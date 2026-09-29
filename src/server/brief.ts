// The brief as the model reads it: the owner's sections, then the Learned
// rules the app maintains. The searches table never reaches the model.
export interface LearnedRule {
  readonly id: string;
  readonly text: string;
  readonly feedbackIds: readonly number[];
}

export function renderBrief(ownerBody: string, learned: readonly LearnedRule[]): string {
  const body = ownerBody.trim();
  if (learned.length === 0) return body;
  return `${body}\n\n## Learned\n\nRules learned from the owner's feedback. They refine the sections above.\n\n${learned
    .map((rule) => `- ${rule.text}`)
    .join("\n")}`;
}
