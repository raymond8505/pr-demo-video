import { promises as fs } from "node:fs";
import { z } from "zod/v4";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths, ensureRunDirs } from "../paths.js";
import { githubFetch, fetchPrDiff } from "../github.js";
import {
  readManifest,
  writeManifest,
  HIGHLIGHT_TYPES,
  type Manifest,
  type ManifestHighlight,
  type Beat,
} from "../manifest.js";
import { getProvider } from "../llm/provider.js";

const DEFAULT_MAX_HIGHLIGHTS = 2;
const DIFF_CHAR_CAP = 80_000;
/** Target spoken length per beat line (~150 wpm) — one crisp sentence. */
const TARGET_BEAT_SECONDS = 3.5;
const TARGET_BEAT_WORDS = Math.round((TARGET_BEAT_SECONDS / 60) * 150);

/**
 * Stage 1 (faithful extractor): neutral, accurate, user-facing highlights. No
 * character — this is the anti-hallucination layer and the source of demoIntent.
 * `beats` is the ordered step-plan (each a single on-screen action) that drives
 * both the narration and the demo spec. We derive the kebab `id` and beat keys
 * ourselves, so the model returns neither.
 */
const ExtractSchema = z.object({
  highlights: z.array(
    z.object({
      type: z.enum(HIGHLIGHT_TYPES),
      title: z.string(),
      plainSummary: z.string(),
      demoIntent: z.string(),
      beats: z.array(z.object({ action: z.string() })).min(1),
    }),
  ),
});

/** Stage 2 (narrator): one spoken line per beat, in order. */
const NarrationSchema = z.object({
  beats: z.array(z.object({ narration: z.string() })).min(1),
});

/** What story.json holds and what --from-story re-seeds from. Beat `key` is
 * written for the human's reference but re-derived by position on re-seed. */
const StoryFileSchema = z.object({
  highlights: z.array(
    z.object({
      type: z.enum(HIGHLIGHT_TYPES),
      title: z.string(),
      plainSummary: z.string(),
      demoIntent: z.string(),
      beats: z
        .array(
          z.object({
            key: z.string().optional(),
            action: z.string(),
            narration: z.string(),
          }),
        )
        .min(1),
    }),
  ),
});
type StoryHighlight = z.infer<typeof StoryFileSchema>["highlights"][number];

interface PrMeta {
  title: string;
  body: string | null;
  commits: { commit: { message: string } }[];
  files: { filename: string; status: string; additions: number; deletions: number }[];
}

