import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Feed });

function Feed() {
  return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-muted-foreground">Yap machine</main>;
}
