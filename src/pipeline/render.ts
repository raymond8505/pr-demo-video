import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths, PROJECT_ROOT } from "../paths.js";
import { readManifest } from "../manifest.js";
import type { DemoVideoProps, SceneInput } from "../../remotion/types.js";

/**
 * Build the scene plan from the manifest and render the Remotion composition to
 * out.mp4. Media paths are passed RELATIVE to the run dir, which becomes
 * Remotion's publicDir, so staticFile() resolves the clips and voiceovers.
 */
export async function run(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  const p = runPaths(runDir);
  const manifest = await readManifest(runDir);

  const scenes: SceneInput[] = manifest.highlights
    .filter((h) => h.clipMp4Path && h.clipDurationSec)
    .map((h) => ({
      id: h.id,
      type: h.type,
      title: h.title,
      narration: h.narration,
      clipSrc: `clips/${h.id}.mp4`,
      clipDurationSec: h.clipDurationSec as number,
      ...(h.voPath && h.voDurationSec
        ? { voSrc: `audio/${h.id}.mp3`, voDurationSec: h.voDurationSec }
        : {}),
    }));

  if (scenes.length === 0) {
    throw new Error(
      "No normalized clips to render. Run `pr-video record` then `pr-video normalize`.",
    );
  }

  const inputProps: DemoVideoProps = { scenes };
  console.error(`Bundling Remotion project (${scenes.length} scene(s))...`);
  const serveUrl = await bundle({
    entryPoint: path.join(PROJECT_ROOT, "remotion", "index.ts"),
    publicDir: runDir,
    onProgress: () => {},
    // Our source uses Node-ESM ".js" specifiers that point at ".ts/.tsx" files.
    // Teach webpack to resolve them so the same imports work in tsx and the bundle.
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: {
          ".js": [".ts", ".tsx", ".js"],
          ...(config.resolve?.extensionAlias ?? {}),
        },
      },
    }),
  });

  const composition = await selectComposition({
    serveUrl,
    id: "demo",
    inputProps,
  });

  console.error(
    `Rendering ${composition.durationInFrames} frames @ ${composition.fps}fps -> out.mp4`,
  );
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: p.outMp4,
    inputProps,
    onProgress: ({ progress }) => {
      process.stderr.write(`\r  render ${Math.round(progress * 100)}%   `);
    },
  });
  process.stderr.write("\n");
  console.error(`Wrote ${p.outMp4}`);
}
