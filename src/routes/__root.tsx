// The document and the shell: the header (the three screens, today's X spend
// against the cap, and what the learning loop is doing) over the page.
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchStatus } from "@/lib/api";
import { usd } from "@/lib/format";
import { initTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import appCss from "@/styles.css?url";

export const statusQuery = { queryKey: ["status"], queryFn: fetchStatus, refetchInterval: 20_000 } as const;

export const CONTAINER = "mx-auto w-full max-w-2xl px-4 md:px-8";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "Yap machine" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: Document,
  component: App,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => initTheme(), []);
  return (
    <TooltipProvider delayDuration={300}>
      <QueryClientProvider client={queryClient}>
        <div className="flex min-h-dvh flex-col">
          <Header />
          <main className={cn(CONTAINER, "flex flex-1 flex-col py-6")}>
            <Outlet />
          </main>
        </div>
        <Toaster position="bottom-right" closeButton />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

const NAV = [
  { to: "/", label: "Feed" },
  { to: "/searches", label: "Searches" },
  { to: "/brief", label: "Brief" },
] as const;

function Header() {
  return (
    <header className="sticky top-0 z-(--z-sticky) border-b bg-background">
      <div className={cn(CONTAINER, "flex h-14 items-center gap-3 sm:gap-4")}>
        <Link to="/" className="shrink-0 rounded-sm text-base font-semibold tracking-tight">
          Yap machine
        </Link>
        <nav className="flex items-center text-sm sm:gap-1" aria-label="Screens">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-hover hover:text-foreground sm:px-2"
              activeProps={{ className: "text-foreground font-medium" }}
              activeOptions={{ exact: true }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <StatusLine />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function StatusLine() {
  const status = useQuery(statusQuery);
  if (!status.data) return null;
  const { spend, learning, brief } = status.data;
  const atCap = spend.todayUsd >= spend.capUsd;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {learning ? (
        <span className="hidden items-center gap-1.5 sm:flex">
          <span aria-hidden="true" className="status-dot-pulse size-1.5 rounded-full bg-status-working-dot" />
          Learning…
        </span>
      ) : brief && brief.createdBy === "learning" ? (
        <Link to="/brief" className="hidden rounded-sm hover:text-foreground sm:inline">
          Brief updated · {brief.rules} {brief.rules === 1 ? "rule" : "rules"}
        </Link>
      ) : null}
      <span
        className={cn("whitespace-nowrap tabular-nums", atCap && "text-attention")}
        title="X API spend today (UTC), counted from every object returned, against the daily cap"
      >
        <span className="hidden sm:inline">X </span>
        {usd(spend.todayUsd)}
        <span className="hidden sm:inline"> / {usd(spend.capUsd)}</span>
      </span>
    </div>
  );
}
