import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths, ensureRunDirs, PROJECT_ROOT } from "../paths.js";
import {
  readManifest,
  updateHighlight,
  highlightNarration,
  type ManifestHighlight,
} from "../manifest.js";
import { ariaSnapshotOf, capSnapshot } from "../browser.js";
import { capture } from "../proc.js";
import { getProvider, type LlmProvider, type LlmMessage } from "../llm/provider.js";

const MAX_ATTEMPTS = 5;

/** What the model must return each iteration. */
const SpecSchema = z.object({
  specCode: z.string(),
  selectorsUsed: z.array(z.string()),
  expectedDurationSec: z.number(),
  notes: z.string().optional(),
});
type Spec = z.infer<typeof SpecSchema>;

/**
 * Agent-driven authoring: for each highlight, iterate generate -> run -> feed the
 * failure (error + a fresh ARIA snapshot) back -> regenerate, until the spec
 * passes or we exhaust the attempt budget. A highlight that never goes green is
 * marked `unresolved` and dropped from the video — a smaller video beats a
 * crashed pipeline.
 */
export async function run(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  await ensureRunDirs(runDir);
  const p = runPaths(runDir);
  const manifest = await readManifest(runDir);
  if (!manifest.previewUrl) {
    throw new Error("manifest has no previewUrl — run `pr-video init` first.");
  }

  const todo = manifest.highlights.filter(
    (h) => h.status === "pending" || h.status === "unresolved",
  );
  if (todo.length === 0) {
    throw new Error("No pending highlights to author. Run `pr-video script` first.");
  }

  const provider = await getProvider();
  console.error(`Using LLM provider: ${provider.name}`);
  for (const h of todo) {
    console.error(`\n=== authoring "${h.title}" (${h.id}) ===`);
    const ok = await authorOne(provider, runDir, manifest.previewUrl, h, p.specs);
    if (!ok) {
      await updateHighlight(runDir, h.id, {
        status: "unresolved",
        unresolvedReason: `No passing spec after ${MAX_ATTEMPTS} attempts.`,
      });
      console.error(`  ✗ ${h.id}: unresolved — dropping from the video.`);
    }
  }

  const final = await readManifest(runDir);
  const authored = final.highlights.filter((x) => x.status === "authored").length;
  console.error(
    `\nAuthored ${authored}/${todo.length} highlight(s). ` +
      `GATE: review specs in ${p.specs} (and watch a headed run) before \`pr-video record\`.`,
  );
}

