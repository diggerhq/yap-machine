// submit_judgments: a scout run's scores, recorded with the model that made them.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { JUDGMENTS_INPUT, MODEL_ID } from "../contract";

export const submitJudgments = defineTool({
  name: "submit_judgments",
  description:
    "Record a score (0-100) and a one-line reason for each post in the batch you were given. Each post is judged once.",
  input: JUDGMENTS_INPUT,
  async run({ input, sessionId }) {
    const answer = await callApp("POST", "/api/agent/judgments", {
      sessionId,
      model: MODEL_ID,
      judgments: input.judgments,
    });
    return answer.ok ? answer.data : appFailure(answer);
  },
});
