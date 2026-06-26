import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import { capture } from "./proc.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * Normalize a Playwright .webm (VP8, variable frame rate, no audio) to a
 * constant-frame-rate H.264 mp4. This is non-negotiable before Remotion:
 * <OffthreadVideo> seeks by timestamp via ffmpeg, and VFR webm makes both
 * duration detection and frame seeking unreliable.
 */
export async function normalizeToMp4(
  inputWebm: string,
  outputMp4: string,
  fps = 30,
): Promise<void> {
  const { code, stderr } = await capture(FFMPEG, [
    "-y",
    "-i",
    inputWebm,
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an", // Playwright clips have no audio; the VO is added in Remotion
    outputMp4,
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg normalize failed (${code}):\n${stderr.slice(-800)}`);
  }
}

/** Authoritative media duration in seconds, read from the (normalized) file. */
export async function mediaDurationSec(file: string): Promise<number> {
  const { slowDurationInSeconds, durationInSeconds } = await parseMedia({
    src: file,
    reader: nodeReader,
    acknowledgeRemotionLicense: true,
    fields: { slowDurationInSeconds: true, durationInSeconds: true },
  });
  // slowDurationInSeconds reads the whole file and is the most accurate; fall
  // back to the header-derived value if it's unavailable.
  const dur = slowDurationInSeconds ?? durationInSeconds;
  if (!dur || dur <= 0) {
    throw new Error(`Could not read a positive duration from ${file}`);
  }
  return dur;
}
