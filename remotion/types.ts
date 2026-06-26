/**
 * Props shape shared between the Node render stage (which reads the manifest and
 * builds the scene plan) and the Remotion bundle (which renders it). Timing is a
 * pure function of these props — the bundle never touches the filesystem for
 * metadata, so calculateMetadata works identically in the Studio and at render.
 *
 * Media paths are RELATIVE to the run dir, which the render stage passes as
 * Remotion's publicDir; the components resolve them with staticFile().
 */
/**
 * One spoken line within a scene, already placed in time. `startSec` is where
 * the line begins relative to the scene start — computed by the render stage
 * from the beat's captured marker (plus any nudge), or a sequential fallback.
 */
export type VoBeat = {
  /** relative path under the run dir, e.g. "audio/<id>/<key>.mp3" */
  src: string;
  startSec: number;
  durationSec: number;
};

export type SceneInput = {
  id: string;
  type: "feature" | "change" | "fix";
  title: string;
  narration: string;
  /** relative path under the run dir, e.g. "clips/<id>.mp4" */
  clipSrc: string;
  clipDurationSec: number;
  /** Per-beat voiceover lines, each pre-placed at its on-screen action. */
  vo: VoBeat[];
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

/** Frames at which a placed beat line starts within its scene (>= 0). */
export function voBeatStartFrames(beat: VoBeat): number {
  return Math.max(0, Math.round(beat.startSec * FPS));
}

/** When the last spoken line in a scene ends (seconds), or 0 if there are none. */
export function voEndSec(scene: SceneInput): number {
  return scene.vo.reduce(
    (end, b) => Math.max(end, Math.max(0, b.startSec) + b.durationSec),
    0,
  );
}

/**
 * Source-of-truth timing: the scene is long enough to play the whole clip AND
 * every (placed) spoken line. Whichever ends later sets the length, so a clip
 * longer than the voice is never truncated and a line that runs past the clip
 * freezes on its last frame. Returns whole frames (>= 1) for one scene.
 */
export function sceneFrames(scene: SceneInput): number {
  const base = Math.max(scene.clipDurationSec, voEndSec(scene));
  return Math.max(1, Math.ceil((base + SCENE_PAD_SEC) * FPS));
}

/** Total composition length accounting for overlapping transitions. */
export function totalFrames(scenes: SceneInput[]): number {
  const sum = scenes.reduce((acc, s) => acc + sceneFrames(s), 0);
  const overlaps = Math.max(0, scenes.length - 1) * TRANSITION_FRAMES;
  return Math.max(1, sum - overlaps);
}
