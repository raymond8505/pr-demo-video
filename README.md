# pr-video

Turn a GitHub PR into a short, customer-facing demo video of its user-visible
changes (new features, changed behavior, bug fixes). Proof of concept.

```
PR + preview URL
  → story (Claude reads the PR, writes a release-note "story")
  → Playwright specs (an agent authors one demo per highlight against the live app)
  → clips (run the specs, record one video per highlight)
  → voiceover (ElevenLabs narrates each highlight — Max, an upbeat product evangelist)
  → out.mp4 (Remotion stitches clips + voiceover, synced, with captions + transitions)
```

The core tool is **repo-agnostic**: its initial input is just a PR reference and
a deployed **preview URL**.

## Example

I recently redesigned the timer UI for my recipe viewer app. The below PR URL and preview URL were the only required inputs to produce the video. The agent figured out what the changes were and how to navigate through the app to get into a state where it could demo the changes.

[PR URL](https://github.com/raymond8505/recipe-viewer/pull/2)

[Preview URL](https://new.raymonds.recipes/)

[Video](https://www.youtube.com/watch?v=HxkYaQqAVuk)

## Setup

```bash
yarn install
npx playwright install chromium
cp .env.example .env   # then fill in the keys
```

`.env` keys: `GITHUB_TOKEN` (repo read), `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`.
Optional: `ELEVENLABS_VOICE_ID` / `ELEVENLABS_VOICE_NAME` (defaults to Will),
`FFMPEG_PATH`.

## One-shot

The simplest path — one command, PR + preview URL in, `out.mp4` out, no gates:

```bash
yarn pr-video make https://github.com/owner/name/pull/123 --preview-url https://preview.example.app
#   -> runs/<owner>-<name>-pr<N>/out.mp4
```

`make` chains every stage below in order and skips the review gates (it does not
stop for you to edit `story.json` or inspect the specs). Use the individual
staged commands when you want to inspect or hand-edit a single step.

## Pipeline (CLI, with manual gates)

Every run lives in `runs/<owner>-<name>-pr<N>/`, coordinated by `manifest.json`.

```bash
# 1. Create the run from a PR + a preview URL (the first-class, repo-agnostic input)
yarn pr-video init https://github.com/owner/name/pull/123 --preview-url https://preview.example.app
#    (recipe-viewer only: omit --preview-url and add --auto-resolve to derive it from GitHub Deployments)

# 2. Read the PR, generate the story.   [GATE] review/edit story.json, then re-seed:
yarn pr-video script https://github.com/owner/name/pull/123
yarn pr-video script <pr> --from-story         # re-seed manifest from the edited story.json

# 3. Sanity-check the preview URL loads and isn't behind a login wall
yarn pr-video probe <pr>

# 4. Agent authors one Playwright spec per highlight.   [GATE] review specs + headed run
yarn pr-video author <pr>

# 5. Record one clip per spec, then normalize to CFR mp4 + read durations
yarn pr-video record <pr>
yarn pr-video normalize <pr>

# 6. Narrate each highlight, then render the final video
yarn pr-video voice <pr>
yarn pr-video render <pr>                       # -> runs/<...>/out.mp4
```

`<pr>` accepts a PR URL, `owner/name#123`, or a bare number with `--repo owner/name`.

## How the tricky bits work

- **Deterministic clip mapping** — Playwright writes videos to unstable paths;
  [tests/clipReporter.ts](tests/clipReporter.ts) copies each test's video to
  `clips/<highlightId>.webm`, keyed on the spec filename. Generated specs stay
  vanilla `@playwright/test` (no import of ours) since the agent authors them.
- **Normalize before Remotion** — Playwright records variable-frame-rate VP8
  webm, which breaks Remotion's duration detection and seeking; we convert to CFR
  H.264 mp4 with ffmpeg and read true durations with `@remotion/media-parser`.
- **Timing** — the voiceover duration is the source of truth per scene; a clip
  shorter than the voice freezes on its last frame, a longer clip is truncated by
  the scene length. See [remotion/types.ts](remotion/types.ts).
- **Authoring loop** — generate → run → feed the error + a fresh ARIA snapshot
  back → regenerate, up to 5 attempts; a highlight that never goes green is marked
  `unresolved` and dropped from the video. See [src/pipeline/author.ts](src/pipeline/author.ts).

## Status

Media pipeline (record → clip mapping → normalize → Remotion render) is proven
end-to-end on a hand-authored spec. The AI stages (story, author, voice) are
implemented and typecheck; they need live API keys + a deployed preview to run.
