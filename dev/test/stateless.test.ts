import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Worker keeps nothing between requests: all state is in Supabase and the
// schedule belongs to the agent. Configuration comes from secrets, never
// from `vars`, so no value in this file can drift from the deployed one.
function jsonc(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

describe("the Worker configuration", () => {
  it("declares no persistence, queue, schedule or vars", () => {
    const config = jsonc("wrangler.jsonc");
    for (const key of [
      "kv_namespaces",
      "d1_databases",
      "r2_buckets",
      "durable_objects",
      "queues",
      "triggers",
      "workflows",
      "vars",
    ]) {
      expect(config, key).not.toHaveProperty(key);
    }
  });
});
