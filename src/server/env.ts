// Configuration, read from the process environment on every request: the
// Vite dev server has .env.local loaded into it, the Worker has its secrets
// there through nodejs_compat. A missing required key is an Error naming the
// key; values never appear in errors. Optional keys never fail a request.
export interface Config {
  readonly supabase: { readonly url: string; readonly secretKey: string };
  /** The agent's bearer on /api/agent/*. */
  readonly agentToken: string;
  /** The app's public origin, for the origin check on the owner's writes. */
  readonly origin: string;
  readonly dailyCapUsd: number;
  readonly threshold: number;
  /** Absent when OPENCOMPUTER_API_KEY is unset: learning runs are then not started. */
  readonly oc?: { readonly apiKey: string; readonly agentRef: string; readonly origin: string };
}

export type ConfigSource = Readonly<Record<string, string | undefined>>;

type RequiredKey = "SUPABASE_URL" | "SUPABASE_SECRET_KEY" | "YAP_AGENT_TOKEN" | "YAP_ORIGIN" | "YAP_AGENT_REF";

function required(source: ConfigSource, key: RequiredKey): string {
  const value = source[key]?.trim();
  if (!value) throw new Error(`Missing configuration: ${key}`);
  return value;
}

function origin(key: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new Error(`${key} must be an origin without a path`);
  return url.origin;
}

function number(source: ConfigSource, key: string, fallback: number, valid: (n: number) => boolean): number {
  const raw = source[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && valid(value) ? value : fallback;
}

export function readConfig(source: ConfigSource): Config {
  const token = required(source, "YAP_AGENT_TOKEN");
  if (token.length < 32) throw new Error("YAP_AGENT_TOKEN must be at least 32 characters");
  const apiKey = source.OPENCOMPUTER_API_KEY?.trim();
  return Object.freeze({
    supabase: Object.freeze({
      url: origin("SUPABASE_URL", required(source, "SUPABASE_URL")),
      secretKey: required(source, "SUPABASE_SECRET_KEY"),
    }),
    agentToken: token,
    origin: origin("YAP_ORIGIN", required(source, "YAP_ORIGIN")),
    dailyCapUsd: number(source, "YAP_DAILY_X_SPEND_USD", 25, (n) => n >= 0),
    threshold: Math.round(number(source, "YAP_SCORE_THRESHOLD", 60, (n) => n >= 0 && n <= 100)),
    ...(apiKey
      ? {
          oc: Object.freeze({
            apiKey,
            agentRef: required(source, "YAP_AGENT_REF"),
            origin: origin(
              "OPENCOMPUTER_API_URL",
              source.OPENCOMPUTER_API_URL?.trim() || "https://app.opencomputer.dev",
            ),
          }),
        }
      : {}),
  });
}
