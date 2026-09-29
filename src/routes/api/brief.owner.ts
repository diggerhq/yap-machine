import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/owner-api";
import { handle } from "@/server/problem";
import { type Handled, owner } from "../-guards";

export const Route = createFileRoute("/api/brief/owner")({
  server: {
    middleware: [owner],
    handlers: {
      PUT: handle(({ request, context }: Handled) => {
        const w = context.wiring;
        return api.putOwnerSections(request, w);
      }),
    },
  },
});
