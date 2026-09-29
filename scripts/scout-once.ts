// `npm run scout:once`: start one scout run the way the schedule does, with
// payload { role: "scout" }. For development, where the schedule does not
// recur. GAP(G11): Run now has no documented API or CLI, so this uses the
// SDK. Needs OPENCOMPUTER_API_KEY and YAP_AGENT_REF (environment or .env.local).
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { OpenComputer } from "@opencomputer/sdk/agents";

const local = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const apiKey = process.env.OPENCOMPUTER_API_KEY ?? local.OPENCOMPUTER_API_KEY;
const agentId = process.env.YAP_AGENT_REF ?? local.YAP_AGENT_REF ?? "yap-machine@development";
const origin = process.env.OPENCOMPUTER_API_URL ?? local.OPENCOMPUTER_API_URL ?? "https://app.opencomputer.dev";
if (!apiKey) {
  console.error("OPENCOMPUTER_API_KEY must be set (environment or .env.local)");
  process.exit(2);
}

const oc = new OpenComputer({ apiKey, baseUrl: `${origin}/api/managed-agents` });
const key = `scout-once-${new Date().toISOString()}`;
const { session } = await oc.sessions.create({ agentId, source: "api" }, { idempotencyKey: key });
const receipt = await oc.sessions.turns.send(session.id, {
  input: "Work the searches that are due.",
  payload: { role: "scout" },
  idempotencyKey: `${key}/start`,
});
console.log(`Started scout run: session ${session.id}, turn ${receipt.turnId} (${receipt.status}) on ${agentId}`);
