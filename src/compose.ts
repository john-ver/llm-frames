import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { VideoFrame } from "./types.js";

const TARGET_SIZE = 1500;  // 목표 그리드 크기 (가로/세로 각각)
const MIN_LONG = 384;
const MAX_LONG = 512;

export interface GridLayout {
  cols: number;
  rows: number;
  count: number;
  cellW: number;   // 셀 너비 (px)
  cellH: number;   // 셀 높이 (px)
  longSide: number; // 셀 긴 변 (ffmpeg scale 기준)
}

/** 초 → HH:MM:SS */
export function toHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/**
 * 영상 비율 + 목표 그리드 크기 기준으로 최적 레이아웃 자동 계산
 * - 셀 긴 변: 384~512
 * - 그리드 전체: ~1500×1500
 * - 빈 셀 없음 (cols × rows == count)
 */
export function autoLayout(
  videoWidth: number,
  videoHeight: number,
  targetSize = TARGET_SIZE
): GridLayout {
  const isPortrait = videoHeight > videoWidth;
  const ratio = isPortrait ? videoWidth / videoHeight : videoHeight / videoWidth;

  let best: GridLayout | null = null;
  let bestScore = Infinity;

  for (let longSide = MIN_LONG; longSide <= MAX_LONG; longSide++) {
    const shortSide = Math.round(longSide * ratio);
    const cellW = isPortrait ? shortSide : longSide;
    const cellH = isPortrait ? longSide : shortSide;

    const cols = Math.max(1, Math.round(targetSize / cellW));
    const rows = Math.max(1, Math.round(targetSize / cellH));
    const count = cols * rows;

    if (count < 4 || count > 36) continue;

    const gridW = cols * cellW;
    const gridH = rows * cellH;
    const score = Math.abs(gridW - targetSize) + Math.abs(gridH - targetSize);

    if (score < bestScore) {
      bestScore = score;
      best = { cols, rows, count, cellW, cellH, longSide };
    }
  }

  // fallback
  return best ?? { cols: 3, rows: 5, count: 15, cellW: 512, cellH: 288, longSide: 512 };
}

/** ffmpeg로 그리드 이미지 합성 */
export async function composeGrid(
  frames: VideoFrame[],
  layout: GridLayout,
  ffmpegPath = "ffmpeg"
): Promise<Buffer> {
  if (frames.length === 0) throw new Error("프레임이 없어요");

  const { cols, cellW, cellH } = layout;
  const tmpDir = await mkdtemp(join(tmpdir(), "llm-frames-grid-"));

  try {
    // 1. 각 프레임에 frame# 오버레이
    const slottedPaths: string[] = [];

    for (const f of frames) {
      const src = join(tmpDir, `f${f.index}.jpg`);
      const dst = join(tmpDir, `s${f.index}.jpg`);
      await writeFile(src, f.data);

      const frameNum = String(f.index);

      // JPEG MCU 패딩 제거 후 프레임 번호 좌상단 오버레이
      const vf = [
        `crop=${cellW}:${cellH}:0:0`,
        `drawtext=text='${frameNum}':x=4:y=4:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=2`,
      ].join(",");

      await runFfmpeg(["-i", src, "-vf", vf, "-q:v", "4", "-y", dst], ffmpegPath);
      slottedPaths.push(dst);
    }

    // 2. xstack으로 그리드 합성
    const n = slottedPaths.length;
    const inputs = slottedPaths.flatMap((p) => ["-i", p]);
    const layout_str = buildXstackLayout(n, cols);

    const outPath = join(tmpDir, "grid.jpg");
    await runFfmpeg(
      [...inputs, "-filter_complex", `xstack=inputs=${n}:layout=${layout_str}`, "-q:v", "4", "-y", outPath],
      ffmpegPath
    );

    return readFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** xstack layout 문자열 생성 */
function buildXstackLayout(n: number, cols: number): string {
  const positions: string[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col === 0 ? "0" : Array.from({ length: col }, (_, c) => `w${c}`).join("+");
    const y = row === 0 ? "0" : Array.from({ length: row }, (_, r) => `h${r * cols}`).join("+");
    positions.push(`${x}_${y}`);
  }
  return positions.join("|");
}

function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
    proc.on("error", reject);
  });
}
