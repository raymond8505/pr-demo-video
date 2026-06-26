import type { PrRef } from "../paths.js";

/**
 * A preview-URL resolution result. The generic pipeline only ever consumes a
 * `url`; deriving that url for a given repo is the resolver's job, kept separate
 * so each repo's deploy mechanism (Vercel, Netlify, a custom VPS, ...) plugs in
 * without touching the pipeline.
 */
export type ResolveResult =
  | { state: "ready"; url: string }
  | { state: "pending"; detail: string }
  | { state: "none"; detail: string };

export interface PreviewResolver {
  readonly name: string;
  /** True if this resolver knows how to handle the given repo. */
  matches(ref: PrRef): boolean;
  resolve(ref: PrRef): Promise<ResolveResult>;
}
