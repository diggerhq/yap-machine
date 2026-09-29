import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/searches")({
  server: {
    middleware: [owner],
    handlers: {
      GET: handle(({ context }: Handled) => {
        const w = context.wiring;
        return api.searches(w);
      }),
      POST: handle(({ request, context }: Handled) => {
        const w = context.wiring;
        return api.createSearch(request, w);
      }),
    },
  },
});
