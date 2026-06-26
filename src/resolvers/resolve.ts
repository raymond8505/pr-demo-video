import type { PrRef } from "../paths.js";
import type { ResolveResult } from "./index.js";
import { recipeViewerResolver } from "./recipeViewer.js";

/** Registry of repo-specific resolvers. Add new repos here. */
const RESOLVERS = [recipeViewerResolver];

const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_ATTEMPTS = 20; // ~5 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a preview URL for a PR. A manually supplied URL always wins (the
 * generic path). Otherwise we find a matching repo resolver and poll it with
 * backoff while the deployment is still building, then fail cleanly.
 */
export async function resolvePreviewUrl(
  ref: PrRef,
  manualUrl?: string,
): Promise<string> {
  if (manualUrl) return manualUrl;

  const resolver = RESOLVERS.find((r) => r.matches(ref));
  if (!resolver) {
    throw new Error(
      `No preview resolver for ${ref.repo}. Pass --preview-url <url> to supply one directly.`,
    );
  }

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const result: ResolveResult = await resolver.resolve(ref);
    if (result.state === "ready") return result.url;
    if (result.state === "none") {
      throw new Error(
        `${resolver.name}: ${result.detail} Re-run once the preview is deployed, or pass --preview-url.`,
      );
    }
    // pending: poll
    if (attempt < POLL_MAX_ATTEMPTS) {
      console.error(
        `  preview pending (${result.detail}) — retry ${attempt}/${POLL_MAX_ATTEMPTS} in ${POLL_INTERVAL_MS / 1000}s`,
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `Preview still not ready after ${POLL_MAX_ATTEMPTS} attempts. Re-run later or pass --preview-url.`,
  );
}
