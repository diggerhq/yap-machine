import { defineSchedule } from "@opencomputer/agent";

export default defineSchedule({
  id: "scout",
  cron: "*/5 * * * *",
  timezone: "UTC",
  enabled: ["production"],
  overlap: "skip",
  dispatch: { text: "Work the searches that are due.", payload: { role: "scout" } },
});
