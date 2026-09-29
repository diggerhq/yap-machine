import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/agent-api";
import { handle } from "@/server/problem";
import { agent, type Handled } from "../../-guards";

export const Route = createFileRoute("/api/agent/searches/$id/claim")({
  server: {
    middleware: [agent],
    handlers: {
      POST: handle(({ request, params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.claim(request, params.id, w);
      }),
    },
  },
});
