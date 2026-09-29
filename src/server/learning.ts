// Starting learning runs, and ending the ones that finished. Two places call
// `startLearning`, always inside waitUntil so no route waits on it: the scout's
// GET /api/agent/work (feedback batches up within the scout's five-minute
// cadence) and a learning run's report when newer feedback is waiting. The
// database decides whether a run starts (one open run at most; a stale one is
// abandoned); this module creates the session, records it on the run, and
// sends the first turn, in that order, so the run's first tool call already
// finds its session on the row.
import type { Wiring } from "./wiring";

export const LEARNING_INPUT = "Fold the owner's new feedback into the brief.";

export async function startLearning(w: Wiring): Promise<{ runId: number | null; sessionId?: string }> {
  if (!w.client || !w.config.oc) {
    console.log("learning: OPENCOMPUTER_API_KEY is not set; no learning run started");
    return { runId: null };
  }
  await endFinishedLearningSessions(w);
  const { id } = await w.db.rpc<{ id: number | null }>("begin_learning_run", { p_now: iso(w) });
  if (id === null) return { runId: null };
  try {
    const created = await w.client.sessions.create(
      { agentId: w.config.oc.agentRef, source: "api" },
      { idempotencyKey: `learn-${String(id)}` },
    );
    const sessionId = created.session.id;
    await w.db.rpc("attach_learning_session", { p_run_id: id, p_session_id: sessionId });
    await w.client.sessions.turns.send(sessionId, {
      input: LEARNING_INPUT,
      payload: { role: "learning" },
      idempotencyKey: `learn-${String(id)}/start`,
    });
    return { runId: id, sessionId };
  } catch (cause) {
    console.error("learning: could not start run", id, cause);
    await w.db.rpc("abandon_learning_run", { p_run_id: id });
    return { runId: id };
  }
}

/**
 * GAP(G14): ending a session cancels its running turn, so a learning run
 * cannot be ended from its own report call without losing the report. The
 * sessions of closed runs are ended here instead, the next time a run is
 * considered.
 */
export async function endFinishedLearningSessions(w: Wiring): Promise<void> {
  if (!w.client) return;
  const sessions = await w.db.rpc<string[]>("learning_sessions_to_end");
  for (const sessionId of sessions) {
    try {
      await w.client.sessions.end(sessionId);
      await w.db.rpc("mark_learning_session_ended", { p_session_id: sessionId, p_now: iso(w) });
    } catch (cause) {
      console.error("learning: could not end session", sessionId, cause);
    }
  }
}

function iso(w: Wiring): string {
  return new Date(w.now()).toISOString();
}
