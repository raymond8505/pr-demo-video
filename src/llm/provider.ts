import type { z } from "zod/v4";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../env.js";
import { PROJECT_ROOT } from "../paths.js";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteArgs<T> {
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  /** A short name for the schema/output, used by the SDK backend. */
  schemaName: string;
  maxTokens?: number;
}

/**
 * One LLM call that must return a value validated against a Zod schema. Backends:
 * the Anthropic SDK (native structured output, needs ANTHROPIC_API_KEY) or the
 * local Claude CLI (uses your Claude Code login; JSON-only prompt + validate).
 */
export interface LlmProvider {
  readonly name: string;
  complete<T>(args: CompleteArgs<T>): Promise<T>;
}

/**
 * Resolve the Claude CLI binary: explicit CLAUDE_CLI_PATH wins, then the project's
 * own node_modules/.bin (the dev-dependency), then a bare `claude` on PATH.
 */
export function resolveClaudeBin(): string | undefined {
  if (process.env.CLAUDE_CLI_PATH) return process.env.CLAUDE_CLI_PATH;
  const local = path.join(
    PROJECT_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "claude.cmd" : "claude",
  );
  if (existsSync(local)) return local;
  return undefined;
}

/**
 * Pick a provider. Honors LLM_PROVIDER ("claude-cli" | "anthropic-sdk"); otherwise
 * prefers the Claude CLI when a binary is resolvable, falling back to the SDK.
 */
export async function getProvider(): Promise<LlmProvider> {
  loadEnv();
  const choice = process.env.LLM_PROVIDER?.toLowerCase();

  if (choice === "anthropic-sdk") {
    const { AnthropicProvider } = await import("./anthropicProvider.js");
    return new AnthropicProvider();
  }
  if (choice === "claude-cli") {
    const { ClaudeCliProvider } = await import("./claudeCliProvider.js");
    return new ClaudeCliProvider();
  }

  // Auto: prefer the CLI when a binary is resolvable (no API key needed), else the SDK.
  if (resolveClaudeBin()) {
    const { ClaudeCliProvider } = await import("./claudeCliProvider.js");
    return new ClaudeCliProvider();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { AnthropicProvider } = await import("./anthropicProvider.js");
    return new AnthropicProvider();
  }
  throw new Error(
    "No LLM provider available. Set LLM_PROVIDER=claude-cli with CLAUDE_CLI_PATH (or install the claude dev-dep), or set ANTHROPIC_API_KEY for LLM_PROVIDER=anthropic-sdk.",
  );
}