export async function run(ref: PrRef, opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  await ensureRunDirs(runDir);
  const p = runPaths(runDir);
  const maxHighlights = Number(opts.max ?? DEFAULT_MAX_HIGHLIGHTS);

  // --from-story: re-seed the manifest from a human-edited story.json (the gate).
  if (opts.fromStory) {
    const story = StoryFileSchema.parse(
      JSON.parse(await fs.readFile(p.storyJson, "utf8")),
    );
    await seedManifest(runDir, ref, story.highlights);
    console.error(`Re-seeded manifest from ${p.storyJson}`);
    return;
  }

  const provider = await getProvider();
  console.error(`Using LLM provider: ${provider.name}`);

  console.error(`Fetching PR ${ref.repo}#${ref.prNumber}...`);
  const [pr, commits, files, diff] = await Promise.all([
    githubFetch<PrMeta>(`/repos/${ref.owner}/${ref.name}/pulls/${ref.prNumber}`),
    githubFetch<PrMeta["commits"]>(
      `/repos/${ref.owner}/${ref.name}/pulls/${ref.prNumber}/commits?per_page=100`,
    ),
    githubFetch<PrMeta["files"]>(
      `/repos/${ref.owner}/${ref.name}/pulls/${ref.prNumber}/files?per_page=100`,
    ),
    fetchPrDiff(ref.owner, ref.name, ref.prNumber),
  ]);

  const truncatedDiff =
    diff.length > DIFF_CHAR_CAP
      ? diff.slice(0, DIFF_CHAR_CAP) + "\n\n[diff truncated for length]"
      : diff;

  // Stage 1: faithful extraction.
  console.error(`Stage 1: extracting user-facing changes...`);
  const extracted = await provider.complete({
    system: EXTRACTOR_SYSTEM,
    messages: [{ role: "user", content: extractorPrompt(pr, commits, files, truncatedDiff, maxHighlights) }],
    schema: ExtractSchema,
    schemaName: "highlights",
  });
  const factual = extracted.highlights.slice(0, maxHighlights);

  // Stage 2: narrator persona, one call per highlight (keeps the voice tight),
  // writing one spoken line per on-screen beat so the words track the action.
  console.error(`Stage 2: writing per-beat narration for ${factual.length} highlight(s)...`);
  const highlights: StoryHighlight[] = [];
  for (const h of factual) {
    const keyed = h.beats.map((b, i) => ({ key: `b${i + 1}`, action: b.action }));
    const { beats: lines } = await provider.complete({
      system: NARRATOR_SYSTEM,
      messages: [{ role: "user", content: narratorPrompt(h.title, h.plainSummary, keyed) }],
      schema: NarrationSchema,
      schemaName: "narration",
      maxTokens: 1500,
    });
    if (lines.length !== keyed.length) {
      console.error(
        `  (warning: ${h.title} — model returned ${lines.length} lines for ${keyed.length} beats; ` +
          `zipping by order, falling back to the step text where missing)`,
      );
    }
    // Zip lines onto beats by order; never leave a beat without a (non-empty)
    // line — the manifest requires it and the human fixes wording at the gate.
    const beats = keyed.map((b, i) => ({
      ...b,
      narration: lines[i]?.narration?.trim() || b.action,
    }));
    highlights.push({ ...h, beats });
  }

  await fs.writeFile(p.storyJson, JSON.stringify({ highlights }, null, 2) + "\n", "utf8");
  await seedManifest(runDir, ref, highlights);

  console.error(`\nWrote ${p.storyJson}:`);
  for (const h of highlights) {
    console.error(`  [${h.type}] ${h.title}`);
    console.error(`    fact: ${h.plainSummary}`);
    h.beats.forEach((b, i) => {
      console.error(`    ${i + 1}. (${b.action})`);
      console.error(`       "${b.narration}"`);
    });
  }
  console.error(
    `\nGATE: review/edit ${p.storyJson} (check facts AND the narrator voice), then re-seed the manifest with:\n  pr-video script ${ref.repo}#${ref.prNumber} --from-story`,
  );
}

// --- Stage 1 ------------------------------------------------------------------
const EXTRACTOR_SYSTEM = `You extract the USER-VISIBLE changes from a GitHub PR — the things that belong in customer release notes (new features, changed behavior, bug fixes). Ignore refactors, tests, CI, dependencies, and internal plumbing unless they change what a user sees or does.

For each highlight return:
- type: "feature" (new), "change" (changed behavior), or "fix" (bug fix)
- title: a short, plain, customer-friendly headline (no jargon)
- plainSummary: 1-2 neutral, factual sentences describing exactly what changed for the user. No flourish. This must be accurate to the diff.
- demoIntent: the concrete UI flow that proves this change on screen — which page, what to click/type, what the viewer should see. Specific enough to script a browser test.
- beats: the demoIntent broken into an ORDERED list of discrete on-screen steps (3 to 6). Each beat is ONE action a viewer watches happen — "open the recipe", "enter cooking mode", "start the timer", "the redesigned card appears". A separate spoken line will narrate each beat as it happens, so each beat must be a single, distinct, visible moment in the flow (not two actions at once, not an invisible internal change). Order them exactly as they occur on screen.

Be faithful to the diff. Do not invent capabilities. Prefer fewer, stronger highlights.`;

