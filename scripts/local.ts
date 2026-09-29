// `npm run dev`: the whole yap machine from this checkout. The app and its
// database run here; the agent runs in your OpenComputer project's
// development environment and reaches the app through a Cloudflare quick
// tunnel (no Cloudflare account needed). In order:
//   1. the agent token, generated once into .env.local and opencomputer/.env.local;
//   2. the linked project (linked on first run as `yap-machine`);
//   3. the database: local (PGlite) unless .env.local names a Supabase project;
//   4. the app on http://localhost:3300;
//   5. the tunnel; its origin is written into the agent's app connection
//      (GAP(G5): a connection origin must be a literal in source);
//   6. the development secrets, set again because a secret's allowed
//      destinations are resolved from the connections when it is set;
//   7. `opencomputer deploy --alias development`.
// Stop with Ctrl-C. The next run gets a new tunnel and redeploys.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Tunnel } from "cloudflared";
import { DB_PORT, openDb, serveRpc } from "../dev/local/db-server";
import {
  AGENT_ENV_FILE,
  APP_PORT,
  appEnv,
  ensureAgentToken,
  linkedProject,
  readEnvFile,
  usesLocalDb,
} from "./local-env";

const CONNECTION_FILE = "opencomputer/agents/yap/connections/app.ts";
const children: ChildProcess[] = [];
let tunnel: Tunnel | undefined;

function step(message: string): void {
  console.log(`\n▸ ${message}`);
}

function run(command: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
    if (input !== undefined) child.stdin?.end(input);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${String(code)}`)),
    );
  });
}

function stop(): void {
  tunnel?.stop();
  for (const child of children) child.kill("SIGINT");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

step("Agent token");
ensureAgentToken();
const xToken = readEnvFile(AGENT_ENV_FILE).X_BEARER_TOKEN;
if (!xToken) {
  console.error(`Set X_BEARER_TOKEN in ${AGENT_ENV_FILE} (an X API app-only bearer token). See the README.`);
  process.exit(1);
}

step("OpenComputer project");
await run("npx", ["opencomputer", "whoami"]);
if (!linkedProject()) await run("npx", ["opencomputer", "link", "--create-project", "yap-machine"]);

const env = appEnv();
if (usesLocalDb(env)) {
  step(`Local database (PGlite) on ${String(DB_PORT)}`);
  await serveRpc(await openDb());
} else {
  step(`Database: ${new URL(env.SUPABASE_URL as string).host}`);
}

step(`App on http://localhost:${String(APP_PORT)}`);
const vite = spawn("npx", ["vite", "dev", "--port", String(APP_PORT), "--strictPort"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, ...env },
});
children.push(vite);

step("Tunnel");
const quick = Tunnel.quick(`http://localhost:${String(APP_PORT)}`);
tunnel = quick;
const origin = await new Promise<string>((resolve, reject) => {
  quick.once("url", (url: string) => resolve(new URL(url).origin));
  quick.once("exit", (code: number | null) => reject(new Error(`cloudflared exited ${String(code)}`)));
});
console.log(`  ${origin}`);

const source = readFileSync(CONNECTION_FILE, "utf8");
const updated = source.replace(/origin: "https:\/\/[^"]+"/, `origin: "${origin}"`);
if (updated !== source) writeFileSync(CONNECTION_FILE, updated);

step("Development secrets");
const agentEnv = readEnvFile(AGENT_ENV_FILE);
for (const name of ["X_BEARER_TOKEN", "YAP_AGENT_TOKEN"]) {
  await run(
    "npx",
    ["opencomputer", "secrets", "set", name, "--value-stdin", "--environment", "development"],
    agentEnv[name] as string,
  );
}

step("Deploying the agent to development");
await run("npx", ["opencomputer", "deploy", "--alias", "development"]);

console.log(`
Ready.
  App:    http://localhost:${String(APP_PORT)}
  Agent:  ${env.YAP_AGENT_REF || "(link the project)"} → ${origin}
Next, in another terminal:
  npm run seed:brief -- brief.example.md   (once: the brief and the searches)
  npm run scout:once                       (one scout run; needs OPENCOMPUTER_API_KEY)
`);
