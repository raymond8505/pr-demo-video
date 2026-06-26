import { describe, it, expect } from "vitest";
import {
  FPS,
  SCENE_PAD_SEC,
  TRANSITION_FRAMES,
  sceneFrames,
  voBeatStartFrames,
  voEndSec,
  totalFrames,
  type SceneInput,
  type VoBeat,
} from "./types.js";

/** A spoken beat with sensible defaults. */
function beat(over: Partial<VoBeat> = {}): VoBeat {
  return { src: "audio/h1/b1.mp3", startSec: 0, durationSec: 3, ...over };
}

/** A scene with sensible defaults; override per case. */
function scene(over: Partial<SceneInput> = {}): SceneInput {
  return {
    id: "h1",
    type: "change",
    title: "T",
    narration: "n",
    clipSrc: "clips/h1.mp4",
    clipDurationSec: 10,
    vo: [],
    ...over,
  };
}

const frames = (sec: number) => Math.ceil((sec + SCENE_PAD_SEC) * FPS);

describe("voBeatStartFrames", () => {
  it("is 0 when the beat starts at the scene start", () => {
    expect(voBeatStartFrames(beat({ startSec: 0 }))).toBe(0);
  });

  it("converts seconds to whole frames", () => {
    expect(voBeatStartFrames(beat({ startSec: 3.1 }))).toBe(Math.round(3.1 * FPS));
  });

  it("never returns a negative frame count", () => {
    expect(voBeatStartFrames(beat({ startSec: -5 }))).toBe(0);
  });
});

describe("voEndSec", () => {
  it("is 0 for a scene with no voiceover", () => {
    expect(voEndSec(scene({ vo: [] }))).toBe(0);
  });

  it("is the latest start+duration across beats", () => {
    const s = scene({
      vo: [beat({ startSec: 0, durationSec: 3 }), beat({ startSec: 8, durationSec: 4 })],
    });
    expect(voEndSec(s)).toBeCloseTo(12);
  });

  it("does not let a negative start pull the end before its duration", () => {
    expect(voEndSec(scene({ vo: [beat({ startSec: -2, durationSec: 3 })] }))).toBeCloseTo(3);
  });
});

describe("sceneFrames", () => {
  it("uses the clip length when there is no voiceover", () => {
    expect(sceneFrames(scene({ clipDurationSec: 12, vo: [] }))).toBe(frames(12));
  });

  it("does NOT truncate a clip that ends after every spoken line", () => {
    // 14.3s clip; last line ends at 3.1 + 8 = 11.1 < clip → clip wins.
    const s = scene({
      clipDurationSec: 14.33,
      vo: [beat({ startSec: 3.1, durationSec: 8 })],
    });
    expect(sceneFrames(s)).toBe(frames(14.33));
  });

  it("extends to fit a line that runs past the clip", () => {
    // line ends at 4 + 11.23 = 15.23 > clip 12 → vo end wins.
    const s = scene({
      clipDurationSec: 12,
      vo: [beat({ startSec: 4, durationSec: 11.23 })],
    });
    expect(sceneFrames(s)).toBe(frames(15.23));
  });

  it("returns at least one frame", () => {
    expect(sceneFrames(scene({ clipDurationSec: 0.0001, vo: [] }))).toBeGreaterThanOrEqual(1);
  });
});

describe("totalFrames", () => {
  it("sums scene lengths for a single scene", () => {
    const s = scene({ clipDurationSec: 14.33, vo: [beat({ startSec: 3.1, durationSec: 8 })] });
    expect(totalFrames([s])).toBe(sceneFrames(s));
  });

  it("subtracts the overlapping transition between scenes", () => {
    const a = scene({ id: "a", clipDurationSec: 10, vo: [] });
    const b = scene({ id: "b", clipDurationSec: 10, vo: [] });
    expect(totalFrames([a, b])).toBe(sceneFrames(a) + sceneFrames(b) - TRANSITION_FRAMES);
  });
});