function extractorPrompt(
  pr: PrMeta,
  commits: PrMeta["commits"],
  files: PrMeta["files"],
  diff: string,
  max: number,
): string {
  const fileList = files
    .map((f) => `  ${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");
  const commitList = commits.map((c) => `  - ${c.commit.message.split("\n")[0]}`).join("\n");
  return `PR title: ${pr.title}

PR description:
${pr.body || "(none)"}

Commits:
${commitList}

Changed files:
${fileList}

Unified diff:
${diff}

Return at most ${max} highlights, ordered by customer impact (most important first).`;
}

// --- Stage 2 (narrator) -------------------------------------------------------
const NARRATOR_SYSTEM = `You are Max, an upbeat product evangelist who loves teaching people about the app's newest updates. You narrate short demonstrations of a software product's latest changes, turning each new feature into a clear, exciting moment a viewer instantly "gets."

Voice and manner:
- Warm, energetic, genuinely excited — the enthusiasm of someone who can't wait to show you what's new.
- Clear and educational: say what the feature does and why it helps, in plain language.
- Friendly and direct, like a great demo host. Modern and conversational, but professional — no slang overload, no hype-y buzzwords or marketing fluff.
- A brisk, lively cadence that reads aloud naturally.

You receive an ordered list of ON-SCREEN STEPS for ONE feature — each step is one action the viewer watches happen. Write ONE short spoken line per step, describing what is happening AS IT HAPPENS, so the spoken words track the action on screen.

Iron rules:
- Exactly one line per step, in the SAME order. Return as many lines as there are steps — no more, no fewer.
- Each line is ONE crisp sentence, about ${TARGET_BEAT_SECONDS} seconds spoken (roughly ${TARGET_BEAT_WORDS} words). Short is good.
- The lines must read as a single, smoothly flowing narration when played back to back — vary openings, don't restate the same idea each line.
- Tell the TRUTH about what each step does. Make it engaging, never inaccurate. If unsure of a detail, say it plain rather than invent.
- No code, no file names, no version numbers, no emoji, no markup, no special characters — every word here is spoken aloud.
- Present tense; speak to the viewer directly.

Example —
Steps:
  1. Open the recipe list
  2. Type "soup" into the search bar
  3. The list filters to matching recipes
Max:
  1. "Let's find something to cook tonight."
  2. "Just start typing in the search bar..."
  3. "...and the list filters instantly to match."

Return one narration line per step, in order.`;

function narratorPrompt(
  title: string,
  plainSummary: string,
  beats: { key: string; action: string }[],
): string {
  const steps = beats.map((b, i) => `  ${i + 1}. ${b.action}`).join("\n");
  return `Feature: ${title}
Plain description: ${plainSummary}

On-screen steps, in order (write one spoken line per step, same order):
${steps}

Return one narration line per step.`;
}

// --- manifest seeding ---------------------------------------------------------
async function seedManifest(
  runDir: string,
  ref: PrRef,
  highlights: StoryHighlight[],
): Promise<void> {
  const existing = await readManifest(runDir).catch(() => null);
  const usedIds = new Set<string>();
  const manifestHighlights: ManifestHighlight[] = highlights.map((h) => {
    let id = slugify(h.title);
    let n = 2;
    while (usedIds.has(id)) id = `${slugify(h.title)}-${n++}`;
    usedIds.add(id);
    // Re-derive beat keys by position so they stay sequential even if the human
    // reordered/added beats in story.json — the spec marks beats in this order.
    const beats: Beat[] = h.beats.map((b, i) => ({
      key: `b${i + 1}`,
      action: b.action,
      narration: b.narration,
    }));
    return {
      id,
      type: h.type,
      title: h.title,
      plainSummary: h.plainSummary,
      beats,
      demoIntent: h.demoIntent,
      status: "pending" as const,
    };
  });

  const manifest: Manifest = {
    repo: ref.repo,
    prNumber: ref.prNumber,
    previewUrl: existing?.previewUrl,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    highlights: manifestHighlights,
  };
  await writeManifest(runDir, manifest);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "highlight"
  );
}
