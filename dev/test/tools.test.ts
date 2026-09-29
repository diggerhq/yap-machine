// The agent's tools, run the way the runtime runs them, against a stand-in
// for OpenComputer's egress proxy: calls on the `app` connection are served
// by the real routes over PGlite (with the bearer the proxy would attach),
// and calls on `x-api` are answered from authored fixtures and recorded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition, ToolExecutionContext } from "@opencomputer/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roleOf } from "../../opencomputer/agents/yap/agent";
import { getWork } from "../../opencomputer/agents/yap/tools/get-work";
import { nextPosts } from "../../opencomputer/agents/yap/tools/next-posts";
import { report } from "../../opencomputer/agents/yap/tools/report";
import { runSearch } from "../../opencomputer/agents/yap/tools/run-search";
import { submitJudgments } from "../../opencomputer/agents/yap/tools/submit-judgments";
import { parseSearchPage } from "../../opencomputer/agents/yap/tools/x-search";
import type { Config } from "../../src/server/env";
import { configure } from "../../src/server/wiring";
import { seedBrief, seedSearch, T0 } from "./arrange";
import { freshDb, type TestDb } from "./pg";
import { serve } from "./serve";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "x");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const ORIGIN = "https://yap-machine-app.example.com";
const TOKEN = "k".repeat(43);
const CONFIG: Config = {
  supabase: { url: "https://db.example", secretKey: "unused" },
  agentToken: TOKEN,
  origin: ORIGIN,
  threshold: 60,
};

let db: TestDb;
let xRequests: URL[];
let xAnswer: (url: URL) => Response;

beforeEach(async () => {
  db = await freshDb();
  xRequests = [];
  xAnswer = (url) => {
    const token = url.searchParams.get("next_token");
    if (token === "page-2-token") return new Response(fixture("page-2.json"), { status: 200 });
    if (token) return new Response("unexpected page", { status: 500 });
    return new Response(fixture("page-1.json"), { status: 200 });
  };
  configure({ config: CONFIG, db, client: null, now: () => Date.parse(T0), waitUntil: () => {} });
  vi.stubEnv("OPENCOMPUTER_CONNECTIONS_URL", "https://egress.test/connections");
  vi.stubEnv("OPENCOMPUTER_CONNECTION_TOKEN", "runtime-token");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const match = /^\/connections\/([^/]+)\/fetch$/.exec(url.pathname);
    if (url.origin !== "https://egress.test" || !match) throw new Error(`unexpected fetch ${url.href}`);
    const call = JSON.parse(String(init?.body)) as {
      method: string;
      path: string;
      headers: Record<string, string>;
      body?: string;
    };
    if (match[1] === "app") {
      return serve(
        new Request(`${ORIGIN}${call.path}`, {
          method: call.method,
          headers: { ...call.headers, authorization: `Bearer ${TOKEN}` },
          ...(call.body === undefined ? {} : { body: call.body }),
        }),
      );
    }
    if (match[1] === "x-api") {
      const target = new URL(`https://api.x.com${call.path}`);
      xRequests.push(target);
      return xAnswer(target);
    }
    throw new Error(`unknown connection ${match[1]}`);
  });
});

