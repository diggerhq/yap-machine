// X API v2 recent search: the request the tool makes and the parser that
// turns a response into candidate posts. Pure, so it is tested against
// authored fixtures (dev/fixtures/x). The API currently uses two spellings
// for included posts (`includes.tweets` / `includes.posts`) and for the full
// text of long posts (`note_tweet` / `note_post`); both are accepted.
import type { CandidatePost } from "../contract";

export const SEARCH_PATH = "/2/tweets/search/recent";

export function searchParams(query: string, sinceId: string | null, nextToken?: string): URLSearchParams {
  const params = new URLSearchParams({
    query,
    max_results: "100",
    sort_order: "recency",
    "tweet.fields": "created_at,public_metrics,conversation_id,referenced_tweets,lang,author_id,note_tweet",
    expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
    "user.fields": "username,name,public_metrics",
  });
  if (sinceId) params.set("since_id", sinceId);
  if (nextToken) params.set("next_token", nextToken);
  return params;
}

interface XUser {
  id?: string;
  username?: string;
  name?: string;
  public_metrics?: { followers_count?: number };
}

interface XPost {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    repost_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
  referenced_tweets?: { type?: string; id?: string }[];
  referenced_posts?: { type?: string; id?: string }[];
  note_tweet?: { text?: string };
  note_post?: { text?: string };
}

interface XPage {
  data?: XPost[];
  includes?: { users?: XUser[]; tweets?: XPost[]; posts?: XPost[] };
  meta?: { newest_id?: string; next_token?: string; result_count?: number };
}

export interface ParsedPage {
  readonly posts: CandidatePost[];
  /** Every post object the response returned (data and includes): what X bills. */
  readonly postReads: number;
  /** Every user object the response returned. */
  readonly userReads: number;
  readonly newestId: string | null;
  readonly nextToken: string | null;
}

const count = (value: number | undefined) => (typeof value === "number" && value >= 0 ? Math.floor(value) : 0);
const fullText = (post: XPost) => post.note_tweet?.text ?? post.note_post?.text ?? post.text ?? "";

export function parseSearchPage(body: unknown): ParsedPage {
  const page = (body ?? {}) as XPage;
  const data = Array.isArray(page.data) ? page.data : [];
  const included = [...(page.includes?.tweets ?? []), ...(page.includes?.posts ?? [])];
  const users = page.includes?.users ?? [];
  const userById = new Map(users.filter((u) => u.id).map((u) => [u.id as string, u]));
  const postById = new Map(included.filter((p) => p.id).map((p) => [p.id as string, p]));

  const posts: CandidatePost[] = [];
  for (const post of data) {
    const author = post.author_id ? userById.get(post.author_id) : undefined;
    if (!post.id || !post.created_at || !author?.username || !post.author_id) continue;
    const refs = post.referenced_tweets ?? post.referenced_posts ?? [];
    const ref = refs.find((r) => r.type === "replied_to") ?? refs.find((r) => r.type === "quoted");
    const parent = ref?.id ? postById.get(ref.id) : undefined;
    const parentAuthor = parent?.author_id ? userById.get(parent.author_id) : undefined;
    const metrics = post.public_metrics ?? {};
    posts.push({
      id: post.id,
      authorId: post.author_id,
      authorHandle: author.username,
      authorName: author.name ?? author.username,
      authorFollowers: count(author.public_metrics?.followers_count),
      text: fullText(post),
      createdAt: new Date(post.created_at).toISOString(),
      conversationId: post.conversation_id ?? null,
      context:
        ref?.id && parent && (ref.type === "replied_to" || ref.type === "quoted")
          ? {
              kind: ref.type,
              id: ref.id,
              authorHandle: parentAuthor?.username ?? "",
              text: fullText(parent),
            }
          : null,
      metrics: {
        like: count(metrics.like_count),
        reply: count(metrics.reply_count),
        repost: count(metrics.retweet_count ?? metrics.repost_count),
        quote: count(metrics.quote_count),
        impression: count(metrics.impression_count),
      },
    });
  }
  return {
    posts,
    postReads: data.length + included.length,
    userReads: users.length,
    newestId: page.meta?.newest_id ?? null,
    nextToken: page.meta?.next_token ?? null,
  };
}
