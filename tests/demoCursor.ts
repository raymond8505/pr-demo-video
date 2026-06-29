import { test as base, expect, type Page, type Locator } from "@playwright/test";

/**
 * Makes the mouse VISIBLE in recorded demos.
 *
 * Playwright's recorded video captures only the page — there is no OS cursor in
 * the frame, and `click()` teleports with no visible pointer. So we inject a fake
 * cursor + click ripple into the page (CURSOR_INIT_SCRIPT, applied on every
 * document via addInitScript) and animate the pointer to each target on the Node
 * side (`glide`, via `page.mouse.move(..., { steps })`) so motion reads naturally.
 *
 * This file is copied verbatim into each run's specs dir as `_demo.ts`
 * (see ensureRunDirs in src/paths.ts); authored specs import { test, expect,
 * glide } from "./_demo". Keep it dependency-free apart from @playwright/test so
 * it resolves from the project node_modules wherever it is copied.
 */

/**
 * Injected into every page before its own scripts run. Draws a cursor element
 * that follows real mouse events (the ones Playwright dispatches) and paints an
 * expanding ripple on mousedown. Both overlays are `pointer-events: none` so they
 * never intercept the hit-test at the click point and break actionability.
 */
export const CURSOR_INIT_SCRIPT = String.raw`
(() => {
  if (window.__prvideoCursor) return;
  window.__prvideoCursor = true;
  const NS = "prvideo-cursor";

  function install() {
    if (document.getElementById(NS)) return;
    const root = document.body || document.documentElement;

    const style = document.createElement("style");
    style.textContent =
      "#" + NS + "{position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;" +
      "margin:-2px 0 0 -2px;opacity:0;transition:transform .05s linear,opacity .15s;will-change:transform;}" +
      "#" + NS + " svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}" +
      "." + NS + "-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;" +
      "border-radius:50%;border:3px solid rgba(56,189,248,.95);background:rgba(56,189,248,.25);" +
      "transform:translate(-50%,-50%) scale(0);animation:" + NS + "-pulse .5s ease-out forwards;}" +
      "@keyframes " + NS + "-pulse{0%{opacity:.95;transform:translate(-50%,-50%) scale(0);}" +
      "100%{opacity:0;transform:translate(-50%,-50%) scale(1);}}";

    const cursor = document.createElement("div");
    cursor.id = NS;
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M3 1 L3 17 L7.5 13 L10 19 L13 17.7 L10.5 11.8 L17 11.5 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>';

    root.appendChild(style);
    root.appendChild(cursor);

    document.addEventListener(
      "mousemove",
      (e) => {
        cursor.style.opacity = "1";
        cursor.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
      },
      true,
    );
    document.addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div");
        r.className = NS + "-ripple";
        r.style.left = e.clientX + "px";
        r.style.top = e.clientY + "px";
        (document.body || document.documentElement).appendChild(r);
        setTimeout(() => r.remove(), 550);
      },
      true,
    );
  }

  if (document.body) install();
  else document.addEventListener("DOMContentLoaded", install);
})();
`;

/** A Playwright bounding box (x/y are viewport-relative). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure midpoint of a bounding box — extracted so it is unit-testable. */
export function centerOf(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Number of intermediate mouse-move events per glide — enough to read as motion. */
const GLIDE_STEPS = 24;

/** Animate the cursor to the locator's center before acting on it. */
async function glideTo(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return; // not visible/measurable — let the action itself surface the error
  const c = centerOf(box);
  await page.mouse.move(c.x, c.y, { steps: GLIDE_STEPS });
}

/**
 * Cursor-visible replacements for raw locator actions. Each glides the pointer to
 * the target (so the viewer sees where the action lands) and then performs it; the
 * injected mousedown ripple fires automatically on click/focus.
 */
export const glide = {
  async click(
    page: Page,
    locator: Locator,
    opts?: Parameters<Locator["click"]>[0],
  ): Promise<void> {
    await glideTo(page, locator);
    await locator.click(opts);
  },

  async fill(page: Page, locator: Locator, text: string): Promise<void> {
    await glideTo(page, locator);
    await locator.click();
    await locator.fill(text);
  },

  async hover(page: Page, locator: Locator): Promise<void> {
    await glideTo(page, locator);
    await locator.hover();
  },
};

/**
 * Drop-in replacement for `@playwright/test`'s `test`: every page gets the cursor
 * overlay injected before the test body runs (and re-injected on each navigation,
 * since addInitScript runs per document).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(CURSOR_INIT_SCRIPT);
    await use(page);
  },
});

export { expect };
