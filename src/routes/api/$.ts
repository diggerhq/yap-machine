// Anything else under /api is a problem, not a page.
import { createFileRoute } from "@tanstack/react-router";
import { problem } from "@/server/problem";
import { owner } from "../-guards";

const notFound = () => problem(404, "not_found", "No such route.");

export const Route = createFileRoute("/api/$")({
  server: {
    middleware: [owner],
    handlers: { GET: notFound, POST: notFound, PATCH: notFound, PUT: notFound, DELETE: notFound },
  },
});
