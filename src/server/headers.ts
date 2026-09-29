// The headers the document is served with. Scripts come only from the app
// itself and the framework's inline bootstrap (by the per-response nonce the
// router stamps on it). Images may also come from X's image host, for the
// authors' avatars. The browser talks only to the app's own routes.
export function securityHeaders(nonce: string): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://pbs.twimg.com",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
  };
}
