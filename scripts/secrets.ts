// `npm run secrets`: uploads the agent's two secrets from
// opencomputer/.env.local to the linked project's development environment,
// through the CLI (values on standard input, never on the command line). A
// secret's allowed destinations are taken from the connections when it is
// set, so run this again after the app connection's origin changes.
import { spawnSync } from "node:child_process";
import { AGENT_ENV_FILE, readEnvFile } from "./local-env";

const NAMES = ["X_BEARER_TOKEN", "YAP_AGENT_TOKEN"] as const;
const values = readEnvFile(AGENT_ENV_FILE);
const missing = NAMES.filter((name) => !values[name]);
if (missing.length) {
  console.error(`Missing in ${AGENT_ENV_FILE}: ${missing.join(", ")}. Run npm run setup first.`);
  process.exit(1);
}
for (const name of NAMES) {
  const result = spawnSync(
    "npx",
    ["opencomputer", "secrets", "set", name, "--value-stdin", "--environment", "development"],
    { input: values[name], stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
