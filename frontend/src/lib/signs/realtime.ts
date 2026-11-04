import { predict, type Prediction, type SignModel } from "./knn";
import { UNKNOWN_LABEL, type LandmarkFrame } from "./types";

export interface RealtimeOptions {
  /** How often the rolling window is classified. */
  evalIntervalMs: number;
  /** Consecutive identical accepted predictions needed to recognize. */
  stableCount: number;
  /** Minimum time between two recognitions. */
  cooldownMs: number;
}

export const DEFAULT_REALTIME_OPTIONS: RealtimeOptions = { evalIntervalMs: 150, stableCount: 3, cooldownMs: 1500 };

export interface SignEvent {
  label: string;
  confidence: number;
}

export interface RealtimeStep {
  /** Latest window prediction (null while the window is still filling). */
  prediction: Prediction | null;
  event: SignEvent | null;
}

/**
 * Rolling-window recognizer: keeps the last `windowMs` of landmark frames,
 * classifies periodically, and emits an intent only after it is stable.
 * After a recognition the window is cleared (temporal state reset), and the
 * same intent is not emitted again until UNKNOWN or no hands are observed.
 */
export class RealtimeSignRecognizer {
  private buffer: LandmarkFrame[] = [];
  private lastEval = Number.NEGATIVE_INFINITY;
  private streakLabel: string | null = null;
  private streak = 0;
  private confidences: number[] = [];
  private unknownStreak = 0;
  private lastEmitted: string | null = null;
  private cooldownUntil = Number.NEGATIVE_INFINITY;
  private readonly opts: RealtimeOptions;

  constructor(
    private readonly model: SignModel,
    opts: Partial<RealtimeOptions> = {},
  ) {
    this.opts = { ...DEFAULT_REALTIME_OPTIONS, ...opts };
  }

  reset(): void {
    this.buffer = [];
    this.streakLabel = null;
    this.streak = 0;
    this.confidences = [];
    this.unknownStreak = 0;
    this.lastEmitted = null;
  }

  /** Adds a frame (timestamp on a monotonic clock) and maybe classifies. */
  push(frame: LandmarkFrame): RealtimeStep {
    const now = frame.timestamp_ms;
    const windowMs = this.model.feature.windowMs;
    this.buffer.push(frame);
    while (this.buffer.length && this.buffer[0].timestamp_ms < now - windowMs) this.buffer.shift();

    if (now - this.lastEval < this.opts.evalIntervalMs) return { prediction: null, event: null };
    this.lastEval = now;
    // Wait until the window covers most of the sample duration.
    if (now - this.buffer[0].timestamp_ms < windowMs * 0.8) return { prediction: null, event: null };

    const prediction = predict(this.model, this.buffer);
    if (prediction.label === UNKNOWN_LABEL) {
      this.streakLabel = null;
      this.streak = 0;
      this.confidences = [];
      this.unknownStreak += 1;
      if (this.unknownStreak >= 2 || prediction.reason === "no_hands") this.lastEmitted = null;
      return { prediction, event: null };
    }

    this.unknownStreak = 0;
    if (prediction.label === this.streakLabel) {
      this.streak += 1;
      this.confidences.push(prediction.confidence);
    } else {
      this.streakLabel = prediction.label;
      this.streak = 1;
      this.confidences = [prediction.confidence];
    }

    if (this.streak >= this.opts.stableCount && prediction.label !== this.lastEmitted && now >= this.cooldownUntil) {
      const confidence = this.confidences.reduce((a, b) => a + b, 0) / this.confidences.length;
      this.lastEmitted = prediction.label;
      this.cooldownUntil = now + this.opts.cooldownMs;
      this.buffer = [];
      this.streakLabel = null;
      this.streak = 0;
      this.confidences = [];
      return { prediction, event: { label: prediction.label, confidence } };
    }
    return { prediction, event: null };
  }
}
