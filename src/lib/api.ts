// The browser's view of the app's routes. Everything goes through here, to
// the app's own origin; the browser never talks to Supabase or OpenComputer.
import type { BriefState, BriefVersion, FeedPage, Filter, Search, Status, Verdict } from "@/shared/feed";
import type { Problem } from "@/shared/problem";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...init,
  });
  const data = (await response.json().catch(() => ({}))) as T & Partial<Problem>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? "error",
      data.error?.message ?? `Request failed (${String(response.status)})`,
    );
  }
  return data;
}

export const fetchFeed = (filter: Filter, cursor?: string | null) =>
  call<FeedPage>("GET", `/api/feed?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);

export const fetchNewCount = (since: string) =>
  call<{ count: number }>("GET", `/api/feed/new-count?since=${encodeURIComponent(since)}`);

/** Recorded as the tab opens; keepalive lets it outlive a navigation. */
export function markOpened(postId: string): void {
  void fetch(`/api/posts/${encodeURIComponent(postId)}/open`, { method: "POST", keepalive: true }).catch(() => {});
}

export const dismiss = (postId: string) =>
  call<{ dismissed: string }>("POST", `/api/posts/${encodeURIComponent(postId)}/dismiss`);

export const undoDismiss = (postId: string) =>
  call<{ restored: string }>("DELETE", `/api/posts/${encodeURIComponent(postId)}/dismiss`);

export const putFeedback = (postId: string, verdict: Verdict, note: string | null) =>
  call<{ id: number }>("PUT", `/api/posts/${encodeURIComponent(postId)}/feedback`, { verdict, note });

export const withdrawFeedback = (postId: string) =>
  call<{ withdrawn: number }>("DELETE", `/api/posts/${encodeURIComponent(postId)}/feedback`);

export const fetchSearches = () => call<{ searches: Search[] }>("GET", "/api/searches");

export const createSearch = (search: Pick<Search, "id" | "label" | "query" | "everyMinutes" | "enabled">) =>
  call<{ id: string }>("POST", "/api/searches", search);

export const patchSearch = (id: string, patch: Partial<Pick<Search, "label" | "query" | "everyMinutes" | "enabled">>) =>
  call<{ id: string }>("PATCH", `/api/searches/${encodeURIComponent(id)}`, patch);

export const fetchBrief = () => call<BriefState>("GET", "/api/brief");

export const fetchBriefVersion = (id: number) => call<BriefVersion>("GET", `/api/brief/versions/${String(id)}`);

export const saveOwnerSections = (ownerBody: string) =>
  call<{ versionId: number }>("PUT", "/api/brief/owner", { ownerBody });

export const deleteRule = (ruleId: string) =>
  call<{ versionId: number }>("DELETE", `/api/brief/rules/${encodeURIComponent(ruleId)}`);

export const restoreVersion = (id: number) =>
  call<{ versionId: number }>("POST", `/api/brief/versions/${String(id)}/restore`);

export const fetchStatus = () => call<Status>("GET", "/api/status");
