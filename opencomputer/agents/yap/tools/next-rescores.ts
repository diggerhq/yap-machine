// next_rescores: the next batch of feed posts to score again under the new brief.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { EMPTY_INPUT } from "../contract";

export const nextRescores = defineTool({
  name: "next_rescores",
  description:
    "Take the next batch of up to 25 feed posts to score again under the updated brief, and the number still waiting. Call again until no posts come back.",
  input: EMPTY_INPUT,
  async run({ sessionId }) {
    const answer = await callApp("POST", "/api/agent/learning/rescores/lease", { sessionId, limit: 25 });
    return answer.ok ? answer.data : appFailure(answer);
  },
});
