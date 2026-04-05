import { spawn } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ExtractOptions, VideoFrame } from "./types.js";

const DEFAULTS = {
  mode: "uniform" as const,
  width: 512,
  quality: 4,
  sceneThreshold: 0.4,
  ffmpegPath: "ffmpeg",
};

/** 영상 길이(초) → 적정 프레임 수 (2분 간격 기준, 8~32 범위) */
export function autoCount(durationSec: number): number {
  const target = Math.round(durationSec / 120);
  return Math.max(8, Math.min(32, target));
}

/** ffmpeg를 실행하고 stdout/stderr를 반환 */
function runFfmpeg(
  args: string[],
  ffmpegPath: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const relevant = stderr
          .split("\n")
          .filter((l) => /error|invalid|failed|cannot|no such/i.test(l))
          .slice(0, 5)
          .join("\n");
        reject(new Error(`ffmpeg exited with code ${code}\n${relevant || "(no error detail)"}`));
      }
    });
    proc.on("error", reject);
  });
}

export interface VideoInfo {
  duration: number;
  /** 원본 영상 너비 */
  videoWidth: number;
  /** 원본 영상 높이 */
  videoHeight: number;
}

/** 영상 길이 + 해상도 조회 */
export async function getVideoInfo(
  input: string,
  ffmpegPath = DEFAULTS.ffmpegPath
): Promise<VideoInfo> {
  const proc = spawn(ffmpegPath, ["-i", input]);
  return new Promise((resolve, reject) => {
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      const mDur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!mDur) reject(new Error("영상 길이를 파싱할 수 없어요"));
      const duration = +mDur![1] * 3600 + +mDur![2] * 60 + +mDur![3];

      const mSize = stderr.match(/Stream.*Video.*?,\s(\d{2,5})x(\d{2,5})[\s,[]/);
      const videoWidth = mSize ? +mSize[1] : 1920;
      const videoHeight = mSize ? +mSize[2] : 1080;

      resolve({ duration, videoWidth, videoHeight });
    });
    proc.on("error", reject);
  });
}

/** uniform 모드: 균등 간격으로 타임스탬프 계산 */
function uniformTimestamps(duration: number, count: number): number[] {
  const interval = duration / count;
  return Array.from({ length: count }, (_, i) =>
    Math.min(+(interval * (i + 0.5)).toFixed(3), duration - 0.001)
  );
}

/** highlight 모드: scene detection으로 전환점 타임스탬프 추출 */
async function detectSceneTimestamps(
  input: string,
  threshold: number,
  ffmpegPath: string
): Promise<number[]> {
  const { stderr } = await runFfmpeg(
    [
      "-i", input,
      "-vf", `select='gt(scene,${threshold})',showinfo`,
      "-vsync", "vfr",
      "-f", "null",
      "-",
    ],
    ffmpegPath
  ).catch(() => ({ stderr: "" }));

  const timestamps: number[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) timestamps.push(parseFloat(m[1]));
  }
  return timestamps;
}

/** highlight 모드: scene 전환점 + uniform 채움으로 최종 타임스탬프 선정 */
async function highlightTimestamps(
  input: string,
  duration: number,
  count: number,
  threshold: number,
  ffmpegPath: string
): Promise<{ timestamps: number[]; sceneCuts: Set<number> }> {
  const cuts = await detectSceneTimestamps(input, threshold, ffmpegPath);

  // count 초과 시 간격이 넓은 것 우선 선택
  const selected =
    cuts.length <= count
      ? cuts
      : cuts
          .map((t, i) => ({ t, gap: t - (cuts[i - 1] ?? 0) }))
          .sort((a, b) => b.gap - a.gap)
          .slice(0, count)
          .map((x) => x.t)
          .sort((a, b) => a - b);

  // 부족한 슬롯은 uniform으로 채움
  const fill = count - selected.length;
  if (fill > 0) {
    const uniform = uniformTimestamps(duration, fill + 2).slice(1, -1);
    for (const t of uniform) {
      if (!selected.some((s) => Math.abs(s - t) < 1)) selected.push(t);
    }
    selected.sort((a, b) => a - b);
  }

  const final = selected.slice(0, count);
  return { timestamps: final, sceneCuts: new Set(cuts) };
}

/** 특정 타임스탬프에서 프레임 1장 추출 → Buffer */
async function extractOneFrame(
  input: string,
  timestamp: number,
  width: number,
  quality: number,
  tmpDir: string,
  index: number,
  ffmpegPath: string
): Promise<Buffer> {
  const outPath = join(tmpDir, `frame_${String(index).padStart(4, "0")}.jpg`);
  await runFfmpeg(
    [
      "-ss", String(timestamp),
      "-i", input,
      "-vframes", "1",
      "-vf", `scale='if(gt(iw,ih),${width},-2)':'if(gt(ih,iw),${width},-2)',setsar=1`,
      "-q:v", String(quality),
      "-y",
      outPath,
    ],
    ffmpegPath
  );
  return readFile(outPath);
}

/** 메인 추출 함수 */
export async function extractFrames(
  opts: ExtractOptions,
  count: number
): Promise<{ frames: VideoFrame[]; duration: number; videoWidth: number; videoHeight: number }> {
  const {
    input,
    mode = DEFAULTS.mode,
    width = DEFAULTS.width,
    quality = DEFAULTS.quality,
    sceneThreshold = DEFAULTS.sceneThreshold,
    ffmpegPath = DEFAULTS.ffmpegPath,
  } = opts;

  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error(`Invalid count: expected integer 1–200, got ${JSON.stringify(count)}`);
  }
  if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 4096) {
    throw new Error(`Invalid width: expected integer 1–4096, got ${JSON.stringify(width)}`);
  }
  if (typeof quality !== "number" || !Number.isInteger(quality) || quality < 1 || quality > 31) {
    throw new Error(`Invalid quality: expected integer 1–31, got ${JSON.stringify(quality)}`);
  }
  if (typeof sceneThreshold !== "number" || !isFinite(sceneThreshold) || sceneThreshold < 0 || sceneThreshold > 1) {
    throw new Error(`Invalid sceneThreshold: expected number 0–1, got ${JSON.stringify(sceneThreshold)}`);
  }

  const { duration: fullDuration, videoWidth, videoHeight } = await getVideoInfo(input, ffmpegPath);
  const start = opts.startTime ?? 0;
  const end = opts.endTime ?? fullDuration;
  const duration = end - start;
  const tmpDir = await mkdtemp(join(tmpdir(), "llm-frames-"));

  try {
    let timestamps: number[];
    let sceneCuts = new Set<number>();

    if (mode === "highlight") {
      const result = await highlightTimestamps(
        input,
        duration,
        count,
        sceneThreshold,
        ffmpegPath
      );
      // start offset 적용
      timestamps = result.timestamps.map((t) => t + start);
      sceneCuts = new Set([...result.sceneCuts].map((t) => t + start));
    } else {
      timestamps = uniformTimestamps(duration, count).map((t) => t + start);
    }

    const frames: VideoFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const data = await extractOneFrame(
        input,
        timestamps[i],
        width,
        quality,
        tmpDir,
        i + 1,
        ffmpegPath
      );
      frames.push({
        index: i + 1,
        timestamp: timestamps[i],
        data,
        mimeType: "image/jpeg" as const,
        isSceneChange: sceneCuts.has(timestamps[i]),
      });
    }

    return { frames, duration, videoWidth, videoHeight };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
