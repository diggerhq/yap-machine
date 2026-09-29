// A line diff for the brief's version history: the longest common
// subsequence of lines, then each line kept, added or removed.
export type DiffLine = { readonly kind: "same" | "added" | "removed"; readonly text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[];
      row[j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] as string });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "removed", text: a[i] as string });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j] as string });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] as string });
  while (j < b.length) out.push({ kind: "added", text: b[j++] as string });
  return out;
}

/** A version as one text, rules included, for diffing. */
export function versionText(ownerBody: string, learned: readonly { text: string }[]): string {
  return learned.length
    ? `${ownerBody.trim()}\n\n## Learned\n\n${learned.map((r) => `- ${r.text}`).join("\n")}`
    : ownerBody.trim();
}
