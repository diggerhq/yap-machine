// The routes end to end over PGlite: the guards, validation, and a scout run
// and a learning run driven the way the tools drive them. The management
// client is a recording fake; nothing leaves the process.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODEL_ID } from "../../opencomputer/agents/yap/contract";
import type { Client } from "../../src/server/client";
import type { Config } from "../../src/server/env";
import { configure } from "../../src/server/wiring";
import { at, candidate, seedBrief, seedSearch, T0 } from "./arrange";
import { freshDb, type TestDb } from "./pg";
import { ROUTES, serve } from "./serve";

const ORIGIN = "https://yap.example";
const TOKEN = "t".repeat(43);

const CONFIG: Config = {
  supabase: { url: "https://db.example", secretKey: "unused" },
  agentToken: TOKEN,
  origin: ORIGIN,
  dailyCapUsd: 25,
  threshold: 60,
  oc: { apiKey: "unused", agentRef: "yap-machine@development", origin: "https://oc.example" },
};

interface Calls {
  created: { agentId?: string; key?: string }[];
  sent: { sessionId: string; input: string; payload: unknown; key?: string }[];
  ended: string[];
}

function fakeClient(calls: Calls, failCreate = false): Client {
  let n = 0;
  return {
    sessions: {
      async create(params: { agentId?: string }, options?: { idempotencyKey?: string }) {
        if (failCreate) throw new Error("create failed");
        calls.created.push({ agentId: params.agentId, key: options?.idempotencyKey });
        n += 1;
        return { session: { id: `learn-session-${String(n)}`, status: "idle", createdAt: T0 }, created: true };
      },
      turns: {
        async send(sessionId: string, params: { input: string; payload?: unknown; idempotencyKey?: string }) {
          calls.sent.push({ sessionId, input: params.input, payload: params.payload, key: params.idempotencyKey });
          return { turnId: "turn-1", status: "running", duplicate: false };
        },
      },
      async end(sessionId: string) {
        calls.ended.push(sessionId);
        return { id: sessionId };
      },
    },
  } as unknown as Client;
}

let db: TestDb;
let now: number;
let pending: Promise<unknown>[];
let calls: Calls;

function setup(options: { client?: Client | null; config?: Config } = {}) {
  configure({
    config: options.config ?? CONFIG,
    db,
    client: options.client === undefined ? fakeClient(calls) : options.client,
    now: () => now,
    waitUntil: (work) => {
      pending.push(work);
    },
  });
}

async function settle(): Promise<void> {
  while (pending.length) await pending.shift();
}

beforeEach(async () => {
  db = await freshDb();
  now = Date.parse(T0);
  pending = [];
  calls = { created: [], sent: [], ended: [] };
  setup();
});

afterEach(() => configure());

