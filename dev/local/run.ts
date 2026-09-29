// `npm run dev:sample`: the app over authored sample data, with no agent,
// for looking at the screens. The sample database is PGlite with the real
// migration and supabase/seed.sql, reloaded on every start and kept apart
// from the database `npm run dev` uses. The app runs on port 3300 against it.
import { spawn } from "node:child_process";
import { DB_PORT, openDb, SAMPLE_DATA, serveRpc } from "./db-server";

export const LOCAL_ENV = {
  SUPABASE_URL: `http://127.0.0.1:${String(DB_PORT)}`,
  SUPABASE_SECRET_KEY: "local",
  YAP_AGENT_TOKEN: "local-agent-token-local-agent-token-local",
  YAP_ORIGIN: "http://localhost:3300",
  OPENCOMPUTER_API_KEY: "",
} as const;

const pg = await openDb({ reset: true, seed: true, dir: SAMPLE_DATA });
await serveRpc(pg);
console.log(`Sample database on ${LOCAL_ENV.SUPABASE_URL}, loaded from supabase/seed.sql`);

const vite = spawn("npx", ["vite", "dev", "--port", "3300", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, ...LOCAL_ENV },
});
vite.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => vite.kill("SIGINT"));
