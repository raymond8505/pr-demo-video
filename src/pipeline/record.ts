import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths, PROJECT_ROOT } from "../paths.js";
import { readManifest, updateHighlight } from "../manifest.js";
import { run } from "../proc.js";

/**
 * Run the authored spec suite against the preview URL, recording one clip per
 * spec. The clip-mapping is done by tests/clipReporter.ts (keyed on spec
 * filename); here we just drive Playwright and then reconcile the manifest with
 * the clips that actually landed on disk.
 */
export async function run_(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  const p = runPaths(runDir);
  const manifest = await readManifest(runDir);

  if (!manifest.previewUrl) {
    throw new Error("manifest has no previewUrl — run `pr-video init` first.");
  }

  const specFiles = (await fs.readdir(p.specs).catch(() => []))
    .filter((f) => /\.spec\.[tj]s$/.test(f));
  if (specFiles.length === 0) {
    throw new Error(`No specs in ${p.specs}. Run \`pr-video author\` first.`);
  }

  console.error(`Recording ${specFiles.length} spec(s) against ${manifest.previewUrl}`);
  const code = await run(
    "npx",
    ["playwright", "test", "--config", path.join(PROJECT_ROOT, "playwright.config.ts")],
    {
      cwd: PROJECT_ROOT,
      env: {
        PRVIDEO_RUN_DIR: runDir,
        PRVIDEO_PREVIEW_URL: manifest.previewUrl,
      },
    },
  );
  if (code !== 0) {
    console.error(`  (playwright exited ${code} — some specs may have failed; recording what passed)`);
  }

  // Reconcile: a highlight is "recorded" iff its clip exists.
  let recorded = 0;
  for (const h of manifest.highlights) {
    const clip = path.join(p.clips, `${h.id}.webm`);
    if (await fileExists(clip)) {
      await updateHighlight(runDir, h.id, {
        status: "recorded",
        clipWebmPath: clip,
        specPath: path.join(p.specs, `${h.id}.spec.ts`),
      });
      recorded++;
    }
  }
  console.error(`Recorded ${recorded}/${manifest.highlights.length} clip(s) into ${p.clips}`);
}

async function fileExists(f: string): Promise<boolean> {
  return fs.access(f).then(() => true).catch(() => false);
}

export { run_ as run };
