#!/usr/bin/env -S tsx
import { Command } from "commander";
import { loadEnv } from "./env.js";
import { parsePrRef, runDirFor, runPaths, ensureRunDirs, type PrRef } from "./paths.js";
import {
  readManifest,
  writeManifest,
  type Manifest,
} from "./manifest.js";
import { resolvePreviewUrl } from "./resolvers/resolve.js";

loadEnv();

const program = new Command();
program
  .name("pr-video")
  .description("Turn a GitHub PR into a customer-facing demo video (PoC).");

/** Shared positional + repo option, used by every stage to locate the run dir. */
function withPr(cmd: Command): Command {
  return cmd
    .argument("<pr>", "PR URL, owner/name#123, or a number (with --repo)")
    .option("--repo <owner/name>", "repo when <pr> is a bare number");
}

async function loadRun(
  ref: PrRef,
): Promise<{ runDir: string; manifest: Manifest }> {
  const runDir = runDirFor(ref);
  const manifest = await readManifest(runDir).catch(() => {
    throw new Error(
      `No run found for ${ref.repo}#${ref.prNumber}. Run \`pr-video resolve\` first.`,
    );
  });
  return { runDir, manifest };
}

/**
 * The `init` step: resolve the preview URL and persist it on the run's manifest
 * (creating the run if needed). Returns the resolved URL. Shared by the
 * init/resolve commands and the one-shot `make` command.
 */
async function seedPreviewUrl(ref: PrRef, previewUrl?: string): Promise<string> {
  const runDir = runDirFor(ref);
  await ensureRunDirs(runDir);
  const url = await resolvePreviewUrl(ref, previewUrl);
  const existing = await readManifest(runDir).catch(() => null);
  const manifest: Manifest = existing
    ? { ...existing, previewUrl: url }
    : {
        repo: ref.repo,
        prNumber: ref.prNumber,
        previewUrl: url,
        createdAt: new Date().toISOString(),
        highlights: [],
      };
  await writeManifest(runDir, manifest);
  return url;
}

// --- init: create the run from a PR URL + a preview URL ------------------------
// The core system is repo-agnostic: its initial input is just (PR ref, preview URL).
// --preview-url is the primary, first-class input. If omitted, an OPTIONAL
// repo-specific resolver may derive it (recipe-viewer ships as a convenience),
// but you never have to rely on that — pass the URL in manually.
const initCmd = withPr(program.command("init"))
  .description("Create the run from a PR ref + a preview URL")
  .requiredOption(
    "--preview-url <url>",
    "the app's deployed preview URL to demo against (or omit and use --auto-resolve)",
  );
// alias kept for the original stage name in the plan
const resolveCmd = withPr(program.command("resolve", { hidden: true }))
  .option("--preview-url <url>", "the app's deployed preview URL")
  .option("--auto-resolve", "try the optional repo-specific resolver if no --preview-url");

for (const cmd of [initCmd, resolveCmd]) {
  cmd.action(async (pr: string, opts: { repo?: string; previewUrl?: string; autoResolve?: boolean }) => {
    const ref = parsePrRef(pr, opts.repo);

    if (!opts.previewUrl && !opts.autoResolve) {
      throw new Error(
        "No --preview-url given. Pass the app's preview URL, or add --auto-resolve to try a repo-specific resolver.",
      );
    }
    if (!opts.previewUrl) {
      console.error(`Resolving preview URL for ${ref.repo}#${ref.prNumber}...`);
    }
    const url = await seedPreviewUrl(ref, opts.previewUrl);
    console.error(`Preview URL: ${url}`);
    console.error(`Run dir:     ${runDirFor(ref)}`);
  });
}

// --- the remaining stages are loaded lazily so the CLI runs before they exist --
type StageRunner = (ref: PrRef, opts: Record<string, unknown>) => Promise<void>;

function stage(
  name: string,
  description: string,
  loader: () => Promise<{ run: StageRunner }>,
  configure?: (cmd: Command) => Command,
): void {
  let cmd = withPr(program.command(name)).description(description);
  if (configure) cmd = configure(cmd);
  cmd.action(async (pr: string, opts: Record<string, unknown>) => {
    const ref = parsePrRef(pr, opts.repo as string | undefined);
    const mod = await loader();
    await mod.run(ref, opts);
  });
}

stage(
  "script",
  "Fetch the PR and generate story.json (gate: review before authoring)",
  () => import("./pipeline/story.js"),
  (cmd) =>
    cmd
      .option("--from-story", "re-seed the manifest from an edited story.json (skip the LLM)")
      .option("--max <n>", "max number of highlights to generate"),
);
stage("probe", "Load the preview URL once and check for auth/route walls", () =>
  import("./pipeline/probe.js"),
);
stage("author", "Agent-driven authoring of one Playwright spec per highlight", () =>
  import("./pipeline/author.js"),
);
stage("record", "Run the spec suite, recording one clip per highlight", () =>
  import("./pipeline/record.js"),
);
stage("normalize", "Convert clips to CFR mp4 and read durations", () =>
  import("./pipeline/normalize.js"),
);
stage(
  "voice",
  "Generate ElevenLabs voiceover per highlight narration",
  () => import("./pipeline/voice.js"),
  (cmd) => cmd.option("--voice <id>", "override the voice id (e.g. a free-tier premade voice)"),
);
stage("render", "Render the Remotion composition to out.mp4", () =>
  import("./pipeline/render.js"),
);

// --- make: one command, PR -> out.mp4, no gates --------------------------------
// Chains every stage in order. The review gates (edit story.json, inspect specs)
// are intentionally skipped — use the individual staged commands above when you
// need to inspect or hand-edit a single step.
const PIPELINE: { name: string; load: () => Promise<{ run: StageRunner }> }[] = [
  { name: "script", load: () => import("./pipeline/story.js") },
  { name: "probe", load: () => import("./pipeline/probe.js") },
  { name: "author", load: () => import("./pipeline/author.js") },
  { name: "record", load: () => import("./pipeline/record.js") },
  { name: "normalize", load: () => import("./pipeline/normalize.js") },
  { name: "voice", load: () => import("./pipeline/voice.js") },
  { name: "render", load: () => import("./pipeline/render.js") },
];

withPr(program.command("make"))
  .description("Run the full pipeline end-to-end (no gates): PR -> out.mp4")
  .requiredOption("--preview-url <url>", "the app's deployed preview URL to demo against")
  .option("--max <n>", "max number of highlights to generate")
  .action(async (pr: string, opts: { repo?: string; previewUrl: string; max?: string }) => {
    const ref = parsePrRef(pr, opts.repo);
    const runDir = runDirFor(ref);

    const url = await seedPreviewUrl(ref, opts.previewUrl);
    console.error(`Preview URL: ${url}`);
    console.error(`Run dir:     ${runDir}\n`);

    // Every stage reads/writes the manifest; --max is only read by `script`.
    const stageOpts: Record<string, unknown> = { repo: opts.repo, max: opts.max };
    for (const [i, s] of PIPELINE.entries()) {
      console.error(`=== [${i + 1}/${PIPELINE.length}] ${s.name} ===`);
      const mod = await s.load();
      await mod.run(ref, stageOpts);
    }
    console.error(`\nDone -> ${runPaths(runDir).outMp4}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`\nerror: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

export { loadRun };
