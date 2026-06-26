import { promises as fs, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { PrRef } from "../paths.js";
import { runDirFor, runPaths } from "../paths.js";
import { loadEnv, requireEnv } from "../env.js";
import { readManifest, updateHighlight } from "../manifest.js";
import { mediaDurationSec } from "../media.js";

// The narrator. Overridable via ELEVENLABS_VOICE_ID (exact id) or
// ELEVENLABS_VOICE_NAME (resolved by search); defaults to Will (an upbeat,
// young American premade voice that fits the product-evangelist persona).
const DEFAULT_VOICE_NAME = "Will";
const TTS_MODEL = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Generate one voiceover mp3 per highlight narration and record its duration —
 * the voiceover duration is the source of truth for scene length at render time.
 */
export async function run(ref: PrRef, opts: Record<string, unknown>): Promise<void> {
  loadEnv();
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const runDir = runDirFor(ref);
  const p = runPaths(runDir);
  const manifest = await readManifest(runDir);

  const client = new ElevenLabsClient({ apiKey });
  const voiceId = await resolveVoiceId(client, opts.voice as string | undefined);

  const todo = manifest.highlights.filter((h) => h.status !== "unresolved");
  if (todo.length === 0) throw new Error("No highlights to voice.");

  for (const h of todo) {
    const mp3 = path.join(p.audio, `${h.id}.mp3`);
    console.error(`voice ${h.id}: "${h.narration.slice(0, 60)}..."`);
    const audio = await client.textToSpeech.convert(voiceId, {
      text: h.narration,
      modelId: TTS_MODEL,
      outputFormat: OUTPUT_FORMAT,
    });
    // convert() resolves to a web ReadableStream; pipe it to disk.
    await streamPipeline(
      Readable.fromWeb(audio as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(mp3),
    );

    const voDurationSec = await mediaDurationSec(mp3);
    await updateHighlight(runDir, h.id, {
      voPath: mp3,
      voDurationSec,
      status: h.status === "normalized" ? "voiced" : h.status,
    });
    console.error(`  ${h.id}: ${voDurationSec.toFixed(2)}s`);
  }
  console.error(`Voiced ${todo.length} highlight(s) with voice ${voiceId}.`);
}

/**
 * Resolve the narrator voice id: explicit ELEVENLABS_VOICE_ID wins; otherwise
 * search the account/library for the configured name (Will by default).
 */
async function resolveVoiceId(
  client: ElevenLabsClient,
  override?: string,
): Promise<string> {
  // --voice wins (a stand-in voice), then ELEVENLABS_VOICE_ID, then search by name.
  if (override) return override;
  const explicit = process.env.ELEVENLABS_VOICE_ID;
  if (explicit) return explicit;

  const name = process.env.ELEVENLABS_VOICE_NAME || DEFAULT_VOICE_NAME;
  const res = await client.voices.search({ search: name, pageSize: 10 });
  const match =
    res.voices.find((v) => v.name?.toLowerCase() === name.toLowerCase()) ??
    res.voices[0];
  if (!match?.voiceId) {
    throw new Error(
      `Could not find an ElevenLabs voice named "${name}". Set ELEVENLABS_VOICE_ID to its id directly.`,
    );
  }
  console.error(`Narrator: ${match.name} (${match.voiceId})`);
  return match.voiceId;
}
