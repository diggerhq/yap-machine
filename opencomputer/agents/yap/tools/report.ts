// report: the session's result, in either role, sent to the app too. The app
// closing the run is best effort here: a run that never reports is closed
// (scout) or abandoned (learning) by the app on its own.
import { defineTool } from "@opencomputer/agent";
import { callApp } from "../connections/app";
import { REPORT_INPUT, REPORT_OUTPUT } from "../contract";

export const report = defineTool({
  name: "report",
  description:
    "Finish the run: say what you did. Scout: role scout, per-search fetched and stored counts, posts judged. Learning: role learning, rule counts before and after, feedback consolidated, posts re-scored. Notes are for the owner, at most 500 characters.",
  input: REPORT_INPUT,
  output: REPORT_OUTPUT,
  result: true,
  async run({ input, sessionId }) {
    await callApp("POST", "/api/agent/report", { sessionId, report: input }).catch(() => undefined);
    return input as never;
  },
});
