// A post as the app stored it, for when X's embed is not shown: author,
// handle, reach, age, the text (cleared 48 hours after posting) and what it
// replies to or quotes.

import { ago, compact } from "@/lib/format";
import type { FeedItem } from "@/shared/feed";

export function PostFallback({ item, now }: { item: FeedItem; now: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-card px-4 py-3 text-sm">
      <div className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
        <span className="truncate font-medium text-foreground">{item.authorName}</span>
        <span className="truncate">@{item.authorHandle}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0" title={new Date(item.createdAt).toLocaleString()}>
          {ago(item.createdAt, now)}
        </span>
        <span className="ml-auto shrink-0 text-xs">{compact(item.authorFollowers)} followers</span>
      </div>
      {item.context ? (
        <p className="border-l-2 pl-3 text-xs text-muted-foreground">
          {item.context.kind === "quoted" ? "Quoting" : "Replying to"} @{item.context.authorHandle || "unknown"}
          {item.context.text ? <span className="mt-1 line-clamp-2 block">{item.context.text}</span> : null}
        </p>
      ) : null}
      {item.text ? (
        <p className="whitespace-pre-wrap break-words">{item.text}</p>
      ) : (
        <p className="text-muted-foreground italic">The stored text is cleared 48 hours after a post; open it on X.</p>
      )}
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span>{compact(item.metrics.reply)} replies</span>
        <span>{compact(item.metrics.like)} likes</span>
        <span>{compact(item.metrics.impression)} views</span>
      </p>
    </div>
  );
}
