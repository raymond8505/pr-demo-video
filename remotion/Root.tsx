import { Composition } from "remotion";
import { DemoVideo } from "./DemoVideo.js";
import {
  type DemoVideoProps,
  FPS,
  WIDTH,
  HEIGHT,
  totalFrames,
} from "./types.js";

const DEFAULT_PROPS: DemoVideoProps = { scenes: [] };

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="demo"
      component={DemoVideo}
      durationInFrames={1}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={DEFAULT_PROPS}
      // Timing is a pure function of props (the scene plan the render stage
      // passes as inputProps), so this is identical in Studio and at render.
      calculateMetadata={({ props }) => {
        const scenes = (props as DemoVideoProps).scenes ?? [];
        return { durationInFrames: totalFrames(scenes) };
      }}
    />
  );
};
