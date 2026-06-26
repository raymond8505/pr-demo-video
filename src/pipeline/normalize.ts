import path from "node:path";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths } from "../paths.js";
import { readManifest, updateHighlight } from "../manifest.js";
import { normalizeToMp4, mediaDurationSec } from "../media.js";

/**
 * Convert each recorded .webm clip to a CFR .mp4 and record its true duration
 * in the manifest. Remotion's scene timing is built on these durations, so a
 * clip that yields a non-positive duration is a hard error, not a warning.
 */
export async function run(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  const p = runPaths(runDir);
  const manifest = await readManifest(runDir);

  const todo = manifest.highlights.filter(
    (h) => h.status === "recorded" && h.clipWebmPath,
  );
  if (todo.length === 0) {
    throw new Error("No recorded clips to normalize. Run `pr-video record` first.");
  }

  for (const h of todo) {
    const mp4 = path.join(p.clips, `${h.id}.mp4`);
    console.error(`normalize ${h.id}: webm -> mp4`);
    await normalizeToMp4(h.clipWebmPath as string, mp4);
    const durationSec = await mediaDurationSec(mp4);
    await updateHighlight(runDir, h.id, {
      status: "normalized",
      clipMp4Path: mp4,
      clipDurationSec: durationSec,
    });
    console.error(`  ${h.id}: ${durationSec.toFixed(2)}s`);
  }
  console.error(`Normalized ${todo.length} clip(s).`);
}
