// The app's agent routes, reached through OpenComputer's egress proxy, which
// attaches the bearer token from the YAP_AGENT_TOKEN secret; the runtime
// never holds it.
// GAP(G5): the origin must be a literal in this call, so it is the one
// per-clone value in agent source. `npm run local` rewrites it to the
// current tunnel's origin; a deployed app sets it to the Worker's origin.
import { bearer, type DataValue, defineConnection, useSecret } from "@opencomputer/agent";

export const app = defineConnection({
  id: "app",
  origin: "https://yap-machine-app.example.com",
  methods: ["GET", "POST"],
  pathPrefix: "/api/agent/",
  headers: { Authorization: bearer(useSecret("YAP_AGENT_TOKEN")) },
});

export interface AppAnswer<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
}

export type Json = { readonly [key: string]: DataValue };

/** One call to an agent route: a JSON body in, the JSON answer and its status out. */
export async function callApp<T = Json>(method: "GET" | "POST", path: string, body?: unknown): Promise<AppAnswer<T>> {
  const response = await app.fetch(path, {
    method,
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { code: "bad_response", message: text.slice(0, 200) } };
  }
  return { ok: response.ok, status: response.status, data: data as T };
}

/** What the model sees when an app call fails: the app's code and message, or the status. */
export function appFailure(answer: AppAnswer<unknown>): Json {
  const problem = (answer.data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return {
    error: typeof problem?.code === "string" ? problem.code : "app_error",
    status: answer.status,
    ...(typeof problem?.message === "string" ? { detail: problem.message.slice(0, 300) } : {}),
  };
}
