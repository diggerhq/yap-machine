// The app's agent routes. The bearer token authenticates the agent to the
// app; the Cloudflare Access service token gets it past Access, which keeps
// the hostname private (a request without it is redirected to a login page,
// which the egress proxy refuses). OpenComputer attaches all three.
// GAP(G5): the origin is a literal, so the Worker's origin lives in source.
import { bearer, type DataValue, defineConnection, secretHeader, useSecret } from "@opencomputer/agent";

export const app = defineConnection({
  id: "app",
  origin: "https://yap-machine.mixflow.workers.dev",
  methods: ["GET", "POST"],
  pathPrefix: "/api/agent/",
  headers: {
    Authorization: bearer(useSecret("YAP_AGENT_TOKEN")),
    "CF-Access-Client-Id": secretHeader(useSecret("CF_ACCESS_CLIENT_ID")),
    "CF-Access-Client-Secret": secretHeader(useSecret("CF_ACCESS_CLIENT_SECRET")),
  },
});

export interface AppAnswer<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
}

/** One call to an agent route: a JSON body in, the JSON answer and its status out. */
export type Json = { readonly [key: string]: DataValue };

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
