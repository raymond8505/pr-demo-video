# pr-video — project notes

PoC CLI that turns a GitHub PR into a customer-facing demo video via a staged
pipeline (init → script → probe → author → record → normalize → voice → render),
coordinated by `runs/<owner>-<name>-pr<N>/manifest.json`. The `pr-video` skill
drives it interactively. Narrator persona/voice is fixed (Max / ElevenLabs "Will").

## Testing

- **Vitest only collects `src/**/*.test.ts` and `remotion/**/*.test.ts`**
  ([vitest.config.ts](vitest.config.ts) explicitly `exclude`s `tests/**` so it
  doesn't pick up Playwright specs). Put unit tests under `src/`, NEVER under
  `tests/` — a test placed there silently never runs. (Importing helpers FROM
  `tests/` into an `src/` test is fine, e.g. `../../tests/clipReporter.js`.)
- Imports use explicit `.js` extensions; `verbatimModuleSyntax` is on → use
  `import type` for type-only imports.

## Demo cursor / glide (visible mouse in recordings)

Recorded Playwright video captures only the page — no OS cursor, and `click()`
teleports. [tests/demoCursor.ts](tests/demoCursor.ts) injects a fake cursor +
click ripple (`addInitScript`) and animates the pointer via `glide.*`
(`page.mouse.move(..., {steps})`). Key facts:

- **Injection is import-driven; there is no Playwright config-level
  `addInitScript`.** Specs MUST `import { test, expect, glide } from "./_demo"`.
  A spec that imports `@playwright/test` directly gets NO cursor, silently. The
  author prompt ([src/pipeline/author.ts](src/pipeline/author.ts) `SYSTEM`)
  enforces this — if regenerated specs lose the cursor, check the import first.
- **`_demo.ts` is a copied artifact**, regenerated from `tests/demoCursor.ts` by
  `ensureRunDirs` on init/script/author/record. Never hand-edit
  `<run>/specs/_demo.ts` — edit the source. Resolution relies on run dirs living
  under `runs/` (so `_demo.ts`'s `@playwright/test` import resolves to project
  `node_modules`).
- **`pointer-events: none` on the cursor + ripple is load-bearing** — without it
  the overlay intercepts the hit-test at the click point and actionability fails.
- `glide` only moves on click/fill/hover. Pure-assertion beats show no cursor
  motion; add a `glide.hover` if a beat needs to "point something out".
- Ripple is a ~0.5s animation from `scale(0)`; a screenshot at t≈0 shows nothing
  (wait ~150ms mid-animation to capture it). Sparse frame sampling misses it —
  cursor presence is the reliable verification signal.

## record stage gotcha

`record` ([src/pipeline/record.ts](src/pipeline/record.ts)) calls `ensureRunDirs`
(not just `runPaths`) so the `_demo.ts` fixture is copied/refreshed at record
time. Only init/script/author/record call `ensureRunDirs` — normalize/voice/
render do not. In the normal flow author precedes record, but re-recording a run
authored before a fixture change otherwise fails with `Cannot find module
./_demo`. record is also where the fixture actually matters (it's baked into the
clip), so refreshing it there is correct.

## Verifying clips without a video player

Use ffmpeg to extract frames and Read them as images:
`ffmpeg -y -i clip.webm -ss <t> -frames:v 1 out.png` (per-timestamp; webm is VFR
so prefer `-ss` after `-i` for accuracy). `ffprobe -show_entries format=duration`
for length.

## Playwright invocation

- `PRVIDEO_VIDEO=off` + `PRVIDEO_SLOWMO=0` for fast spec iteration (no recording).
- Passing an absolute spec path as a positional to `npx playwright test` →
  "No tests found" (it's a regex filter; Windows `\`/`:` break it). Pass a bare
  name fragment instead (e.g. `cursor-smoke`).
