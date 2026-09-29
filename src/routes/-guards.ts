// The two guards the server routes compose. `agent`: the bearer token the
// agent's connection carries (no origin check; agent calls carry none).
// `owner`: only on the app's own host (not through the local tunnel), and a
// write must come from the app's own page. Both provide the wiring.
import { createMiddleware } from "@tanstack/react-start";
import { agentAuthorized } from "@/server/agent-auth";
import { onAppHost, originAllowed } from "@/server/origin";
import { problem } from "@/server/problem";
import { type Wiring, wiring } from "@/server/wiring";

/** What a handler behind a guard receives. */
export interface Handled<TParams = Record<string, never>> {
  readonly request: Request;
  readonly params: TParams;
  readonly context: { readonly wiring: Wiring };
}

function current(): { ok: true; wiring: Wiring } | { ok: false; response: Response } {
  try {
    return { ok: true, wiring: wiring() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, response: problem(500, "misconfigured", message) };
  }
}

export const agent = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const found = current();
  if (!found.ok) return found.response;
  if (!agentAuthorized(request, found.wiring.config.agentToken)) {
    return problem(401, "unauthorized", "The agent token is missing or wrong.");
  }
  return next({ context: { wiring: found.wiring } });
});

export const owner = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const found = current();
  if (!found.ok) return found.response;
  if (!onAppHost(request, found.wiring.config.origin)) {
    return problem(404, "not_found", "No such route.");
  }
  if (!originAllowed(request, found.wiring.config.origin)) {
    return problem(403, "origin_mismatch", "This request must come from the app itself.");
  }
  return next({ context: { wiring: found.wiring } });
});
