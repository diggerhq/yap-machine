// The brief: the owner's sections (only the owner edits them; saving makes a
// version), the Learned rules the learning runs maintain (each with the
// feedback behind it while its posts are kept; any can be deleted), the
// feedback waiting to be folded in, and the version history with a diff and
// restore.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { History, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { deleteRule, fetchBrief, fetchBriefVersion, restoreVersion, saveOwnerSections } from "@/lib/api";
import { diffLines, versionText } from "@/lib/diff";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BriefState, RuleFeedback } from "@/shared/feed";
import { statusQuery } from "./__root";

export const Route = createFileRoute("/brief")({ component: Brief });

const briefQuery = { queryKey: ["brief"], queryFn: fetchBrief } as const;

function Brief() {
  const brief = useQuery(briefQuery);
  if (brief.isPending) return <Skeleton className="h-96 rounded-lg" />;
  if (brief.isError) {
    return (
      <p role="alert" className="rounded-md bg-status-failed-bg px-3 py-2 text-sm text-status-failed">
        {brief.error.message}
      </p>
    );
  }
  if (!brief.data.active) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        There is no brief yet. Load the seed with npm run seed:brief.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <OwnerSections body={brief.data.active.ownerBody} />
      <Learned state={brief.data} />
      <Queue queue={brief.data.queue} />
      <Versions state={brief.data} />
    </div>
  );
}

function useRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: briefQuery.queryKey });
    void client.invalidateQueries({ queryKey: statusQuery.queryKey });
  };
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function OwnerSections({ body }: { body: string }) {
  const refresh = useRefresh();
  const [draft, setDraft] = useState(body);
  useEffect(() => setDraft(body), [body]);
  const save = useMutation({
    mutationFn: () => saveOwnerSections(draft),
    onSuccess: () => {
      toast.success("Saved as a new version");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const changed = draft.trim() !== body.trim();
  return (
    <Section title="Your sections" hint="What you care about. Only you edit these; learning runs never change them.">
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={16}
        aria-label="Your sections of the brief"
        className="font-mono text-xs leading-relaxed"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!changed} onClick={() => setDraft(body)}>
          Discard
        </Button>
        <Button size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          Save version
        </Button>
      </div>
    </Section>
  );
}

function FeedbackLine({ item }: { item: RuleFeedback & { createdAt?: string } }) {
  return (
    <li className="flex flex-col gap-0.5 text-xs">
      <span className="flex items-center gap-2">
        <span className={item.verdict === "relevant" ? "text-status-ready-for-review" : "text-status-failed"}>
          {item.verdict === "relevant" ? "Relevant" : "Not relevant"}
        </span>
        <span className="text-muted-foreground">@{item.authorHandle}</span>
        {item.createdAt ? <span className="text-muted-foreground">{ago(item.createdAt)} ago</span> : null}
      </span>
      {item.note ? <span>“{item.note}”</span> : null}
      {item.text ? <span className="line-clamp-2 text-muted-foreground">{item.text}</span> : null}
    </li>
  );
}

function Learned({ state }: { state: BriefState }) {
  const refresh = useRefresh();
  const remove = useMutation({
    mutationFn: (ruleId: string) => deleteRule(ruleId),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const rules = state.active?.learned ?? [];
  return (
    <Section
      title="Learned"
      hint="Rules learning runs drew from your feedback. Deleting one makes a new version; it returns only if new feedback supports it."
    >
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No learned rules yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm">{rule.text}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete this rule"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(rule.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {rule.feedback?.length ? (
                <ul className="flex flex-col gap-2 border-l-2 pl-3">
                  {rule.feedback.map((item) => (
                    <FeedbackLine key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Its feedback's posts are no longer kept.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Queue({ queue }: { queue: BriefState["queue"] }) {
  return (
    <Section
      title="Waiting to be learned"
      hint="Feedback the scout already uses as examples; the next learning run folds it into rules."
    >
      {queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="flex flex-col gap-3 rounded-lg border p-4">
          {queue.map((item) => (
            <FeedbackLine key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Versions({ state }: { state: BriefState }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (id: number) => restoreVersion(id),
    onSuccess: () => {
      toast.success("Restored as a new version");
      setOpen(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Section title="Versions" hint="Every change makes a version. Restoring copies an old one into a new version.">
      <ul className="flex flex-col divide-y rounded-lg border text-sm">
        {state.versions.map((version) => (
          <li key={version.id} className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">v{version.id}</span>
              <span>{version.createdBy === "learning" ? "Learning run" : "You"}</span>
              <span className="text-muted-foreground">{ago(version.createdAt)} ago</span>
              <span className="text-xs text-muted-foreground">
                {version.rules} {version.rules === 1 ? "rule" : "rules"}
              </span>
              {version.status === "active" ? (
                <Badge variant="outline" className="font-normal">
                  active
                </Badge>
              ) : null}
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setOpen(open === version.id ? null : version.id)}>
                  <History aria-hidden="true" />
                  {open === version.id ? "Hide" : "Diff"}
                </Button>
                {version.status === "active" ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(version.id)}
                  >
                    Restore
                  </Button>
                )}
              </span>
            </div>
            {open === version.id ? <VersionDiff id={version.id} basedOn={version.basedOn} /> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function VersionDiff({ id, basedOn }: { id: number; basedOn: number | null }) {
  const version = useQuery({ queryKey: ["brief-version", id], queryFn: () => fetchBriefVersion(id) });
  const base = useQuery({
    queryKey: ["brief-version", basedOn],
    queryFn: () => fetchBriefVersion(basedOn as number),
    enabled: basedOn !== null,
  });
  if (!version.data || (basedOn !== null && !base.data)) return <Skeleton className="h-24" />;
  const after = versionText(version.data.ownerBody, version.data.learned);
  const before = base.data ? versionText(base.data.ownerBody, base.data.learned) : "";
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-code p-3 font-mono text-xs leading-relaxed text-code-foreground">
      {basedOn === null ? <p className="mb-2 text-muted-foreground">The first version.</p> : null}
      {diffLines(before, after).map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of a static diff.
          key={index}
          className={cn(
            "whitespace-pre-wrap",
            line.kind === "added" && "bg-status-ready-for-review-bg text-status-ready-for-review",
            line.kind === "removed" && "bg-status-failed-bg text-status-failed line-through",
          )}
        >
          {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
          {line.text}
        </div>
      ))}
    </pre>
  );
}
