import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/brief/rules/$ruleId")({
  server: {
    middleware: [owner],
    handlers: {
      DELETE: handle(({ params, context }: Handled<{ readonly ruleId: string }>) => {
        const w = context.wiring;
        return api.deleteRule(params.ruleId, w);
      }),
    },
  },
});
