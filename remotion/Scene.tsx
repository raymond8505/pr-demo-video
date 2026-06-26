import { AbsoluteFill, OffthreadVideo, Audio, staticFile } from "remotion";
import type { SceneInput } from "./types.js";

const TYPE_LABEL: Record<SceneInput["type"], string> = {
  feature: "NEW",
  change: "IMPROVED",
  fix: "FIXED",
};

const TYPE_COLOR: Record<SceneInput["type"], string> = {
  feature: "#16a34a",
  change: "#2563eb",
  fix: "#9333ea",
};

/**
 * One highlight: the demo clip fills the frame; the voiceover plays over it; a
 * lower-third caption shows the title + change type. The enclosing Sequence
 * (in DemoVideo) sets the scene length, so a clip shorter than the voice freezes
 * on its last frame and a longer clip is truncated — no per-clip trimming here.
 */
export const Scene: React.FC<{ scene: SceneInput }> = ({ scene }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0f" }}>
      <OffthreadVideo src={staticFile(scene.clipSrc)} muted />
      {scene.voSrc ? <Audio src={staticFile(scene.voSrc)} /> : null}

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          padding: 48,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            alignSelf: "flex-start",
            maxWidth: "80%",
            background: "rgba(11,11,15,0.78)",
            borderRadius: 14,
            padding: "16px 22px",
            backdropFilter: "blur(6px)",
          }}
        >
          <span
            style={{
              fontFamily: "Arial, sans-serif",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: 1,
              color: "#fff",
              background: TYPE_COLOR[scene.type],
              borderRadius: 8,
              padding: "6px 12px",
            }}
          >
            {TYPE_LABEL[scene.type]}
          </span>
          <span
            style={{
              fontFamily: "Arial, sans-serif",
              fontWeight: 700,
              fontSize: 34,
              color: "#fff",
            }}
          >
            {scene.title}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
