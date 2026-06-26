import type {
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";

/** A beat marker captured from a clip, timed relative to the clip's start. */
export interface BeatMarker {
  key: string;
  tSec: number;
}

/**
 * Pull beat-marker keys (in order) out of a chunk of spec stdout. The spec emits
 * `console.log("@@PRVIDEO_BEAT <key>")` immediately before each beat's action.
 * Exported (and pure) so the parsing is unit-testable without a live run.
 */
export function parseBeatMarkers(text: string): { key: string }[] {
  const out: { key: string }[] = [];
  const re = /@@PRVIDEO_BEAT\s+([a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ key: m[1] as string });
  return out;
}

/** Small lead-in (sec) subtracted from each marker for context warm-up before
 * the first recorded frame. Tune via PRVIDEO_BEAT_LEAD if beats land late. */
const BEAT_LEAD_SEC = Number(process.env.PRVIDEO_BEAT_LEAD ?? 0);

/**
 * Maps each test's recorded video to a deterministic clip file named after its
 * spec: runs/<id>/specs/<highlightId>.spec.ts -> runs/<id>/clips/<highlightId>.webm.
 * Also captures the beat markers the spec prints to stdout and writes their
 * timings to runs/<id>/clips/<highlightId>.beats.json so render can drop each
 * spoken line where its action actually happened.
 *
 * Why a reporter (not a fixture or afterEach):
 *  - By the time onTestEnd fires, Playwright has already finalized and flushed
 *    the video, exposing it as a `video` attachment with a real path — so we
 *    copy an existing file rather than racing `video.saveAs()` (which blocks
 *    until the page closes and is awkward to await in afterEach).
 *  - Generated specs stay vanilla `@playwright/test` files with no import of
 *    ours (markers are plain console.log) — exactly what we want since the AI
 *    authors them.
 *
 * Timing reference: marker tSec = now - result.startTime, which is the moment
 * Playwright began the test (≈ when the recording started). The spec blocks in
 * realtime (slow-mo included), so elapsed wall-clock tracks video time.
 *
 * Convention: one test per spec file. If a spec holds multiple tests, later
 * passing tests overwrite the clip; the author stage enforces one-test-per-spec.
 */
export default class ClipReporter implements Reporter {
  private readonly clipsDir: string;
  /** Accumulated markers per highlight id while a test runs. */
  private readonly markers = new Map<string, BeatMarker[]>();

  constructor() {
    const runDir = process.env.PRVIDEO_RUN_DIR;
    if (!runDir) {
      throw new Error("ClipReporter requires PRVIDEO_RUN_DIR in the environment");
    }
    this.clipsDir = path.join(runDir, "clips");
    fs.mkdirSync(this.clipsDir, { recursive: true });
  }

  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult): void {
    if (!test || !result) return;
    const found = parseBeatMarkers(chunk.toString());
    if (found.length === 0) return;
    const tSec = Math.max(0, (Date.now() - result.startTime.getTime()) / 1000 - BEAT_LEAD_SEC);
    const id = highlightIdOf(test);
    const list = this.markers.get(id) ?? [];
    for (const { key } of found) list.push({ key, tSec });
    this.markers.set(id, list);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed") return; // only demo flows that actually worked
    const video = result.attachments.find(
      (a) => a.name === "video" && a.path,
    );
    if (!video?.path) return;

    const highlightId = highlightIdOf(test);
    const dest = path.join(this.clipsDir, `${highlightId}.webm`);
    fs.copyFileSync(video.path, dest);

    const beats = this.markers.get(highlightId) ?? [];
    fs.writeFileSync(
      path.join(this.clipsDir, `${highlightId}.beats.json`),
      JSON.stringify(beats, null, 2) + "\n",
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.error(
      `  clip: ${highlightId}.webm (${beats.length} beat marker(s)) (from ${test.location.file})`,
    );
  }
}

function highlightIdOf(test: TestCase): string {
  return path.basename(test.location.file).replace(/\.spec\.[tj]s$/, "");
}
