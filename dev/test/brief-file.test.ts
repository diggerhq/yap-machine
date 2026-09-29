import { describe, expect, it } from "vitest";
import { BriefError, parseBrief } from "../../scripts/brief-file";

const SECTIONS = ["Owner", "Product", "Topics", "Neighbours", "Find", "Skip", "Examples"];
const body = (fill: (name: string) => string) => SECTIONS.map((name) => `## ${name}\n\n${fill(name)}`).join("\n\n");
const TABLE = `## Searches

Notes about the table.

| id | label | every | query |
|---|---|---|---|
| \`mentions\` | Mentions | 5 | \`(acme OR "acme dev") -is:retweet\` |
| \`topics\` | Topics | 15 | \`("agent sandbox" OR microvm) lang:en\` |`;

describe("parseBrief", () => {
  it("splits the owner sections from the searches table", () => {
    const file = `# Seed\n\nPreamble the loader ignores.\n\n---\n\n${body((n) => `About ${n}.`)}\n\n${TABLE}\n`;
    const parsed = parseBrief(file);
    expect(parsed.ownerBody.startsWith("## Owner")).toBe(true);
    expect(parsed.ownerBody).not.toContain("Searches");
    expect(parsed.ownerBody).toContain("## Examples\n\nAbout Examples.");
    expect(parsed.searches).toEqual([
      { id: "mentions", label: "Mentions", everyMinutes: 5, query: '(acme OR "acme dev") -is:retweet' },
      { id: "topics", label: "Topics", everyMinutes: 15, query: '("agent sandbox" OR microvm) lang:en' },
    ]);
  });

  it("refuses empty or placeholder sections and bad rows", () => {
    expect(() => parseBrief(`---\n${body((n) => (n === "Skip" ? "" : "x"))}\n${TABLE}`)).toThrow(BriefError);
    expect(() => parseBrief(`---\n${body((n) => (n === "Find" ? "Filled in later." : "x"))}\n${TABLE}`)).toThrow(
      /placeholder/,
    );
    expect(() => parseBrief(`---\n${body(() => "x")}\n${TABLE.replace("| 5 |", "| 7 |")}`)).toThrow(/interval/);
    expect(() => parseBrief(body(() => "x"))).toThrow(/---/);
  });
});
