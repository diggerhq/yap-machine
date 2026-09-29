import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/posts/$id/feedback")({
  server: {
    middleware: [owner],
    handlers: {
      PUT: handle(({ request, params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.putFeedback(request, params.id, w);
      }),
      DELETE: handle(({ params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.withdrawFeedback(params.id, w);
      }),
    },
  },
});
