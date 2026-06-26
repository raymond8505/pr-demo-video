import { AbsoluteFill } from "remotion";
import {
  TransitionSeries,
  linearTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene } from "./Scene.js";
import {
  type DemoVideoProps,
  sceneFrames,
  TRANSITION_FRAMES,
} from "./types.js";

/**
 * Sequences each highlight as a scene with a crossfade between them. Scene
 * length comes from sceneFrames() (voice-driven), matching what calculateMetadata
 * uses for the total, so the timeline stays consistent.
 */
export const DemoVideo: React.FC<DemoVideoProps> = ({ scenes }) => {
  if (scenes.length === 0) {
    return <AbsoluteFill style={{ backgroundColor: "#0b0b0f" }} />;
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0f" }}>
      <TransitionSeries>
        {scenes.flatMap((scene, i) => {
          const seq = (
            <TransitionSeries.Sequence
              key={scene.id}
              durationInFrames={sceneFrames(scene)}
            >
              <Scene scene={scene} />
            </TransitionSeries.Sequence>
          );
          if (i === 0) return [seq];
          const transition = (
            <TransitionSeries.Transition
              key={`t-${scene.id}`}
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          );
          return [transition, seq];
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
