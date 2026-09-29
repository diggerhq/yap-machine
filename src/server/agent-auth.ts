// The agent routes' authentication: the bearer token OpenComputer attaches
// from the YAP_AGENT_TOKEN secret, compared in constant time.
function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function agentAuthorized(req: Request, token: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] !== undefined && constantTimeEqual(match[1], token);
}
