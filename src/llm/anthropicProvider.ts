import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import { requireEnv } from "../env.js";
import type { CompleteArgs, LlmProvider, LlmMessage } from "./provider.js";

const MODEL = "claude-opus-4-8";

/** Native structured output via messages.parse (adaptive thinking, high effort). */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic-sdk";
  private client: Anthropic;

  constructor() {
    requireEnv("ANTHROPIC_API_KEY");
    this.client = new Anthropic();
  }

  async complete<T>(args: CompleteArgs<T>): Promise<T> {
    const res = await this.client.messages.parse({
      model: MODEL,
      max_tokens: args.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      output_config: {
        format: zodOutputFormat(args.schema as z.ZodType),
        effort: "high",
      },
      system: args.system,
      messages: args.messages.map((m: LlmMessage) => ({
        role: m.role,
        content: m.content,
      })),
    });
    const out = res.parsed_output as T | null;
    if (out == null) {
      throw new Error(
        `Anthropic returned no parsed output (stop_reason: ${res.stop_reason}).`,
      );
    }
    return out;
  }
}
