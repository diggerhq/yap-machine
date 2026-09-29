import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/feed")({
  server: {
    middleware: [owner],
    handlers: {
      GET: handle(({ request, context }: Handled) => {
        const w = context.wiring;
        return api.feed(request, w);
      }),
    },
  },
});
