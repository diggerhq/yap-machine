// Every screen and card state over the seed, at 390 and 1440, light and dark.
// The seed's post ids are far in the future, so X's embed never finds them
// and each card shows its stored fallback, which is what these capture.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const OUT = join(import.meta.dirname, "..", "design", "screens");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [390, 1440] as const;
const THEMES = ["light", "dark"] as const;

async function capture(page: Page, name: string): Promise<void> {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(OUT, `${name}-${String(width)}-${theme}.png`), fullPage: true });
    }
  }
}

test("feed: Open, ranked, with a re-scored card and a reply's context", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-slot=post-card]").first()).toContainText("Coding agents unattended");
  await expect(page.getByText("re-scored")).toBeVisible();
  await expect(page.getByText("Replying to @infra_cy")).toBeVisible();
  await capture(page, "feed-open");
});

test("feed: marking Not relevant asks for an optional note", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-slot=post-card]").first().waitFor();
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByRole("textbox", { name: "Why is it not relevant?" })).toBeFocused();
  await capture(page, "feed-note");
});

test("feed: Filtered and Handled", async ({ page }) => {
  await page.goto("/?filter=filtered");
  await expect(page.getByRole("button", { name: /Relevant/ }).first()).toBeVisible();
  await capture(page, "feed-filtered");
  await page.goto("/?filter=handled");
  await expect(page.getByText("In the brief")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByText("The stored text is cleared")).toBeVisible();
  await capture(page, "feed-handled");
});

test("searches: list and the add form", async ({ page }) => {
  await page.goto("/searches");
  await expect(page.getByText("Mentions (sample)")).toBeVisible();
  await capture(page, "searches");
  await page.getByRole("button", { name: "Add search" }).click();
  await capture(page, "searches-add");
});

test("brief: sections, learned rules, the queue and a version diff", async ({ page }) => {
  await page.goto("/brief");
  await expect(page.getByText("Coding agents run in CI or overnight")).toBeVisible();
  await page.getByRole("button", { name: "Diff" }).first().click();
  await expect(page.locator("pre")).toContainText("## Learned");
  await capture(page, "brief");
});
