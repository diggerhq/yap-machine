// The server entry of the one artifact: the framework's request handler,
// which serves the document, the route files under /api and /auth, and the
// client assets. Cloudflare calls fetch(request, env, ctx); the Vite dev
// server calls fetch(request). The Worker's variables reach the routes
// through process.env (nodejs_compat), so there is nothing host-specific here.
import handler from "@tanstack/react-start/server-entry";

export default handler;
