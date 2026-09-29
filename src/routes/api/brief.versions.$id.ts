import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/brief/versions/$id")({
  server: {
    middleware: [owner],
    handlers: {
      GET: handle(({ params, context }: Handled<{ readonly id: string }>) => {
        const w = context.wiring;
        return api.briefVersion(params.id, w);
      }),
    },
  },
});
