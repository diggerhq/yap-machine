import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_ID } from "../../opencomputer/agents/yap/contract";
import { candidatesBody, judgmentsBody, report, reportBody } from "../../src/shared/contract";
import { candidate } from "./arrange";

describe("the contract validators", () => {
  it("accept what the tools send", () => {
    const body = {
      sessionId: "s1",
      searchId: "mentions",
      newestId: "1",
      posts: [
        candidate("1"),
        candidate("2", { context: { kind: "quoted", id: "9", authorHandle: "q", text: "t" }, conversationId: null }),
      ],
      postReads: 3,
      userReads: 2,
    };
    expect(candidatesBody.safeParse(body).success).toBe(true);
    expect(candidatesBody.safeParse({ ...body, newestId: null, posts: [] }).success).toBe(true);
    expect(
      judgmentsBody.safeParse({ sessionId: "s", model: MODEL_ID, judgments: [{ postId: "1", score: 5, reason: "r" }] })
        .success,
    ).toBe(true);
    expect(report.safeParse({ role: "scout", searches: [], judged: 0, notes: "" }).success).toBe(true);
    expect(
      report.safeParse({ role: "learning", rulesBefore: 0, rulesAfter: 1, consolidated: 1, rescored: 0, notes: "" })
        .success,
    ).toBe(true);
    expect(
      reportBody.safeParse({ sessionId: "s", report: { role: "scout", searches: [], judged: 0, notes: "" } }).success,
    ).toBe(true);
  });

  it("refuse what they must not", () => {
    expect(
      candidatesBody.safeParse({
        sessionId: "s",
        searchId: "BAD",
        newestId: null,
        posts: [],
        postReads: 0,
        userReads: 0,
      }).success,
    ).toBe(false);
    expect(
      candidatesBody.safeParse({
        sessionId: "s",
        searchId: "a",
        newestId: null,
        posts: [{ ...candidate("1"), createdAt: "yesterday" }],
        postReads: 0,
        userReads: 0,
      }).success,
    ).toBe(false);
    expect(
      judgmentsBody.safeParse({ sessionId: "s", model: "m", judgments: [{ postId: "1", score: 5.5, reason: "r" }] })
        .success,
    ).toBe(false);
    expect(
      judgmentsBody.safeParse({
        sessionId: "s",
        model: "m",
        judgments: [{ postId: "1", score: 5, reason: "r", draft: "x" }],
      }).success,
    ).toBe(false);
    expect(report.safeParse({ role: "scout", searches: [], judged: 0, notes: "", rulesAfter: 1 }).success).toBe(false);
    expect(report.safeParse({ role: "other", notes: "" }).success).toBe(false);
  });

  it("keeps MODEL_ID equal to the model the agent declares (GAP(G13))", () => {
    const agent = readFileSync("opencomputer/agents/yap/agent.ts", "utf8");
    const declared = /useModel\("([^"]+)"\)/.exec(agent)?.[1];
    expect(declared).toBe(MODEL_ID);
  });
});
