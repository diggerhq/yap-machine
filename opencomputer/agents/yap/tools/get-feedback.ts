// get_feedback: a learning run's input, the brief and the waiting feedback.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { EMPTY_INPUT } from "../contract";

export const getFeedback = defineTool({
  name: "get_feedback",
  description:
    "Read the brief with its Learned rules (each with an id and the feedback ids behind it), its versionId, and the owner's feedback not yet folded into rules.",
  input: EMPTY_INPUT,
  async run({ sessionId }) {
    const answer = await callApp("GET", `/api/agent/learning?sessionId=${encodeURIComponent(sessionId)}`);
    return answer.ok ? answer.data : appFailure(answer);
  },
});
