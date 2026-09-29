// What every route handler works with: the configuration, the database, the
// management client (when configured), the clock and `waitUntil`. Built per
// request from the host; tests replace any part through `configure`.
import { type Client, createClient } from "./client";
import { type Db, supabaseDb } from "./db";
import { type Config, readConfig } from "./env";

export interface Wiring {
  readonly config: Config;
  readonly db: Db;
  /** The OpenComputer management client; undefined without OPENCOMPUTER_API_KEY. */
  readonly client: Client | undefined;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** Keeps work alive after the response (Cloudflare's ctx.waitUntil). */
  readonly waitUntil: (work: Promise<unknown>) => void;
}

interface Overrides {
  readonly config?: Config;
  readonly db?: Db;
  readonly client?: Client | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly waitUntil?: (work: Promise<unknown>) => void;
}

let overrides: Overrides | undefined;

/** Tests only: fix parts of the wiring every route sees; `configure()` restores the host's. */
export function configure(next?: Overrides): void {
  overrides = next;
}

async function hostWaitUntil(work: Promise<unknown>): Promise<void> {
  const settled = work.catch((cause: unknown) => console.error(cause));
  try {
    // The Workers runtime keeps the request's context reachable through this
    // module; elsewhere (the Vite dev server) the promise runs on by itself.
    const specifier = "cloudflare:workers";
    const workers = (await import(/* @vite-ignore */ specifier)) as { waitUntil?: (p: Promise<unknown>) => void };
    workers.waitUntil?.(settled);
  } catch {
    // Not on Workers.
  }
}

/** The wiring for one request. Throws the configuration error naming a missing key. */
export function wiring(): Wiring {
  const config = overrides?.config ?? readConfig(process.env);
  const fetchImpl = overrides?.fetch ?? globalThis.fetch.bind(globalThis);
  const client =
    overrides?.client === null
      ? undefined
      : (overrides?.client ?? (config.oc ? createClient(config.oc, fetchImpl) : undefined));
  return {
    config,
    db: overrides?.db ?? supabaseDb(config.supabase.url, config.supabase.secretKey, fetchImpl),
    client,
    now: overrides?.now ?? (() => Date.now()),
    waitUntil:
      overrides?.waitUntil ??
      ((work) => {
        void hostWaitUntil(work);
      }),
  };
}
