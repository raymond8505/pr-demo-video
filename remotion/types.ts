/**
 * Props shape shared between the Node render stage (which reads the manifest and
 * builds the scene plan) and the Remotion bundle (which renders it). Timing is a
 * pure function of these props — the bundle never touches the filesystem for
 * metadata, so calculateMetadata works identically in the Studio and at render.
 *
 * Media paths are RELATIVE to the run dir, which the render stage passes as
 * Remotion's publicDir; the components resolve them with staticFile().
 */
export type SceneInput = {
  id: string;
  type: "feature" | "change" | "fix";
  title: string;
  narration: string;
  /** relative path under the run dir, e.g. "clips/<id>.mp4" */
  clipSrc: string;
  clipDurationSec: number;
  /** relative path under the run dir, e.g. "audio/<id>.mp3" (optional pre-VO) */
  voSrc?: string;
  voDurationSec?: number;
  /**
   * Seconds to delay the voiceover after the scene starts, so narration lands on
   * the on-screen payoff instead of the navigation preamble. Defaults to 0 (VO
   * starts with the clip). Set per-highlight at the render gate. */
  voOffsetSec?: number;
};

export type DemoVideoProps = {
  scenes: SceneInput[];
};

export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;
/** Crossfade length between scenes (frames). Transitions overlap, so the total
 * timeline is sum(sceneFrames) - (sceneCount - 1) * TRANSITION_FRAMES. */
export const TRANSITION_FRAMES = 15;
/** Breathing room added to each scene beyond its voice/clip length (seconds). */
export const SCENE_PAD_SEC = 0.6;

/**
 * Frames to delay the voiceover within its scene (>= 0). The VO is offset so its
 * content lands on the on-screen payoff rather than the navigation preamble.
 */
export function voOffsetFrames(scene: SceneInput): number {
  return Math.max(0, Math.round((scene.voOffsetSec ?? 0) * FPS));
}

/**
 * Source-of-truth timing: the scene is long enough to play the whole clip AND
 * the (possibly delayed) voiceover. Whichever ends later sets the length, so a
 * clip longer than the voice is never truncated and a voice that runs past the
 * clip freezes on its last frame. Returns whole frames (>= 1) for one scene.
 */
export function sceneFrames(scene: SceneInput): number {
  const voEnd =
    scene.voDurationSec != null
      ? (scene.voOffsetSec ?? 0) + scene.voDurationSec
      : 0;
  const base = Math.max(scene.clipDurationSec, voEnd);
  return Math.max(1, Math.ceil((base + SCENE_PAD_SEC) * FPS));
}

/** Total composition length accounting for overlapping transitions. */
export function totalFrames(scenes: SceneInput[]): number {
  const sum = scenes.reduce((acc, s) => acc + sceneFrames(s), 0);
  const overlaps = Math.max(0, scenes.length - 1) * TRANSITION_FRAMES;
  return Math.max(1, sum - overlaps);
}
