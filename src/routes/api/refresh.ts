import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/refresh")({
  server: {
    middleware: [owner],
    handlers: {
      GET: handle(({ context }: Handled) => api.refreshProgress(context.wiring)),
      POST: handle(({ context }: Handled) => api.refresh(context.wiring)),
    },
  },
});
