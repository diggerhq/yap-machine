// `npm run seed:brief -- <path>`: load a seed brief. Writes the brief text to
// brief.local.md (ignored), makes the owner sections the active version, and
// upserts the searches table (enabled). The database comes from the
// environment or .env.local: SUPABASE_URL and SUPABASE_SECRET_KEY.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { isRefusal, supabaseDb } from "../src/server/db";
import { parseBrief } from "./brief-file";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run seed:brief -- <path to the seed brief>");
  process.exit(2);
}
const local = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const url = process.env.SUPABASE_URL ?? local.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? local.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)");
  process.exit(2);
}

const brief = parseBrief(readFileSync(path, "utf8"));
writeFileSync("brief.local.md", `${brief.ownerBody}\n`);
const db = supabaseDb(url, key, fetch);
const version = await db.rpc("create_brief_version", {
  p_owner_body: brief.ownerBody,
  p_learned: null,
  p_created_by: "owner",
});
if (isRefusal(version)) throw new Error(`Brief refused: ${version.error}`);
const searches = await db.rpc("upsert_searches", { p_searches: brief.searches });
if (isRefusal(searches)) throw new Error(`Searches refused: ${searches.error}`);
console.log(
  `Loaded brief version ${String((version as { versionId: number }).versionId)} and ${String(brief.searches.length)} searches.`,
);
