// The owner's routes answer only on the app's own host, and a write must come
// from the app's own page. Locally the app is also reachable through a
// tunnel, so the agent can call it; the tunnel's host is not the app's, so
// the owner's routes (the brief, the searches, the feed) are not served
// through it. Deployed, the host is the Worker's and the same check holds.
// Agent routes carry no Origin and are guarded by their bearer token instead
// (agent-auth.ts).
function requestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  if (req.headers.get("sec-fetch-site") === "same-origin") return new URL(req.url).origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether the request came to the app's own host. */
export function onAppHost(req: Request, appOrigin: string): boolean {
  return new URL(req.url).host === new URL(appOrigin).host;
}

/** Whether a request may change state: a read, or a write from the app's own origin. */
export function originAllowed(req: Request, appOrigin: string): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return requestOrigin(req) === appOrigin;
}
