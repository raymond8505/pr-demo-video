import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (one level up from src/). */
export const PROJECT_ROOT = path.resolve(here, "..");
export const RUNS_ROOT = path.join(PROJECT_ROOT, "runs");
/**
 * The cursor/glide fixture module. Copied into each run's specs dir as `_demo.ts`
 * by ensureRunDirs so authored specs can `import { test, expect, glide } from
 * "./_demo"` — see tests/demoCursor.ts.
 */
export const CURSOR_TEMPLATE = path.join(PROJECT_ROOT, "tests", "demoCursor.ts");

export interface PrRef {
  owner: string;
  name: string;
  /** "owner/name" */
  repo: string;
  prNumber: number;
}

/**
 * Accepts a full PR URL ("https://github.com/owner/name/pull/123"),
 * the "owner/name#123" shorthand, or a bare number when --repo is supplied.
 */
export function parsePrRef(ref: string, repoFlag?: string): PrRef {
  const urlMatch = ref.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i,
  );
  if (urlMatch) {
    const [, owner, name, num] = urlMatch as unknown as [
      string,
      string,
      string,
      string,
    ];
    return { owner, name, repo: `${owner}/${name}`, prNumber: Number(num) };
  }

  const shorthand = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shorthand) {
    const [, owner, name, num] = shorthand as unknown as [
      string,
      string,
      string,
      string,
    ];
    return { owner, name, repo: `${owner}/${name}`, prNumber: Number(num) };
  }

  if (/^\d+$/.test(ref)) {
    if (!repoFlag || !repoFlag.includes("/")) {
      throw new Error(
        `PR "${ref}" given as a bare number — pass --repo owner/name`,
      );
    }
    const [owner, name] = repoFlag.split("/") as [string, string];
    return { owner, name, repo: repoFlag, prNumber: Number(ref) };
  }

  throw new Error(
    `Could not parse PR reference "${ref}". Use a PR URL, owner/name#123, or a number with --repo.`,
  );
}

/** runs/<owner>-<name>-pr<N>/ — slugged so it is filesystem-safe. */
export function runDirFor(ref: PrRef): string {
  const slug = `${ref.owner}-${ref.name}`.replace(/[^a-z0-9-]+/gi, "-");
  return path.join(RUNS_ROOT, `${slug}-pr${ref.prNumber}`);
}

export interface RunPaths {
  root: string;
  specs: string;
  clips: string;
  audio: string;
  storyJson: string;
  outMp4: string;
}

export function runPaths(runDir: string): RunPaths {
  return {
    root: runDir,
    specs: path.join(runDir, "specs"),
    clips: path.join(runDir, "clips"),
    audio: path.join(runDir, "audio"),
    storyJson: path.join(runDir, "story.json"),
    outMp4: path.join(runDir, "out.mp4"),
  };
}

/** Per-highlight voiceover directory: <run>/audio/<id>/ (one mp3 per beat). */
export function beatAudioDir(runDir: string, highlightId: string): string {
  return path.join(runPaths(runDir).audio, highlightId);
}

/** A beat's mp3 on disk: <run>/audio/<id>/<key>.mp3. */
export function beatAudioFile(
  runDir: string,
  highlightId: string,
  beatKey: string,
): string {
  return path.join(beatAudioDir(runDir, highlightId), `${beatKey}.mp3`);
}

/** A beat's mp3 RELATIVE to the run dir (Remotion publicDir): audio/<id>/<key>.mp3. */
export function beatAudioRel(highlightId: string, beatKey: string): string {
  return `audio/${highlightId}/${beatKey}.mp3`;
}

/** Captured beat-marker timings for a clip: <run>/clips/<id>.beats.json. */
export function beatMarkersFile(runDir: string, highlightId: string): string {
  return path.join(runPaths(runDir).clips, `${highlightId}.beats.json`);
}

export async function ensureRunDirs(runDir: string): Promise<RunPaths> {
  const p = runPaths(runDir);
  await Promise.all([
    fs.mkdir(p.specs, { recursive: true }),
    fs.mkdir(p.clips, { recursive: true }),
    fs.mkdir(p.audio, { recursive: true }),
  ]);
  // Make the cursor/glide fixture importable from authored specs as "./_demo".
  // Copy (not rename) — fs.rename throws EPERM on OneDrive-synced paths.
  await fs.copyFile(CURSOR_TEMPLATE, path.join(p.specs, "_demo.ts"));
  return p;
}
