export type SamplingMode = "uniform" | "highlight";

export interface ExtractOptions {
  /** 입력 비디오 경로 */
  input: string;

  /** 샘플링 방식 (기본값: "uniform") */
  mode?: SamplingMode;

  /** 분석 시작 시간 (초, 기본값: 0) */
  startTime?: number;

  /** 분석 종료 시간 (초, 기본값: 영상 끝) */
  endTime?: number;

  /** 프레임 너비 px — 높이는 비율 유지 (기본값: 512) */
  width?: number;

  /** JPEG 품질 1–31, 낮을수록 고품질 (기본값: 4) */
  quality?: number;

  /** 장면 전환 감도 0–1 (highlight 모드 전용, 기본값: 0.4) */
  sceneThreshold?: number;

  /** 커스텀 ffmpeg 바이너리 경로 (기본값: "ffmpeg") */
  ffmpegPath?: string;
}

export interface VideoFrame {
  /** 시퀀스 내 1-based 인덱스 */
  index: number;

  /** 원본 영상 기준 타임스탬프 (초) */
  timestamp: number;

  /** JPEG 이미지 데이터 */
  data: Buffer;

  mimeType: "image/jpeg";

  /** highlight 모드에서 장면 전환 프레임 여부 */
  isSceneChange?: boolean;
}

export interface GridMetadata {
  duration: number;
  videoWidth: number;
  videoHeight: number;
  frameCount: number;
  layout: { cols: number; rows: number; cellW: number; cellH: number };
  frames: { index: number; timestamp: number; isSceneChange: boolean }[];
}

export interface ExtractResult {
  /** 원시 프레임 배열 — 직접 필터링/처리 시 활용 */
  frames: VideoFrame[];

  /** 번호 오버레이 포함 그리드 이미지 (JPEG Buffer) */
  grid: Buffer;

  /** LLM에 주입할 XML 텍스트 설명 블록 */
  description: string;

  /** 구조화 메타데이터 (JSON 직렬화 가능) */
  metadata: GridMetadata;

  /** 원본 영상 총 길이 (초) */
  duration: number;

  /** 원본 영상 너비 */
  videoWidth: number;

  /** 원본 영상 높이 */
  videoHeight: number;
}
