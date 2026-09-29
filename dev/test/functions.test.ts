// Every database function, run in PGlite against the real migration.
import { beforeEach, describe, expect, it } from "vitest";
import { at, candidate, judge, seedBrief, seedSearch, store, T0 } from "./arrange";
import { freshDb, type TestDb } from "./pg";

let db: TestDb;

beforeEach(async () => {
  db = await freshDb();
});

type Work = {
  error?: string;
  brief: { versionId: number; ownerBody: string; learned: unknown[] };
  feedback: { id: number; verdict: string; note: string | null; author: string; text: string }[];
  searches: { id: string; label: string }[];
  spend: { todayUsd: number; capUsd: number };
  unconsolidated: number;
};

const work = (now = T0, session = "scout-1") =>
  db.rpc<Work>("begin_scout_run", { p_session_id: session, p_cap_usd: 25, p_now: now });
const claim = (id: string, now = T0, cap = 25) =>
  db.rpc<{ error?: string; query?: string; sinceId?: string | null }>("claim_search", {
    p_search_id: id,
    p_cap_usd: cap,
    p_now: now,
  });

describe("begin_scout_run", () => {
  it("refuses without an active brief but still records the run", async () => {
    expect(await work()).toEqual({ error: "no_brief" });
    expect(await db.query("select session_id from scout_runs")).toEqual([{ session_id: "scout-1" }]);
  });

  it("is idempotent per session and lists only due searches", async () => {
    await seedBrief(db);
    await seedSearch(db, "fast", 5);
    await seedSearch(db, "slow", 60);
    await seedSearch(db, "off", 5, false);
    await db.query("update searches set last_run_at = $1 where id = 'slow'", [at(-30)]);
    await db.query("update searches set last_run_at = $1 where id = 'fast'", [at(-4)]);
    const first = await work();
    expect(first.searches.map((s) => s.id)).toEqual(["fast"]);
    await work();
    expect(await db.query("select count(*)::int as n from scout_runs")).toEqual([{ n: 1 }]);
  });

  it("carries the newest 20 unconsolidated feedback items verbatim", async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(
      db,
      "s",
      Array.from({ length: 22 }, (_, i) => candidate(String(100 + i))),
    );
    for (let i = 0; i < 22; i += 1) {
      await db.rpc("put_feedback", {
        p_post_id: String(100 + i),
        p_verdict: "not_relevant",
        p_note: i === 21 ? "Trading bots are not our agents" : null,
        p_now: at(i),
      });
    }
    const result = await work(at(30));
    expect(result.feedback).toHaveLength(20);
    expect(result.feedback[0]).toMatchObject({
      verdict: "not_relevant",
      note: "Trading bots are not our agents",
      author: "author121",
    });
    expect(result.unconsolidated).toBe(22);
  });
});

describe("claim_search", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s", 15);
  });

  it("returns the query and stamps the run; a second claim is not due", async () => {
    expect(await claim("s")).toEqual({ query: "s -is:retweet", sinceId: null });
    expect(await claim("s", at(5))).toEqual({ error: "not_due" });
    // Due again one minute early, so a five-minute schedule never skips a beat.
    expect(await claim("s", at(14))).toMatchObject({ query: "s -is:retweet" });
  });

  it("hands back the cursor, and drops it after 6 days", async () => {
    await claim("s");
    await store(db, "s", [candidate("500"), candidate("900")]);
    expect(await claim("s", at(15))).toMatchObject({ sinceId: "900" });
    await db.query("update searches set last_run_at = $1", [at(-6 * 24 * 60 - 1)]);
    expect(await claim("s")).toMatchObject({ sinceId: null });
  });

  it("refuses at the budget cap without stamping, and for unknown or disabled searches", async () => {
    await db.query("insert into usage_daily (day, spend_usd) values ('2026-09-29', 25)");
    expect(await claim("s")).toEqual({ error: "budget_exhausted" });
    expect(await db.query("select last_run_at from searches")).toEqual([{ last_run_at: null }]);
    // Spend is per UTC day: tomorrow the cap is fresh.
    expect(await claim("s", "2026-09-30T00:01:00.000Z")).toMatchObject({ query: "s -is:retweet" });
    expect(await claim("nope", "2026-09-30T00:01:00.000Z")).toEqual({ error: "unknown_search" });
    await seedSearch(db, "off", 5, false);
    expect(await claim("off", "2026-09-30T00:01:00.000Z")).toEqual({ error: "not_due" });
  });

  it("refuses without a brief", async () => {
    await db.query("update brief_versions set status = 'superseded'");
    expect(await claim("s")).toEqual({ error: "no_brief" });
  });
});

