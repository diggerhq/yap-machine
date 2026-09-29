// The management client: `@opencomputer/sdk/agents` pointed at the
// configured origin with the host's fetch. The app uses it for one thing:
// starting learning runs, and ending them once they have reported.
import { OpenComputer } from "@opencomputer/sdk/agents";

export type Client = Pick<OpenComputer, "sessions">;

export function createClient(
  oc: { readonly apiKey: string; readonly origin: string },
  fetchImpl: typeof globalThis.fetch,
): Client {
  return new OpenComputer({ apiKey: oc.apiKey, baseUrl: `${oc.origin}/api/managed-agents`, fetch: fetchImpl });
}
