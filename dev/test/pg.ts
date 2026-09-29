// The database the tests run against: PGlite (Postgres in WebAssembly) with
// the real migration applied, behind the same `Db` interface the Worker uses
// over supabase-js. The Supabase roles the migration grants to are created
// first. Each call to `freshDb` is an empty database.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { type Db, DbError } from "../../src/server/db";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "supabase", "migrations");

export interface TestDb extends Db {
  readonly pg: PGlite;
  /** Plain SQL, for arranging and asserting. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export async function freshDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role;");
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return {
    pg,
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const names = Object.keys(args).filter((name) => args[name] !== undefined);
      const params = names.map((name) => {
        const value = args[name];
        return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
      });
      const list = names.map((name, index) => `${name} => $${String(index + 1)}`).join(", ");
      try {
        const result = await pg.query<{ result: T }>(`select public.${fn}(${list}) as result`, params);
        return result.rows[0]?.result as T;
      } catch (cause) {
        throw new DbError(
          fn,
          (cause as { code?: string }).code,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await pg.query<T>(sql, params)).rows;
    },
  };
}
