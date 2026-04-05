# llm-frames

[![npm](https://img.shields.io/npm/v/llm-frames)](https://www.npmjs.com/package/llm-frames)
[![CI](https://github.com/john-ver/llm-frames/actions/workflows/ci.yml/badge.svg)](https://github.com/john-ver/llm-frames/actions/workflows/ci.yml)

> 비디오 프레임을 그리드 이미지로 추출해 LLM 컨텍스트에 주입합니다.

[English](./README.md) | 한국어

## 이게 뭔가요?

`llm-frames`는 `ffmpeg`를 감싸서 비디오에서 프레임을 추출하고 하나의 그리드 이미지로 합성합니다. 멀티모달 LLM에 비디오 내용을 직접 주입하기 위해 만들어졌습니다.

- **그리드 이미지** (~1500×1500 JPEG) — 이미지 한 장에 모든 프레임, 토큰 최소화
- **XML description** — 프레임 인덱스 + 타임스탬프를 텍스트로 제공
- **자동 레이아웃** — 영상 비율에 맞춰 셀 크기(긴 변 384–512px)와 그리드 형태 자동 계산

## 다른 도구와 뭐가 다른가

기존 도구들은 사람이 보기 위한 시각화나 범용 비디오 처리를 목표로 합니다. LLM 입력 토큰 예산을 고려한 도구는 없었습니다.

| | llm-frames | vcsi | ffmpeg (직접) |
|---|---|---|---|
| **목적** | LLM 컨텍스트 주입 | 사람용 컨택트 시트 | 프레임 추출 |
| **출력** | 그리드 JPEG + XML 타임스탬프 | 컨택트 시트 이미지 | 개별 프레임 파일 |
| **토큰 예산 최적화** | ✅ 이미지 한 장에 전체 | ❌ 크고 사람 중심 | ❌ N개 별도 이미지 |
| **프레임 인덱스 오버레이** | ✅ LLM이 번호로 참조 가능 | ❌ | ❌ |
| **자동 레이아웃** | ✅ 영상 비율에서 자동 계산 | 부분적 | ❌ |
| **타임스탬프 텍스트 페어링** | ✅ 이미지와 XML을 함께 제공 | ❌ | ❌ |
| **런타임** | Node.js + ffmpeg | Python | ffmpeg |

핵심은 **paired output**입니다 — 모델이 볼 수 있는 그리드 이미지 + 참조할 수 있는 타임스탬프 텍스트 블록. 둘 중 하나만으로는 부족합니다.

## 요구사항

- Node.js 18+
- `$PATH`에 `ffmpeg` 4.0+
- 입력 파일 500MB 이하

## 설치

```bash
npm install llm-frames
```

## 사용법

```typescript
import { extract } from "llm-frames";

const result = await extract({ input: "/path/to/video.mp4" });

// result.grid        — JPEG Buffer, 이미지로 주입
// result.description — XML 문자열, 텍스트로 주입
// result.frames      — VideoFrame 배열, 프로그래밍적 활용
// result.metadata    — 레이아웃 + 프레임별 타임스탬프 JS 객체
```

### LLM에 주입하기 (Anthropic 예시)

```typescript
const { grid, description } = await extract({ input: "video.mp4" });

const response = await anthropic.messages.create({
  model: "claude-opus-4-6",
  messages: [{
    role: "user",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: grid.toString("base64") },
      },
      {
        type: "text",
        text: `${description}\n\n이 영상에서 어떤 일이 벌어지는지 설명해줘.`,
      },
    ],
  }],
});
```

XML description 형태:

```xml
<video_frames>
  <meta
    total_duration="1326s"
    frame_count="28"
    sampling="uniform interval=47.4s"
  />
  <frame index="1" timestamp="24s" />
  <frame index="2" timestamp="71s" />
  ...
</video_frames>
```

그리드 이미지의 각 셀 좌상단에 프레임 번호가 표시돼 있어서, LLM이 "3번 프레임에서..." 처럼 인덱스로 참조할 수 있습니다.

## 옵션

```typescript
interface ExtractOptions {
  input: string;           // 입력 비디오 경로

  mode?: "uniform"         // 균등 간격 (기본값)
       | "highlight";      // 장면 변화 기반

  startTime?: number;      // 구간 시작 (초, 기본값: 0)
  endTime?: number;        // 구간 끝   (초, 기본값: 영상 끝)

  width?: number;          // 셀 긴 변 px (기본값: 512)
                           // extract()에서는 무시됨 — 항상 autoLayout()이 덮어씀
                           // extractFrames() 직접 호출 시에만 적용
  quality?: number;        // JPEG 품질 1–31, 낮을수록 좋음 (기본값: 4)
  sceneThreshold?: number; // 장면 감지 감도 0–1 (highlight 전용, 기본값: 0.4)
  ffmpegPath?: string;     // 커스텀 ffmpeg 바이너리 경로
}
```

## 반환값

```typescript
interface ExtractResult {
  frames:      VideoFrame[];   // 원본 프레임
  grid:        Buffer;         // 합성된 그리드 JPEG
  description: string;         // LLM용 XML 텍스트 블록
  metadata:    GridMetadata;   // 구조화 데이터 (레이아웃, 프레임별 타임스탬프)
  duration:    number;         // 영상 총 길이 (초)
  videoWidth:  number;
  videoHeight: number;
}

interface VideoFrame {
  index:         number;
  timestamp:     number;        // 시작 기준 초
  data:          Buffer;        // JPEG 데이터
  mimeType:      "image/jpeg";
  isSceneChange?: boolean;      // highlight 모드 전용
}
```

## 샘플링 모드

### `uniform` (기본값)

균등 간격으로 프레임 추출. 프레임 수는 `autoLayout()`이 영상 해상도를 기준으로 결정 (4–36 프레임, 목표 그리드 ~1500×1500).

### `highlight`

장면 전환 지점에서 프레임 추출하고, 움직임 적은 구간은 균등 채움. 뚜렷한 장면 변화가 있는 영상에 적합.

```typescript
const result = await extract({
  input: "video.mp4",
  mode: "highlight",
  sceneThreshold: 0.3,  // 낮을수록 민감
});
```

## 구간 추출

```typescript
const result = await extract({
  input: "video.mp4",
  startTime: 120,   // 2:00부터
  endTime: 360,     // 6:00까지
});
```

## 유틸리티

```typescript
import { autoLayout, autoCount, toHMS } from "llm-frames";

// 영상 해상도로 그리드 레이아웃 계산
const layout = autoLayout(1920, 1080);
// → { cols: 4, rows: 7, count: 28, cellW: 384, cellH: 216, longSide: 384 }

// 영상 길이에서 적정 프레임 수 계산 (8–32, ~2분당 1프레임)
// 참고: extract()는 autoLayout().count를 사용함 — extractFrames() 직접 호출 시 활용
const count = autoCount(3600); // → 30

// 초 → HH:MM:SS
toHMS(3723); // → "01:02:03"
```

## 라이선스

MIT
