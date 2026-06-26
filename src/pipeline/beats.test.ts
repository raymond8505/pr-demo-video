import { describe, it, expect } from "vitest";
import { parseBeatMarkers } from "../../tests/clipReporter.js";
import { mergeBeatMarkers } from "./record.js";
import { placeBeats, SEQUENTIAL_GAP_SEC } from "./placeBeats.js";
import type { Beat } from "../manifest.js";

function beat(over: Partial<Beat> = {}): Beat {
  return { key: "b1", action: "do a thing", narration: "Watch this.", ...over };
}

describe("parseBeatMarkers", () => {
  it("extracts marker keys in order from mixed stdout", () => {
    const out = parseBeatMarkers(
      [
        "Running 1 test using 1 worker",
        '@@PRVIDEO_BEAT b1',
        "some app log line",
        "@@PRVIDEO_BEAT b2",
        "@@PRVIDEO_BEAT b3-extra",
      ].join("\n"),
    );
    expect(out.map((m) => m.key)).toEqual(["b1", "b2", "b3-extra"]);
  });

  it("returns nothing when there are no markers", () => {
    expect(parseBeatMarkers("just normal output\nno markers here")).toEqual([]);
  });
});

describe("mergeBeatMarkers", () => {
  it("zips marker times onto beats by order when counts match", () => {
    const beats = [beat({ key: "b1" }), beat({ key: "b2" })];
    const { beats: merged, matched } = mergeBeatMarkers(beats, [
      { key: "b1", tSec: 1.5 },
      { key: "b2", tSec: 6.2 },
    ]);
    expect(matched).toBe(true);
    expect(merged[0]!.markerSec).toBe(1.5);
    expect(merged[1]!.markerSec).toBe(6.2);
  });

  it("leaves beats untouched on a count mismatch (→ sequential fallback)", () => {
    const beats = [beat({ key: "b1" }), beat({ key: "b2" })];
    const { beats: merged, matched } = mergeBeatMarkers(beats, [{ key: "b1", tSec: 1.5 }]);
    expect(matched).toBe(false);
    expect(merged[0]!.markerSec).toBeUndefined();
  });
});

describe("placeBeats", () => {
  it("places each beat at its marker, applying the nudge", () => {
    const vo = placeBeats("hl", [
      beat({ key: "b1", voDurationSec: 3, markerSec: 0 }),
      beat({ key: "b2", voDurationSec: 4, markerSec: 8, voOffsetSec: -0.5 }),
    ]);
    expect(vo).toEqual([
      { src: "audio/hl/b1.mp3", startSec: 0, durationSec: 3 },
      { src: "audio/hl/b2.mp3", startSec: 7.5, durationSec: 4 },
    ]);
  });

  it("falls back to sequential placement when markers are missing", () => {
    const vo = placeBeats("hl", [
      beat({ key: "b1", voDurationSec: 3 }),
      beat({ key: "b2", voDurationSec: 4 }),
    ]);
    expect(vo[0]!.startSec).toBe(0);
    expect(vo[1]!.startSec).toBeCloseTo(3 + SEQUENTIAL_GAP_SEC);
  });

  it("clamps a negative nudge to a non-negative start", () => {
    const vo = placeBeats("hl", [beat({ key: "b1", voDurationSec: 3, markerSec: 0.1, voOffsetSec: -1 })]);
    expect(vo[0]!.startSec).toBe(0);
  });

  it("skips beats that were never voiced", () => {
    const vo = placeBeats("hl", [
      beat({ key: "b1", voDurationSec: 3, markerSec: 0 }),
      beat({ key: "b2" }), // no voDurationSec
    ]);
    expect(vo.map((b) => b.src)).toEqual(["audio/hl/b1.mp3"]);
  });
});
