// The agent's routes (/api/agent/*): each validates its body against the
// contract, calls one database function and shapes the answer for the tool.
// The guard in front of them has already checked the bearer token.
import { candidatesBody, firstIssue, judgmentsBody, learnedBody, leaseBody, reportBody } from "../shared/contract";
import { type LearnedRule, renderBrief } from "./brief";
import { isRefusal } from "./db";
import { startLearning } from "./learning";
import { answer, problem, refused } from "./problem";
import type { Wiring } from "./wiring";

/** A leased batch travels to the model under this many bytes of JSON (GAP(G10)). */
export const BATCH_BYTES = 40 * 1024;

const iso = (w: Wiring) => new Date(w.now()).toISOString();

async function body(req: Request): Promise<unknown> {
  return req.json().catch(() => undefined);
}

function sessionParam(req: Request): string | null {
  const value = new URL(req.url).searchParams.get("sessionId")?.trim();
  return value && value.length <= 200 ? value : null;
}

function invalid(message: string): Response {
  return problem(400, "invalid_request", message);
}

interface Work {
  brief: { versionId: number; ownerBody: string; learned: LearnedRule[] };
  feedback: unknown[];
  searches: unknown[];
  unconsolidated: number;
}

/** GET /api/agent/work */
export async function work(req: Request, w: Wiring): Promise<Response> {
  const sessionId = sessionParam(req);
  if (!sessionId) return invalid("sessionId is required");
  const result = await w.db.rpc<Work>("begin_scout_run", {
    p_session_id: sessionId,
    p_now: iso(w),
  });
  if (isRefusal(result)) return refused(result);
  // The database starts a run only when unconsolidated feedback exists and
  // none is open; the same pass ends the sessions of finished runs.
  w.waitUntil(startLearning(w));
  return Response.json({
    brief: renderBrief(result.brief.ownerBody, result.brief.learned),
    feedback: result.feedback,
    searches: result.searches,
  });
}

/** POST /api/agent/searches/:id/claim */
export async function claim(req: Request, searchId: string, w: Wiring): Promise<Response> {
  const parsed = (await body(req)) as { sessionId?: unknown } | undefined;
  if (typeof parsed?.sessionId !== "string" || !parsed.sessionId) return invalid("sessionId is required");
  return answer(
    await w.db.rpc("claim_search", {
      p_search_id: searchId,
      p_session_id: parsed.sessionId,
      p_now: iso(w),
    }),
  );
}

/** POST /api/agent/candidates */
export async function candidates(req: Request, w: Wiring): Promise<Response> {
  const parsed = candidatesBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  const b = parsed.data;
  return answer(
    await w.db.rpc("record_candidates", {
      p_search_id: b.searchId,
      p_session_id: b.sessionId,
      p_newest_id: b.newestId,
      p_posts: b.posts,
      p_post_reads: b.postReads,
      p_user_reads: b.userReads,
      p_now: iso(w),
    }),
  );
}

/**
 * A leased batch cut to BATCH_BYTES of JSON. Posts cut off stay leased to
 * the session and come back on its next call, so they count as waiting.
 */
export function bounded<T extends { posts: unknown[]; waiting: number }>(batch: T): T {
  const posts = [...batch.posts];
  let cut = 0;
  while (posts.length > 1 && JSON.stringify({ ...batch, posts }).length > BATCH_BYTES) {
    posts.pop();
    cut += 1;
  }
  return { ...batch, posts, waiting: batch.waiting + cut };
}

/** POST /api/agent/queue/lease */
export async function lease(req: Request, w: Wiring): Promise<Response> {
  const parsed = leaseBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  const result = await w.db.rpc<{ posts: unknown[]; waiting: number }>("lease_posts", {
    p_session_id: parsed.data.sessionId,
    p_limit: parsed.data.limit,
    p_now: iso(w),
  });
  return isRefusal(result) ? refused(result) : Response.json(bounded(result));
}

/** POST /api/agent/judgments */
export async function judgments(req: Request, w: Wiring): Promise<Response> {
  const parsed = judgmentsBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  return answer(
    await w.db.rpc("record_judgments", {
      p_session_id: parsed.data.sessionId,
      p_model: parsed.data.model,
      p_judgments: parsed.data.judgments,
      p_now: iso(w),
    }),
  );
}

/** POST /api/agent/report */
export async function report(req: Request, w: Wiring): Promise<Response> {
  const parsed = reportBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  const result = await w.db.rpc<{ role: string; closed: boolean; startNext?: boolean }>("record_report", {
    p_session_id: parsed.data.sessionId,
    p_report: parsed.data.report,
    p_now: iso(w),
  });
  if (isRefusal(result)) return refused(result);
  if (result.startNext) w.waitUntil(startLearning(w));
  return Response.json(result);
}

/** GET /api/agent/learning */
export async function learning(req: Request, w: Wiring): Promise<Response> {
  const sessionId = sessionParam(req);
  if (!sessionId) return invalid("sessionId is required");
  const result = await w.db.rpc<{
    brief: { versionId: number; ownerBody: string; learned: LearnedRule[] };
    feedback: unknown[];
  }>("offer_feedback", { p_session_id: sessionId });
  if (isRefusal(result)) return refused(result);
  return Response.json({
    versionId: result.brief.versionId,
    ownerSections: result.brief.ownerBody,
    learned: result.brief.learned,
    feedback: result.feedback,
  });
}

/** POST /api/agent/learning/rules */
export async function saveLearned(req: Request, w: Wiring): Promise<Response> {
  const parsed = learnedBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  return answer(
    await w.db.rpc("save_learned", {
      p_session_id: parsed.data.sessionId,
      p_base_version_id: parsed.data.baseVersionId,
      p_rules: parsed.data.rules,
      p_considered: parsed.data.considered,
      p_now: iso(w),
    }),
  );
}

/** POST /api/agent/learning/rescores/lease */
export async function leaseRescores(req: Request, w: Wiring): Promise<Response> {
  const parsed = leaseBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  const result = await w.db.rpc<{ versionId: number; posts: unknown[]; waiting: number }>("lease_rescores", {
    p_session_id: parsed.data.sessionId,
    p_limit: parsed.data.limit,
    p_threshold: w.config.threshold,
    p_now: iso(w),
  });
  return isRefusal(result) ? refused(result) : Response.json(bounded(result));
}

/** POST /api/agent/learning/rescores */
export async function rescores(req: Request, w: Wiring): Promise<Response> {
  const parsed = judgmentsBody.safeParse(await body(req));
  if (!parsed.success) return invalid(firstIssue(parsed.error));
  return answer(
    await w.db.rpc("record_rescores", {
      p_session_id: parsed.data.sessionId,
      p_model: parsed.data.model,
      p_judgments: parsed.data.judgments,
      p_threshold: w.config.threshold,
      p_now: iso(w),
    }),
  );
}
