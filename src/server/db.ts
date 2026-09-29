// The one database seam: named Postgres functions, called with supabase-js
// `.rpc()`. Every function returns jsonb; a refusal comes back as
// `{ error: "<code>" }` and is the caller's to map, while a failure of the
// call itself is a DbError. Tests implement the same interface over PGlite
// running the same migration (dev/test/pg.ts).
import { createClient } from "@supabase/supabase-js";

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
}

export class DbError extends Error {
  constructor(
    readonly fn: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = "DbError";
  }
}

/** A refusal a database function returned instead of a result. */
export interface Refusal {
  readonly error: string;
  readonly [key: string]: unknown;
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";
}

export function supabaseDb(url: string, secretKey: string, fetchImpl: typeof globalThis.fetch): Db {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new DbError(fn, error.code, error.message);
      return data as T;
    },
  };
}
