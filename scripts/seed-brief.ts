// `npm run seed:brief -- <path>`: load a brief. Makes its sections the active
// brief version and upserts its searches table (enabled). The database is
// the app's: the local one while `npm run dev` runs, or the Supabase project
// in .env.local.
import { readFileSync } from "node:fs";
import { isRefusal, supabaseDb } from "../src/server/db";
import { parseBrief } from "./brief-file";
import { appEnv, usesLocalDb } from "./local-env";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run seed:brief -- <path to a brief>   (see brief.example.md)");
  process.exit(2);
}
const env = appEnv();
if (!env.SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL is set without SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}
const brief = parseBrief(readFileSync(path, "utf8"));
const db = supabaseDb(env.SUPABASE_URL as string, env.SUPABASE_SECRET_KEY, fetch);
let version: unknown;
try {
  version = await db.rpc("create_brief_version", {
    p_owner_body: brief.ownerBody,
    p_learned: null,
    p_created_by: "owner",
  });
} catch (cause) {
  if (usesLocalDb(env)) {
    console.error("The local database is not running. Start `npm run dev` first, then run this in another terminal.");
    process.exit(1);
  }
  throw cause;
}
if (isRefusal(version)) throw new Error(`Brief refused: ${version.error}`);
const searches = await db.rpc("upsert_searches", { p_searches: brief.searches });
if (isRefusal(searches)) throw new Error(`Searches refused: ${searches.error}`);
console.log(
  `Loaded brief version ${String((version as { versionId: number }).versionId)} and ${String(brief.searches.length)} searches.`,
);