describe("record_candidates", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "a");
    await seedSearch(db, "b");
  });

  it("stores new posts once, first search wins, and refreshes known ones", async () => {
    expect(await store(db, "a", [candidate("1"), candidate("2")])).toEqual({ fetched: 2, stored: 2, alreadyKnown: 0 });
    const again = candidate("2", { metrics: { like: 50, reply: 9, repost: 0, quote: 0, impression: 9000 } });
    expect(await store(db, "b", [again, candidate("3")])).toEqual({ fetched: 2, stored: 1, alreadyKnown: 1 });
    const rows = await db.query<{ id: string; search_id: string; likes: number }>(
      "select id, search_id, (metrics->>'like')::int as likes from posts order by id",
    );
    expect(rows).toEqual([
      { id: "1", search_id: "a", likes: 3 },
      { id: "2", search_id: "a", likes: 50 },
      { id: "3", search_id: "b", likes: 3 },
    ]);
  });

  it("advances the cursor only forwards, comparing ids as numbers", async () => {
    await store(db, "a", [candidate("99")]);
    await store(db, "a", [candidate("100")]);
    await store(db, "a", [candidate("98")]);
    expect(await db.query("select since_id from searches where id = 'a'")).toEqual([{ since_id: "100" }]);
    await store(db, "a", []);
    expect(await db.query("select since_id from searches where id = 'a'")).toEqual([{ since_id: "100" }]);
  });

  it("adds every returned object to today's spend and records the run", async () => {
    await db.rpc("record_candidates", {
      p_search_id: "a",
      p_session_id: "scout-1",
      p_newest_id: "5",
      p_posts: [candidate("5")],
      p_post_reads: 3,
      p_user_reads: 2,
      p_now: T0,
    });
    expect(await db.query("select spend_usd::float as usd, post_reads, user_reads from usage_daily")).toEqual([
      { usd: 0.035, post_reads: 3, user_reads: 2 },
    ]);
    expect(await db.query("select fetched, stored from search_runs")).toEqual([{ fetched: 1, stored: 1 }]);
  });

  it("clears text 48 hours after a post's creation and deletes rows after 7 days", async () => {
    await store(db, "a", [candidate("1", { createdAt: at(-60) })], at(-8 * 24 * 60));
    await store(db, "a", [candidate("2", { createdAt: at(-47 * 60), context: null })], at(-10));
    await store(db, "a", [candidate("3", { createdAt: at(-72 * 60) })], at(-5));
    await store(db, "a", [candidate("4")]);
    const rows = await db.query<{ id: string; has_text: boolean }>(
      "select id, text is not null as has_text from posts order by id",
    );
    // 1 was fetched 8 days ago and is gone; 2 is inside the window; 3 was
    // older than 48 hours on arrival and never kept its text.
    expect(rows).toEqual([
      { id: "2", has_text: true },
      { id: "3", has_text: false },
      { id: "4", has_text: true },
    ]);
    await store(db, "a", [], at(2 * 60));
    expect(await db.query("select id from posts where text is not null order by id")).toEqual([{ id: "4" }]);
  });

  it("refuses an unknown search", async () => {
    expect(await store(db, "zzz", [candidate("1")])).toEqual({ error: "unknown_search" });
  });
});

