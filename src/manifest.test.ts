import { describe, it, expect } from "vitest";
import { ManifestSchema, highlightNarration, type Beat } from "./manifest.js";

function beat(over: Partial<Beat> = {}): Beat {
  return { key: "b1", action: "do a thing", narration: "Watch this.", ...over };
}

describe("highlightNarration", () => {
  it("joins beat lines in order, trimmed", () => {
    const h = { beats: [beat({ narration: " First. " }), beat({ narration: "Second." })] };
    expect(highlightNarration(h)).toBe("First. Second.");
  });

  it("is the single line for a one-beat highlight", () => {
    expect(highlightNarration({ beats: [beat({ narration: "Only." })] })).toBe("Only.");
  });
});

describe("ManifestSchema", () => {
  it("round-trips a highlight with voiced, marked beats", () => {
    const parsed = ManifestSchema.parse({
      repo: "owner/name",
      prNumber: 2,
      createdAt: "2026-06-26T00:00:00.000Z",
      highlights: [
        {
          id: "redesigned-timer",
          type: "change",
          title: "Redesigned timer",
          demoIntent: "open cook mode and start a timer",
          status: "voiced",
          beats: [
            { key: "b1", action: "open recipe", narration: "Open it." },
            {
              key: "b2",
              action: "start timer",
              narration: "Start the timer.",
              voPath: "audio/redesigned-timer/b2.mp3",
              voDurationSec: 3.2,
              markerSec: 5.1,
              voOffsetSec: -0.2,
            },
          ],
        },
      ],
    });
    const h = parsed.highlights[0]!;
    expect(h.beats).toHaveLength(2);
    expect(h.beats[1]!.markerSec).toBe(5.1);
    expect(h.beats[1]!.voOffsetSec).toBe(-0.2);
    expect(h.status).toBe("voiced");
  });

  it("defaults status to pending and beats to no top-level narration", () => {
    const parsed = ManifestSchema.parse({
      repo: "o/n",
      prNumber: 1,
      createdAt: "2026-06-26",
      highlights: [
        { id: "h", type: "fix", title: "T", demoIntent: "d", beats: [beat()] },
      ],
    });
    expect(parsed.highlights[0]!.status).toBe("pending");
  });

  it("rejects a highlight with zero beats", () => {
    expect(() =>
      ManifestSchema.parse({
        repo: "o/n",
        prNumber: 1,
        createdAt: "x",
        highlights: [{ id: "h", type: "fix", title: "T", demoIntent: "d", beats: [] }],
      }),
    ).toThrow();
  });

  it("rejects a non-kebab beat key", () => {
    expect(() =>
      ManifestSchema.parse({
        repo: "o/n",
        prNumber: 1,
        createdAt: "x",
        highlights: [
          {
            id: "h",
            type: "fix",
            title: "T",
            demoIntent: "d",
            beats: [{ key: "B_1", action: "a", narration: "n" }],
          },
        ],
      }),
    ).toThrow();
  });
});
