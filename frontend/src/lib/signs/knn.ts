import { DEFAULT_FEATURE_CONFIG, featureLength, handPresenceRatio, sequenceFeatures, type FeatureConfig } from "./features";
import { UNKNOWN_LABEL, type LandmarkFrame, type Sample } from "./types";

/**
 * k-nearest-neighbor sequence classifier over standardized, fixed-length
 * landmark feature vectors. Chosen because it works with ~20–30 samples per
 * class, trains instantly and deterministically, and its distances give a
 * natural out-of-distribution rejection rule.
 */
export interface SignModel {
  format: "signbridge-knn";
  version: 1;
  model_id: string;
  created_at: string;
  /** What the labels are: complete phrase intents (today) or single signs (future). */
  target?: "phrase_intent" | "sign";
  /** Classifier family; matches the registry's "recognizer" field. */
  recognizer?: string;
  /** Labels this model can output, including UNKNOWN. Read dynamically by the UI. */
  labels: string[];
  feature: FeatureConfig;
  k: number;
  mean: number[];
  std: number[];
  vectors: number[][];
  vector_labels: string[];
  /** Nearest-neighbor distance above which a window is rejected as UNKNOWN. */
  reject_distance: number;
  /** Vote share required to accept a prediction. */
  min_confidence: number;
  training: { samples: number; counts: Record<string, number>; sessions: number; signers: number };
}

export type RejectReason = "accepted" | "unknown_class" | "low_confidence" | "out_of_distribution" | "no_hands";

export interface Prediction {
  /** Accepted intent, or UNKNOWN. */
  label: string;
  /** Vote share of the winning label (0..1). */
  confidence: number;
  /** Winning label before rejection rules. */
  candidate: string;
  distance: number;
  reason: RejectReason;
}

export interface TrainOptions {
  k?: number;
  minConfidence?: number;
  feature?: FeatureConfig;
  now?: Date;
}

/** Registry "recognizer" value for models produced by this module. */
export const RECOGNIZER_ID = "knn-sequence-v1";

const round = (x: number) => Math.round(x * 1e4) / 1e4;

function standardize(v: number[], mean: number[], std: number[]): number[] {
  return v.map((x, i) => (x - mean[i]) / std[i]);
}

function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

