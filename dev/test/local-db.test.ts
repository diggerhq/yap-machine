// The local database stand-in brings an existing database up to date: a
// database made with the first migration only (before the stand-in recorded
// migrations) gets the later ones applied once, and its data kept.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../local/db-server";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the local database", () => {
  it("applies the migrations an existing database has not seen, once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yap-pglite-"));
    dirs.push(dir);
    const migrations = join(import.meta.dirname, "..", "..", "supabase", "migrations");
    const [first] = readdirSync(migrations).sort();
    const old = new PGlite(dir);
    await old.exec("create role anon; create role authenticated; create role service_role;");
    await old.exec(readFileSync(join(migrations, first as string), "utf8"));
    await old.exec("insert into searches (id, label, query, every_minutes) values ('kept', 'Kept', 'q', 5)");
    await old.close();

    const upgraded = await openDb({ dir });
    const applied = (await upgraded.query<{ name: string }>("select name from local_migrations order by name")).rows;
    expect(applied.map((r) => r.name)).toEqual(readdirSync(migrations).sort());
    expect((await upgraded.query("select id from searches")).rows).toEqual([{ id: "kept" }]);
    await upgraded.close();

    const again = await openDb({ dir });
    expect((await again.query("select count(*)::int as n from local_migrations")).rows).toEqual([
      { n: applied.length },
    ]);
    await again.close();
  });
});
