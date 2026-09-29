// Arranging the database for the tests: a fixed clock, a brief, searches
// and authored posts. Post text here is invented; no real post appears.
import type { TestDb } from "./pg";

export const T0 = "2026-09-29T12:00:00.000Z";

/** An ISO time `minutes` after T0 (negative for before). */
export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

export const OWNER_BODY = "## Owner\n\nThe owner.\n\n## Topics\n\n- Running agents in production.";

export async function seedBrief(db: TestDb, body = OWNER_BODY): Promise<number> {
  const result = await db.rpc<{ versionId: number }>("create_brief_version", {
    p_owner_body: body,
    p_learned: null,
    p_created_by: "owner",
    p_now: at(-600),
  });
  return result.versionId;
}

export async function seedSearch(db: TestDb, id: string, everyMinutes = 5, enabled = true): Promise<void> {
  await db.rpc("create_search", {
    p_id: id,
    p_label: `Search ${id}`,
    p_query: `${id} -is:retweet`,
    p_every_minutes: everyMinutes,
    p_enabled: enabled,
  });
}

export interface Candidate {
  id: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  authorFollowers: number;
  text: string;
  createdAt: string;
  conversationId: string | null;
  context: { kind: string; id: string; authorHandle: string; text: string } | null;
  metrics: { like: number; reply: number; repost: number; quote: number; impression: number };
}

export function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    authorId: `9${id}`,
    authorHandle: `author${id}`,
    authorName: `Author ${id}`,
    authorFollowers: 1200,
    text: `Invented post ${id} about running agents for hours.`,
    createdAt: at(-30),
    conversationId: id,
    context: null,
    metrics: { like: 3, reply: 1, repost: 0, quote: 0, impression: 400 },
    ...overrides,
  };
}

/** Stores candidates for a search as run_search would, at time `now`. */
export async function store(
  db: TestDb,
  searchId: string,
  posts: Candidate[],
  now = T0,
  session = "scout-1",
): Promise<{ fetched: number; stored: number; alreadyKnown: number }> {
  const newest = posts.map((p) => p.id).sort((a, b) => (BigInt(a) > BigInt(b) ? -1 : 1))[0] ?? null;
  return db.rpc("record_candidates", {
    p_search_id: searchId,
    p_session_id: session,
    p_newest_id: newest,
    p_posts: posts,
    p_post_reads: posts.length,
    p_user_reads: new Set(posts.map((p) => p.authorId)).size,
    p_now: now,
  });
}

export async function judge(
  db: TestDb,
  judgments: { postId: string; score: number; reason?: string }[],
  now = T0,
  session = "scout-1",
): Promise<{ accepted: number; rejected: { postId: string; error: string }[] }> {
  return db.rpc("record_judgments", {
    p_session_id: session,
    p_model: "anthropic/claude-sonnet-5.5",
    p_judgments: judgments.map((j) => ({ reason: "On topic.", ...j })),
    p_now: now,
  });
}
