// One post in the feed, laid out for reading: the author (avatar, name,
// handle, age) and then the text, large, with nothing competing for the eye.
// Replies and quotes carry the post they answer, muted above the text. The
// actions are icons (Open on X, Not relevant or Relevant, Done) with their
// names and keys in tooltips. Why the agent surfaced the post stays folded
// behind a small toggle. A Not relevant or Relevant mark takes an optional
// one-line note: Enter saves it, Esc saves without it. Done sets a post aside
// with no verdict, so nothing is learned from it. A handled card shows its
// verdict and note, or Done, with Undo until a learning run has folded it in.
import { ArrowUpRight, Check, Info, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { forwardRef, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ago, compact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type FeedItem, type Filter, postUrl, type Verdict } from "@/shared/feed";

export interface CardActions {
  open(item: FeedItem): void;
  mark(item: FeedItem, verdict: Verdict, note: string | null): void;
  /** Done: set aside without a verdict; nothing is learned from it. */
  dismiss(item: FeedItem): void;
  undo(item: FeedItem): void;
}

export const PostCard = forwardRef<
  HTMLLIElement,
  {
    item: FeedItem;
    filter: Filter;
    selected: boolean;
    noting: Verdict | null;
    onNoting: (verdict: Verdict | null) => void;
    actions: CardActions;
    now: number;
  }
>(function PostCard({ item, filter, selected, noting, onNoting, actions, now }, ref) {
  const [why, setWhy] = useState(false);
  const verdict: Verdict = filter === "filtered" ? "relevant" : "not_relevant";
  return (
    <li
      ref={ref}
      data-slot="post-card"
      data-selected={selected || undefined}
      className={cn(
        "relative flex gap-3 border-l-2 border-transparent px-4 py-4 md:px-5",
        selected && "border-l-accent bg-hover",
      )}
    >
      <Avatar item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="truncate font-semibold">{item.authorName}</span>
          <span className="truncate text-muted-foreground">@{item.authorHandle}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <time
            className="shrink-0 text-muted-foreground"
            dateTime={item.createdAt}
            title={new Date(item.createdAt).toLocaleString()}
          >
            {ago(item.createdAt, now)}
          </time>
        </div>

        {item.context ? (
          <p className="text-sm text-muted-foreground">
            {item.context.kind === "quoted" ? "Quoting" : "Replying to"} @{item.context.authorHandle || "unknown"}
            {item.context.text ? <span className="mt-0.5 line-clamp-2 block">{item.context.text}</span> : null}
          </p>
        ) : null}

        {item.text ? (
          <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{item.text}</p>
        ) : (
          <p className="text-[15px] text-muted-foreground italic">
            The text is cleared 48 hours after a post; open it on X.
          </p>
        )}

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
          <div className="-ml-2 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="flex gap-3 pl-2">
              <span>{compact(item.metrics.reply)} replies</span>
              <span className="hidden sm:inline">{compact(item.metrics.like)} likes</span>
              <span className="hidden sm:inline">{compact(item.authorFollowers)} followers</span>
            </span>
            <span className="ml-auto flex items-center">
              {item.judgment ? (
                <Action label="Why it's here" onClick={() => setWhy((open) => !open)} pressed={why} subtle>
                  <Info />
                </Action>
              ) : null}
              <Action
                label={verdict === "not_relevant" ? "Not relevant" : "Relevant"}
                hotkey={verdict === "not_relevant" ? "x" : "r"}
                onClick={() => onNoting(verdict)}
              >
                {verdict === "not_relevant" ? <ThumbsDown /> : <ThumbsUp />}
              </Action>
              <Action label="Done: set aside, nothing learned" hotkey="d" onClick={() => actions.dismiss(item)}>
                <Check />
              </Action>
              <Action label="Open on X" hotkey="o" href={postUrl(item)} onClick={() => actions.open(item)}>
                <ArrowUpRight />
              </Action>
            </span>
          </div>
        )}

        {why && item.judgment ? (
          <p className="text-xs text-muted-foreground">
            {item.judgment.reason}
            {item.judgment.kind === "rescore" ? " (re-scored after the brief changed)" : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
});

function Avatar({ item }: { item: FeedItem }) {
  const [broken, setBroken] = useState(false);
  const letter = (item.authorName || item.authorHandle).slice(0, 1).toUpperCase();
  return item.authorAvatar && !broken ? (
    <img
      src={item.authorAvatar}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="size-10 shrink-0 rounded-full bg-muted object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
    >
      {letter}
    </span>
  );
}

function Action({
  label,
  hotkey,
  onClick,
  href,
  pressed,
  subtle = false,
  children,
}: {
  label: string;
  hotkey?: string;
  onClick?: () => void;
  href?: string;
  pressed?: boolean;
  subtle?: boolean;
  children: ReactNode;
}) {
  const className = cn("text-muted-foreground hover:text-foreground", subtle && "opacity-60 hover:opacity-100");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant="ghost" size="icon-sm" className={className}>
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} onClick={onClick}>
              {children}
            </a>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className={className}
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          >
            {children}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hotkey ? <Kbd className="ml-2">{hotkey}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function Handled({ item, onUndo }: { item: FeedItem; onUndo: () => void }) {
  const feedback = item.feedback;
  const undoable = (feedback && !feedback.consolidated) || (!feedback && item.dismissedAt);
  const state = feedback
    ? feedback.verdict === "relevant"
      ? "Relevant"
      : "Not relevant"
    : item.dismissedAt
      ? "Done"
      : "Opened on X";
  return (
    <div className="-ml-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "shrink-0 pl-2 whitespace-nowrap",
          feedback?.verdict === "relevant" && "text-status-ready-for-review",
          feedback?.verdict === "not_relevant" && "text-status-failed",
        )}
      >
        {state}
      </span>
      {feedback?.note ? <span className="min-w-0 truncate">“{feedback.note}”</span> : null}
      {feedback?.consolidated ? <span className="shrink-0 whitespace-nowrap">· in the brief</span> : null}
      <span className="ml-auto flex items-center">
        {undoable ? (
          <Action label="Undo" onClick={onUndo}>
            <RotateCcw />
          </Action>
        ) : null}
        <Action label="Open on X" href={postUrl(item)}>
          <ArrowUpRight />
        </Action>
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
      className="flex flex-wrap items-center gap-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(note.trim() || null);
      }}
    >
      <input
        ref={input}
        aria-label={label}
        placeholder={`${label} Optional. Enter saves, Esc skips`}
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
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
