import type { PrRef } from "../paths.js";
import { runDirFor } from "../paths.js";
import { readManifest } from "../manifest.js";
import { ariaSnapshotOf } from "../browser.js";

/**
 * Cheap sanity check before the expensive author loop: load the preview URL once
 * and surface whether it looks like a login wall. Catching an auth gate here
 * saves authoring five highlights against a page the agent can't actually use.
 */
export async function run(ref: PrRef, _opts: Record<string, unknown>): Promise<void> {
  const runDir = runDirFor(ref);
  const manifest = await readManifest(runDir);
  if (!manifest.previewUrl) {
    throw new Error("manifest has no previewUrl — run `pr-video init` first.");
  }

  console.error(`Probing ${manifest.previewUrl} ...`);
  const snapshot = await ariaSnapshotOf(manifest.previewUrl);
  const lc = snapshot.toLowerCase();

  const looksAuthWalled =
    /\b(password|sign in|log in|login|sign up)\b/.test(lc) &&
    snapshot.length < 3_000;

  console.error(`\nARIA snapshot (${snapshot.length} chars), first lines:`);
  console.error(snapshot.split("\n").slice(0, 25).join("\n"));

  if (looksAuthWalled) {
    console.error(
      `\n⚠️  This page looks like it may be behind auth. The author loop targets unauthed flows;\n` +
        `   for authed features, provide a Playwright storageState (auth.json) — out of scope for the PoC.`,
    );
  } else {
    console.error(`\n✓ Page loads and exposes interactive content. Ready to author.`);
  }
}