describe("lease_posts and record_judgments", () => {
  const lease = (session: string, limit = 25, now = T0) =>
    db.rpc<{ posts: { id: string; text: string; ageMinutes: number; context: unknown }[]; waiting: number }>(
      "lease_posts",
      { p_session_id: session, p_limit: limit, p_now: now },
    );

  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(
      db,
      "s",
      Array.from({ length: 30 }, (_, i) => candidate(String(1000 + i))),
    );
  });

  it("leases oldest first in batches, compactly, and counts what waits", async () => {
    const first = await lease("scout-1", 25);
    expect(first.posts).toHaveLength(25);
    expect(first.waiting).toBe(5);
    expect(first.posts[0]).toMatchObject({
      id: "1000",
      author: "author1000",
      followers: 1200,
      ageMinutes: 30,
      replies: 1,
      likes: 3,
    });
    const other = await lease("scout-2", 25);
    expect(other.posts.map((p) => p.id)).toEqual(["1025", "1026", "1027", "1028", "1029"]);
    expect(other.waiting).toBe(0);
  });

  it("returns a session's own leased posts again and takes over expired leases", async () => {
    await lease("scout-1", 10);
    expect((await lease("scout-1", 10)).posts[0]?.id).toBe("1000");
    expect((await lease("scout-2", 5)).posts[0]?.id).toBe("1010");
    const later = await lease("scout-3", 25, at(11));
    expect(later.posts[0]?.id).toBe("1000");
  });

  it("truncates long text and context for the model", async () => {
    await store(db, "s", [
      candidate("2000", {
        text: "x".repeat(900),
        context: { kind: "replied_to", id: "1", authorHandle: "parent", text: "y".repeat(500) },
      }),
    ]);
    await judge(
      db,
      Array.from({ length: 30 }, (_, i) => ({ postId: String(1000 + i), score: 10 })),
    );
    const [post] = (await lease("scout-1")).posts;
    expect(post?.text).toHaveLength(600);
    expect(post?.context).toEqual({ kind: "replied_to", author: "parent", text: "y".repeat(300) });
  });

  it("never leases posts older than the feed window", async () => {
    await store(db, "s", [candidate("3000", { createdAt: at(-49 * 60) })]);
    const ids = [...(await lease("a", 25)).posts, ...(await lease("b", 25)).posts].map((p) => p.id);
    expect(ids).not.toContain("3000");
  });

  it("judges each post once per scout, validates, and releases the lease", async () => {
    await lease("scout-1", 2);
    const result = await judge(db, [
      { postId: "1000", score: 80 },
      { postId: "1000", score: 20 },
      { postId: "nope", score: 50 },
      { postId: "1001", score: 101 },
      { postId: "1002", score: 50, reason: "" },
      { postId: "1003", score: 49.5 },
      { postId: "1004", score: "high" as unknown as number },
    ]);
    expect(result).toEqual({
      accepted: 1,
      rejected: [
        { postId: "1000", error: "already_judged" },
        { postId: "nope", error: "unknown_post" },
        { postId: "1001", error: "invalid_score" },
        { postId: "1002", error: "invalid_reason" },
        { postId: "1003", error: "invalid_score" },
        { postId: "1004", error: "invalid_score" },
      ],
    });
    expect(await db.query("select leased_until from posts where id = '1000'")).toEqual([{ leased_until: null }]);
    const [row] = await db.query<{ kind: string; brief_version_id: number; model: string }>(
      "select kind, brief_version_id, model from judgments",
    );
    expect(row).toMatchObject({ kind: "scout", model: "anthropic/claude-sonnet-5.5" });
  });
});

describe("record_report", () => {
  it("closes a scout run once", async () => {
    await work();
    const report = { role: "scout", searches: [], judged: 0, notes: "" };
    expect(await db.rpc("record_report", { p_session_id: "scout-1", p_report: report, p_now: T0 })).toEqual({
      role: "scout",
      closed: true,
    });
    expect(await db.rpc("record_report", { p_session_id: "scout-1", p_report: report, p_now: at(1) })).toEqual({
      role: "scout",
      closed: false,
    });
  });

  it("refuses a learning report from a session that runs no learning run", async () => {
    expect(await db.rpc("record_report", { p_session_id: "x", p_report: { role: "learning" }, p_now: T0 })).toEqual({
      error: "not_learning_session",
    });
  });
});

