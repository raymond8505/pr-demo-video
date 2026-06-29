import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrRef } from "../paths.js";
import { runDirFor, ensureRunDirs, beatMarkersFile, PROJECT_ROOT } from "../paths.js";
import {
  readManifest,
  updateHighlight,
  type Beat,
  type ManifestHighlight,
} from "../manifest.js";
import { run } from "../proc.js";

/** A captured beat marker as written to clips/<id>.beats.json. */
interface CapturedMarker {
  key: string;
  tSec: number;
}

/**
 * Fold captured marker timings into a highlight's beats by ORDER. Markers and
 * beats must be 1:1 (one marker per beat, emitted in order); if the counts
 * disagree we return the beats untouched so render falls back to sequential
 * placement rather than mis-syncing.
 */
export function mergeBeatMarkers(
  beats: Beat[],
  markers: CapturedMarker[],
): { beats: Beat[]; matched: boolean } {
  if (markers.length !== beats.length) return { beats, matched: false };
  return {
    beats: beats.map((b, i) => ({ ...b, markerSec: markers[i]?.tSec })),
    matched: true,
  };
}

/**
 * Run the authored spec suite against the preview URL, recording one clip per
 * spec. The clip-mapping is done by tests/clipReporter.ts (keyed on spec
 * filename); here we just drive Playwright and then reconcile the manifest with
 * the clips that actually landed on disk.
 */
export async function run_(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  // ensureRunDirs (not just runPaths) so the cursor/glide fixture is copied in
  // fresh as specs/_demo.ts before we record — specs import it, and record is
  // when it actually matters (it's baked into the recorded clip).
  const p = await ensureRunDirs(runDir);
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

  // Reconcile: a highlight is "recorded" iff its clip exists. While here, fold
  // the captured beat markers into the manifest so render can sync each line.
  let recorded = 0;
  for (const h of manifest.highlights) {
    const clip = path.join(p.clips, `${h.id}.webm`);
    if (!(await fileExists(clip))) continue;

    const patch: Partial<ManifestHighlight> = {
      status: "recorded",
      clipWebmPath: clip,
      specPath: path.join(p.specs, `${h.id}.spec.ts`),
    };

    const markers = await readBeatMarkers(beatMarkersFile(runDir, h.id));
    if (!markers) {
      console.error(`  (warning: ${h.id} — no beat markers captured; beats will play sequentially)`);
    } else {
      const { beats, matched } = mergeBeatMarkers(h.beats, markers);
      if (matched) {
        patch.beats = beats;
      } else {
        console.error(
          `  (warning: ${h.id} — ${markers.length} marker(s) for ${h.beats.length} beat(s); beats will play sequentially)`,
        );
      }
    }

    await updateHighlight(runDir, h.id, patch);
    recorded++;
  }
  console.error(`Recorded ${recorded}/${manifest.highlights.length} clip(s) into ${p.clips}`);
}

async function fileExists(f: string): Promise<boolean> {
  return fs.access(f).then(() => true).catch(() => false);
}

/** Read clips/<id>.beats.json; null if missing or malformed (→ sequential). */
async function readBeatMarkers(file: string): Promise<CapturedMarker[] | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (m) => m && typeof m.key === "string" && typeof m.tSec === "number",
      )
    ) {
      return parsed as CapturedMarker[];
    }
  } catch {
    // missing or unparseable — fall back to sequential placement
  }
  return null;
}

export { run_ as run };