async function agentCall(method: string, path: string, body?: unknown, token = TOKEN): Promise<Response> {
  return serve(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function ownerCall(method: string, path: string, body?: unknown, origin: string | null = ORIGIN) {
  return serve(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("the route table", () => {
  it("lists every route file", () => {
    const root = join(import.meta.dirname, "..", "..", "src", "routes", "api");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    expect(files(root)).toHaveLength(ROUTES.length);
    expect(relative(root, root)).toBe("");
  });
});

describe("the guards", () => {
  it("require the agent token on every agent route, compared exactly", async () => {
    for (const path of ["/api/agent/work?sessionId=s", "/api/agent/nothing"]) {
      expect((await agentCall("GET", path, undefined, "wrong")).status).toBe(401);
    }
    const bare = await serve(new Request(`${ORIGIN}/api/agent/work?sessionId=s`));
    expect(bare.status).toBe(401);
    expect((await agentCall("GET", "/api/agent/nothing")).status).toBe(404);
  });

  it("require the app's origin on the owner's writes, not on reads", async () => {
    await seedBrief(db);
    expect((await ownerCall("GET", "/api/status", undefined, null)).status).toBe(200);
    expect((await ownerCall("PUT", "/api/brief/owner", { ownerBody: "x" }, null)).status).toBe(403);
    expect((await ownerCall("PUT", "/api/brief/owner", { ownerBody: "x" }, "https://evil.example")).status).toBe(403);
    expect((await ownerCall("PUT", "/api/brief/owner", { ownerBody: "x" })).status).toBe(200);
  });

  it("serve the owner's routes only on the app's host, and the agent's through the tunnel too", async () => {
    await seedBrief(db);
    const tunnel = "https://your-words.ngrok-free.app";
    expect((await serve(new Request(`${tunnel}/api/brief`))).status).toBe(404);
    expect((await serve(new Request(`${tunnel}/api/feed`))).status).toBe(404);
    const agent = await serve(
      new Request(`${tunnel}/api/agent/work?sessionId=s`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(agent.status).toBe(200);
  });

  it("name a missing configuration key", async () => {
    configure({ db });
    const saved = process.env.YAP_AGENT_TOKEN;
    delete process.env.YAP_AGENT_TOKEN;
    const response = await ownerCall("GET", "/api/status");
    if (saved !== undefined) process.env.YAP_AGENT_TOKEN = saved;
    expect(response.status).toBe(500);
    expect((await json<{ error: { message: string } }>(response)).error.message).toMatch(
      /SUPABASE_URL|YAP_AGENT_TOKEN/,
    );
  });
});

describe("a scout run through the agent routes", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "mentions", 5);
    await seedSearch(db, "slow", 60);
    await db.query("update searches set last_run_at = $1 where id = 'slow'", [at(-10)]);
  });

  it("works the due searches, judges the queue and reports", async () => {
    const work = await json<{ brief: string; searches: { id: string }[]; spend: unknown }>(
      await agentCall("GET", "/api/agent/work?sessionId=scout-1"),
    );
    expect(work.brief).toContain("## Owner");
    expect(work.searches).toEqual([{ id: "mentions", label: "Search mentions" }]);
    expect(work.spend).toEqual({ todayUsd: 0, capUsd: 25 });

    const claim = await agentCall("POST", "/api/agent/searches/mentions/claim", { sessionId: "scout-1" });
    expect(await json(claim)).toEqual({ query: "mentions -is:retweet", sinceId: null });
    expect((await agentCall("POST", "/api/agent/searches/slow/claim", { sessionId: "scout-1" })).status).toBe(409);

    const posts = [candidate("11"), candidate("12")];
    const stored = await agentCall("POST", "/api/agent/candidates", {
      sessionId: "scout-1",
      searchId: "mentions",
      newestId: "12",
      posts,
      postReads: 2,
      userReads: 2,
    });
    expect(await json(stored)).toEqual({ fetched: 2, stored: 2, alreadyKnown: 0 });

    const lease = await json<{ posts: { id: string }[]; waiting: number }>(
      await agentCall("POST", "/api/agent/queue/lease", { sessionId: "scout-1", limit: 25 }),
    );
    expect(lease.posts.map((p) => p.id)).toEqual(["11", "12"]);
    const judged = await agentCall("POST", "/api/agent/judgments", {
      sessionId: "scout-1",
      model: MODEL_ID,
      judgments: [
        { postId: "11", score: 88, reason: "Asks where to host a long-running agent." },
        { postId: "12", score: 12, reason: "Consumer AI." },
      ],
    });
    expect(await json(judged)).toEqual({ accepted: 2, rejected: [] });

    const report = { role: "scout", searches: [{ searchId: "mentions", fetched: 2, stored: 2 }], judged: 2, notes: "" };
    expect(await json(await agentCall("POST", "/api/agent/report", { sessionId: "scout-1", report }))).toEqual({
      role: "scout",
      closed: true,
    });
    const open = await json<{ items: { id: string; judgment: { score: number } }[] }>(
      await ownerCall("GET", "/api/feed?filter=open"),
    );
    expect(open.items.map((i) => [i.id, i.judgment.score])).toEqual([["11", 88]]);
  });

  it("refuses malformed bodies with the field at fault", async () => {
    const response = await agentCall("POST", "/api/agent/judgments", {
      sessionId: "s",
      model: MODEL_ID,
      judgments: [{ postId: "1", score: 50, reason: "x", reply: "Great point!" }],
    });
    expect(response.status).toBe(400);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe("invalid_request");
    expect((await agentCall("GET", "/api/agent/work")).status).toBe(400);
  });

  it("refuses a claim at the budget cap", async () => {
    await db.query("insert into usage_daily (day, spend_usd) values ('2026-09-29', 25)");
    const response = await agentCall("POST", "/api/agent/searches/mentions/claim", { sessionId: "s" });
    expect(response.status).toBe(409);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe("budget_exhausted");
  });

  it("cuts a leased batch to its byte bound and returns the rest next time", async () => {
    const long = Array.from({ length: 25 }, (_, i) =>
      candidate(String(100 + i), {
        text: "w".repeat(600),
        context: { kind: "replied_to", id: "1", authorHandle: "p", text: "c".repeat(300) },
      }),
    );
    // Long handles push each post past the bound's share.
    for (const post of long) post.authorHandle = `h${"x".repeat(40)}${post.id}`;
    await agentCall("POST", "/api/agent/candidates", {
      sessionId: "s",
      searchId: "mentions",
      newestId: "124",
      posts: long,
      postReads: 25,
      userReads: 25,
    });
    const first = await json<{ posts: { id: string }[]; waiting: number }>(
      await agentCall("POST", "/api/agent/queue/lease", { sessionId: "s", limit: 25 }),
    );
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(40 * 1024);
    expect(first.posts.length + first.waiting).toBe(25);
  });

  it("starts no learning run without feedback, and one with it", async () => {
    await agentCall("GET", "/api/agent/work?sessionId=scout-1");
    await settle();
    expect(calls.created).toEqual([]);
    await agentCall("POST", "/api/agent/candidates", {
      sessionId: "s",
      searchId: "mentions",
      newestId: "11",
      posts: [candidate("11")],
      postReads: 1,
      userReads: 1,
    });
    await agentCall("POST", "/api/agent/judgments", {
      sessionId: "s",
      model: MODEL_ID,
      judgments: [{ postId: "11", score: 80, reason: "r" }],
    });
    expect((await ownerCall("PUT", "/api/posts/11/feedback", { verdict: "not_relevant", note: "crypto" })).status).toBe(
      200,
    );
    // The feedback route does not start a run; the next scout's work does.
    await settle();
    expect(calls.created).toEqual([]);
    now = Date.parse(at(5));
    await agentCall("GET", "/api/agent/work?sessionId=scout-2");
    await settle();
    expect(calls.created).toEqual([{ agentId: "yap-machine@development", key: "learn-1" }]);
    expect(calls.sent).toEqual([
      {
        sessionId: "learn-session-1",
        input: "Fold the owner's new feedback into the brief.",
        payload: { role: "learning" },
        key: "learn-1/start",
      },
    ]);
  });
});

describe("a learning run through the agent routes", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
    await agentCall("POST", "/api/agent/candidates", {
      sessionId: "scout",
      searchId: "s",
      newestId: "4",
      posts: ["1", "2", "3", "4"].map((id) => candidate(id)),
      postReads: 4,
      userReads: 4,
    });
    await agentCall("POST", "/api/agent/judgments", {
      sessionId: "scout",
      model: MODEL_ID,
      judgments: [
        { postId: "1", score: 85, reason: "AI trading agent." },
        { postId: "2", score: 80, reason: "Crypto bot runs for hours." },
        { postId: "3", score: 75, reason: "Agent sandboxes." },
        { postId: "4", score: 70, reason: "Durable execution." },
      ],
    });
    for (const id of ["1", "2"]) {
      await ownerCall("PUT", `/api/posts/${id}/feedback`, {
        verdict: "not_relevant",
        note: id === "1" ? "trading bots are not our agents" : null,
      });
    }
    await agentCall("GET", "/api/agent/work?sessionId=scout-2");
    await settle();
  });

  it("folds feedback into a rule, re-scores the feed, closes, and is ended later", async () => {
    const session = "learn-session-1";
    const offered = await json<{
      versionId: number;
      ownerSections: string;
      learned: unknown[];
      feedback: { id: number; note: string | null }[];
    }>(await agentCall("GET", `/api/agent/learning?sessionId=${session}`));
    expect(offered.feedback.map((f) => f.note)).toEqual(["trading bots are not our agents", null]);
    expect((await agentCall("GET", "/api/agent/learning?sessionId=intruder")).status).toBe(403);

    const ids = offered.feedback.map((f) => f.id);
    const uncovered = await agentCall("POST", "/api/agent/learning/rules", {
      sessionId: session,
      baseVersionId: offered.versionId,
      rules: [{ text: "AI trading bots are not relevant.", feedbackIds: [ids[0]] }],
      considered: [],
    });
    expect(uncovered.status).toBe(400);
    const saved = await agentCall("POST", "/api/agent/learning/rules", {
      sessionId: session,
      baseVersionId: offered.versionId,
      rules: [{ text: "AI trading bots are not relevant, even when they say agent.", feedbackIds: ids }],
      considered: [],
    });
    expect(await json(saved)).toMatchObject({ rules: 1 });

    const batch = await json<{ posts: { id: string }[] }>(
      await agentCall("POST", "/api/agent/learning/rescores/lease", { sessionId: session, limit: 25 }),
    );
    expect(batch.posts.map((p) => p.id).sort()).toEqual(["3", "4"]);
    await agentCall("POST", "/api/agent/learning/rescores", {
      sessionId: session,
      model: MODEL_ID,
      judgments: [
        { postId: "3", score: 76, reason: "Still sandboxes." },
        { postId: "4", score: 40, reason: "Learned: not ours." },
      ],
    });
    const open = await json<{ items: { id: string; judgment: { kind: string } }[] }>(
      await ownerCall("GET", "/api/feed?filter=open"),
    );
    expect(open.items.map((i) => [i.id, i.judgment.kind])).toEqual([["3", "rescore"]]);

    const report = { role: "learning", rulesBefore: 0, rulesAfter: 1, consolidated: 2, rescored: 2, notes: "" };
    expect(await json(await agentCall("POST", "/api/agent/report", { sessionId: session, report }))).toEqual({
      role: "learning",
      closed: true,
      startNext: false,
    });
    await settle();
    // GAP(G14): not ended from its own report call; the next pass ends it.
    expect(calls.ended).toEqual([]);
    now = Date.parse(at(5));
    await agentCall("GET", "/api/agent/work?sessionId=scout-3");
    await settle();
    expect(calls.ended).toEqual([session]);
    const brief = await json<{ active: { learned: { text: string; feedback: unknown[] }[] } }>(
      await ownerCall("GET", "/api/brief"),
    );
    expect(brief.active.learned[0]?.feedback).toHaveLength(2);
  });

  it("abandons the run when its session cannot start", async () => {
    // A second batch of feedback, with a client that fails to create.
    setup({ client: fakeClient(calls, true) });
    now = Date.parse(at(20));
    await ownerCall("PUT", "/api/posts/3/feedback", { verdict: "not_relevant" });
    await agentCall("GET", "/api/agent/work?sessionId=scout-9");
    await settle();
    const runs = await db.query<{ abandoned: boolean }>("select abandoned from learning_runs order by id");
    expect(runs).toEqual([{ abandoned: true }, { abandoned: true }]);
  });

  it("does nothing without an API key", async () => {
    setup({ client: null, config: { ...CONFIG, oc: undefined } });
    now = Date.parse(at(20));
    await agentCall("GET", "/api/agent/work?sessionId=scout-9");
    await settle();
    expect(await db.query("select count(*)::int as n from learning_runs")).toEqual([{ n: 1 }]);
  });
});

