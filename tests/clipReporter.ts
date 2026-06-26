import type {
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";

/**
 * Maps each test's recorded video to a deterministic clip file named after its
 * spec: runs/<id>/specs/<highlightId>.spec.ts -> runs/<id>/clips/<highlightId>.webm.
 *
 * Why a reporter (not a fixture or afterEach):
 *  - By the time onTestEnd fires, Playwright has already finalized and flushed
 *    the video, exposing it as a `video` attachment with a real path — so we
 *    copy an existing file rather than racing `video.saveAs()` (which blocks
 *    until the page closes and is awkward to await in afterEach).
 *  - Generated specs stay vanilla `@playwright/test` files with no import of
 *    ours — exactly what we want since the AI authors them.
 *
 * Convention: one test per spec file. If a spec holds multiple tests, later
 * passing tests overwrite the clip; the author stage enforces one-test-per-spec.
 */
export default class ClipReporter implements Reporter {
  private readonly clipsDir: string;

  constructor() {
    const runDir = process.env.PRVIDEO_RUN_DIR;
    if (!runDir) {
      throw new Error("ClipReporter requires PRVIDEO_RUN_DIR in the environment");
    }
    this.clipsDir = path.join(runDir, "clips");
    fs.mkdirSync(this.clipsDir, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed") return; // only demo flows that actually worked
    const video = result.attachments.find(
      (a) => a.name === "video" && a.path,
    );
    if (!video?.path) return;

    const highlightId = path
      .basename(test.location.file)
      .replace(/\.spec\.[tj]s$/, "");
    const dest = path.join(this.clipsDir, `${highlightId}.webm`);
    fs.copyFileSync(video.path, dest);
    // eslint-disable-next-line no-console
    console.error(`  clip: ${highlightId}.webm (from ${test.location.file})`);
  }
}
