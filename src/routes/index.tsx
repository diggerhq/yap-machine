// The feed: Open (worth answering now, by rank), Filtered (scored below the
// threshold) and Handled (opened on X, or given feedback). A reading surface:
// there is no text input for X anywhere. The list polls for newly judged
// Open posts every 20 seconds and offers them as "N new" rather than moving
// the page under the reader. Keyboard: j/k move, o opens on X, x marks Not
// relevant, r marks Relevant.
import { type InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type CardActions, PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchFeed, fetchNewCount, markOpened, putFeedback, withdrawFeedback } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type FeedItem, type FeedPage, FILTERS, type Filter, postUrl, type Verdict } from "@/shared/feed";
import { statusQuery } from "./__root";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { filter?: Filter } =>
    FILTERS.includes(search.filter as Filter) && search.filter !== "open" ? { filter: search.filter as Filter } : {},
  component: Feed,
});

const LABELS: Record<Filter, string> = { open: "Open", filtered: "Filtered", handled: "Handled" };
const EMPTY: Record<Filter, string> = {
  open: "Nothing worth answering right now. The scout runs every five minutes.",
  filtered: "Nothing scored below the threshold in the last 48 hours.",
  handled: "Posts you open on X or give feedback on land here.",
};

function Feed() {
  const filter = Route.useSearch().filter ?? "open";
  const client = useQueryClient();
  const { resolved } = useTheme();
  const status = useQuery(statusQuery);
  const threshold = status.data?.threshold ?? 60;
  const feed = useInfiniteQuery({
    queryKey: ["feed", filter],
    queryFn: ({ pageParam }) => fetchFeed(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const since = feed.data?.pages[0]?.at;
  const fresh = useQuery({
    queryKey: ["feed-new", since],
    queryFn: () => fetchNewCount(since as string),
    enabled: filter === "open" && Boolean(since),
    refetchInterval: 20_000,
  });
  const newCount = filter === "open" ? (fresh.data?.count ?? 0) : 0;

  const [selected, setSelected] = useState(0);
  const [noting, setNoting] = useState<{ id: string; verdict: Verdict } | null>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const now = Date.now();

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length]);

  const drop = useCallback(
    (id: string) => {
      client.setQueryData<InfiniteData<FeedPage>>(["feed", filter], (data) =>
        data
          ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((i) => i.id !== id) })) }
          : data,
      );
      void client.invalidateQueries({ queryKey: ["feed", "handled"] });
    },
    [client, filter],
  );

  const actions: CardActions = useMemo(
    () => ({
      open(item) {
        markOpened(item.id);
        if (filter !== "handled") drop(item.id);
      },
      mark(item, verdict, note) {
        drop(item.id);
        putFeedback(item.id, verdict, note)
          .then(() => void client.invalidateQueries({ queryKey: statusQuery.queryKey }))
          .catch((error: Error) => {
            toast.error(error.message);
            void client.invalidateQueries({ queryKey: ["feed"] });
          });
      },
      undo(item) {
        withdrawFeedback(item.id)
          .then(() => void client.invalidateQueries({ queryKey: ["feed"] }))
          .catch((error: Error) => toast.error(error.message));
      },
    }),
    [client, drop, filter],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const item = items[selected];
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = Math.max(0, Math.min(items.length - 1, selected + (event.key === "j" ? 1 : -1)));
        setSelected(next);
        const id = items[next]?.id;
        if (id) cards.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (!item) return;
      if (event.key === "o") {
        event.preventDefault();
        window.open(postUrl(item), "_blank", "noopener,noreferrer");
        actions.open(item);
      } else if (event.key === "x" && filter === "open") {
        event.preventDefault();
        setNoting({ id: item.id, verdict: "not_relevant" });
      } else if (event.key === "r" && filter === "filtered") {
        event.preventDefault();
        setNoting({ id: item.id, verdict: "relevant" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, filter, actions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Filter">
          {FILTERS.map((f) => (
            <Link
              key={f}
              to="/"
              search={f === "open" ? {} : { filter: f }}
              className={cn(
                "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground",
                f === filter && "bg-background font-medium text-foreground shadow-xs",
              )}
            >
              {LABELS[f]}
            </Link>
          ))}
        </nav>
        {filter !== "handled" ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {filter === "open" ? "Score" : "Below"} {filter === "open" ? "≥" : ""} {threshold}
          </span>
        ) : null}
      </div>

      {newCount > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => {
            window.scrollTo({ top: 0 });
            void feed.refetch();
          }}
        >
          <ArrowUp aria-hidden="true" />
          {newCount} new
        </Button>
      ) : null}

      {feed.isPending ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-lg" />
          ))}
        </div>
      ) : feed.isError ? (
        <p role="alert" className="rounded-md bg-status-failed-bg px-3 py-2 text-sm text-status-failed">
          {feed.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{EMPTY[filter]}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item: FeedItem, index) => (
            <PostCard
              key={item.id}
              ref={(element) => {
                if (element) cards.current.set(item.id, element);
                else cards.current.delete(item.id);
              }}
              item={item}
              filter={filter}
              threshold={threshold}
              selected={index === selected}
              noting={noting?.id === item.id ? noting.verdict : null}
              onNoting={(verdict) => {
                setSelected(index);
                setNoting(verdict ? { id: item.id, verdict } : null);
              }}
              actions={actions}
              dark={resolved === "dark"}
              now={now}
            />
          ))}
        </ul>
      )}

      {feed.hasNextPage ? (
        <Button
          variant="ghost"
          className="self-center"
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          {feed.isFetchingNextPage ? "Loading…" : "More"}
        </Button>
      ) : null}
    </div>
  );
}
