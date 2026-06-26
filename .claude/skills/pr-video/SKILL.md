---
name: pr-video
description: This skill should be used when the user wants to turn a GitHub PR into a demo video with this repo's pipeline — phrases like "make a demo video for PR <n>", "run the pr-video pipeline", "build the video for this PR", "flesh out the narration", or "debug the demo specs". Drives the staged CLI interactively so the human never touches the command line: it runs each stage, collaborates on the narration script, and hand-debugs failing Playwright specs.
version: 1.0.0
---

# pr-video — agent-driven demo-video pipeline

Turn a GitHub PR into a customer-facing demo video by driving the staged CLI
([src/cli.ts](../../../src/cli.ts)) **one stage at a time**, with you (the agent)
doing the judgment work at each gate so the user never has to run commands or edit
JSON. Use the staged commands below — **not** `pr-video make` (that's the no-gate
one-shot; this skill *is* the gated path, done for the user).

## Ground rules

- **Narrator persona and voice are fixed:** "Max", an upbeat product evangelist, voiced
  by ElevenLabs "Will". Do not change them unless the user explicitly asks. See the
  `narrator-voice` memory and [src/pipeline/story.ts](../../../src/pipeline/story.ts)
  (`NARRATOR_SYSTEM`) / [src/pipeline/voice.ts](../../../src/pipeline/voice.ts).
- **A run lives in `runs/<owner>-<name>-pr<N>/`**, coordinated by `manifest.json`.
  Stages communicate through it; read it between stages to see each highlight's
  `status` and decide what to do next.
- **`<pr>`** accepts a URL, `owner/name#123`, or a bare number with `--repo owner/name`.
- Commands are `yarn pr-video <stage> <pr> [opts]`. Show the user a short summary after
  each stage; don't make them read raw CLI output.

## Two gotchas that will bite you (learned the hard way)

1. **Stale artifacts mask failures.** `record` builds the video from whatever `.spec.ts`
   files and `<id>.webm` clips happen to be in the run dir — including leftovers from a
   previous run. A highlight `author` marked `unresolved` can get silently resurrected to
   `recorded` by an old clip. **Before a fresh build, clear `specs/`, `clips/`,
   `audio/`, and `test-results/` in the run dir** (keep `manifest.json` / `story.json`).
2. **Spec filename must equal the highlight id.** Clip→highlight mapping is by filename:
   `specs/<highlightId>.spec.ts` → `clips/<highlightId>.webm`. A spec named anything else
   records a clip that maps to nothing and is dropped. Highlight ids are in `manifest.json`.

## Workflow

### 0. Set up the run (preview URL)

The pipeline drives a browser against the app's **deployed preview URL**. Ask the user
for it if unknown (recipe-viewer can sometimes auto-derive it; most PRs need it given).

```
yarn pr-video init <pr> --preview-url <url>
# recipe-viewer only: omit --preview-url and add --auto-resolve to try GitHub Deployments
```

### 1. Script — generate, then flesh out the narration *with the user*

```
yarn pr-video script <pr>          # Stage 1 extracts facts; Stage 2 writes Max's narration
```

Then open `runs/<...>/story.json`. For each highlight:
- **Check the facts** (`plainSummary`) against the actual PR — fetch the diff if unsure;
  the extractor can over- or under-claim.
- **Refine the narration** (`narration`) in Max's voice: upbeat product evangelist,
  ~2–3 sentences, ~28 words (≈11s spoken), present tense, no code/filenames/emoji.
  Edit `story.json` directly based on the user's feedback. This is the main collaboration
  point — surface each narration line and iterate until the user is happy.

Re-seed the manifest from your edits (no LLM call):

```
yarn pr-video script <pr> --from-story
```

### 2. Probe — confirm the app + capture the selector map

```
yarn pr-video probe <pr>
```

