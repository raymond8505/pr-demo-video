import { chromium } from "@playwright/test";

const VIEWPORT = { width: 1280, height: 720 };

/**
 * Load a URL once and return its accessibility (ARIA) snapshot — the YAML role
 * tree Playwright exposes, the same representation the spec author reasons over
 * to pick role/text/placeholder selectors. Used by `probe` and the author loop.
 */
export async function ariaSnapshotOf(
  url: string,
  opts: { timeoutMs?: number; settleMs?: number } = {},
): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 30_000,
    });
    await page.waitForTimeout(opts.settleMs ?? 1_000);
    return await page.locator("body").ariaSnapshot();
  } finally {
    await browser.close();
  }
}

/** Cap a snapshot so it stays a reasonable size in an LLM prompt. */
export function capSnapshot(snapshot: string, maxChars = 6_000): string {
  return snapshot.length > maxChars
    ? snapshot.slice(0, maxChars) + "\n# [snapshot truncated]"
    : snapshot;
}
