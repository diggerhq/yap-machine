// get_work: what this scout run works on, from the app.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { EMPTY_INPUT } from "../contract";

export const getWork = defineTool({
  name: "get_work",
  description:
    "Read the relevance brief, the owner's recent feedback on posts, the searches that are due now, and today's X spend. Call first.",
  input: EMPTY_INPUT,
  async run({ sessionId }) {
    const answer = await callApp("GET", `/api/agent/work?sessionId=${encodeURIComponent(sessionId)}`);
    return answer.ok ? answer.data : appFailure(answer);
  },
});
