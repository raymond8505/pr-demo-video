import type { PrRef } from "../paths.js";
import { listDeployments, listDeploymentStatuses } from "../github.js";
import type { PreviewResolver, ResolveResult } from "./index.js";

/**
 * recipe-viewer publishes per-PR previews through the GitHub Deployments API
 * (see its .github/workflows/staging.yml). Each PR gets an environment named
 * `staging-pr-<N>`; the latest deployment's latest status carries the
 * `environment_url` (e.g. https://<branch-slug>.new.raymonds.recipes) once the
 * build succeeds. Statuses are returned newest-first.
 */
export const recipeViewerResolver: PreviewResolver = {
  name: "recipe-viewer (GitHub Deployments)",

  matches(ref: PrRef): boolean {
    return ref.repo.toLowerCase() === "raymond8505/recipe-viewer";
  },

  async resolve(ref: PrRef): Promise<ResolveResult> {
    const environment = `staging-pr-${ref.prNumber}`;
    const deployments = await listDeployments(ref.owner, ref.name, environment);
    if (deployments.length === 0) {
      return {
        state: "none",
        detail: `No deployments for environment ${environment}. Has the Staging workflow run for this PR?`,
      };
    }

    // Deployments are newest-first; the first that has a terminal/usable status wins.
    for (const dep of deployments) {
      const statuses = await listDeploymentStatuses(
        ref.owner,
        ref.name,
        dep.id,
      );
      const latest = statuses[0];
      if (!latest) continue;

      if (latest.state === "success" && latest.environment_url) {
        return { state: "ready", url: latest.environment_url };
      }
      if (latest.state === "in_progress" || latest.state === "pending" || latest.state === "queued") {
        return {
          state: "pending",
          detail: `Deployment ${dep.id} is ${latest.state}; the preview is still building.`,
        };
      }
      // failure/error/inactive on the newest deployment: keep looking at older ones.
    }

    return {
      state: "none",
      detail: `No successful deployment found for ${environment} (newest builds failed or were superseded).`,
    };
  },
};
