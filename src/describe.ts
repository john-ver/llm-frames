import type { VideoFrame } from "./types.js";

export interface DescribeOptions {
  duration: number;
  mode: "uniform" | "highlight";
}

/** LLM에 주입할 XML 텍스트 설명 블록 생성 */
export function buildDescription(
  frames: VideoFrame[],
  opts: DescribeOptions
): string {
  const { duration, mode } = opts;
  const interval =
    mode === "uniform" && frames.length > 1
      ? `${(duration / frames.length).toFixed(1)}s`
      : "scene-based";

  const preamble = [
    `<video_frames>`,
    `  <meta`,
    `    total_duration="${Math.round(duration)}s"`,
    `    frame_count="${frames.length}"`,
    `    sampling="${mode === "uniform" ? `uniform interval=${interval}` : `highlight threshold-based`}"`,
    `  />`,
  ].join("\n");

  const frameLines = frames
    .map((f) => {
      const attrs = [
        `index="${f.index}"`,
        `timestamp="${Math.round(f.timestamp)}s"`,
        f.isSceneChange ? `type="scene_change"` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `  <frame ${attrs} />`;
    })
    .join("\n");

  return `${preamble}\n${frameLines}\n</video_frames>`;
}
