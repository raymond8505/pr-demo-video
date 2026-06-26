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
 * Source-of-truth timing: the voiceover drives scene length when present, else
 * the clip length. Returns whole frames (>= 1) for one scene.
 */
export function sceneFrames(scene: SceneInput): number {
  const base = scene.voDurationSec ?? scene.clipDurationSec;
  return Math.max(1, Math.ceil((base + SCENE_PAD_SEC) * FPS));
}

/** Total composition length accounting for overlapping transitions. */
export function totalFrames(scenes: SceneInput[]): number {
  const sum = scenes.reduce((acc, s) => acc + sceneFrames(s), 0);
  const overlaps = Math.max(0, scenes.length - 1) * TRANSITION_FRAMES;
  return Math.max(1, sum - overlaps);
}
