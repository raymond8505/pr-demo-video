import { z } from "zod/v4";
import { captureWithInput } from "../proc.js";
import type { CompleteArgs, LlmProvider, LlmMessage } from "./provider.js";
import { resolveClaudeBin } from "./provider.js";

/**
 * Routes LLM calls through the local Claude CLI in headless print mode
 * (`claude -p --output-format json`), using your existing Claude Code login —
 * no ANTHROPIC_API_KEY required. The CLI has no native structured output, so we
 * instruct JSON-only, validate with the same Zod schema, and repair once.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = "claude-cli";

  async complete<T>(args: CompleteArgs<T>): Promise<T> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(args.schema as z.ZodType));
    const messages = [...args.messages];

    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = buildPrompt(args.system, messages, jsonSchema);
      const raw = await this.invoke(prompt);
      const candidate = extractJson(raw);
      const parsed = args.schema.safeParse(candidate);
      if (parsed.success) return parsed.data;

      if (attempt === 1) {
        // Repair turn: show what came back and the validation error, ask for clean JSON.
        messages.push({ role: "assistant", content: raw.slice(0, 4000) });
        messages.push({
          role: "user",
          content: `That was not valid JSON for the required schema (${parsed.error.message.slice(
            0,
            300,
          )}). Return ONLY the JSON object, no prose, no code fences.`,
        });
      } else {
        throw new Error(
          `Claude CLI did not return schema-valid JSON after a repair attempt: ${parsed.error.message.slice(
            0,
            300,
          )}`,
        );
      }
    }
    throw new Error("unreachable");
  }

  private async invoke(prompt: string): Promise<string> {
    const bin = resolveClaudeBin() ?? "claude";
    const quotedBin = bin.includes(" ") ? `"${bin}"` : bin;
    const cliArgs = ["-p", "--output-format", "json"];
    if (process.env.CLAUDE_CLI_MODEL) {
      cliArgs.push("--model", process.env.CLAUDE_CLI_MODEL);
    }

    const { code, stdout, stderr } = await captureWithInput(
      quotedBin,
      cliArgs,
      prompt,
    );
    if (code !== 0) {
      throw new Error(
        `Claude CLI exited ${code}. Is CLAUDE_CLI_PATH correct and logged in?\n${stderr.slice(-500)}`,
      );
    }
    return extractCliResult(stdout);
  }
}

/** Fold system + conversation + the JSON-only instruction into one stdin prompt. */
function buildPrompt(
  system: string,
  messages: LlmMessage[],
  jsonSchema: string,
): string {
  const convo = messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${m.content}`)
    .join("\n\n");
  return `${system}

${convo}

Respond with ONLY a single JSON object that conforms to this JSON Schema. No prose, no explanation, no markdown code fences.

JSON Schema:
${jsonSchema}`;
}

/** `claude --output-format json` wraps the answer in a result envelope. */
function extractCliResult(stdout: string): string {
  try {
    const env = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (env.is_error) {
      throw new Error(`Claude CLI reported an error: ${stdout.slice(0, 300)}`);
    }
    if (typeof env.result === "string") return env.result;
  } catch {
    // Not the envelope — fall back to the raw text.
  }
  return stdout;
}

/** Pull a JSON object out of model text (handles fences / surrounding prose). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  return undefined; // schema.safeParse will fail and trigger a repair
}
