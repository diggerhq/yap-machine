import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/posts/$id/dismiss")({
  server: {
    middleware: [owner],
    handlers: {
      POST: handle(({ params, context }: Handled<{ readonly id: string }>) => api.dismiss(params.id, context.wiring)),
      DELETE: handle(({ params, context }: Handled<{ readonly id: string }>) =>
        api.undoDismiss(params.id, context.wiring),
      ),
    },
  },
});
