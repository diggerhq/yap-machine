// submit_rescores: new scores for the posts next_rescores returned.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { JUDGMENTS_INPUT, MODEL_ID } from "../contract";

export const submitRescores = defineTool({
  name: "submit_rescores",
  description: "Record a new score (0-100) and a one-line reason for each post next_rescores gave you.",
  input: JUDGMENTS_INPUT,
  async run({ input, sessionId }) {
    const answer = await callApp("POST", "/api/agent/learning/rescores", {
      sessionId,
      model: MODEL_ID,
      judgments: input.judgments,
    });
    return answer.ok ? answer.data : appFailure(answer);
  },
});