async function authorOne(
  provider: LlmProvider,
  runDir: string,
  previewUrl: string,
  h: ManifestHighlight,
  specsDir: string,
): Promise<boolean> {
  const specPath = path.join(specsDir, `${h.id}.spec.ts`);
  const snapshot = capSnapshot(await ariaSnapshotOf(previewUrl));

  const messages: LlmMessage[] = [
    { role: "user", content: firstPrompt(h, snapshot) },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let spec: Spec;
    try {
      spec = await provider.complete({
        system: SYSTEM,
        messages,
        schema: SpecSchema,
        schemaName: "spec",
      });
    } catch (err) {
      console.error(`  attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }

    await fs.writeFile(specPath, spec.specCode, "utf8");
    console.error(`  attempt ${attempt}: running spec (${spec.selectorsUsed.length} selectors)...`);

    const { code, stdout, stderr } = await capture(
      "npx",
      ["playwright", "test", specPath, "--config", path.join(PROJECT_ROOT, "playwright.config.ts")],
      {
        cwd: PROJECT_ROOT,
        env: {
          PRVIDEO_RUN_DIR: runDir,
          PRVIDEO_PREVIEW_URL: previewUrl,
          PRVIDEO_VIDEO: "off", // fast iteration; the record stage does the real recording
          PRVIDEO_SLOWMO: "0",
        },
      },
    );

    if (code === 0) {
      await updateHighlight(runDir, h.id, {
        status: "authored",
        specPath,
        unresolvedReason: undefined,
      });
      console.error(`  ✓ ${h.id}: spec passes (expected ~${spec.expectedDurationSec}s)`);
      return true;
    }

    // Feed the failure back. Prefer Playwright's error-context (an ARIA snapshot
    // at the POINT OF FAILURE — deep in the app where the spec actually got stuck)
    // over a fresh landing-page snapshot, which is useless for multi-page flows.
    const errorTail = (stdout + "\n" + stderr).slice(-3_000);
    const failureSnapshot =
      (await latestErrorContext(runDir)) ??
      capSnapshot(await ariaSnapshotOf(previewUrl));
    messages.push({ role: "assistant", content: JSON.stringify(spec) });
    messages.push({ role: "user", content: retryPrompt(errorTail, failureSnapshot) });
  }
  return false;
}

const SYSTEM = `You author a single Playwright test that visually demonstrates one product change on a live web app, for a screen-recorded demo video.

The demo is broken into ordered BEATS — each beat is one on-screen action with its own spoken line that plays the moment that action happens. Your spec performs the beats in order and emits a marker at the start of each so the voiceover can be synced to it.

Hard requirements for the spec you emit (in \`specCode\`):
- Import the demo helpers, NOT @playwright/test directly: \`import { test, expect, glide } from "./_demo";\`. Exactly ONE \`test(...)\` per file.
- Make the cursor visible by acting through \`glide\` instead of raw locator methods, so the pointer animates to each target and a click ripple shows on screen:
  - Click: \`await glide.click(page, page.getByRole("button", { name: "Save" }));\`
  - Type: \`await glide.fill(page, page.getByPlaceholder("Search"), "soup");\`
  - Hover: \`await glide.hover(page, page.getByText("Menu"));\`
  Use \`page.goto\`, \`expect\`, \`waitForTimeout\` etc. as normal. Only the interactions (click/fill/hover) go through \`glide\`, and always pass \`page\` as the first argument.
- Navigate with the configured baseURL: \`await page.goto("/")\` (and relative paths). Never hardcode a host.
- The app has NO data-testids. Use accessible selectors only: getByRole, getByText, getByPlaceholder, getByLabel — chosen from the ARIA snapshot you are given.
- Perform the beats IN ORDER. Immediately BEFORE the visible action of each beat, emit its marker on its own line: \`console.log("@@PRVIDEO_BEAT <key>");\` using the beat's key. Emit exactly one marker per beat, in order — these are the ONLY console.log calls allowed.
- After each beat's action, assert visibility with \`await expect(locator).toBeVisible()\` AND add \`await page.waitForTimeout(800)\` so the camera lingers and the recording reads well.
- The test must actually perform the demoIntent flow on screen — open the right page, interact, and show the result.
- Aim for a runtime close to expectedDurationSec so the clip roughly matches the voiceover length.
- Prefer .first() when a role/text query could match multiple elements, to avoid strict-mode violations.

Return specCode (the full file), selectorsUsed (the locators you chose), expectedDurationSec, and optional notes.`;

function firstPrompt(h: ManifestHighlight, snapshot: string): string {
  const beatList = h.beats
    .map(
      (b, i) =>
        `  ${i + 1}. key="${b.key}" — action: ${b.action}\n     spoken line (plays as this action happens): "${b.narration}"`,
    )
    .join("\n");
  return `Highlight to demonstrate:
- type: ${h.type}
- title: ${h.title}
- demoIntent (the overall flow to perform): ${h.demoIntent}

Beats — perform these in order, emitting \`console.log("@@PRVIDEO_BEAT <key>")\` just before each beat's visible action:
${beatList}

The full voiceover is roughly ${estimateNarrationSec(highlightNarration(h))}s, so target that runtime across all beats.

ARIA snapshot of the app's landing page (your selector source of truth):
\`\`\`yaml
${snapshot}
\`\`\`

Write the Playwright spec that demonstrates this highlight.`;
}

function retryPrompt(errorTail: string, snapshot: string): string {
  return `That spec failed. Playwright output (tail):
\`\`\`
${errorTail}
\`\`\`

ARIA snapshot of the page AT THE POINT OF FAILURE (use this to fix your selectors —
it shows the actual DOM where the test got stuck, which may be deep in the app):
\`\`\`
${snapshot}
\`\`\`

Fix the selectors/flow and return a corrected spec.`;
}

/**
 * Playwright writes an `error-context.md` (an ARIA snapshot at the point of
 * failure) into each failed test's output dir. Return the most recent one so the
 * agent can see where the spec actually got stuck — essential for deep flows
 * (e.g. cooking mode) the landing-page snapshot never reveals.
 */
async function latestErrorContext(runDir: string): Promise<string | null> {
  const testResults = path.join(runDir, "test-results");
  let best: { mtime: number; content: string } | null = null;
  let subdirs: string[];
  try {
    subdirs = await fs.readdir(testResults);
  } catch {
    return null;
  }
  for (const sub of subdirs) {
    const file = path.join(testResults, sub, "error-context.md");
    try {
      const stat = await fs.stat(file);
      if (!best || stat.mtimeMs > best.mtime) {
        best = { mtime: stat.mtimeMs, content: await fs.readFile(file, "utf8") };
      }
    } catch {
      // no error-context in this subdir
    }
  }
  return best ? capSnapshot(best.content, 7_000) : null;
}

/** ~150 wpm speaking rate -> seconds, with a small floor. */
function estimateNarrationSec(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(4, Math.round((words / 150) * 60));
}
