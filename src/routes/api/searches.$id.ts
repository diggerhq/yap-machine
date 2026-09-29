import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/searches/$id")({
  server: {
    middleware: [owner],
    handlers: {
      PATCH: handle(({ request, params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.patchSearch(request, params.id, w);
      }),
    },
  },
});
