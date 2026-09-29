// The one error shape every route returns: { error: { code, message } }.
// Database functions refuse with a code; `refused` turns it into a status.
import type { Problem } from "../shared/problem";
import { isRefusal, type Refusal } from "./db";

export function problem(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message, ...extra } } satisfies Problem, { status });
}

const REFUSALS: Record<string, [number, string]> = {
  no_brief: [409, "There is no active brief. Load one with npm run seed:brief."],
  not_due: [409, "This search is not due."],
  unknown_search: [404, "No such search."],
  unknown_post: [404, "No such post."],
  unknown_version: [404, "No such brief version."],
  not_found: [404, "Not found."],
  consolidated: [409, "This feedback is already folded into the brief."],
  stale_learned: [409, "The learned rules changed since that version; read the feedback again."],
  uncovered_feedback: [400, "Every offered feedback id must be cited by a rule or listed as considered."],
  invalid_feedback_ids: [400, "A rule cites feedback that was not offered, or considered lists an id that was not."],
  not_learning_session: [403, "This session is not running the open learning run."],
  search_exists: [409, "A search with this id exists."],
  invalid_search: [
    400,
    "The search is invalid: id is lowercase letters, digits and hyphens; every is 5 to 1440 in steps of 5; the query is at most 512 characters.",
  ],
  invalid_filter: [400, "The filter is open, filtered or handled."],
  invalid_verdict: [400, "The verdict is not_relevant or relevant."],
  invalid_note: [400, "The note is at most 280 characters."],
  invalid_brief: [400, "The brief is empty."],
  invalid_rules: [400, "The rules are invalid."],
  invalid_report: [400, "The report's role is scout or learning."],
};

/** The response for a refusal a database function returned. */
export function refused(refusal: Refusal): Response {
  const [status, message] = REFUSALS[refusal.error] ?? [409, "Refused."];
  const { error, ...extra } = refusal;
  return problem(status, error, message, extra);
}

/** The result as JSON, or the refusal as a problem. */
export function answer(result: unknown, status = 200): Response {
  return isRefusal(result) ? refused(result) : Response.json(result, { status });
}

/** Wraps a handler: whatever it throws leaves as a 500 problem, logged. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (cause) {
      console.error(cause);
      return problem(500, "internal_error", "Something went wrong.");
    }
  };
}