export function trainModel(samples: Sample[], opts: TrainOptions = {}): SignModel {
  const feature = opts.feature ?? DEFAULT_FEATURE_CONFIG;
  const rows: { v: number[]; label: string }[] = [];
  for (const s of samples) {
    const v = sequenceFeatures(s.frames, feature);
    if (v) rows.push({ v, label: s.label });
  }
  if (rows.length === 0) throw new Error("No usable samples to train on.");

  const dim = featureLength(feature);
  const mean = new Array<number>(dim).fill(0);
  for (const r of rows) r.v.forEach((x, i) => (mean[i] += x / rows.length));
  const std = new Array<number>(dim).fill(0);
  for (const r of rows) r.v.forEach((x, i) => (std[i] += (x - mean[i]) ** 2 / rows.length));
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i]) || 1;

  const vectors = rows.map((r) => standardize(r.v, mean, std).map(round));
  const vectorLabels = rows.map((r) => r.label);

  // Rejection radius, calibrated leave-one-out: the larger of 1.5x the 95th
  // percentile nearest same-class distance and half the median nearest
  // other-class distance. The second term keeps very consistent recordings
  // from producing a radius so tight that normal variation is rejected.
  const same: number[] = [];
  const other: number[] = [];
  vectors.forEach((v, i) => {
    if (vectorLabels[i] === UNKNOWN_LABEL) return;
    let bestSame = Number.POSITIVE_INFINITY;
    let bestOther = Number.POSITIVE_INFINITY;
    vectors.forEach((w, j) => {
      if (i === j) return;
      const d = distance(v, w);
      if (vectorLabels[j] === vectorLabels[i]) bestSame = Math.min(bestSame, d);
      else bestOther = Math.min(bestOther, d);
    });
    if (Number.isFinite(bestSame)) same.push(bestSame);
    if (Number.isFinite(bestOther)) other.push(bestOther);
  });
  same.sort((a, b) => a - b);
  other.sort((a, b) => a - b);
  const rejectDistance =
    same.length >= 3
      ? Math.max(quantile(same, 0.95) * 1.5, other.length ? quantile(other, 0.5) * 0.5 : 0)
      : Number.POSITIVE_INFINITY;

  const counts: Record<string, number> = {};
  for (const l of vectorLabels) counts[l] = (counts[l] ?? 0) + 1;
  const now = opts.now ?? new Date();

  return {
    format: "signbridge-knn",
    version: 1,
    model_id: `knn-v1-${now.toISOString().replace(/[-:T]/g, "").slice(0, 12)}`,
    created_at: now.toISOString(),
    target: "phrase_intent",
    recognizer: RECOGNIZER_ID,
    labels: Object.keys(counts).sort(),
    feature,
    k: Math.min(opts.k ?? 5, rows.length),
    mean: mean.map((x) => round(x)),
    std: std.map((x) => round(x) || 1),
    vectors,
    vector_labels: vectorLabels,
    reject_distance: Number.isFinite(rejectDistance) ? round(rejectDistance) : 1e9,
    min_confidence: opts.minConfidence ?? 0.6,
    training: {
      samples: rows.length,
      counts,
      sessions: new Set(samples.map((s) => s.session_id)).size,
      signers: new Set(samples.map((s) => s.signer_id)).size,
    },
  };
}

/** Minimum fraction of frames with a visible hand to attempt classification. */
export const MIN_HAND_PRESENCE = 0.3;

export function predict(model: SignModel, frames: LandmarkFrame[]): Prediction {
  const v = handPresenceRatio(frames) >= MIN_HAND_PRESENCE ? sequenceFeatures(frames, model.feature) : null;
  if (!v) {
    return { label: UNKNOWN_LABEL, confidence: 0, candidate: UNKNOWN_LABEL, distance: Number.POSITIVE_INFINITY, reason: "no_hands" };
  }
  const x = standardize(v, model.mean, model.std);
  const dists = model.vectors.map((w, i) => ({ d: distance(x, w), label: model.vector_labels[i] }));
  dists.sort((a, b) => a.d - b.d);
  const top = dists.slice(0, model.k);

  const votes = new Map<string, number>();
  let total = 0;
  for (const { d, label } of top) {
    const w = 1 / (d + 1e-6);
    votes.set(label, (votes.get(label) ?? 0) + w);
    total += w;
  }
  let candidate = UNKNOWN_LABEL;
  let best = -1;
  for (const [label, w] of votes) {
    if (w > best) {
      best = w;
      candidate = label;
    }
  }
  const confidence = best / total;
  const nearest = dists[0].d;

  let reason: RejectReason = "accepted";
  if (candidate === UNKNOWN_LABEL) reason = "unknown_class";
  else if (nearest > model.reject_distance) reason = "out_of_distribution";
  else if (confidence < model.min_confidence) reason = "low_confidence";

  return {
    label: reason === "accepted" ? candidate : UNKNOWN_LABEL,
    confidence,
    candidate,
    distance: nearest,
    reason,
  };
}

export function isSignModel(value: unknown): value is SignModel {
  const m = value as SignModel;
  return (
    typeof m === "object" &&
    m !== null &&
    m.format === "signbridge-knn" &&
    m.version === 1 &&
    Array.isArray(m.vectors) &&
    m.vectors.length === m.vector_labels?.length &&
    m.vectors.length > 0 &&
    m.mean?.length === featureLength(m.feature) &&
    m.std?.length === m.mean.length &&
    m.vectors.every((v) => v.length === m.mean.length)
  );
}
