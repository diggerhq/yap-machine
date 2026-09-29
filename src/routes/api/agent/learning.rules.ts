import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/agent-api";
import { handle } from "@/server/problem";
import { agent, type Handled } from "../../-guards";

export const Route = createFileRoute("/api/agent/learning/rules")({
  server: {
    middleware: [agent],
    handlers: {
      POST: handle(({ request, context }: Handled) => {
        const w = context.wiring;
        return api.saveLearned(request, w);
      }),
    },
  },
});
