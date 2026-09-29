// The contract between the agent and the app, in one place: the model id the
// tools record, the JSON Schemas of every tool input, of the report (the
// session's result) and of every /api/agent/* request body. Agent code may
// import nothing from outside its own directory (GAP(G5)), so this module is
// plain constants; the app builds its validators from them
// (src/shared/contract.ts). The report schema is a pure literal because the
// compiler copies it into the deployment without running code.
import type { FromSchema } from "json-schema-to-ts";

// GAP(G13): tools cannot learn the model, so the literal in agent.ts is
// repeated here and a test keeps the two equal.
export const MODEL_ID = "anthropic/claude-sonnet-5.5";

export const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

export const JUDGMENT = {
  type: "object",
  properties: {
    postId: { type: "string", pattern: "^[0-9]{1,20}$", description: "The id of a post you were given" },
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "How worth answering the post is for the owner now, 0 to 100",
    },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "One line saying why, in terms of the brief; never text for X",
    },
  },
  required: ["postId", "score", "reason"],
  additionalProperties: false,
} as const;

export const JUDGMENTS_INPUT = {
  type: "object",
  properties: { judgments: { type: "array", minItems: 1, maxItems: 25, items: JUDGMENT } },
  required: ["judgments"],
  additionalProperties: false,
} as const;

export const RUN_SEARCH_INPUT = {
  type: "object",
  properties: { searchId: { type: "string", pattern: "^[a-z0-9-]{1,64}$", description: "A search id from get_work" } },
  required: ["searchId"],
  additionalProperties: false,
} as const;

export const SAVE_LEARNED_INPUT = {
  type: "object",
  properties: {
    baseVersionId: { type: "integer", minimum: 1, description: "The brief versionId get_feedback returned" },
    rules: {
      type: "array",
      maxItems: 50,
      description: "The complete new Learned list: existing rules to keep, merged, and new ones",
      items: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: 200, description: "A short, general rule" },
          feedbackIds: {
            type: "array",
            maxItems: 200,
            items: { type: "integer", minimum: 1 },
            description: "The feedback ids behind the rule",
          },
        },
        required: ["text", "feedbackIds"],
        additionalProperties: false,
      },
    },
    considered: {
      type: "array",
      maxItems: 200,
      items: { type: "integer", minimum: 1 },
      description: "Offered feedback ids that no rule should cover",
    },
  },
  required: ["baseVersionId", "rules", "considered"],
  additionalProperties: false,
} as const;

/** The session's result: what a scout run or a learning run did. */
export const REPORT_OUTPUT = {
  oneOf: [
    {
      type: "object",
      properties: {
        role: { type: "string", enum: ["scout"] },
        searches: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              searchId: { type: "string", maxLength: 64 },
              fetched: { type: "integer", minimum: 0 },
              stored: { type: "integer", minimum: 0 },
            },
            required: ["searchId", "fetched", "stored"],
            additionalProperties: false,
          },
        },
        judged: { type: "integer", minimum: 0 },
        notes: { type: "string", maxLength: 500 },
      },
      required: ["role", "searches", "judged", "notes"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        role: { type: "string", enum: ["learning"] },
        rulesBefore: { type: "integer", minimum: 0 },
        rulesAfter: { type: "integer", minimum: 0 },
        consolidated: { type: "integer", minimum: 0 },
        rescored: { type: "integer", minimum: 0 },
        notes: { type: "string", maxLength: 500 },
      },
      required: ["role", "rulesBefore", "rulesAfter", "consolidated", "rescored", "notes"],
      additionalProperties: false,
    },
  ],
} as const;

/**
 * What the model sends to report: one flat object, because a tool's input
 * must be an object at its root. The output schema above is the strict
 * check, by role, on what the tool returns and commits.
 */
export const REPORT_INPUT = {
  type: "object",
  properties: {
    role: { type: "string", enum: ["scout", "learning"] },
    searches: REPORT_OUTPUT.oneOf[0].properties.searches,
    judged: { type: "integer", minimum: 0 },
    rulesBefore: { type: "integer", minimum: 0 },
    rulesAfter: { type: "integer", minimum: 0 },
    consolidated: { type: "integer", minimum: 0 },
    rescored: { type: "integer", minimum: 0 },
    notes: { type: "string", maxLength: 500 },
  },
  required: ["role", "notes"],
  additionalProperties: false,
} as const;

