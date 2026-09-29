import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/posts/$id/open")({
  server: {
    middleware: [owner],
    handlers: {
      POST: handle(({ params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.opened(params.id, w);
      }),
    },
  },
});
