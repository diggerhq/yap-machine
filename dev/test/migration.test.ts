import { describe, expect, it } from "vitest";
import { freshDb } from "./pg";

describe("the migration", () => {
  it("applies and grants the Worker's role only", async () => {
    const db = await freshDb();
    const grants = await db.query<{ grantee: string }>(
      "select distinct grantee from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','service_role')",
    );
    expect(grants.map((g) => g.grantee)).toEqual(["service_role"]);
    const rls = await db.query<{ relname: string }>(
      "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity",
    );
    expect(rls).toEqual([]);
  });
});
