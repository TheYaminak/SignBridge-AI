import type {
  GestureRecognizer,
  GestureRecognizerOptions,
  GestureRecognizerResult,
} from "@mediapipe/tasks-vision";

import type { FrameObservation } from "./types";

/** Self-hosted assets (see scripts/copy-mediapipe-wasm.mjs and public/models). */
export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
export const GESTURE_MODEL_PATH = "/models/gesture_recognizer.task";

export type Delegate = "GPU" | "CPU";

export interface Connection {
  start: number;
  end: number;
}

/** Landmark extraction stage: MediaPipe Gesture Recognizer in VIDEO mode. */
export interface HandTracker {
  readonly delegate: Delegate;
  readonly connections: Connection[];
  /** timestampMs must increase monotonically between calls. */
  detect(video: HTMLVideoElement, timestampMs: number): FrameObservation;
  close(): void;
}

function toFrame(result: GestureRecognizerResult, timestampMs: number): FrameObservation {
  return {
    timestampMs,
    hands: result.landmarks.map((landmarks, i) => {
      const gesture = result.gestures[i]?.[0];
      return {
        landmarks,
        handedness: result.handedness[i]?.[0]?.categoryName ?? "",
        gesture: gesture ? { label: gesture.categoryName, score: gesture.score } : null,
      };
    }),
  };
}

// MediaPipe's WASM runtime writes routine INFO/warning lines to console.error,
// which Next.js dev shows as errors. Downgrade only those lines while a
// tracker is alive.
const NOISE = /^(INFO:|W\d{4} |I\d{4} |Graph successfully started)/;
let consolePatches = 0;
let originalConsoleError: typeof console.error | null = null;

function quietMediaPipeLogs(): () => void {
  if (consolePatches++ === 0) {
    originalConsoleError = console.error;
    const original = originalConsoleError;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && NOISE.test(args[0])) {
        console.debug(...args);
        return;
      }
      original.apply(console, args);
    };
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (--consolePatches === 0 && originalConsoleError) {
      console.error = originalConsoleError;
      originalConsoleError = null;
    }
  };
}

/**
 * Loads the gesture recognizer. Tries the GPU delegate first and falls back
 * to CPU if GPU initialization fails. All processing stays in the browser.
 */
export async function createHandTracker({
  preferGpu = true,
}: { preferGpu?: boolean } = {}): Promise<HandTracker> {
  const restoreConsole = quietMediaPipeLogs();
  try {
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const wasmBase = new URL(MEDIAPIPE_WASM_PATH, window.location.origin).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase, false);

    const options = (delegate: Delegate): GestureRecognizerOptions => ({
      baseOptions: { modelAssetPath: GESTURE_MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    let recognizer: GestureRecognizer;
    let delegate: Delegate = preferGpu ? "GPU" : "CPU";
    try {
      recognizer = await GestureRecognizer.createFromOptions(fileset, options(delegate));
    } catch (err) {
      if (delegate === "CPU") throw err;
      console.warn("MediaPipe GPU delegate unavailable, falling back to CPU.", err);
      delegate = "CPU";
      recognizer = await GestureRecognizer.createFromOptions(fileset, options(delegate));
    }

    return {
      delegate,
      connections: GestureRecognizer.HAND_CONNECTIONS,
      detect(video, timestampMs) {
        return toFrame(recognizer.recognizeForVideo(video, timestampMs), timestampMs);
      },
      close() {
        recognizer.close();
        restoreConsole();
      },
    };
  } catch (err) {
    restoreConsole();
    throw err;
  }
}
