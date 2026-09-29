// The headers the document is served with. Scripts come only from the app
// itself, the framework's inline bootstrap (by the per-response nonce the
// router stamps on it) and X's embed script; X's embeds render in its own
// frames and load avatars and media from its image hosts. Nothing else
// inline runs, and the browser talks only to the app's own routes.
export function securityHeaders(nonce: string): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://platform.twitter.com https://platform.x.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://pbs.twimg.com https://syndication.twitter.com",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-src https://platform.twitter.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
  };
}
