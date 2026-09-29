// The local configuration every script reads: .env.local at the root for the
// app, opencomputer/.env.local for the agent's secrets, and the linked
// project. With no SUPABASE_URL the app uses the local database (PGlite with
// the real migration, served by dev/local/db-server.ts), so a fresh clone
// runs with no database account at all.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const APP_PORT = 3300;
export const LOCAL_DB_URL = "http://127.0.0.1:54399";
export const LOCAL_DB_KEY = "local";
export const APP_ENV_FILE = ".env.local";
export const AGENT_ENV_FILE = "opencomputer/.env.local";
export const PROJECT_FILE = ".opencomputer/project.json";

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    Object.entries(parseEnv(readFileSync(path, "utf8"))).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
    ),
  );
}

/** Sets KEY=value in an env file, adding the line or replacing an empty or existing one. */
export function setEnvValue(path: string, key: string, value: string): void {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const at = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (at === -1) lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  else lines[at] = `${key}=${value}`;
  writeFileSync(path, `${lines.join("\n").replace(/\n*$/, "")}\n`);
}

/**
 * The agent token both sides share: the app checks it, the agent's
 * connection sends it. Generated once into both files when missing; a value
 * already in either file wins and is copied to the other.
 */
export function ensureAgentToken(): string {
  const token =
    readEnvFile(APP_ENV_FILE).YAP_AGENT_TOKEN ??
    readEnvFile(AGENT_ENV_FILE).YAP_AGENT_TOKEN ??
    randomBytes(32).toString("base64url");
  if (readEnvFile(APP_ENV_FILE).YAP_AGENT_TOKEN !== token) setEnvValue(APP_ENV_FILE, "YAP_AGENT_TOKEN", token);
  if (readEnvFile(AGENT_ENV_FILE).YAP_AGENT_TOKEN !== token) setEnvValue(AGENT_ENV_FILE, "YAP_AGENT_TOKEN", token);
  return token;
}

export interface LinkedProject {
  readonly projectId: string;
  readonly agentId: string;
}

export function linkedProject(): LinkedProject | undefined {
  if (!existsSync(PROJECT_FILE)) return undefined;
  const parsed = JSON.parse(readFileSync(PROJECT_FILE, "utf8")) as Partial<LinkedProject>;
  return parsed.projectId && parsed.agentId ? { projectId: parsed.projectId, agentId: parsed.agentId } : undefined;
}

/** The app's configuration for this machine: the environment, then .env.local, then the local defaults. */
export function appEnv(): Record<string, string> {
  const file = readEnvFile(APP_ENV_FILE);
  const value = (key: string) => process.env[key] ?? file[key];
  const hosted = Boolean(value("SUPABASE_URL"));
  const project = linkedProject();
  return {
    ...file,
    SUPABASE_URL: hosted ? (value("SUPABASE_URL") as string) : LOCAL_DB_URL,
    SUPABASE_SECRET_KEY: hosted ? (value("SUPABASE_SECRET_KEY") ?? "") : LOCAL_DB_KEY,
    YAP_ORIGIN: value("YAP_ORIGIN") ?? `http://localhost:${String(APP_PORT)}`,
    YAP_AGENT_REF: value("YAP_AGENT_REF") ?? (project ? `${project.agentId}@development` : ""),
    ...(value("YAP_AGENT_TOKEN") ? { YAP_AGENT_TOKEN: value("YAP_AGENT_TOKEN") as string } : {}),
    ...(value("OPENCOMPUTER_API_KEY") ? { OPENCOMPUTER_API_KEY: value("OPENCOMPUTER_API_KEY") as string } : {}),
  };
}

export function usesLocalDb(env: Record<string, string>): boolean {
  return env.SUPABASE_URL === LOCAL_DB_URL;
}
