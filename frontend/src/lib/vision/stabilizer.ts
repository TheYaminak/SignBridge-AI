import type { Classification, StableRecognition } from "./types";

export interface StabilizerConfig {
  /** Per-frame predictions below this confidence count as "no gesture". */
  minConfidence: number;
  /** Number of recent frames considered. */
  windowSize: number;
  /** Fraction of the window that must agree on one label (0..1). */
  minAgreement: number;
  /** Minimum time between two emitted recognitions, in ms. */
  cooldownMs: number;
  /** Consecutive frames without hands before the state resets. */
  resetAfterEmptyFrames: number;
}

export const DEFAULT_STABILIZER_CONFIG: StabilizerConfig = {
  minConfidence: 0.8,
  windowSize: 10,
  minAgreement: 0.7,
  cooldownMs: 1200,
  resetAfterEmptyFrames: 8,
};

export interface StabilizerInput {
  timestampMs: number;
  handsPresent: boolean;
  classification: Classification | null;
}

export interface StabilizerOutput {
  /** Set only on the frame where a new recognition is confirmed. */
  event: StableRecognition | null;
  /** The label currently winning the window, if any (for UI feedback). */
  candidate: { label: string; agreement: number } | null;
}

interface WindowEntry {
  label: string | null;
  confidence: number;
}

/**
 * Turns noisy per-frame predictions into discrete recognitions:
 * - temporal smoothing: a label must win `minAgreement` of the last `windowSize` frames
 * - duplicate suppression: the same label is not emitted twice in a row until
 *   the hand relaxes (window dominated by "no gesture") or hands leave
 * - cooldown: at most one recognition per `cooldownMs`
 * - reset: after `resetAfterEmptyFrames` frames without hands
 */
export class GestureStabilizer {
  private readonly config: StabilizerConfig;
  private window: WindowEntry[] = [];
  private emptyFrames = 0;
  private lastLabel: string | null = null;
  private lastEmitMs = Number.NEGATIVE_INFINITY;

  constructor(config: Partial<StabilizerConfig> = {}) {
    this.config = { ...DEFAULT_STABILIZER_CONFIG, ...config };
  }

  reset(): void {
    this.window = [];
    this.emptyFrames = 0;
    this.lastLabel = null;
  }

  push({ timestampMs, handsPresent, classification }: StabilizerInput): StabilizerOutput {
    const none: StabilizerOutput = { event: null, candidate: null };

    if (!handsPresent) {
      this.emptyFrames += 1;
      if (this.emptyFrames >= this.config.resetAfterEmptyFrames) this.reset();
      return none;
    }
    this.emptyFrames = 0;

    const accepted =
      classification && classification.confidence >= this.config.minConfidence
        ? classification
        : null;
    this.window.push({
      label: accepted?.label ?? null,
      confidence: accepted?.confidence ?? 0,
    });
    if (this.window.length > this.config.windowSize) this.window.shift();

    const { label, count, totalConfidence } = this.majority();
    const agreement = count / this.config.windowSize;
    const candidate = label === null ? null : { label, agreement };

    if (this.window.length < this.config.windowSize || agreement < this.config.minAgreement) {
      return { event: null, candidate };
    }

    if (label === null) {
      // Hand relaxed: allow the previous gesture to be recognized again.
      this.lastLabel = null;
      return { event: null, candidate: null };
    }
    if (label === this.lastLabel) return { event: null, candidate };
    if (timestampMs - this.lastEmitMs < this.config.cooldownMs) return { event: null, candidate };

    this.lastLabel = label;
    this.lastEmitMs = timestampMs;
    return {
      event: {
        label,
        confidence: totalConfidence / count,
        kind: accepted?.kind ?? "gesture",
        timestampMs,
      },
      candidate,
    };
  }

  private majority(): { label: string | null; count: number; totalConfidence: number } {
    const tally = new Map<string | null, { count: number; total: number }>();
    for (const e of this.window) {
      const t = tally.get(e.label) ?? { count: 0, total: 0 };
      t.count += 1;
      t.total += e.confidence;
      tally.set(e.label, t);
    }
    let best: { label: string | null; count: number; totalConfidence: number } = {
      label: null,
      count: 0,
      totalConfidence: 0,
    };
    for (const [label, t] of tally) {
      if (t.count > best.count) best = { label, count: t.count, totalConfidence: t.total };
    }
    return best;
  }
}
