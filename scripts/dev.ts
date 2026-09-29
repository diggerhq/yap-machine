// `npm run dev`: the app on http://localhost:3300 and its database. Nothing
// remote. With no SUPABASE_URL in .env.local the database is local (PGlite
// with the real migration, kept in dev/local/.pglite). It warns when the
// agent cannot reach this app: no public address, or an app connection that
// names a different one than YAP_PUBLIC_ORIGIN.
import { spawn } from "node:child_process";
import { DB_PORT, openDb, serveRpc } from "../dev/local/db-server";
import { APP_PORT, appEnv, connectionOrigin, publicOrigin, usesLocalDb } from "./local-env";

const env = appEnv();
if (!env.YAP_AGENT_TOKEN) {
  console.error("No YAP_AGENT_TOKEN in .env.local. Run npm run setup first.");
  process.exit(1);
}
const origin = publicOrigin(env.YAP_PUBLIC_ORIGIN);
if (!origin) console.warn("! No YAP_PUBLIC_ORIGIN: the agent cannot reach this app. See the README.");
else if (connectionOrigin() !== origin) {
  console.warn(`! The agent's app connection names ${String(connectionOrigin())}, not ${origin}.`);
  console.warn("  Run npm run setup, npm run secrets and npm run deploy:agent.");
}

if (usesLocalDb(env)) {
  await serveRpc(await openDb());
  console.log(`Local database on port ${String(DB_PORT)} (dev/local/.pglite)`);
}
const vite = spawn("npx", ["vite", "dev", "--port", String(APP_PORT), "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, ...env },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => vite.kill("SIGINT"));
