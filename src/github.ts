import { requireEnv } from "./env.js";

const API = "https://api.github.com";

/**
 * Minimal GitHub REST client. We use raw fetch (not the `gh` CLI, which is
 * broken in this environment) with a token from GITHUB_TOKEN. recipe-viewer is
 * private, so the token needs repo-read scope.
 */
export async function githubFetch<T>(
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(`${API}${endpoint}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${endpoint} -> ${res.status} ${res.statusText}: ${body.slice(0, 400)}`,
    );
  }
  return (await res.json()) as T;
}

/** The diff for a PR, as a unified-diff string (media type override). */
export async function fetchPrDiff(
  owner: string,
  name: string,
  prNumber: number,
): Promise<string> {
  const token = requireEnv("GITHUB_TOKEN");
  const res = await fetch(
    `${API}/repos/${owner}/${name}/pulls/${prNumber}`,
    {
      headers: {
        Accept: "application/vnd.github.diff",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub PR diff ${prNumber} -> ${res.status}: ${body.slice(0, 300)}`,
    );
  }
  return res.text();
}

export interface Deployment {
  id: number;
  environment: string;
  created_at: string;
}

export interface DeploymentStatus {
  state: string; // success | in_progress | failure | error | inactive | pending | queued
  environment_url: string | null;
  created_at: string;
}

export async function listDeployments(
  owner: string,
  name: string,
  environment: string,
): Promise<Deployment[]> {
  return githubFetch<Deployment[]>(
    `/repos/${owner}/${name}/deployments?environment=${encodeURIComponent(
      environment,
    )}&per_page=20`,
  );
}

export async function listDeploymentStatuses(
  owner: string,
  name: string,
  deploymentId: number,
): Promise<DeploymentStatus[]> {
  return githubFetch<DeploymentStatus[]>(
    `/repos/${owner}/${name}/deployments/${deploymentId}/statuses?per_page=20`,
  );
}
