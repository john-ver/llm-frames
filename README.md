# llm-frames

> Extract video frames as a grid image for LLM context injection.

English | [한국어](./README.ko.md)

## What this is

`llm-frames` wraps `ffmpeg` to extract frames from a video and compose them into a single grid image — purpose-built for feeding video content into multimodal LLMs.

- **Grid image** (~1500×1500 JPEG) — one image, all frames, minimal tokens
- **XML description** — frame indices + timestamps as text for LLM context
- **Auto layout** — cell size (longest side 384–512px) and grid shape calculated from video aspect ratio

## Why llm-frames

Existing tools either target human inspection or general-purpose video processing — not LLM input budgets.

| | llm-frames | vcsi | ffmpeg (raw) |
|---|---|---|---|
| **Purpose** | LLM context injection | Human contact sheet | Frame extraction |
| **Output** | Grid JPEG + XML timestamps | Contact sheet image | Individual frames |
| **Token budget aware** | ✅ one image, all frames | ❌ large human-readable sheet | ❌ N separate images |
| **Frame index overlay** | ✅ LLM can reference by number | ❌ | ❌ |
| **Auto layout** | ✅ from video aspect ratio | partial | ❌ |
| **Timestamp text pairing** | ✅ XML alongside image | ❌ | ❌ |
| **Runtime** | Node.js + ffmpeg | Python | ffmpeg |

The core insight: sending a video to an LLM needs a **paired** output — a grid image the model can see, and a text block with timestamps it can reference. Neither alone is sufficient.

## Requirements

- Node.js 18+
- `ffmpeg` 4.0+ in `$PATH`

## Install

```bash
npm install llm-frames
```

## Usage

```typescript
import { extract } from "llm-frames";

const result = await extract({ input: "/path/to/video.mp4" });

// result.grid        — JPEG Buffer, inject as image
// result.description — XML string, inject as text
// result.frames      — raw VideoFrame[], for programmatic use
// result.metadata    — layout + per-frame timestamps as a JS object
```

### Inject into LLM (Anthropic example)

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
        text: `${description}\n\nDescribe what happens in this video.`,
      },
    ],
  }],
});
```

The XML description looks like:

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

Frame numbers are overlaid on the grid image (top-left of each cell), so the LLM can reference them by index.

## Options

```typescript
interface ExtractOptions {
  input: string;           // path to input video

  mode?: "uniform"         // evenly spaced (default)
       | "highlight";      // scene-change biased

  startTime?: number;      // segment start (seconds, default: 0)
  endTime?: number;        // segment end   (seconds, default: end of video)

  width?: number;          // cell long side in px (default: 512)
                           // ignored by extract() — always overridden by autoLayout()
                           // only applies when calling extractFrames() directly
  quality?: number;        // JPEG quality 1–31, lower = better (default: 4)
  sceneThreshold?: number; // scene detection sensitivity 0–1 (highlight only, default: 0.4)
  ffmpegPath?: string;     // custom ffmpeg binary path
}
```

## Return value

```typescript
interface ExtractResult {
  frames:      VideoFrame[];   // raw frames
  grid:        Buffer;         // composed grid JPEG
  description: string;         // XML text block for LLM
  metadata:    GridMetadata;   // structured data (layout, per-frame timestamps)
  duration:    number;         // total video duration in seconds
  videoWidth:  number;
  videoHeight: number;
}

interface VideoFrame {
  index:         number;
  timestamp:     number;        // seconds from start
  data:          Buffer;        // JPEG
  mimeType:      "image/jpeg";
  isSceneChange?: boolean;      // highlight mode only
}
```

## Sampling modes

### `uniform` (default)

Frames at evenly spaced intervals. Count is determined by `autoLayout()` based on video resolution (4–36 frames, targeting a ~1500×1500 grid).

### `highlight`

Frames at scene transition points, with uniform fill for low-motion segments. Useful for content with distinct scenes.

```typescript
const result = await extract({
  input: "video.mp4",
  mode: "highlight",
  sceneThreshold: 0.3,  // lower = more sensitive
});
```

## Segment extraction

```typescript
const result = await extract({
  input: "video.mp4",
  startTime: 120,   // start at 2:00
  endTime: 360,     // end at 6:00
});
```

## Utilities

```typescript
import { autoLayout, autoCount, toHMS } from "llm-frames";

// compute grid layout for a given video resolution
const layout = autoLayout(1920, 1080);
// → { cols: 4, rows: 7, count: 28, cellW: 384, cellH: 216, longSide: 384 }

// recommended frame count from duration (8–32, ~1 frame per 2 minutes)
// note: extract() uses autoLayout().count instead — use this when calling extractFrames() directly
const count = autoCount(3600); // → 30

// seconds to HH:MM:SS
toHMS(3723); // → "01:02:03"
```

## License

MIT