describe("the owner's routes", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "s");
  });

  it("create, patch and list searches", async () => {
    const created = await ownerCall("POST", "/api/searches", {
      id: "new-one",
      label: "New",
      query: "agents -is:retweet",
      everyMinutes: 15,
      enabled: true,
    });
    expect(created.status).toBe(201);
    expect(
      (await ownerCall("POST", "/api/searches", { id: "Bad", label: "x", query: "q", everyMinutes: 5, enabled: true }))
        .status,
    ).toBe(400);
    expect((await ownerCall("PATCH", "/api/searches/new-one", { everyMinutes: 30 })).status).toBe(200);
    expect((await ownerCall("PATCH", "/api/searches/nope", { enabled: false })).status).toBe(404);
    const list = await json<{ searches: { id: string; everyMinutes: number }[] }>(
      await ownerCall("GET", "/api/searches"),
    );
    expect(list.searches.map((s) => [s.id, s.everyMinutes])).toEqual([
      ["new-one", 30],
      ["s", 5],
    ]);
  });

  it("put, replace and withdraw feedback, and record opens", async () => {
    await agentCall("POST", "/api/agent/candidates", {
      sessionId: "x",
      searchId: "s",
      newestId: "1",
      posts: [candidate("1")],
      postReads: 1,
      userReads: 1,
    });
    expect((await ownerCall("PUT", "/api/posts/1/feedback", { verdict: "maybe" })).status).toBe(400);
    expect((await ownerCall("PUT", "/api/posts/9/feedback", { verdict: "relevant" })).status).toBe(404);
    expect((await ownerCall("PUT", "/api/posts/1/feedback", { verdict: "relevant", note: "" })).status).toBe(200);
    expect((await ownerCall("DELETE", "/api/posts/1/feedback")).status).toBe(200);
    expect((await ownerCall("DELETE", "/api/posts/1/feedback")).status).toBe(404);
    expect((await ownerCall("POST", "/api/posts/1/open")).status).toBe(200);
    expect((await ownerCall("POST", "/api/posts/1/dismiss")).status).toBe(200);
    expect((await ownerCall("POST", "/api/posts/1/dismiss", undefined, null)).status).toBe(403);
    expect((await ownerCall("DELETE", "/api/posts/1/dismiss")).status).toBe(200);
    expect((await ownerCall("POST", "/api/posts/9/dismiss")).status).toBe(404);
  });

  it("edit the owner's sections, delete a rule and restore a version", async () => {
    await db.query("update brief_versions set learned = $1", [
      JSON.stringify([{ id: "r1", text: "A rule.", feedbackIds: [] }]),
    ]);
    const edit = await json<{ versionId: number }>(
      await ownerCall("PUT", "/api/brief/owner", { ownerBody: "## Owner\n\nNew." }),
    );
    expect(
      (await json<{ learned: unknown[] }>(await ownerCall("GET", `/api/brief/versions/${String(edit.versionId)}`)))
        .learned,
    ).toHaveLength(1);
    expect((await ownerCall("DELETE", "/api/brief/rules/r1")).status).toBe(200);
    expect((await ownerCall("DELETE", "/api/brief/rules/r1")).status).toBe(404);
    expect((await ownerCall("POST", "/api/brief/versions/1/restore")).status).toBe(200);
    const state = await json<{ versions: unknown[]; active: { learned: unknown[] } }>(
      await ownerCall("GET", "/api/brief"),
    );
    expect(state.versions).toHaveLength(4);
    expect(state.active.learned).toHaveLength(1);
  });

  it("page the feed with an opaque cursor and count new items", async () => {
    await agentCall("POST", "/api/agent/candidates", {
      sessionId: "x",
      searchId: "s",
      newestId: "3",
      posts: ["1", "2", "3"].map((id) => candidate(id)),
      postReads: 3,
      userReads: 3,
    });
    await agentCall("POST", "/api/agent/judgments", {
      sessionId: "x",
      model: MODEL_ID,
      judgments: ["1", "2", "3"].map((postId, i) => ({ postId, score: 90 - i, reason: "r" })),
    });
    const first = await json<{ items: { id: string }[]; nextCursor: string }>(
      await ownerCall("GET", "/api/feed?filter=open&limit=2"),
    );
    expect(first.items.map((i) => i.id)).toEqual(["1", "2"]);
    const second = await json<{ items: { id: string }[]; nextCursor: string | null }>(
      await ownerCall("GET", `/api/feed?filter=open&limit=2&cursor=${first.nextCursor}`),
    );
    expect(second.items.map((i) => i.id)).toEqual(["3"]);
    expect(second.nextCursor).toBeNull();
    expect((await ownerCall("GET", "/api/feed?cursor=garbage")).status).toBe(400);
    expect(await json(await ownerCall("GET", `/api/feed/new-count?since=${at(-1)}`))).toEqual({ count: 3 });
    const status = await json<{ spend: { todayUsd: number }; threshold: number }>(
      await ownerCall("GET", "/api/status"),
    );
    expect(status).toMatchObject({ spend: { todayUsd: 0.045 }, threshold: 60 });
  });
});
