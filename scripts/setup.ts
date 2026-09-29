// `npm run setup`: prepares this checkout's local files, and touches nothing
// remote. Safe to run again.
//   1. YAP_AGENT_TOKEN: generated once, written to .env.local (the app checks
//      it) and opencomputer/.env.local (the agent's secret sends it).
//   2. The agent's app connection: its origin set to YAP_PUBLIC_ORIGIN, the
//      fixed public address the agent reaches the app at. GAP(G5): a
//      connection origin must be a literal in source.
// Then upload the secrets (npm run secrets) and deploy the agent
// (npm run deploy:agent), in that order; see the README.
import { readFileSync, writeFileSync } from "node:fs";
import {
  AGENT_ENV_FILE,
  APP_ENV_FILE,
  appEnv,
  CONNECTION_FILE,
  connectionOrigin,
  ensureAgentToken,
  linkedProject,
  publicOrigin,
  readEnvFile,
} from "./local-env";

const problems: string[] = [];

ensureAgentToken();
console.log(`✓ YAP_AGENT_TOKEN is in ${APP_ENV_FILE} and ${AGENT_ENV_FILE}`);

const origin = publicOrigin(appEnv().YAP_PUBLIC_ORIGIN);
if (!origin) {
  problems.push(`Set YAP_PUBLIC_ORIGIN in ${APP_ENV_FILE} to your ngrok domain, e.g. https://example.ngrok-free.app`);
} else if (connectionOrigin() === origin) {
  console.log(`✓ The agent's app connection points at ${origin}`);
} else {
  const source = readFileSync(CONNECTION_FILE, "utf8");
  writeFileSync(CONNECTION_FILE, source.replace(/origin: "https:\/\/[^"]+"/, `origin: "${origin}"`));
  console.log(`✓ The agent's app connection now points at ${origin} (${CONNECTION_FILE})`);
}

if (!readEnvFile(AGENT_ENV_FILE).X_BEARER_TOKEN) problems.push(`Set X_BEARER_TOKEN in ${AGENT_ENV_FILE}`);
if (!appEnv().OPENCOMPUTER_API_KEY) problems.push(`Set OPENCOMPUTER_API_KEY in ${APP_ENV_FILE}`);
if (!linkedProject()) problems.push("Link a project: npx opencomputer link --create-project yap-machine");

if (problems.length) {
  console.log("\nStill to do:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log("\nNext: npm run secrets, then npm run deploy:agent.");