describe("feedback", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(db, "s", [candidate("1"), candidate("2")]);
  });

  const put = (post: string, verdict = "not_relevant", note: string | null = null) =>
    db.rpc<{ id?: number; error?: string }>("put_feedback", {
      p_post_id: post,
      p_verdict: verdict,
      p_note: note,
      p_now: T0,
    });

  it("replaces unconsolidated feedback with a new row", async () => {
    const first = await put("1");
    const second = await put("1", "relevant", "  good one  ");
    expect(second.id).toBeGreaterThan(first.id ?? 0);
    expect(await db.query("select verdict, note from feedback")).toEqual([{ verdict: "relevant", note: "good one" }]);
  });

  it("refuses unknown posts, bad verdicts and long notes", async () => {
    expect(await put("zzz")).toEqual({ error: "unknown_post" });
    expect(await put("1", "meh")).toEqual({ error: "invalid_verdict" });
    expect(await put("1", "relevant", "n".repeat(281))).toEqual({ error: "invalid_note" });
  });

  it("withdraws until consolidated, then refuses both", async () => {
    await put("1");
    expect(await db.rpc("withdraw_feedback", { p_post_id: "1" })).toMatchObject({ withdrawn: expect.any(Number) });
    expect(await db.rpc("withdraw_feedback", { p_post_id: "1" })).toEqual({ error: "not_found" });
    await put("2");
    await db.query("update feedback set consolidated_in = 1");
    expect(await db.rpc("withdraw_feedback", { p_post_id: "2" })).toEqual({ error: "consolidated" });
    expect(await put("2", "relevant")).toEqual({ error: "consolidated" });
  });

  it("marks a post opened once", async () => {
    await db.rpc("mark_opened", { p_post_id: "1", p_now: T0 });
    await db.rpc("mark_opened", { p_post_id: "1", p_now: at(5) });
    expect(await db.query("select opened_at::text as t from posts where id = '1'")).toEqual([
      { t: "2026-09-29 12:00:00+00" },
    ]);
    expect(await db.rpc("mark_opened", { p_post_id: "zzz" })).toEqual({ error: "unknown_post" });
  });
});

describe("brief versions", () => {
  const rules = [{ id: "r1", text: "Crypto agents are not relevant.", feedbackIds: [1] }];

  it("switches the active version atomically and keeps learned rules on owner edits", async () => {
    const v1 = await seedBrief(db);
    await db.query("update brief_versions set learned = $1 where id = $2", [JSON.stringify(rules), v1]);
    const { versionId: v2 } = await db.rpc<{ versionId: number }>("create_brief_version", {
      p_owner_body: "## Owner\n\nEdited.",
      p_learned: null,
      p_created_by: "owner",
    });
    const rows = await db.query<{ id: number; status: string; based_on: number | null; learned: unknown }>(
      "select id, status, based_on, learned from brief_versions order by id",
    );
    expect(rows).toEqual([
      { id: v1, status: "superseded", based_on: null, learned: rules },
      { id: v2, status: "active", based_on: v1, learned: rules },
    ]);
  });

  it("deletes a learned rule as a new version, and restores an old version as a new one", async () => {
    const v1 = await seedBrief(db);
    await db.query("update brief_versions set learned = $1 where id = $2", [JSON.stringify(rules), v1]);
    expect(await db.rpc("delete_learned_rule", { p_rule_id: "nope" })).toEqual({ error: "not_found" });
    const { versionId: v2 } = await db.rpc<{ versionId: number }>("delete_learned_rule", { p_rule_id: "r1" });
    expect(await db.query("select learned from brief_versions where id = $1", [v2])).toEqual([{ learned: [] }]);
    const { versionId: v3 } = await db.rpc<{ versionId: number }>("restore_brief_version", { p_version_id: v1 });
    expect(await db.query("select learned, based_on, status from brief_versions where id = $1", [v3])).toEqual([
      { learned: rules, based_on: v1, status: "active" },
    ]);
    expect(await db.rpc("restore_brief_version", { p_version_id: 999 })).toEqual({ error: "not_found" });
  });

  it("refuses an empty body and malformed rules", async () => {
    expect(await db.rpc("create_brief_version", { p_owner_body: " ", p_learned: null, p_created_by: "owner" })).toEqual(
      {
        error: "invalid_brief",
      },
    );
    expect(
      await db.rpc("create_brief_version", { p_owner_body: "x", p_learned: [{ id: "r" }], p_created_by: "owner" }),
    ).toEqual({ error: "invalid_rules" });
  });
});

