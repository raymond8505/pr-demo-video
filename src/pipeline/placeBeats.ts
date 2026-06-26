import { beatAudioRel } from "../paths.js";
import type { Beat } from "../manifest.js";
import type { VoBeat } from "../../remotion/types.js";

/** Gap inserted after a beat when placing the next one sequentially (no marker). */
export const SEQUENTIAL_GAP_SEC = 0.4;

/**
 * Place a highlight's voiced beats on the scene timeline. Each beat starts at
 * its captured marker (when its action happened on screen) plus any render-gate
 * nudge; beats without a marker fall back to playing after the previous one.
 * Unvoiced beats are skipped. Pure — unit-tested in placeBeats.test.ts.
 */
export function placeBeats(highlightId: string, beats: Beat[]): VoBeat[] {
  const out: VoBeat[] = [];
  let cursor = 0;
  for (const beat of beats) {
    if (beat.voDurationSec == null) continue;
    const base = beat.markerSec ?? cursor;
    out.push({
      src: beatAudioRel(highlightId, beat.key),
      startSec: Math.max(0, base + (beat.voOffsetSec ?? 0)),
      durationSec: beat.voDurationSec,
    });
    cursor = base + beat.voDurationSec + SEQUENTIAL_GAP_SEC;
  }
  return out;
}
