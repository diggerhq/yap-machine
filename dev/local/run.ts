// `npm run dev:local`: the whole app on this machine with no Supabase project
// and no Docker. The local database stand-in (PGlite with the real
// migration) serves the app's database calls, and `vite dev` runs the app
// against it on port 3300. `-- --seed` loads supabase/seed.sql into a fresh
// database; `-- --reset` empties it first. Values in the environment win
// over these defaults, and .env.local is not read for the database, so a
// local run never touches a hosted project.
import { spawn } from "node:child_process";
import { DB_PORT, openDb, serveRpc } from "./db-server";

export const LOCAL_ENV = {
  SUPABASE_URL: `http://127.0.0.1:${String(DB_PORT)}`,
  SUPABASE_SECRET_KEY: "local",
  YAP_AGENT_TOKEN: "local-agent-token-local-agent-token-local",
  YAP_ORIGIN: "http://localhost:3300",
  OPENCOMPUTER_API_KEY: "",
} as const;

const seed = process.argv.includes("--seed");
const pg = await openDb({ reset: process.argv.includes("--reset") || seed, seed });
await serveRpc(pg);
console.log(`Local database on ${LOCAL_ENV.SUPABASE_URL}${seed ? ", seeded" : ""}`);

const vite = spawn("npx", ["vite", "dev", "--port", "3300", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, ...LOCAL_ENV },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => vite.kill("SIGINT"));