describe("learning runs", () => {
  const begin = (now = T0) => db.rpc<{ id: number | null }>("begin_learning_run", { p_now: now });
  const offer = (session: string) =>
    db.rpc<{
      error?: string;
      brief: { versionId: number; learned: { id: string; feedbackIds: number[] }[] };
      feedback: { id: number }[];
    }>("offer_feedback", { p_session_id: session });
  const save = (
    session: string,
    base: number,
    rules: { text: string; feedbackIds: number[] }[],
    considered: number[] = [],
  ) =>
    db.rpc<{ error?: string; versionId?: number; feedbackIds?: number[] }>("save_learned", {
      p_session_id: session,
      p_base_version_id: base,
      p_rules: rules,
      p_considered: considered,
      p_now: T0,
    });

  async function started(session = "learn-1", now = T0): Promise<number> {
    const { id } = await begin(now);
    if (id === null) throw new Error("no run started");
    await db.rpc("attach_learning_session", { p_run_id: id, p_session_id: session });
    return id;
  }

  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(
      db,
      "s",
      ["1", "2", "3", "4"].map((id) => candidate(id)),
    );
    await judge(db, [
      { postId: "1", score: 90 },
      { postId: "2", score: 70 },
      { postId: "3", score: 45 },
      { postId: "4", score: 20 },
    ]);
  });

  it("starts only with unconsolidated feedback, one at a time, and abandons a stale one", async () => {
    expect(await begin()).toEqual({ id: null });
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    const { id } = await begin();
    expect(id).toEqual(expect.any(Number));
    expect(await begin(at(10))).toEqual({ id: null });
    const { id: next } = await begin(at(16));
    expect(next).toBeGreaterThan(id ?? 0);
    expect(await db.query("select abandoned from learning_runs order by id")).toEqual([
      { abandoned: true },
      { abandoned: false },
    ]);
  });

  it("serves only the session running the open run", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started("learn-1");
    expect(await offer("someone-else")).toEqual({ error: "not_learning_session" });
    expect((await offer("learn-1")).feedback).toHaveLength(1);
  });

  it("folds covered feedback into a new version and refuses uncovered or foreign ids", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: "crypto", p_now: T0 });
    await db.rpc("put_feedback", { p_post_id: "2", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started();
    const offered = await offer("learn-1");
    const [f1, f2] = offered.feedback.map((f) => f.id);
    const base = offered.brief.versionId;
    expect(await save("learn-1", base, [{ text: "Crypto agents are not relevant.", feedbackIds: [f1 ?? 0] }])).toEqual({
      error: "uncovered_feedback",
      feedbackIds: [f2],
    });
    expect(await save("learn-1", base, [{ text: "x", feedbackIds: [999] }], [f1 ?? 0, f2 ?? 0])).toEqual({
      error: "invalid_feedback_ids",
    });
    const saved = await save(
      "learn-1",
      base,
      [{ text: "Crypto agents are not relevant.", feedbackIds: [f1 ?? 0] }],
      [f2 ?? 0],
    );
    expect(saved).toMatchObject({ versionId: expect.any(Number), rules: 1 });
    expect(await db.query("select count(*)::int as n from feedback where consolidated_in is null")).toEqual([{ n: 0 }]);
    const [active] = await db.query<{ created_by: string; learned: { text: string; feedbackIds: number[] }[] }>(
      "select created_by, learned from brief_versions where status = 'active'",
    );
    expect(active?.created_by).toBe("learning");
    expect(active?.learned[0]).toMatchObject({ text: "Crypto agents are not relevant.", feedbackIds: [f1] });
  });

  it("refuses a save based on stale learned rules", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started();
    const offered = await offer("learn-1");
    await db.rpc("create_brief_version", {
      p_owner_body: "## Owner\n\nRestored.",
      p_learned: [{ id: "r9", text: "An older rule, restored.", feedbackIds: [] }],
      p_created_by: "owner",
    });
    const ids = offered.feedback.map((f) => f.id);
    expect(await save("learn-1", offered.brief.versionId, [], ids)).toEqual({ error: "stale_learned" });
  });

  it("re-scores Open and near-threshold Filtered posts once under the new version", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started();
    const offered = await offer("learn-1");
    await save(
      "learn-1",
      offered.brief.versionId,
      [],
      offered.feedback.map((f) => f.id),
    );
    const leased = await db.rpc<{ posts: { id: string }[]; waiting: number }>("lease_rescores", {
      p_session_id: "learn-1",
      p_limit: 25,
      p_threshold: 60,
      p_now: T0,
    });
    // 1 has feedback; 4 is Filtered but more than 20 below the threshold.
    expect(leased.posts.map((p) => p.id)).toEqual(["2", "3"]);
    const record = (postId: string, score: number) =>
      db.rpc("record_rescores", {
        p_session_id: "learn-1",
        p_model: "m",
        p_judgments: [{ postId, score, reason: "Re-scored." }],
        p_threshold: 60,
        p_now: T0,
      });
    expect(await record("2", 30)).toEqual({ accepted: 1, rejected: [] });
    expect(await record("2", 35)).toEqual({ accepted: 0, rejected: [{ postId: "2", error: "already_rescored" }] });
    expect(await record("4", 35)).toEqual({ accepted: 0, rejected: [{ postId: "4", error: "not_in_rescore_set" }] });
    const [current] = await db.query<{ score: number; kind: string }>(
      "select score, kind from current_judgments where post_id = '2'",
    );
    expect(current).toEqual({ score: 30, kind: "rescore" });
  });

  it("closes on its report, says whether newer feedback waits, and lists its session to end", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started();
    const offered = await offer("learn-1");
    await save(
      "learn-1",
      offered.brief.versionId,
      [],
      offered.feedback.map((f) => f.id),
    );
    await db.rpc("put_feedback", { p_post_id: "2", p_verdict: "not_relevant", p_note: null, p_now: at(1) });
    const report = { role: "learning", rulesBefore: 0, rulesAfter: 0, consolidated: 1, rescored: 0, notes: "" };
    expect(await db.rpc("record_report", { p_session_id: "learn-1", p_report: report, p_now: at(2) })).toEqual({
      role: "learning",
      closed: true,
      startNext: true,
    });
    expect(await db.rpc("record_report", { p_session_id: "learn-1", p_report: report, p_now: at(3) })).toEqual({
      role: "learning",
      closed: false,
      startNext: false,
    });
    expect(await db.rpc("learning_sessions_to_end")).toEqual(["learn-1"]);
    await db.rpc("mark_learning_session_ended", { p_session_id: "learn-1" });
    expect(await db.rpc("learning_sessions_to_end")).toEqual([]);
    expect(await offer("learn-1")).toEqual({ error: "not_learning_session" });
  });

  it("keeps a deleted rule's feedback consolidated", async () => {
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await started();
    const offered = await offer("learn-1");
    const [f1] = offered.feedback.map((f) => f.id);
    await save("learn-1", offered.brief.versionId, [{ text: "Rule.", feedbackIds: [f1 ?? 0] }]);
    const [active] = await db.query<{ learned: { id: string }[] }>(
      "select learned from brief_versions where status = 'active'",
    );
    await db.rpc("delete_learned_rule", { p_rule_id: active?.learned[0]?.id });
    expect(await db.query("select count(*)::int as n from feedback where consolidated_in is null")).toEqual([{ n: 0 }]);
    expect(await begin(at(20))).toEqual({ id: null });
  });
});

