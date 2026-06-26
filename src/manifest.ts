import { z } from "zod/v4";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The manifest is the spine of the pipeline: a single JSON ledger per run,
 * keyed by highlight id, that every stage reads and writes. It is what makes
 * the manual gates between stages inspectable and the pipeline resumable.
 */

export const HIGHLIGHT_TYPES = ["feature", "change", "fix"] as const;
export type HighlightType = (typeof HIGHLIGHT_TYPES)[number];

/**
 * The shape the story-generation LLM call must return. Kept deliberately small:
 * `narration` is the spoken voiceover (capped to a few sentences) and
 * `demoIntent` is the UI flow that proves the change on screen.
 */
export const StoryHighlightSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be kebab-case (a-z, 0-9, -)"),
  type: z.enum(HIGHLIGHT_TYPES),
  title: z.string().min(1),
  /** Neutral, factual description of the change (stage 1) — shown at the gate
   * so accuracy can be reviewed separately from the in-character narration. */
  plainSummary: z.string().optional(),
  narration: z.string().min(1),
  demoIntent: z.string().min(1),
});
export type StoryHighlight = z.infer<typeof StoryHighlightSchema>;

export const StorySchema = z.object({
  highlights: z.array(StoryHighlightSchema).min(1),
});
export type Story = z.infer<typeof StorySchema>;

/** Per-highlight processing state as it moves through the pipeline. */
export const HighlightStatus = z.enum([
  "pending", // in story, not yet authored
  "authored", // a green spec exists
  "recorded", // a raw .webm clip exists
  "normalized", // a CFR .mp4 clip + duration exist
  "voiced", // a VO .mp3 + duration exist
  "unresolved", // authoring failed; dropped from the video
]);
export type HighlightStatus = z.infer<typeof HighlightStatus>;

export const ManifestHighlightSchema = StoryHighlightSchema.extend({
  status: HighlightStatus.default("pending"),
  specPath: z.string().optional(),
  clipWebmPath: z.string().optional(),
  clipMp4Path: z.string().optional(),
  clipDurationSec: z.number().positive().optional(),
  voPath: z.string().optional(),
  voDurationSec: z.number().positive().optional(),
  unresolvedReason: z.string().optional(),
});
export type ManifestHighlight = z.infer<typeof ManifestHighlightSchema>;

export const ManifestSchema = z.object({
  repo: z.string(), // "owner/name"
  prNumber: z.number().int().positive(),
  previewUrl: z.string().url().optional(),
  createdAt: z.string(),
  highlights: z.array(ManifestHighlightSchema).default([]),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const MANIFEST_FILE = "manifest.json";

export async function readManifest(runDir: string): Promise<Manifest> {
  const raw = await fs.readFile(path.join(runDir, MANIFEST_FILE), "utf8");
  return ManifestSchema.parse(JSON.parse(raw));
}

export async function writeManifest(
  runDir: string,
  manifest: Manifest,
): Promise<void> {
  // Validate on the way out so a buggy stage can't persist a malformed ledger.
  const validated = ManifestSchema.parse(manifest);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, MANIFEST_FILE),
    JSON.stringify(validated, null, 2) + "\n",
    "utf8",
  );
}

/**
 * Read-modify-write a single highlight by id. Stages call this to record their
 * output (a spec path, a clip duration, an unresolved reason) without having to
 * marshal the whole ledger themselves.
 */
export async function updateHighlight(
  runDir: string,
  id: string,
  patch: Partial<ManifestHighlight>,
): Promise<Manifest> {
  const manifest = await readManifest(runDir);
  const idx = manifest.highlights.findIndex((h) => h.id === id);
  const current = manifest.highlights[idx];
  if (idx === -1 || !current) {
    throw new Error(`No highlight "${id}" in manifest at ${runDir}`);
  }
  manifest.highlights[idx] = { ...current, ...patch };
  await writeManifest(runDir, manifest);
  return manifest;
}
