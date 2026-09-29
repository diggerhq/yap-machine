// The searches: each saved X query with its interval, whether it runs, and
// what it earned today. Adding, retuning or pausing a search is an edit here,
// never a deploy; the scout picks it up on its next five-minute run.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createSearch, fetchSearches, patchSearch } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Search } from "@/shared/feed";

export const Route = createFileRoute("/searches")({ component: Searches });

const searchesQuery = { queryKey: ["searches"], queryFn: fetchSearches } as const;

type Draft = Pick<Search, "id" | "label" | "query" | "everyMinutes" | "enabled">;

function Searches() {
  const searches = useQuery(searchesQuery);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Searches</h1>
          <p className="text-sm text-muted-foreground">
            Saved X queries. Each runs on its own interval and pays for a post once.
          </p>
        </div>
        {adding ? null : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add search
          </Button>
        )}
      </div>
      {adding ? (
        <SearchForm
          initial={{ id: "", label: "", query: "", everyMinutes: 15, enabled: true }}
          isNew
          onDone={() => setAdding(false)}
        />
      ) : null}
      {searches.isPending ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : searches.isError ? (
        <p role="alert" className="rounded-md bg-status-failed-bg px-3 py-2 text-sm text-status-failed">
          {searches.error.message}
        </p>
      ) : searches.data.searches.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No searches yet. Load the seed brief with npm run seed:brief, or add one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {searches.data.searches.map((search) =>
            editing === search.id ? (
              <li key={search.id} className="p-4">
                <SearchForm initial={search} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <SearchRow key={search.id} search={search} onEdit={() => setEditing(search.id)} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function SearchRow({ search, onEdit }: { search: Search; onEdit: () => void }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => patchSearch(search.id, { enabled: !search.enabled }),
    onSuccess: () => client.invalidateQueries({ queryKey: searchesQuery.queryKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <li className={cn("flex flex-col gap-2 p-4", !search.enabled && "text-muted-foreground")}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{search.label}</span>
        <code className="text-xs text-muted-foreground">{search.id}</code>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {search.enabled ? "Pause" : "Resume"}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${search.label}`} onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </Button>
        </span>
      </div>
      <code className="block rounded-md bg-code px-3 py-2 text-xs break-words whitespace-pre-wrap text-code-foreground">
        {search.query}
      </code>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Stat label="Every" value={`${String(search.everyMinutes)} min`} />
        <Stat label="Last run" value={search.lastRunAt ? `${ago(search.lastRunAt)} ago` : "never"} />
        <Stat label="Fetched today" value={String(search.fetchedToday)} />
        <Stat label="Reached Open today" value={String(search.openToday)} />
        <Stat label="Not relevant, 7 days" value={String(search.notRelevant7d)} />
        {search.enabled ? null : <Stat label="State" value="paused" />}
      </dl>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function SearchForm({ initial, isNew = false, onDone }: { initial: Draft; isNew?: boolean; onDone: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initial);
  const id = useId();
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? createSearch(draft)
        : patchSearch(initial.id, {
            label: draft.label,
            query: draft.query,
            everyMinutes: draft.everyMinutes,
            enabled: draft.enabled,
          }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: searchesQuery.queryKey });
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
        <label htmlFor={`${id}-id`} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Id
          <Input
            id={`${id}-id`}
            value={draft.id}
            disabled={!isNew}
            required
            pattern="[a-z0-9-]{1,64}"
            placeholder="agent-sandboxes"
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
          />
        </label>
        <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Label
          <Input
            id={`${id}-label`}
            value={draft.label}
            required
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
        <label htmlFor={`${id}-every`} className="flex flex-col gap-1 text-xs text-muted-foreground">
          Every (minutes)
          <Input
            id={`${id}-every`}
            type="number"
            min={5}
            max={1440}
            step={5}
            value={draft.everyMinutes}
            onChange={(event) => setDraft({ ...draft, everyMinutes: Number(event.target.value) })}
          />
        </label>
      </div>
      <label htmlFor={`${id}-query`} className="flex flex-col gap-1 text-xs text-muted-foreground">
        X query, sent verbatim ({draft.query.length}/512)
        <Textarea
          id={`${id}-query`}
          value={draft.query}
          required
          maxLength={512}
          rows={3}
          className="font-mono text-xs"
          onChange={(event) => setDraft({ ...draft, query: event.target.value })}
        />
      </label>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          Runs
        </label>
        <span className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {isNew ? "Add" : "Save"}
          </Button>
        </span>
      </div>
    </form>
  );
}
