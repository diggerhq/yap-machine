// Reading a seed brief: the text below the first `---` line is the brief. Its
// owner sections become the first version; its `## Searches` table becomes
// the searches, and never reaches the model.
export const OWNER_SECTIONS = ["Owner", "OpenComputer", "Topics", "Neighbours", "Find", "Skip", "Examples"] as const;

export interface SeedSearch {
  readonly id: string;
  readonly label: string;
  readonly everyMinutes: number;
  readonly query: string;
}

export interface ParsedBrief {
  readonly ownerBody: string;
  readonly searches: SeedSearch[];
}

export class BriefError extends Error {}

function sections(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    found.set(title, newline === -1 ? "" : part.slice(newline + 1).trim());
  }
  return found;
}

const cell = (value: string) => value.trim().replace(/^`(.*)`$/s, "$1");

export function parseSearchesTable(body: string): SeedSearch[] {
  const rows = body.split("\n").filter((line) => line.trim().startsWith("|"));
  const out: SeedSearch[] = [];
  for (const row of rows.slice(2)) {
    const cells = row.trim().replace(/^\|/, "").replace(/\|$/, "").split(" | ");
    if (cells.length !== 4) throw new BriefError(`A searches row must have 4 cells: ${row.slice(0, 80)}`);
    const [id, label, every, query] = cells.map(cell) as [string, string, string, string];
    if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new BriefError(`Bad search id: ${id}`);
    const everyMinutes = Number(every);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 5 || everyMinutes % 5 !== 0) {
      throw new BriefError(`Bad interval for ${id}: ${every}`);
    }
    if (query.length < 1 || query.length > 512)
      throw new BriefError(`Query for ${id} is ${String(query.length)} characters`);
    out.push({ id, label, everyMinutes, query });
  }
  return out;
}

export function parseBrief(file: string): ParsedBrief {
  const at = file.search(/^---\s*$/m);
  if (at === -1) throw new BriefError("The brief must follow a --- line");
  const text = file.slice(file.indexOf("\n", at) + 1).trim();
  const found = sections(text);
  for (const name of OWNER_SECTIONS) {
    const body = found.get(name);
    if (body === undefined) throw new BriefError(`Missing section: ## ${name}`);
    if (!body || /\bFilled\b/.test(body)) throw new BriefError(`Section ## ${name} is empty or still a placeholder`);
  }
  const searchesBody = found.get("Searches");
  if (!searchesBody) throw new BriefError("Missing section: ## Searches");
  const ownerBody = text.replace(/^## Searches\n[\s\S]*?(?=^## |(?![\s\S]))/m, "").trim();
  return { ownerBody, searches: parseSearchesTable(searchesBody) };
}
