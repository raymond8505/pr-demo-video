import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Driven by the `record` stage via env vars so a single static config serves
 * every run:
 *   PRVIDEO_RUN_DIR     - the run directory; specs live in <run>/specs, clips in <run>/clips
 *   PRVIDEO_PREVIEW_URL - the deployed app URL to demo against (becomes baseURL)
 *
 * Fixed 1280x720 everywhere so clips match the Remotion composition with no
 * letterboxing, and slowMo + workers:1 so the recordings are watchable and
 * record sequentially (parallel recording can corrupt clips).
 */
const runDir = process.env.PRVIDEO_RUN_DIR ?? process.cwd();
const previewUrl = process.env.PRVIDEO_PREVIEW_URL;
const VIEWPORT = { width: 1280, height: 720 };
// The author loop overrides these for fast iteration (no slow-mo, no recording);
// the record stage uses the watchable defaults.
const slowMo = Number(process.env.PRVIDEO_SLOWMO ?? 300);
const videoOff = process.env.PRVIDEO_VIDEO === "off";

export default defineConfig({
  testDir: path.join(runDir, "specs"),
  outputDir: path.join(runDir, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], [path.resolve(import.meta.dirname, "tests/clipReporter.ts")]],
  timeout: 90_000,
  use: {
    baseURL: previewUrl,
    viewport: VIEWPORT,
    video: videoOff ? "off" : { mode: "on", size: VIEWPORT },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      // Slow every action so a viewer can follow the demo (0 during authoring).
      slowMo,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
  ],
});