describe("the feed", () => {
  const page = (filter: string, cursor: unknown = null, limit = 50, now = T0) =>
    db.rpc<{ items: { id: string; rank: number | null; feedback: unknown }[]; nextCursor: unknown }>("feed_page", {
      p_filter: filter,
      p_threshold: 60,
      p_cursor: cursor,
      p_limit: limit,
      p_now: now,
    });

  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(db, "s", [
      candidate("1", { createdAt: at(-10) }),
      candidate("2", { createdAt: at(-6 * 60) }),
      candidate("3", { createdAt: at(-20) }),
      candidate("4", { createdAt: at(-30) }),
      candidate("5", { createdAt: at(-40) }),
      candidate("6", { createdAt: at(-50 * 60) }),
    ]);
    await judge(db, [
      { postId: "1", score: 70 },
      { postId: "2", score: 100 },
      { postId: "3", score: 20 },
      { postId: "4", score: 80 },
      { postId: "5", score: 90 },
      { postId: "6", score: 99 },
    ]);
  });

  it("ranks Open by decayed score and pages by cursor", async () => {
    const first = await page("open", null, 2);
    // 5: 90 × 0.5^(40/360) ≈ 83.4; 4: 80 × … ≈ 75.6; 1: ≈ 68.7; 2: 100 × 0.5 = 50.
    expect(first.items.map((i) => i.id)).toEqual(["5", "4"]);
    const second = await page("open", first.nextCursor, 2, at(30));
    expect(second.items.map((i) => i.id)).toEqual(["1", "2"]);
    const third = await page("open", second.nextCursor, 2);
    expect(third.items).toEqual([]);
    expect(third.nextCursor).toBeNull();
  });

  it("puts low scores in Filtered and opened or marked posts in Handled", async () => {
    expect((await page("filtered")).items.map((i) => i.id)).toEqual(["3"]);
    await db.rpc("mark_opened", { p_post_id: "5", p_now: at(1) });
    await db.rpc("put_feedback", { p_post_id: "3", p_verdict: "relevant", p_note: "yes", p_now: at(2) });
    expect((await page("open")).items.map((i) => i.id)).toEqual(["4", "1", "2"]);
    expect((await page("filtered")).items).toEqual([]);
    const handled = await page("handled");
    expect(handled.items.map((i) => i.id)).toEqual(["3", "5"]);
    expect(handled.items[0]?.feedback).toMatchObject({ verdict: "relevant", note: "yes", consolidated: false });
  });

  it("shows a re-score as the current judgment", async () => {
    await db.query(
      "insert into judgments (post_id, kind, score, reason, brief_version_id, session_id, model, judged_at) values ('4', 'rescore', 10, 'Learned.', 1, 'l', 'm', $1)",
      [at(1)],
    );
    expect((await page("filtered")).items.map((i) => i.id)).toEqual(["3", "4"]);
  });

  it("counts Open items judged since a time", async () => {
    expect(await db.rpc("feed_new_count", { p_since: at(-1), p_threshold: 60, p_now: T0 })).toEqual({ count: 4 });
    expect(await db.rpc("feed_new_count", { p_since: at(1), p_threshold: 60, p_now: T0 })).toEqual({ count: 0 });
  });

  it("refuses an unknown filter", async () => {
    expect(await page("everything")).toEqual({ error: "invalid_filter" });
  });
});

