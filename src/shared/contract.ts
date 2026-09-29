// The app's validators for the agent's requests, built from the schemas the
// agent declares (opencomputer/agents/yap/contract.ts), so a body the app
// accepts is exactly what the tools promise to send.
import { z } from "zod";
import {
  CANDIDATES_BODY,
  type CandidatesBody,
  JUDGMENTS_BODY,
  type JudgmentsBody,
  LEARNED_BODY,
  LEASE_BODY,
  type LearnedBody,
  type LeaseBody,
  REPORT_BODY,
  REPORT_OUTPUT,
  type Report,
  type ReportBody,
} from "../../opencomputer/agents/yap/contract";

export type { CandidatesBody, JudgmentsBody, LearnedBody, LeaseBody, Report, ReportBody };

type JsonSchema = Parameters<typeof z.fromJSONSchema>[0];
const from = <T>(schema: unknown) => z.fromJSONSchema(schema as JsonSchema) as z.ZodType<T>;

export const candidatesBody = from<CandidatesBody>(CANDIDATES_BODY);
export const leaseBody = from<LeaseBody>(LEASE_BODY);
export const judgmentsBody = from<JudgmentsBody>(JUDGMENTS_BODY);
export const reportBody = from<ReportBody>(REPORT_BODY);
export const report = from<Report>(REPORT_OUTPUT);
export const learnedBody = from<LearnedBody>(LEARNED_BODY);

/** The first problem with a value, as one line naming its path. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
