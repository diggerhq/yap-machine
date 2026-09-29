// `npm run scout:once`: start one scout run the way the schedule does, with
// payload { role: "scout" }. The schedule recurs only in production; in
// development this is how a run starts. GAP(G11): Run now has no documented
// API or CLI, and the CLI's session command sends no payload, so this uses
// the SDK with OPENCOMPUTER_API_KEY from .env.local.
import { OpenComputer } from "@opencomputer/sdk/agents";
import { SCOUT_INPUT } from "../src/server/scout";
import { appEnv } from "./local-env";

const env = appEnv();
if (!env.OPENCOMPUTER_API_KEY) {
  console.error("Set OPENCOMPUTER_API_KEY in .env.local (create one in the OpenComputer dashboard). See the README.");
  process.exit(2);
}
if (!env.YAP_AGENT_REF) {
  console.error("No agent to run: link the project first (npm run dev does it).");
  process.exit(2);
}
const origin = env.OPENCOMPUTER_API_URL ?? "https://app.opencomputer.dev";
const oc = new OpenComputer({ apiKey: env.OPENCOMPUTER_API_KEY, baseUrl: `${origin}/api/managed-agents` });
const key = `scout-once-${new Date().toISOString()}`;
const { session } = await oc.sessions.create({ agentId: env.YAP_AGENT_REF, source: "api" }, { idempotencyKey: key });
const receipt = await oc.sessions.turns.send(session.id, {
  input: SCOUT_INPUT,
  payload: { role: "scout" },
  idempotencyKey: `${key}/start`,
});
console.log(`Scout run started on ${env.YAP_AGENT_REF}: session ${session.id} (turn ${receipt.status}).`);
console.log(`Follow it with: npx opencomputer session attach ${session.id}`);
