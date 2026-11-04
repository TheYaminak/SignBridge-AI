import {
  DATASET_FORMAT,
  DATASET_VERSION,
  LANDMARK_VALUES,
  TRAINABLE_LABELS,
  UNKNOWN_LABEL,
  type Dataset,
  type LandmarkFrame,
  type Sample,
} from "./types";

/** Recommended starting point; not a guarantee of accuracy. */
export const RECOMMENDED_SAMPLES = 20;
export const MIN_FRAMES = 8;

export interface DatasetValidation {
  samples: Sample[];
  errors: string[];
  warnings: string[];
}

function validHand(h: unknown): h is number[] | null {
  return h === null || (Array.isArray(h) && h.length === LANDMARK_VALUES && h.every((x) => typeof x === "number" && Number.isFinite(x)));
}

function sampleError(s: unknown, allowed: readonly string[]): string | null {
  const x = s as Partial<Sample>;
  if (typeof x !== "object" || x === null) return "not an object";
  if (typeof x.sample_id !== "string" || !x.sample_id) return "missing sample_id";
  if (typeof x.label !== "string" || !allowed.includes(x.label)) return `unsupported label ${JSON.stringify(x.label)}`;
  if (typeof x.session_id !== "string" || !x.session_id) return "missing session_id";
  if (!Array.isArray(x.frames)) return "missing frames";
  if (x.frames.length < MIN_FRAMES) return `only ${x.frames.length} frames (need ${MIN_FRAMES})`;
  let last = Number.NEGATIVE_INFINITY;
  for (const [i, f] of (x.frames as LandmarkFrame[]).entries()) {
    if (typeof f?.timestamp_ms !== "number" || !Number.isFinite(f.timestamp_ms) || f.timestamp_ms < last) {
      return `frame ${i}: invalid or decreasing timestamp`;
    }
    last = f.timestamp_ms;
    if (!validHand(f.left_hand) || !validHand(f.right_hand)) return `frame ${i}: hand must be null or ${LANDMARK_VALUES} finite numbers`;
  }
  return null;
}

/** Validates imported or stored data; invalid samples are dropped and reported. */
export function validateDataset(data: unknown, allowed: readonly string[] = TRAINABLE_LABELS): DatasetValidation {
  const errors: string[] = [];
  const d = data as Partial<Dataset>;
  if (typeof d !== "object" || d === null || d.format !== DATASET_FORMAT) {
    return { samples: [], errors: [`Not a SignBridge landmark dataset (expected format "${DATASET_FORMAT}").`], warnings: [] };
  }
  if (d.version !== DATASET_VERSION) errors.push(`Unsupported dataset version ${String(d.version)}.`);
  if (!Array.isArray(d.samples)) return { samples: [], errors: [...errors, "Missing samples array."], warnings: [] };

  const samples: Sample[] = [];
  const ids = new Set<string>();
  d.samples.forEach((s, i) => {
    const err = sampleError(s, allowed);
    if (err) {
      errors.push(`Sample ${i}: ${err}.`);
    } else if (ids.has(s.sample_id)) {
      errors.push(`Sample ${i}: duplicate sample_id.`);
    } else {
      ids.add(s.sample_id);
      samples.push({ ...s, signer_id: s.signer_id || "unknown", reference_urls: s.reference_urls ?? [] });
    }
  });
  return { samples, errors, warnings: datasetWarnings(samples) };
}

export function countByLabel(samples: Sample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of samples) counts[s.label] = (counts[s.label] ?? 0) + 1;
  return counts;
}

/** Plain-language warnings about data sufficiency. */
export function datasetWarnings(samples: Sample[]): string[] {
  const w: string[] = [];
  const counts = countByLabel(samples);
  const intents = Object.keys(counts).filter((l) => l !== UNKNOWN_LABEL);
  if (!counts[UNKNOWN_LABEL]) w.push("No UNKNOWN samples: the model cannot learn to reject rest, transitions, or unrelated movement.");
  if (intents.length === 0) w.push("No intent samples yet.");
  for (const [label, n] of Object.entries(counts)) {
    if (n < RECOMMENDED_SAMPLES) w.push(`${label}: ${n} samples. Record at least ${RECOMMENDED_SAMPLES} (more is better).`);
  }
  if (new Set(samples.map((s) => s.session_id)).size < 2) {
    w.push("Only one recording session: validation cannot be split by session, so metrics will be optimistic.");
  }
  if (new Set(samples.map((s) => s.signer_id)).size < 2) {
    w.push("Single signer: the model is not expected to generalize to other people.");
  }
  return w;
}

export function toDataset(samples: Sample[], now = new Date()): Dataset {
  return { format: DATASET_FORMAT, version: DATASET_VERSION, exported_at: now.toISOString(), samples };
}