describe("searches and status", () => {
  it("creates, patches and reports stats", async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    expect(
      await db.rpc("create_search", { p_id: "s", p_label: "x", p_query: "q", p_every_minutes: 5, p_enabled: true }),
    ).toEqual({
      error: "search_exists",
    });
    expect(
      await db.rpc("create_search", {
        p_id: "Bad Id",
        p_label: "x",
        p_query: "q",
        p_every_minutes: 5,
        p_enabled: true,
      }),
    ).toEqual({ error: "invalid_search" });
    expect(await db.rpc("update_search", { p_id: "s", p_patch: { everyMinutes: 7 } })).toEqual({
      error: "invalid_search",
    });
    await store(db, "s", [candidate("1"), candidate("2")]);
    await judge(db, [
      { postId: "1", score: 90 },
      { postId: "2", score: 10 },
    ]);
    await db.rpc("put_feedback", { p_post_id: "1", p_verdict: "not_relevant", p_note: null, p_now: T0 });
    await db.rpc("update_search", { p_id: "s", p_patch: { query: "new query", enabled: false } });
    const [stats] = await db.rpc<Record<string, unknown>[]>("search_stats", { p_threshold: 60, p_now: T0 });
    expect(stats).toMatchObject({
      id: "s",
      query: "new query",
      enabled: false,
      fetchedToday: 2,
      openToday: 1,
      notRelevant7d: 1,
    });
    // A new query restarts its cursor.
    expect(await db.query("select since_id from searches")).toEqual([{ since_id: null }]);
    const status = await db.rpc<Record<string, unknown>>("app_status", { p_cap_usd: 25, p_now: T0 });
    expect(status).toMatchObject({ spend: { todayUsd: 0.03, capUsd: 25 }, learning: null, unconsolidated: 1 });
  });

  it("upserts a seed's searches enabled", async () => {
    await seedSearch(db, "s", 5, false);
    await db.rpc("upsert_searches", {
      p_searches: [
        { id: "s", label: "S", query: "s -is:retweet", everyMinutes: 15 },
        { id: "t", label: "T", query: "t", everyMinutes: 60 },
      ],
    });
    expect(await db.query("select id, enabled, every_minutes from searches order by id")).toEqual([
      { id: "s", enabled: true, every_minutes: 15 },
      { id: "t", enabled: true, every_minutes: 60 },
    ]);
  });

  it("reads the brief state with each rule's feedback", async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await store(db, "s", [candidate("1")]);
    const { id } = await db.rpc<{ id: number }>("put_feedback", {
      p_post_id: "1",
      p_verdict: "not_relevant",
      p_note: "no",
      p_now: T0,
    });
    await db.query("update brief_versions set learned = $1", [
      JSON.stringify([{ id: "r1", text: "Rule.", feedbackIds: [id] }]),
    ]);
    const state = await db.rpc<{
      active: { learned: { feedback: unknown[] }[] };
      queue: unknown[];
      versions: unknown[];
    }>("brief_state");
    expect(state.active.learned[0]?.feedback).toEqual([
      { id, verdict: "not_relevant", note: "no", postId: "1", authorHandle: "author1", text: expect.any(String) },
    ]);
    expect(state.queue).toHaveLength(1);
    expect(state.versions).toHaveLength(1);
  });
});