afterEach(() => {
  configure();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function run<T>(tool: ToolDefinition, input: Record<string, unknown> = {}, sessionId = "scout-1"): Promise<T> {
  const context: ToolExecutionContext = {
    input,
    sessionId,
    messageId: "m1",
    toolCallId: "c1",
    agentId: "yap-machine",
    reportProgress: async () => {},
  };
  return Promise.resolve(tool.run(context)) as Promise<T>;
}

describe("parseSearchPage", () => {
  it("reads both spellings, context, full text, and every billable object", () => {
    const first = parseSearchPage(JSON.parse(fixture("page-1.json")));
    expect(first.posts.map((p) => p.id)).toEqual(["1850000000000000103", "1850000000000000102", "1850000000000000101"]);
    expect(first.posts[1]?.context).toEqual({
      kind: "replied_to",
      id: "1850000000000000090",
      authorHandle: "infra_cy",
      text: "What are people using for sandboxes that run agents for hours?",
    });
    expect(first.posts[2]?.text).toMatch(/the whole problem\.$/);
    // Avatars come only from X's image host, at the larger size.
    expect(first.posts[0]?.authorAvatar).toBe("https://pbs.twimg.com/profile_images/1/example_bigger.jpg");
    expect(first.posts[1]?.authorAvatar).toBeNull();
    expect(first).toMatchObject({
      postReads: 5,
      userReads: 3,
      newestId: "1850000000000000103",
      nextToken: "page-2-token",
    });

    const second = parseSearchPage(JSON.parse(fixture("page-2.json")));
    expect(second.posts[0]).toMatchObject({
      text: "This, but for background agents: where does the state live when the VM goes away?",
      context: { kind: "quoted", authorHandle: "quoted_eve", text: "Serverless timeouts kill long agent tasks." },
      metrics: { repost: 2, reply: 1, like: 8 },
    });
    expect(parseSearchPage(JSON.parse(fixture("empty.json")))).toMatchObject({ posts: [], newestId: null });
  });
});

describe("a scout run through the tools", () => {
  beforeEach(async () => {
    await seedBrief(db);
    await seedSearch(db, "mentions", 5);
  });

  it("claims, fetches at most two pages, stores, leases, judges and reports", async () => {
    const work = await run<{ searches: { id: string }[]; brief: string }>(getWork);
    expect(work.searches.map((s) => s.id)).toEqual(["mentions"]);

    const searched = await run<Record<string, unknown>>(runSearch, { searchId: "mentions" });
    expect(searched).toEqual({ searchId: "mentions", fetched: 4, stored: 4, alreadyKnown: 0 });
    expect(xRequests).toHaveLength(2);
    const [first] = xRequests;
    expect(first?.pathname).toBe("/2/tweets/search/recent");
    expect(first?.searchParams.get("query")).toBe("mentions -is:retweet");
    expect(first?.searchParams.get("since_id")).toBeNull();
    expect(first?.searchParams.get("max_results")).toBe("100");
    expect(first?.searchParams.get("expansions")).toBe("author_id,referenced_tweets.id,referenced_tweets.id.author_id");
    const [searchRow] = await db.query<{ since_id: string }>("select since_id from searches");
    expect(searchRow?.since_id).toBe("1850000000000000103");
    // 5 + 2 post objects and 3 + 2 user objects across the two pages.
    expect(await db.query("select spend_usd::float as usd from usage_daily")).toEqual([{ usd: 0.085 }]);

    const batch = await run<{ posts: { id: string }[]; waiting: number }>(nextPosts);
    expect(batch.posts).toHaveLength(4);
    const judged = await run<{ accepted: number }>(submitJudgments, {
      judgments: batch.posts.map((p, i) => ({ postId: p.id, score: 90 - i * 20, reason: "Scored in a test." })),
    });
    expect(judged.accepted).toBe(4);
    expect((await run<{ posts: unknown[] }>(nextPosts)).posts).toEqual([]);

    const result = { role: "scout", searches: [{ searchId: "mentions", fetched: 4, stored: 4 }], judged: 4, notes: "" };
    expect(await run(report, result)).toEqual(result);
    expect(await db.query("select finished_at is not null as closed from scout_runs")).toEqual([{ closed: true }]);
  });

  it("sends the cursor on the next run and keeps it when nothing is new", async () => {
    await run(runSearch, { searchId: "mentions" });
    xRequests = [];
    xAnswer = () => new Response(fixture("empty.json"), { status: 200 });
    await db.query("update searches set last_run_at = last_run_at - interval '5 minutes'");
    expect(await run(runSearch, { searchId: "mentions" })).toEqual({
      searchId: "mentions",
      fetched: 0,
      stored: 0,
      alreadyKnown: 0,
    });
    expect(xRequests[0]?.searchParams.get("since_id")).toBe("1850000000000000103");
    expect(await db.query("select since_id from searches")).toEqual([{ since_id: "1850000000000000103" }]);
  });

  it("reports X's refusals and outages without failing the run", async () => {
    xAnswer = () => new Response(fixture("rejected.json"), { status: 400 });
    expect(await run(runSearch, { searchId: "mentions" })).toEqual({
      searchId: "mentions",
      error: "x_rejected",
      status: 400,
      detail: "Invalid 'since_id':'1'. 'since_id' must be a tweet id created after 2026-09-22T12:00Z.",
    });
    await db.query("update searches set last_run_at = null");
    xAnswer = () => new Response("", { status: 429 });
    expect(await run(runSearch, { searchId: "mentions" })).toMatchObject({ error: "x_unavailable", status: 429 });
  });

  it("makes no X request when the search is not due", async () => {
    await run(runSearch, { searchId: "mentions" });
    xRequests = [];
    expect(await run(runSearch, { searchId: "mentions" })).toMatchObject({ error: "not_due", status: 409 });
    expect(xRequests).toEqual([]);
  });

  it("sends a post X returned on both pages once", async () => {
    const page = (id: string, token: string | null) => ({
      data: [{ id, text: "post", author_id: "7001", created_at: "2026-09-29T11:59:00.000Z" }],
      includes: { users: [{ id: "7001", username: "a", name: "A" }] },
      meta: { newest_id: id, ...(token ? { next_token: token } : {}) },
    });
    xAnswer = (url) =>
      new Response(
        JSON.stringify(
          url.searchParams.get("next_token") ? page("1860000000000000001", null) : page("1860000000000000001", "p2"),
        ),
      );
    expect(await run(runSearch, { searchId: "mentions" })).toMatchObject({ fetched: 1, stored: 1 });
  });

  it("bounds a search's overshoot of the cap to two pages", async () => {
    // Two full pages cost at most 2 × (100 + 100 includes) posts and 2 × 200
    // users: (400 × 0.005) + (400 × 0.010) = $6 in the worst case, $2 for
    // posts alone. The tool never follows a third page.
    const big = (token: string | null) => ({
      data: Array.from({ length: 100 }, (_, i) => ({
        id: String(1860000000000000000n + BigInt(i) + (token ? 0n : 1000n)),
        text: "post",
        author_id: "7001",
        created_at: "2026-09-29T11:59:00.000Z",
      })),
      includes: { users: [{ id: "7001", username: "a", name: "A", public_metrics: { followers_count: 1 } }] },
      meta: { newest_id: "1", ...(token ? { next_token: token } : { next_token: "again" }) },
    });
    xAnswer = (url) => new Response(JSON.stringify(big(url.searchParams.get("next_token") ? null : "p2")));
    await run(runSearch, { searchId: "mentions" });
    expect(xRequests).toHaveLength(2);
  });
});

describe("roles", () => {
  it("come from the payload only", () => {
    expect(roleOf({ role: "scout" })).toBe("scout");
    expect(roleOf({ role: "learning" })).toBe("learning");
    expect(roleOf({ role: "admin" })).toBeUndefined();
    expect(roleOf("scout")).toBeUndefined();
    expect(roleOf(undefined)).toBeUndefined();
  });
});
