// save_learned: the complete new Learned list. The app applies it as a new
// brief version; the model never edits the brief's text.
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { SAVE_LEARNED_INPUT } from "../contract";

export const saveLearned = defineTool({
  name: "save_learned",
  description:
    "Save the complete new list of Learned rules, citing feedback ids, plus the offered feedback ids no rule should cover (considered). Every offered id must be cited or considered.",
  input: SAVE_LEARNED_INPUT,
  async run({ input, sessionId }) {
    const answer = await callApp("POST", "/api/agent/learning/rules", {
      sessionId,
      baseVersionId: input.baseVersionId,
      rules: input.rules,
      considered: input.considered,
    });
    return answer.ok ? answer.data : appFailure(answer);
  },
});
