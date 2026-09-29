// The origin check on the owner's routes. Cloudflare Access keeps strangers
// out of the hostname; this keeps other sites from making the owner's
// browser change state here. Reads are always allowed. Agent routes carry no
// Origin and are guarded by their bearer token instead (agent-auth.ts).
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

/** Whether a request may change state: a read, or a write from the app's own origin. */
export function originAllowed(req: Request, appOrigin: string): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return requestOrigin(req) === appOrigin;
}
