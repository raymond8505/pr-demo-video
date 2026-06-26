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
} from "../manifest.js";
import { getProvider } from "../llm/provider.js";

const DEFAULT_MAX_HIGHLIGHTS = 2;
const DIFF_CHAR_CAP = 80_000;
/** Target spoken length per narration (~150 wpm). */
const TARGET_SECONDS = 11;
const TARGET_WORDS = Math.round((TARGET_SECONDS / 60) * 150);

/**
 * Stage 1 (faithful extractor): neutral, accurate, user-facing highlights. No
 * character — this is the anti-hallucination layer and the source of demoIntent.
 * We derive the kebab `id` ourselves, so the model doesn't return one.
 */
const ExtractSchema = z.object({
  highlights: z.array(
    z.object({
      type: z.enum(HIGHLIGHT_TYPES),
      title: z.string(),
      plainSummary: z.string(),
      demoIntent: z.string(),
    }),
  ),
});

/** Stage 2 (narrator): narration only, rewritten from one plainSummary. */
const NarrationSchema = z.object({ narration: z.string() });

/** What story.json holds and what --from-story re-seeds from. */
const StoryFileSchema = z.object({
  highlights: z.array(
    z.object({
      type: z.enum(HIGHLIGHT_TYPES),
      title: z.string(),
      plainSummary: z.string(),
      demoIntent: z.string(),
      narration: z.string(),
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

  // Stage 2: narrator persona, one call per highlight (keeps the voice tight).
  console.error(`Stage 2: writing narration for ${factual.length} highlight(s)...`);
  const highlights: StoryHighlight[] = [];
  for (const h of factual) {
    const { narration } = await provider.complete({
      system: NARRATOR_SYSTEM,
      messages: [{ role: "user", content: narratorPrompt(h.title, h.plainSummary) }],
      schema: NarrationSchema,
      schemaName: "narration",
      maxTokens: 1000,
    });
    highlights.push({ ...h, narration });
  }

  await fs.writeFile(p.storyJson, JSON.stringify({ highlights }, null, 2) + "\n", "utf8");
  await seedManifest(runDir, ref, highlights);

  console.error(`\nWrote ${p.storyJson}:`);
  for (const h of highlights) {
    console.error(`  [${h.type}] ${h.title}`);
    console.error(`    fact: ${h.plainSummary}`);
    console.error(`    narration: ${h.narration}`);
  }
  console.error(
    `\nGATE: review/edit ${p.storyJson} (check facts AND the narrator voice), then \`pr-video script --from-story\`.`,
  );
}

// --- Stage 1 ------------------------------------------------------------------
const EXTRACTOR_SYSTEM = `You extract the USER-VISIBLE changes from a GitHub PR — the things that belong in customer release notes (new features, changed behavior, bug fixes). Ignore refactors, tests, CI, dependencies, and internal plumbing unless they change what a user sees or does.

For each highlight return:
- type: "feature" (new), "change" (changed behavior), or "fix" (bug fix)
- title: a short, plain, customer-friendly headline (no jargon)
- plainSummary: 1-2 neutral, factual sentences describing exactly what changed for the user. No flourish. This must be accurate to the diff.
- demoIntent: the concrete UI flow that proves this change on screen — which page, what to click/type, what the viewer should see. Specific enough to script a browser test.

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

Iron rules:
- Tell the TRUTH about what the feature does. Make it engaging, never inaccurate. If you are unsure of a detail, say it plain rather than invent.
- No code, no file names, no version numbers, no emoji, no markup, no special characters — every word here is spoken aloud.
- 2 to 3 sentences. Aim for about ${TARGET_SECONDS} seconds spoken (about ${TARGET_WORDS} words).
- Present tense; speak to the viewer directly.

Example —
Plain feature: "You can now search recipes by typing in the search bar; results filter as you type."
Max: "Here's something you'll love — finding a recipe is now instant. Just start typing in the search bar and the list filters as you go, so your next meal is only a few keystrokes away."

You receive a plain description of ONE user-facing change. Return narration in your voice that a customer would both enjoy and clearly understand.`;

function narratorPrompt(title: string, plainSummary: string): string {
  return `Feature: ${title}
Plain description: ${plainSummary}

Write the narration for this one change.`;
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
    return {
      id,
      type: h.type,
      title: h.title,
      plainSummary: h.plainSummary,
      narration: h.narration,
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