// ─── /api/agent/* request bodies ───────────────────────────────────────────

export const SESSION_BODY = {
  type: "object",
  properties: { sessionId: { type: "string", minLength: 1, maxLength: 200 } },
  required: ["sessionId"],
  additionalProperties: false,
} as const;

export const CANDIDATE_POST = {
  type: "object",
  properties: {
    id: { type: "string", pattern: "^[0-9]{1,20}$" },
    authorId: { type: "string", pattern: "^[0-9]{1,20}$" },
    authorHandle: { type: "string", minLength: 1, maxLength: 50 },
    authorName: { type: "string", maxLength: 100 },
    authorFollowers: { type: "integer", minimum: 0 },
    authorAvatar: { type: ["string", "null"], maxLength: 500, pattern: "^https://pbs\\.twimg\\.com/" },
    text: { type: "string", maxLength: 30000 },
    createdAt: { type: "string", format: "date-time" },
    conversationId: { type: ["string", "null"], maxLength: 20 },
    context: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["replied_to", "quoted"] },
            id: { type: "string", pattern: "^[0-9]{1,20}$" },
            authorHandle: { type: "string", maxLength: 50 },
            text: { type: "string", maxLength: 30000 },
          },
          required: ["kind", "id", "authorHandle", "text"],
          additionalProperties: false,
        },
      ],
    },
    metrics: {
      type: "object",
      properties: {
        like: { type: "integer", minimum: 0 },
        reply: { type: "integer", minimum: 0 },
        repost: { type: "integer", minimum: 0 },
        quote: { type: "integer", minimum: 0 },
        impression: { type: "integer", minimum: 0 },
      },
      required: ["like", "reply", "repost", "quote", "impression"],
      additionalProperties: false,
    },
  },
  required: [
    "id",
    "authorId",
    "authorHandle",
    "authorName",
    "authorFollowers",
    "authorAvatar",
    "text",
    "createdAt",
    "conversationId",
    "context",
    "metrics",
  ],
  additionalProperties: false,
} as const;

export const CANDIDATES_BODY = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 200 },
    searchId: { type: "string", pattern: "^[a-z0-9-]{1,64}$" },
    newestId: { type: ["string", "null"], pattern: "^[0-9]{1,20}$" },
    posts: { type: "array", maxItems: 200, items: CANDIDATE_POST },
    postReads: { type: "integer", minimum: 0, maximum: 2000 },
    userReads: { type: "integer", minimum: 0, maximum: 2000 },
  },
  required: ["sessionId", "searchId", "newestId", "posts", "postReads", "userReads"],
  additionalProperties: false,
} as const;

export const LEASE_BODY = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 25 },
  },
  required: ["sessionId", "limit"],
  additionalProperties: false,
} as const;

export const JUDGMENTS_BODY = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 200 },
    model: { type: "string", minLength: 1, maxLength: 200 },
    judgments: { type: "array", minItems: 1, maxItems: 25, items: JUDGMENT },
  },
  required: ["sessionId", "model", "judgments"],
  additionalProperties: false,
} as const;

export const REPORT_BODY = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 200 },
    report: REPORT_OUTPUT,
  },
  required: ["sessionId", "report"],
  additionalProperties: false,
} as const;

export const LEARNED_BODY = {
  type: "object",
  properties: {
    sessionId: { type: "string", minLength: 1, maxLength: 200 },
    baseVersionId: SAVE_LEARNED_INPUT.properties.baseVersionId,
    rules: SAVE_LEARNED_INPUT.properties.rules,
    considered: SAVE_LEARNED_INPUT.properties.considered,
  },
  required: ["sessionId", "baseVersionId", "rules", "considered"],
  additionalProperties: false,
} as const;

export type Judgment = FromSchema<typeof JUDGMENT>;
export type CandidatePost = FromSchema<typeof CANDIDATE_POST>;
export type CandidatesBody = FromSchema<typeof CANDIDATES_BODY>;
export type LeaseBody = FromSchema<typeof LEASE_BODY>;
export type JudgmentsBody = FromSchema<typeof JUDGMENTS_BODY>;
export type Report = FromSchema<typeof REPORT_OUTPUT>;
export type ReportBody = FromSchema<typeof REPORT_BODY>;
export type LearnedBody = FromSchema<typeof LEARNED_BODY>;
export type SessionBody = FromSchema<typeof SESSION_BODY>;
