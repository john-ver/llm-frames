import { extractFrames, getVideoInfo } from "./extract.js";
import { composeGrid, autoLayout } from "./compose.js";
import { buildDescription } from "./describe.js";
import type { ExtractOptions, ExtractResult, GridMetadata } from "./types.js";

export type { ExtractOptions, ExtractResult, VideoFrame, GridMetadata } from "./types.js";
export { autoLayout, toHMS, type GridLayout } from "./compose.js";
export { autoCount } from "./extract.js";

export async function extract(opts: ExtractOptions): Promise<ExtractResult> {
  const mode = opts.mode ?? "uniform";
  const ffmpegPath = opts.ffmpegPath;

  // 1. 영상 정보 조회
  const { duration: fullDuration, videoWidth, videoHeight } = await getVideoInfo(
    opts.input,
    ffmpegPath
  );

  // 2. 최적 레이아웃 자동 계산 (셀 긴 변 384~512, 그리드 ~1500×1500)
  const layout = autoLayout(videoWidth, videoHeight);

  // 3. 프레임 추출 (긴 변 = layout.longSide 기준)
  const { frames } = await extractFrames(
    { ...opts, width: layout.longSide },
    layout.count
  );

  // 4. 그리드 + 설명 생성
  const grid = await composeGrid(frames, layout, ffmpegPath);
  const description = buildDescription(frames, { duration: fullDuration, mode });

  const metadata: GridMetadata = {
    duration: fullDuration,
    videoWidth,
    videoHeight,
    frameCount: frames.length,
    layout: { cols: layout.cols, rows: layout.rows, cellW: layout.cellW, cellH: layout.cellH },
    frames: frames.map((f) => ({
      index: f.index,
      timestamp: f.timestamp,
      isSceneChange: f.isSceneChange ?? false,
    })),
  };

  return { frames, grid, description, metadata, duration: fullDuration, videoWidth, videoHeight };
}
