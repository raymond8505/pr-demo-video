import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { PROJECT_ROOT } from "./paths.js";

/**
 * Load .env from the project root if present, making the FILE authoritative.
 *
 * We parse and assign ourselves rather than using process.loadEnvFile because
 * that built-in refuses to override variables already set in the OS environment
 * — so a stale `GITHUB_TOKEN` (or any key) exported in the shell would silently
 * shadow the project's .env and produce confusing 401s. For a project-local
 * secrets file, the file should win. Safe to call more than once.
 */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key) process.env[key] = val; // file overrides any stale OS env var
    }
  }
  loaded = true;
}

/** Read a required env var or throw a clear, actionable error. */
export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Set it in .env (see .env.example).`,
    );
  }
  return v;
}
