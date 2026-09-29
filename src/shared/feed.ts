// What the owner's screens read: the view types the server routes return.
export type Filter = "open" | "filtered" | "handled";
export const FILTERS: readonly Filter[] = ["open", "filtered", "handled"];

export type Verdict = "not_relevant" | "relevant";

export interface FeedItem {
  readonly id: string;
  readonly authorHandle: string;
  readonly authorName: string;
  readonly authorFollowers: number;
  /** Cleared 48 hours after the post was created; the embed still shows it. */
  readonly text: string | null;
  readonly createdAt: string;
  readonly context: { kind: string; id: string; authorHandle: string; text?: string } | null;
  readonly metrics: { like: number; reply: number; repost: number; quote: number; impression: number };
  readonly openedAt: string | null;
  readonly searchId: string;
  readonly judgment: {
    readonly score: number;
    readonly reason: string;
    readonly kind: "scout" | "rescore";
    readonly judgedAt: string;
    readonly briefVersionId: number;
  } | null;
  readonly rank: number | null;
  readonly feedback: {
    readonly id: number;
    readonly verdict: Verdict;
    readonly note: string | null;
    readonly createdAt: string;
    readonly consolidated: boolean;
  } | null;
}

export interface FeedPage {
  readonly items: FeedItem[];
  readonly nextCursor: string | null;
  /** The server's clock for this page; the "N new" count runs from it. */
  readonly at: string;
}

export interface Search {
  readonly id: string;
  readonly label: string;
  readonly query: string;
  readonly everyMinutes: number;
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly fetchedToday: number;
  readonly openToday: number;
  readonly notRelevant7d: number;
}

export interface RuleFeedback {
  readonly id: number;
  readonly verdict: Verdict;
  readonly note: string | null;
  readonly postId: string;
  readonly authorHandle: string;
  readonly text: string | null;
}

export interface BriefVersion {
  readonly versionId: number;
  readonly ownerBody: string;
  readonly learned: { id: string; text: string; feedbackIds: number[]; feedback?: RuleFeedback[] }[];
  readonly createdBy: "owner" | "learning";
  readonly createdAt: string;
  readonly basedOn: number | null;
  readonly status?: "active" | "superseded";
}

export interface BriefState {
  readonly active: BriefVersion | null;
  readonly queue: (RuleFeedback & { createdAt: string })[];
  readonly versions: {
    id: number;
    status: "active" | "superseded";
    createdBy: "owner" | "learning";
    createdAt: string;
    basedOn: number | null;
    rules: number;
  }[];
}

export interface Status {
  readonly spend: { todayUsd: number; capUsd: number; postReads: number; userReads: number };
  readonly learning: { id: number; startedAt: string } | null;
  readonly lastLearning: { id: number; finishedAt: string } | null;
  readonly brief: { versionId: number; createdAt: string; createdBy: string; rules: number } | null;
  readonly unconsolidated: number;
  readonly threshold: number;
}

/** Where a post lives on X; the owner reads the thread and replies there. */
export function postUrl(item: Pick<FeedItem, "id" | "authorHandle">): string {
  return `https://x.com/${encodeURIComponent(item.authorHandle)}/status/${encodeURIComponent(item.id)}`;
}
