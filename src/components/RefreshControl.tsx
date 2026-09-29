// Refresh: starts a scout run now and shows where it is, from the app's own
// tables: starting, searching X (searches run of those planned), scoring
// (posts scored of those waiting), done. A run takes a minute or two, so
// this is a button with progress, not pull-to-refresh. It also shows runs
// the schedule started. When a run finishes the feed reloads.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchRefresh, startRefresh } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { phaseOf, type ScoutRun } from "@/shared/feed";

function label(run: ScoutRun): { text: string; progress: number | null } {
  switch (phaseOf(run)) {
    case "starting":
      return { text: "Starting…", progress: null };
    case "searching":
      return {
        text: `Searching X · ${String(run.searched)} of ${String(run.planned)}`,
        progress: run.planned ? run.searched / run.planned / 2 : null,
      };
    case "scoring": {
      const total = run.judged + run.waiting;
      return {
        text: run.waiting > 0 ? `Scoring · ${String(run.waiting)} left` : "Finishing…",
        progress: 0.5 + (total ? run.judged / total : 1) / 2,
      };
    }
    default:
      return { text: "", progress: null };
  }
}

export function RefreshControl() {
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const refresh = useQuery({
    queryKey: ["refresh"],
    queryFn: fetchRefresh,
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      return run && !run.finishedAt && !run.stalled ? 2000 : 15000;
    },
  });
  const run = refresh.data?.run ?? null;
  const running = Boolean(run && !run.finishedAt && !run.stalled);

  // When a run finishes, reload what it changed.
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (running && run) was.current = run.sessionId;
    if (!running && run && was.current === run.sessionId) {
      was.current = null;
      void client.invalidateQueries({ queryKey: ["feed"] });
      void client.invalidateQueries({ queryKey: ["status"] });
      toast(run.stored > 0 ? `${String(run.stored)} new posts fetched and scored` : "Nothing new on X right now");
    }
  }, [running, run, client]);

  const start = () => {
    setStarting(true);
    startRefresh()
      .then((data) => client.setQueryData(["refresh"], data))
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setStarting(false));
  };

  if (running && run) {
    const { text, progress } = label(run);
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        <RefreshCw aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">{text}</span>
        <span className="relative hidden h-1 w-20 overflow-hidden rounded-full bg-muted sm:block">
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500",
              progress === null && "w-1/4 animate-pulse",
            )}
            style={progress === null ? undefined : { width: `${String(Math.round(progress * 100))}%` }}
          />
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {run?.finishedAt ? <span className="hidden sm:inline">Updated {ago(run.finishedAt)} ago</span> : null}
      <Button variant="outline" size="sm" disabled={starting} onClick={start}>
        <RefreshCw aria-hidden="true" className={cn(starting && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}
