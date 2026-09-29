// A local stand-in for Supabase's REST endpoint, for running the app on this
// machine without a Supabase project or Docker: it serves exactly what the
// app calls, `POST /rest/v1/rpc/<function>` with the named arguments as the
// JSON body, over PGlite (Postgres in WebAssembly) with the real migration
// applied. It is a real database, not a mock; only PostgREST is replaced.
// State persists under dev/local/.pglite (ignored). `--reset` starts empty;
// `--seed` loads supabase/seed.sql.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const DB_PORT = 54399;
const ROOT = join(import.meta.dirname, "..", "..");
const DATA = join(import.meta.dirname, ".pglite");
/** The sample data lives apart, so loading it never touches the database `npm run dev` keeps. */
export const SAMPLE_DATA = join(import.meta.dirname, ".pglite-sample");
const FUNCTION = /^\/rest\/v1\/rpc\/([a-z_]+)$/;

export async function openDb(options: { reset?: boolean; seed?: boolean; dir?: string } = {}): Promise<PGlite> {
  const dir = options.dir ?? DATA;
  if (options.reset && existsSync(dir)) rmSync(dir, { recursive: true });
  const fresh = !existsSync(dir);
  const pg = new PGlite(dir);
  if (fresh) {
    await pg.exec("create role anon; create role authenticated; create role service_role;");
    const migrations = join(ROOT, "supabase", "migrations");
    for (const file of readdirSync(migrations).sort()) await pg.exec(readFileSync(join(migrations, file), "utf8"));
  }
  if (options.seed) await pg.exec(readFileSync(join(ROOT, "supabase", "seed.sql"), "utf8"));
  return pg;
}

export function serveRpc(pg: PGlite, port = DB_PORT): Promise<() => Promise<void>> {
  const server = createServer((req, res) => {
    const match = FUNCTION.exec(req.url?.split("?")[0] ?? "");
    if (req.method !== "POST" || !match) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "not found" }));
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      void (async () => {
        try {
          const args = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
          const names = Object.keys(args);
          const params = names.map((n) => {
            const v = args[n];
            return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
          });
          const list = names.map((n, i) => `${n} => $${String(i + 1)}`).join(", ");
          const result = await pg.query<{ result: unknown }>(`select public.${match[1]}(${list}) as result`, params);
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(result.rows[0]?.result ?? null));
        } catch (cause) {
          const error = cause as { code?: string; message?: string };
          res
            .writeHead(400, { "content-type": "application/json" })
            .end(JSON.stringify({ code: error.code ?? "PGLITE", message: error.message ?? String(cause) }));
        }
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(() => new Promise((done) => server.close(() => done()))));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pg = await openDb({ reset: process.argv.includes("--reset"), seed: process.argv.includes("--seed") });
  await serveRpc(pg);
  console.log(`Local database on http://127.0.0.1:${String(DB_PORT)} (PGlite, ${DATA})`);
}
