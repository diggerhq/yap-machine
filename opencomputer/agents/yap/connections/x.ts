// X API v2, read-only: recent search with the app-only bearer token, which
// OpenComputer attaches at its egress proxy; the runtime never holds it.
import { bearer, defineConnection, useSecret } from "@opencomputer/agent";

export const xApi = defineConnection({
  id: "x-api",
  origin: "https://api.x.com",
  methods: ["GET"],
  pathPrefix: "/2/",
  headers: { Authorization: bearer(useSecret("X_BEARER_TOKEN")) },
});
