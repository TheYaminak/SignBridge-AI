import { countByLabel, datasetWarnings } from "./dataset";
import { predict, trainModel, type SignModel, type TrainOptions } from "./knn";
import { UNKNOWN_LABEL, type Sample } from "./types";

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Split {
  train: Sample[];
  validation: Sample[];
  /** session_holdout: every class split by session; mixed: some classes; stratified_random: none. */
  strategy: "session_holdout" | "mixed" | "stratified_random";
  /** Classes that could only be split randomly (all samples from one session). */
  randomLabels: string[];
}

/**
 * Splits per class. When a class was recorded in at least two sessions,
 * whole sessions of that class are held out, so validation never shares a
 * session with training. Otherwise that class falls back to a stratified
 * random split, which is reported as optimistic. Deterministic for a seed.
 */
export function splitDataset(samples: Sample[], seed = 42, validationFraction = 0.25): Split {
  const rand = seededRandom(seed);
  const train: Sample[] = [];
  const validation: Sample[] = [];
  const randomLabels: string[] = [];

  const byLabel = new Map<string, Sample[]>();
  for (const s of [...samples].sort((a, b) => a.sample_id.localeCompare(b.sample_id))) {
    byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
  }

  for (const label of [...byLabel.keys()].sort()) {
    const items = byLabel.get(label)!;
    const sessions = [...new Set(items.map((s) => s.session_id))].sort();
    if (sessions.length >= 2) {
      const held = new Set<string>();
      let count = 0;
      for (const sid of shuffle(sessions, rand)) {
        if (held.size >= sessions.length - 1 || (held.size > 0 && count >= items.length * validationFraction)) break;
        held.add(sid);
        count += items.filter((s) => s.session_id === sid).length;
      }
      for (const s of items) (held.has(s.session_id) ? validation : train).push(s);
    } else {
      randomLabels.push(label);
      const shuffled = shuffle(items, rand);
      const nVal = shuffled.length >= 2 ? Math.max(1, Math.round(shuffled.length * validationFraction)) : 0;
      validation.push(...shuffled.slice(0, nVal));
      train.push(...shuffled.slice(nVal));
    }
  }

  const strategy =
    randomLabels.length === 0 ? "session_holdout" : randomLabels.length === byLabel.size ? "stratified_random" : "mixed";
  return { train, validation, strategy, randomLabels };
}

export interface ClassMetrics {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Evaluation {
  n: number;
  accuracy: number;
  labels: string[];
  /** confusion[i][j]: true labels[i] predicted as labels[j]. */
  confusion: number[][];
  perClass: ClassMetrics[];
}

export function evaluate(model: SignModel, samples: Sample[]): Evaluation {
  const labels = [...new Set([...model.labels, ...samples.map((s) => s.label), UNKNOWN_LABEL])].sort();
  const idx = new Map(labels.map((l, i) => [l, i]));
  const confusion = labels.map(() => labels.map(() => 0));
  let correct = 0;
  for (const s of samples) {
    const p = predict(model, s.frames).label;
    confusion[idx.get(s.label)!][idx.get(p)!] += 1;
    if (p === s.label) correct += 1;
  }
  const perClass = labels.map((label, i) => {
    const tp = confusion[i][i];
    const support = confusion[i].reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[i], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, support, precision, recall, f1 };
  });
  return { n: samples.length, accuracy: samples.length ? correct / samples.length : 0, labels, confusion, perClass };
}

export interface TrainingReport {
  split: { strategy: Split["strategy"]; train: number; validation: number; seed: number };
  evaluation: Evaluation | null;
  warnings: string[];
  /** Final model, trained on all samples after evaluation. */
  model: SignModel;
}

/** Validates split → trains on train → evaluates on held-out → retrains on all. */
export function trainAndEvaluate(samples: Sample[], opts: TrainOptions & { seed?: number } = {}): TrainingReport {
  const seed = opts.seed ?? 42;
  const warnings = datasetWarnings(samples);
  const split = splitDataset(samples, seed);

  let evaluation: Evaluation | null = null;
  if (split.validation.length > 0 && split.train.length > 0) {
    evaluation = evaluate(trainModel(split.train, opts), split.validation);
    const small = Object.entries(countByLabel(split.validation)).filter(([, n]) => n < 5);
    if (split.validation.length < 20 || small.length > 0) {
      warnings.push("Validation set is too small; accuracy and per-class metrics are unreliable.");
    }
    const missing = [...new Set(samples.map((s) => s.label))].filter((l) => !split.validation.some((s) => s.label === l));
    if (missing.length) warnings.push(`Not evaluated (no held-out samples): ${missing.join(", ")}.`);
  } else {
    warnings.push("Not enough data to hold out a validation set; the model was not evaluated.");
  }
  if (split.randomLabels.length > 0) {
    warnings.push(
      `Split randomly within one session (optimistic; record these across 2+ sessions): ${split.randomLabels.join(", ")}.`,
    );
  }

  return {
    split: { strategy: split.strategy, train: split.train.length, validation: split.validation.length, seed },
    evaluation,
    warnings,
    model: trainModel(samples, opts),
  };
}

export function formatReport(r: TrainingReport): string {
  const lines = [
    `Split: ${r.split.strategy} (seed ${r.split.seed}) — train ${r.split.train}, validation ${r.split.validation}`,
  ];
  if (r.evaluation) {
    const e = r.evaluation;
    lines.push(`Validation accuracy: ${(e.accuracy * 100).toFixed(1)}% on ${e.n} held-out samples`, "", "Per class:");
    for (const c of e.perClass.filter((c) => c.support > 0 || c.precision > 0)) {
      lines.push(`  ${c.label.padEnd(14)} support ${String(c.support).padStart(3)}  precision ${c.precision.toFixed(2)}  recall ${c.recall.toFixed(2)}  f1 ${c.f1.toFixed(2)}`);
    }
    lines.push("", "Confusion matrix (rows = true, cols = predicted):", `  ${"".padEnd(14)} ${e.labels.map((l) => l.slice(0, 8).padStart(8)).join(" ")}`);
    e.confusion.forEach((row, i) => lines.push(`  ${e.labels[i].padEnd(14)} ${row.map((n) => String(n).padStart(8)).join(" ")}`));
  }
  if (r.warnings.length) lines.push("", "Warnings:", ...r.warnings.map((w) => `  - ${w}`));
  lines.push("", `Final model ${r.model.model_id}: trained on all ${r.model.training.samples} samples.`);
  return lines.join("\n");
}
