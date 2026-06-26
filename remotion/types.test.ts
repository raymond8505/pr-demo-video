import { describe, it, expect } from "vitest";
import {
  FPS,
  SCENE_PAD_SEC,
  TRANSITION_FRAMES,
  sceneFrames,
  voOffsetFrames,
  totalFrames,
  type SceneInput,
} from "./types.js";

/** A scene with sensible defaults; override per case. */
function scene(over: Partial<SceneInput> = {}): SceneInput {
  return {
    id: "h1",
    type: "change",
    title: "T",
    narration: "n",
    clipSrc: "clips/h1.mp4",
    clipDurationSec: 10,
    ...over,
  };
}

const frames = (sec: number) => Math.ceil((sec + SCENE_PAD_SEC) * FPS);

describe("voOffsetFrames", () => {
  it("defaults to 0 when no offset is set", () => {
    expect(voOffsetFrames(scene())).toBe(0);
  });

  it("converts seconds to whole frames", () => {
    expect(voOffsetFrames(scene({ voOffsetSec: 3.1 }))).toBe(Math.round(3.1 * FPS));
  });

  it("never returns a negative frame count", () => {
    expect(voOffsetFrames(scene({ voOffsetSec: -5 }))).toBe(0);
  });
});

describe("sceneFrames", () => {
  it("uses the clip length when there is no voiceover", () => {
    expect(sceneFrames(scene({ clipDurationSec: 12, voDurationSec: undefined }))).toBe(
      frames(12),
    );
  });

  it("does NOT truncate a clip that is longer than the voiceover", () => {
    // Regression: a 14.3s clip with an 11.2s VO must span the full clip.
    const s = scene({ clipDurationSec: 14.33, voDurationSec: 11.23 });
    expect(sceneFrames(s)).toBe(frames(14.33));
  });

  it("uses the voiceover length when it is longer than the clip", () => {
    const s = scene({ clipDurationSec: 8, voDurationSec: 11.23 });
    expect(sceneFrames(s)).toBe(frames(11.23));
  });

  it("extends to fit a delayed voiceover that runs past the clip", () => {
    const s = scene({ clipDurationSec: 12, voDurationSec: 11.23, voOffsetSec: 4 });
    // offset + vo = 15.23 > clip 12 → base 15.23
    expect(sceneFrames(s)).toBe(frames(15.23));
  });

  it("keeps the full clip when the delayed voiceover still ends within it", () => {
    // Right-aligned: offset == clip - vo, so VO ends exactly with the clip.
    const s = scene({ clipDurationSec: 14.33, voDurationSec: 11.23, voOffsetSec: 3.1 });
    expect(sceneFrames(s)).toBe(frames(14.33));
  });

  it("returns at least one frame", () => {
    expect(sceneFrames(scene({ clipDurationSec: 0.0001, voDurationSec: undefined }))).toBeGreaterThanOrEqual(1);
  });
});

describe("totalFrames", () => {
  it("sums scene lengths for a single scene", () => {
    const s = scene({ clipDurationSec: 14.33, voDurationSec: 11.23, voOffsetSec: 3.1 });
    expect(totalFrames([s])).toBe(sceneFrames(s));
  });

  it("subtracts the overlapping transition between scenes", () => {
    const a = scene({ id: "a", clipDurationSec: 10, voDurationSec: undefined });
    const b = scene({ id: "b", clipDurationSec: 10, voDurationSec: undefined });
    expect(totalFrames([a, b])).toBe(sceneFrames(a) + sceneFrames(b) - TRANSITION_FRAMES);
  });
});
