// run_search: one due search, end to end, without the model touching the
// query, the cursor or the posts. Claim it from the app (which refuses at the
// budget cap or when it is not due), query X for posts after the cursor,
// follow at most one further page, and hand everything to the app, which
// stores new posts, advances the cursor and counts the spend. The model gets
// counts back; posts reach it later, in leased batches (next_posts).
import { defineTool } from "@opencomputer/agent";
import { appFailure, callApp } from "../connections/app";
import { xApi } from "../connections/x";
import { RUN_SEARCH_INPUT } from "../contract";
import { type ParsedPage, parseSearchPage, SEARCH_PATH, searchParams } from "./x-search";

const MAX_PAGES = 2;

type XFailure = { readonly error: "x_unavailable" | "x_rejected"; readonly status: number; readonly detail: string };

async function fetchPage(query: string, sinceId: string | null, nextToken?: string): Promise<ParsedPage | XFailure> {
  const response = await xApi.fetch(`${SEARCH_PATH}?${searchParams(query, sinceId, nextToken).toString()}`);
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { detail?: string; title?: string; errors?: { message?: string }[] };
      detail = (body.errors?.[0]?.message ?? body.detail ?? body.title ?? detail).slice(0, 300);
    } catch {}
    const unavailable = response.status === 429 || response.status >= 500;
    return { error: unavailable ? "x_unavailable" : "x_rejected", status: response.status, detail };
  }
  return parseSearchPage(JSON.parse(text));
}

export const runSearch = defineTool({
  name: "run_search",
  description:
    "Fetch new posts for one due search (an id from get_work) and store them in the app's judging queue. Returns counts only; read the posts with next_posts.",
  input: RUN_SEARCH_INPUT,
  async run({ input, sessionId }) {
    const searchId = String(input.searchId);
    const claim = await callApp<{ query: string; sinceId: string | null }>(
      "POST",
      `/api/agent/searches/${encodeURIComponent(searchId)}/claim`,
      { sessionId },
    );
    if (!claim.ok) return { searchId, ...appFailure(claim) };

    const pages: ParsedPage[] = [];
    let failure: XFailure | undefined;
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await fetchPage(claim.data.query, claim.data.sinceId, nextToken);
      if ("error" in result) {
        failure = result;
        break;
      }
      pages.push(result);
      if (!result.nextToken) break;
      nextToken = result.nextToken;
    }
    // Nothing fetched: the claim stands (the search ran), the cursor stays.
    if (pages.length === 0 && failure) return { searchId, ...failure };

    // The cursor moves to the first page's newest id. When more than two
    // pages were new, the tail is skipped; the next run starts after it.
    const stored = await callApp<{ fetched: number; stored: number; alreadyKnown: number }>(
      "POST",
      "/api/agent/candidates",
      {
        sessionId,
        searchId,
        newestId: pages[0]?.newestId ?? null,
        posts: pages.flatMap((p) => p.posts),
        postReads: pages.reduce((sum, p) => sum + p.postReads, 0),
        userReads: pages.reduce((sum, p) => sum + p.userReads, 0),
      },
    );
    if (!stored.ok) return { searchId, ...appFailure(stored) };
    return { searchId, ...stored.data, ...(failure ? { partial: failure.error } : {}) };
  },
});