This prints an **ARIA snapshot** of the landing page — the source of truth for accessible
selectors (the app has no data-testids). Keep it; you'll need it to debug specs. If the
page is behind a login wall, stop and tell the user.

### 3. Author — auto-attempt, then hand-debug the failures

```
yarn pr-video author <pr>          # LLM loop: generate → run → retry, up to 5 attempts/highlight
```

Read `manifest.json`. Any highlight with `status: "unresolved"` failed the auto-loop —
**this is where you take over.** For each unresolved highlight:

1. Read its generated spec: `runs/<...>/specs/<id>.spec.ts`.
2. Read the failure snapshot: the newest `runs/<...>/test-results/*/error-context.md`
   (an ARIA snapshot **at the point of failure** — deep in the app, where the landing-page
   snapshot can't help). Also re-read the highlight's `demoIntent`.
3. Hand-fix the selectors/flow using **accessible selectors only** (`getByRole`,
   `getByText`, `getByPlaceholder`, `getByLabel`), preferring `.first()` to avoid
   strict-mode violations. Keep `await expect(...).toBeVisible()` + `await
   page.waitForTimeout(800)` after each transition so the recording reads well. Keep the
   filename `<id>.spec.ts`.
4. Iterate fast against the live app (video off, no slow-mo). On Windows PowerShell:

   ```powershell
   $env:PRVIDEO_RUN_DIR="C:\projects\pr-video\runs\<owner>-<name>-pr<N>"
   $env:PRVIDEO_PREVIEW_URL="<url>"; $env:PRVIDEO_VIDEO="off"
   npx playwright test "$env:PRVIDEO_RUN_DIR\specs\<id>.spec.ts" --config playwright.config.ts
   ```

   Add `--headed` to watch it run. The spec uses the configured `baseURL`, so navigate
   with `page.goto("/")` and relative paths — never hardcode the host.
5. Repeat until the spec exits 0. You don't need to edit the manifest `status` by hand —
   the `record` stage reconciles status from the clips that actually land.

If a highlight genuinely can't be demonstrated (the change isn't visible in the UI), tell
the user and leave it unresolved — a smaller video beats a broken one.

### 4. Record + normalize

```
yarn pr-video record <pr>          # runs the spec suite, maps clips by filename
yarn pr-video normalize <pr>       # webm → CFR mp4 + true durations (Remotion needs this)
```

Confirm in `manifest.json` that every highlight you intend to ship reached
`status: "recorded"` then `"normalized"` and has a clip in `clips/`.

### 5. Voice + render

```
yarn pr-video voice <pr>           # ElevenLabs TTS per narration (Max / "Will")
yarn pr-video render <pr>          # Remotion → runs/<...>/out.mp4
```

`voice` throws **"No highlights to voice"** if nothing was recorded — that means author +
your debugging produced zero usable specs; go back to step 3, don't paper over it.

Finish by pointing the user at `runs/<...>/out.mp4` and offering to play it.

## Stage reference

| Stage | Command | Reads | Produces |
|---|---|---|---|
| init | `init <pr> --preview-url <url>` | — | manifest (previewUrl) |
| script | `script <pr>` / `script <pr> --from-story` | PR / edited story.json | story.json, seeded highlights |
| probe | `probe <pr>` | previewUrl | ARIA snapshot (stdout) |
| author | `author <pr>` | highlights, live app | specs/*.spec.ts, status authored/unresolved |
| record | `record <pr>` | specs | clips/*.webm, status recorded |
| normalize | `normalize <pr>` | clips | clips/*.mp4, durations |
| voice | `voice <pr>` | narration | audio/*.mp3, status voiced |
| render | `render <pr>` | clips + audio | out.mp4 |

Key source: [src/cli.ts](../../../src/cli.ts),
[src/pipeline/](../../../src/pipeline/), [playwright.config.ts](../../../playwright.config.ts),
[tests/clipReporter.ts](../../../tests/clipReporter.ts).
