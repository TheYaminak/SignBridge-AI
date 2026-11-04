import type { HandLandmarks, LandmarkFrame } from "./types";

/**
 * Preprocessing shared by training (browser + CLI) and real-time inference.
 * Any change here must bump FeatureConfig.version, because trained models
 * store the config they were built with.
 */
export interface FeatureConfig {
  version: 1;
  /** Frames after temporal resampling. */
  frames: number;
  /** Length of a sample / the real-time window, in ms. */
  windowMs: number;
}

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = { version: 1, frames: 16, windowMs: 3000 };

/** Per hand: presence flag + 21×3 wrist-relative scaled coords + wrist x,y. */
const HAND_DIM = 1 + 63 + 2;
/** Per frame: two hand slots + wrist velocity (dx, dy) for each slot. */
const FRAME_DIM = HAND_DIM * 2 + 4;

export function featureLength(config: FeatureConfig): number {
  return config.frames * FRAME_DIM;
}

/**
 * Position and scale normalization: landmarks relative to the wrist, divided
 * by the wrist→middle-finger-MCP distance. The wrist's image position is kept
 * separately so location (e.g. near the face vs. the chest) still counts.
 */
function handFeatures(hand: HandLandmarks | null): number[] {
  const out = new Array<number>(HAND_DIM).fill(0);
  if (!hand) return out;
  const wx = hand[0];
  const wy = hand[1];
  const wz = hand[2];
  const scale = Math.max(Math.hypot(hand[27] - wx, hand[28] - wy), 1e-3); // landmark 9
  out[0] = 1;
  for (let i = 0; i < 21; i++) {
    out[1 + i * 3] = (hand[i * 3] - wx) / scale;
    out[2 + i * 3] = (hand[i * 3 + 1] - wy) / scale;
    out[3 + i * 3] = (hand[i * 3 + 2] - wz) / scale;
  }
  out[64] = wx - 0.5;
  out[65] = wy - 0.5;
  return out;
}

/**
 * Temporal sampling: picks `n` frames evenly spaced in time (nearest frame,
 * not interpolation, so a missing hand stays missing instead of blending).
 */
export function resample(frames: LandmarkFrame[], n: number): LandmarkFrame[] {
  if (frames.length === 0) return [];
  const t0 = frames[0].timestamp_ms;
  const t1 = frames[frames.length - 1].timestamp_ms;
  const out: LandmarkFrame[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = n === 1 ? t0 : t0 + ((t1 - t0) * k) / (n - 1);
    while (
      j + 1 < frames.length &&
      Math.abs(frames[j + 1].timestamp_ms - target) <= Math.abs(frames[j].timestamp_ms - target)
    ) {
      j++;
    }
    out.push(frames[j]);
  }
  return out;
}

/** Fraction of frames with at least one hand. */
export function handPresenceRatio(frames: LandmarkFrame[]): number {
  if (frames.length === 0) return 0;
  return frames.filter((f) => f.left_hand || f.right_hand).length / frames.length;
}

/** Fixed-length feature vector for a landmark sequence, or null if empty. */
export function sequenceFeatures(frames: LandmarkFrame[], config: FeatureConfig): number[] | null {
  if (frames.length === 0) return null;
  const sampled = resample(frames, config.frames);
  const out: number[] = [];
  let prev: LandmarkFrame | null = null;
  for (const f of sampled) {
    out.push(...handFeatures(f.left_hand), ...handFeatures(f.right_hand));
    // Movement over time: wrist displacement since the previous sample.
    for (const slot of ["left_hand", "right_hand"] as const) {
      const a = prev?.[slot];
      const b = f[slot];
      if (a && b) out.push((b[0] - a[0]) * 10, (b[1] - a[1]) * 10);
      else out.push(0, 0);
    }
    prev = f;
  }
  return out;
}
