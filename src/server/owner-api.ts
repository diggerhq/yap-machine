// The owner's routes (/api/*). Cloudflare Access keeps the hostname private;
// the guard in front of these checks that a write comes from the app's own
// origin. Each handler calls one database function.
import { z } from "zod";
import type { FeedPage, Filter } from "../shared/feed";
import { isRefusal } from "./db";
import { answer, problem, refused } from "./problem";
import type { Wiring } from "./wiring";

const iso = (w: Wiring) => new Date(w.now()).toISOString();

async function body(req: Request): Promise<unknown> {
  return req.json().catch(() => undefined);
}

function invalid(error: z.ZodError): Response {
  const issue = error.issues[0];
  return problem(
    400,
    "invalid_request",
    issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request",
  );
}

// The feed cursor is the database's keyset position, opaque to the browser.
function encodeCursor(cursor: unknown): string | null {
  if (!cursor) return null;
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string | null): unknown {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as unknown;
    return z.object({ key: z.number(), id: z.string(), at: z.string() }).parse(parsed);
  } catch {
    return undefined;
  }
}

/** GET /api/feed?filter=&cursor=&limit= */
export async function feed(req: Request, w: Wiring): Promise<Response> {
  const search = new URL(req.url).searchParams;
  const filter = (search.get("filter") ?? "open") as Filter;
  const cursor = decodeCursor(search.get("cursor"));
  if (cursor === undefined) return problem(400, "invalid_cursor", "The cursor is not one this feed issued.");
  const limit = Math.min(100, Math.max(1, Number(search.get("limit") ?? 50) || 50));
  const result = await w.db.rpc<{ items: FeedPage["items"]; nextCursor: unknown; at: string }>("feed_page", {
    p_filter: filter,
    p_threshold: w.config.threshold,
    p_cursor: cursor,
    p_limit: limit,
    p_now: iso(w),
  });
  if (isRefusal(result)) return refused(result);
  return Response.json({
    items: result.items,
    nextCursor: encodeCursor(result.nextCursor),
    at: result.at,
  } satisfies FeedPage);
}

/** GET /api/feed/new-count?since= */
export async function newCount(req: Request, w: Wiring): Promise<Response> {
  const since = new URL(req.url).searchParams.get("since") ?? "";
  if (Number.isNaN(Date.parse(since))) return problem(400, "invalid_request", "since must be a time");
  return answer(await w.db.rpc("feed_new_count", { p_since: since, p_threshold: w.config.threshold, p_now: iso(w) }));
}

/** POST /api/posts/:id/open */
export async function opened(postId: string, w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("mark_opened", { p_post_id: postId, p_now: iso(w) }));
}

/** POST /api/posts/:id/dismiss: Done, without a verdict; teaches nothing. */
export async function dismiss(postId: string, w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("mark_dismissed", { p_post_id: postId, p_now: iso(w) }));
}

/** DELETE /api/posts/:id/dismiss */
export async function undoDismiss(postId: string, w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("undo_dismissed", { p_post_id: postId }));
}

const feedbackBody = z.object({
  verdict: z.enum(["not_relevant", "relevant"]),
  note: z.string().trim().max(280).nullish(),
});

/** PUT /api/posts/:id/feedback */
export async function putFeedback(req: Request, postId: string, w: Wiring): Promise<Response> {
  const parsed = feedbackBody.safeParse(await body(req));
  if (!parsed.success) return invalid(parsed.error);
  return answer(
    await w.db.rpc("put_feedback", {
      p_post_id: postId,
      p_verdict: parsed.data.verdict,
      p_note: parsed.data.note || null,
      p_now: iso(w),
    }),
  );
}

/** DELETE /api/posts/:id/feedback */
export async function withdrawFeedback(postId: string, w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("withdraw_feedback", { p_post_id: postId }));
}

/** GET /api/searches */
export async function searches(w: Wiring): Promise<Response> {
  const result = await w.db.rpc("search_stats", { p_threshold: w.config.threshold, p_now: iso(w) });
  return isRefusal(result) ? refused(result) : Response.json({ searches: result });
}

const searchFields = {
  label: z.string().trim().min(1).max(120),
  query: z.string().trim().min(1).max(512),
  everyMinutes: z.number().int().min(5).max(1440).multipleOf(5),
  enabled: z.boolean(),
};
const createSearchBody = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), ...searchFields });
const patchSearchBody = z.object(searchFields).partial().strict();

/** POST /api/searches */
export async function createSearch(req: Request, w: Wiring): Promise<Response> {
  const parsed = createSearchBody.safeParse(await body(req));
  if (!parsed.success) return invalid(parsed.error);
  const s = parsed.data;
  return answer(
    await w.db.rpc("create_search", {
      p_id: s.id,
      p_label: s.label,
      p_query: s.query,
      p_every_minutes: s.everyMinutes,
      p_enabled: s.enabled,
    }),
    201,
  );
}

/** PATCH /api/searches/:id */
export async function patchSearch(req: Request, id: string, w: Wiring): Promise<Response> {
  const parsed = patchSearchBody.safeParse(await body(req));
  if (!parsed.success) return invalid(parsed.error);
  return answer(await w.db.rpc("update_search", { p_id: id, p_patch: parsed.data }));
}

/** GET /api/brief */
export async function brief(w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("brief_state"));
}

/** GET /api/brief/versions/:id */
export async function briefVersion(id: string, w: Wiring): Promise<Response> {
  if (!/^[0-9]{1,18}$/.test(id)) return problem(404, "not_found", "Not found.");
  return answer(await w.db.rpc("brief_version", { p_version_id: Number(id) }));
}

const ownerBody = z.object({ ownerBody: z.string().trim().min(1).max(50_000) });

/** PUT /api/brief/owner */
export async function putOwnerSections(req: Request, w: Wiring): Promise<Response> {
  const parsed = ownerBody.safeParse(await body(req));
  if (!parsed.success) return invalid(parsed.error);
  return answer(
    await w.db.rpc("create_brief_version", {
      p_owner_body: parsed.data.ownerBody,
      p_learned: null,
      p_created_by: "owner",
      p_now: iso(w),
    }),
  );
}

/** DELETE /api/brief/rules/:ruleId */
export async function deleteRule(ruleId: string, w: Wiring): Promise<Response> {
  return answer(await w.db.rpc("delete_learned_rule", { p_rule_id: ruleId, p_now: iso(w) }));
}

/** POST /api/brief/versions/:id/restore */
export async function restoreVersion(id: string, w: Wiring): Promise<Response> {
  if (!/^[0-9]{1,18}$/.test(id)) return problem(404, "not_found", "Not found.");
  return answer(await w.db.rpc("restore_brief_version", { p_version_id: Number(id), p_now: iso(w) }));
}

/** GET /api/status */
export async function status(w: Wiring): Promise<Response> {
  const result = await w.db.rpc<Record<string, unknown>>("app_status", {
    p_cap_usd: w.config.dailyCapUsd,
    p_now: iso(w),
  });
  return isRefusal(result) ? refused(result) : Response.json({ ...result, threshold: w.config.threshold });
}
