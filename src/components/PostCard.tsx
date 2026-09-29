// One post in the feed: the score and its reason, the post itself (X's embed
// or the stored fallback), and what the owner can do with it. Open on X is
// the only way to reply: it opens the post's page, where the owner writes by
// hand. Not relevant (on Open) and Relevant (on Filtered) take an optional
// one-line note: Enter saves it, Esc saves without it. A handled card shows
// its verdict and note, with Undo until a learning run has folded it in.
import { ExternalLink, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { type FeedItem, type Filter, postUrl, type Verdict } from "@/shared/feed";
import { PostFallback } from "./PostFallback";
import { XEmbed } from "./XEmbed";

export interface CardActions {
  open(item: FeedItem): void;
  mark(item: FeedItem, verdict: Verdict, note: string | null): void;
  undo(item: FeedItem): void;
}

function scoreTone(score: number, threshold: number): string {
  if (score >= threshold + 20) return "bg-accent text-accent-foreground";
  if (score >= threshold) return "bg-accent-soft text-foreground";
  return "bg-muted text-muted-foreground";
}

export const PostCard = forwardRef<
  HTMLLIElement,
  {
    item: FeedItem;
    filter: Filter;
    threshold: number;
    selected: boolean;
    noting: Verdict | null;
    onNoting: (verdict: Verdict | null) => void;
    actions: CardActions;
    dark: boolean;
    now: number;
  }
>(function PostCard({ item, filter, threshold, selected, noting, onNoting, actions, dark, now }, ref) {
  const judgment = item.judgment;
  const verdictForFilter: Verdict = filter === "filtered" ? "relevant" : "not_relevant";
  return (
    <li
      ref={ref}
      data-slot="post-card"
      data-selected={selected || undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-background p-4 md:p-5",
        selected && "border-ring ring-1 ring-ring/40",
      )}
    >
      {judgment ? (
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-8 min-w-10 shrink-0 items-center justify-center rounded-md px-2 font-mono text-sm font-semibold tabular-nums",
              scoreTone(judgment.score, threshold),
            )}
            title="How worth answering, 0 to 100"
          >
            {judgment.score}
          </span>
          <p className="min-w-0 flex-1 pt-1 text-sm">
            {judgment.reason}
            {judgment.kind === "rescore" ? (
              <Badge variant="outline" className="ml-2 align-middle font-normal text-muted-foreground">
                re-scored
              </Badge>
            ) : null}
          </p>
        </div>
      ) : null}

      <XEmbed postId={item.id} dark={dark} fallback={<PostFallback item={item} now={now} />} />

      {filter === "handled" ? (
        <Handled item={item} onUndo={() => actions.undo(item)} />
      ) : noting ? (
        <NoteInput
          verdict={noting}
          onDone={(note) => {
            onNoting(null);
            actions.mark(item, noting, note);
          }}
          onCancel={() => onNoting(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href={postUrl(item)} target="_blank" rel="noopener noreferrer" onClick={() => actions.open(item)}>
              <ExternalLink aria-hidden="true" />
              Open on X{selected ? <Kbd className="ml-1">o</Kbd> : null}
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onNoting(verdictForFilter)}>
            {verdictForFilter === "not_relevant" ? <ThumbsDown aria-hidden="true" /> : <ThumbsUp aria-hidden="true" />}
            {verdictForFilter === "not_relevant" ? "Not relevant" : "Relevant"}
            {selected ? <Kbd className="ml-1">{verdictForFilter === "not_relevant" ? "x" : "r"}</Kbd> : null}
          </Button>
        </div>
      )}
    </li>
  );
});

function Handled({ item, onUndo }: { item: FeedItem; onUndo: () => void }) {
  const feedback = item.feedback;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {feedback ? (
        <Badge
          variant="outline"
          className={cn(
            "font-normal",
            feedback.verdict === "relevant" ? "text-status-ready-for-review" : "text-status-failed",
          )}
        >
          {feedback.verdict === "relevant" ? "Relevant" : "Not relevant"}
        </Badge>
      ) : null}
      {item.openedAt ? (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          Opened on X
        </Badge>
      ) : null}
      {feedback?.note ? <span className="min-w-0 text-muted-foreground">“{feedback.note}”</span> : null}
      <span className="ml-auto flex items-center gap-2">
        {feedback && !feedback.consolidated ? (
          <Button variant="ghost" size="sm" onClick={onUndo}>
            <RotateCcw aria-hidden="true" />
            Undo
          </Button>
        ) : feedback ? (
          <span className="text-xs text-muted-foreground">In the brief</span>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <a href={postUrl(item)} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Open on X
          </a>
        </Button>
      </span>
    </div>
  );
}

function NoteInput({
  verdict,
  onDone,
  onCancel,
}: {
  verdict: Verdict;
  onDone: (note: string | null) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => input.current?.focus(), []);
  const label = verdict === "relevant" ? "Why is it relevant?" : "Why is it not relevant?";
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(note.trim() || null);
      }}
    >
      <input
        ref={input}
        aria-label={label}
        placeholder={`${label} Optional`}
        maxLength={280}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDone(null);
          }
        }}
        className="h-8 min-w-0 flex-1 basis-full rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground sm:basis-auto"
      />
      <Button type="submit" size="sm">
        Save <Kbd className="ml-1">Enter</Kbd>
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => onDone(null)}>
        Without note <Kbd className="ml-1">Esc</Kbd>
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
