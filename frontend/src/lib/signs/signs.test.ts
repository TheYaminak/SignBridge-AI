/**
 * Unit tests for the sign pipeline. The landmark sequences below are
 * TEST FIXTURES generated in code to exercise the algorithms; they are not
 * training data and are never used to build a real model.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toDataset, validateDataset } from "./dataset";
import { evaluate, splitDataset, trainAndEvaluate } from "./evaluate";
import { DEFAULT_FEATURE_CONFIG, featureLength, resample, sequenceFeatures } from "./features";
import { isSignModel, predict, trainModel, windowFromSamples } from "./knn";
import { toLandmarkFrame } from "./landmarks";
import { RealtimeSignRecognizer } from "./realtime";
import type { LandmarkFrame, Sample } from "./types";
import { isInterpretable, modelCoverage, trainingLabels } from "./vocabulary";
import { acceptsRecognition, displayPhase, transition, type PipelinePhase } from "./pipeline";
import { pickVoice } from "../languages";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IntentInfo } from "../../types/api";

// The real registry served by the Go API.
const registry: IntentInfo[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "backend", "internal", "domain", "vocabulary.json"), "utf8"),
).entries;
const ALLOWED = trainingLabels(registry);

/** A fake hand: 21 points around (cx, cy) with a given finger spread. */
function hand(cx: number, cy: number, spread: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI;
    out.push(cx + Math.cos(a) * spread * (i % 5 === 0 ? 1 : 0.6), cy - Math.sin(a) * spread, 0);
  }
  out[27] = cx; // landmark 9 above the wrist sets the scale
  out[28] = cy - 0.1;
  return out;
}

type Pattern = (t: number) => Pick<LandmarkFrame, "left_hand" | "right_hand">;

const patterns: Record<string, Pattern> = {
  // moves right hand upward
  HELLO: (t) => ({ left_hand: null, right_hand: hand(0.6, 0.6 - 0.3 * t, 0.08) }),
  // two hands, moving apart
  THANK_YOU: (t) => ({ left_hand: hand(0.45 - 0.1 * t, 0.5, 0.05), right_hand: hand(0.55 + 0.1 * t, 0.5, 0.05) }),
  // resting low, barely moving
  UNKNOWN: (t) => ({ left_hand: null, right_hand: hand(0.5, 0.9 + 0.01 * t, 0.03) }),
};

function makeSample(label: string, i: number, session = "s1", jitter = 0.01): Sample {
  const frames: LandmarkFrame[] = [];
  for (let f = 0; f < 45; f++) {
    const t = f / 44;
    const base = patterns[label](t + Math.sin(i * 7.3) * jitter);
    frames.push({ timestamp_ms: f * 66, ...base });
  }
  return {
    sample_id: `${label}-${session}-${i}`,
    label,
    source: "local_webcam",
    reference_urls: [],
    session_id: session,
    signer_id: "tester",
    recorded_at: "2026-11-04T00:00:00.000Z",
    duration_ms: 2970,
    frames,
  };
}

function makeSet(perClass: number, sessions = ["s1"]): Sample[] {
  const out: Sample[] = [];
  for (const label of Object.keys(patterns)) {
    for (let i = 0; i < perClass; i++) out.push(makeSample(label, i, sessions[i % sessions.length]));
  }
  return out;
}

describe("features", () => {
  it("resamples to a fixed length by time", () => {
    const s = makeSample("HELLO", 0);
    assert.equal(resample(s.frames, 16).length, 16);
    assert.equal(resample(s.frames, 16)[0], s.frames[0]);
    assert.equal(resample(s.frames, 16)[15], s.frames[44]);
  });

  it("produces fixed-length vectors and zeros for missing hands", () => {
    const v = sequenceFeatures(makeSample("HELLO", 0).frames, DEFAULT_FEATURE_CONFIG)!;
    assert.equal(v.length, featureLength(DEFAULT_FEATURE_CONFIG));
    assert.equal(v[0], 0); // left hand absent
    assert.equal(v[66], 1); // right hand present
  });

  it("is invariant to hand position and scale (relative coordinates)", () => {
    const a = sequenceFeatures([{ timestamp_ms: 0, left_hand: null, right_hand: hand(0.3, 0.3, 0.05) }], { ...DEFAULT_FEATURE_CONFIG, frames: 1 })!;
    const b = sequenceFeatures([{ timestamp_ms: 0, left_hand: null, right_hand: hand(0.7, 0.6, 0.05) }], { ...DEFAULT_FEATURE_CONFIG, frames: 1 })!;
    // relative landmark block identical, wrist position differs
    assert.deepEqual(a.slice(67, 130).map((x) => x.toFixed(6)), b.slice(67, 130).map((x) => x.toFixed(6)));
    assert.notEqual(a[130], b[130]);
  });

  it("returns null for empty sequences", () => {
    assert.equal(sequenceFeatures([], DEFAULT_FEATURE_CONFIG), null);
  });
});

describe("knn classifier", () => {
  const model = trainModel(makeSet(10), { now: new Date("2026-11-04T00:00:00Z") });

  it("trains a valid, deterministic model", () => {
    assert.ok(isSignModel(model));
    assert.deepEqual(model.labels, ["HELLO", "THANK_YOU", "UNKNOWN"]);
    const again = trainModel(makeSet(10), { now: new Date("2026-11-04T00:00:00Z") });
    assert.deepEqual(again, model);
  });

  it("classifies unseen samples of each pattern", () => {
    for (const label of ["HELLO", "THANK_YOU"]) {
      const p = predict(model, makeSample(label, 99, "s1", 0.02).frames);
      assert.equal(p.label, label);
      assert.ok(p.confidence > 0.6);
    }
  });

  it("returns UNKNOWN for the rest class", () => {
    assert.equal(predict(model, makeSample("UNKNOWN", 77).frames).label, "UNKNOWN");
  });

  it("returns UNKNOWN when no hands are visible", () => {
    const empty = Array.from({ length: 40 }, (_, i) => ({ timestamp_ms: i * 70, left_hand: null, right_hand: null }));
    const p = predict(model, empty);
    assert.equal(p.label, "UNKNOWN");
    assert.equal(p.reason, "no_hands");
  });

  it("rejects out-of-distribution input", () => {
    const weird = Array.from({ length: 40 }, (_, i) => ({
      timestamp_ms: i * 70,
      left_hand: hand(0.1, 0.1, 0.3),
      right_hand: hand(0.9, 0.1, 0.3),
    }));
    assert.equal(predict(model, weird).label, "UNKNOWN");
  });

  it("detects invalid model files", () => {
    assert.equal(isSignModel({ format: "signbridge-knn" }), false);
    assert.equal(isSignModel({ ...model, mean: [1, 2] }), false);
  });
});

describe("evaluation", () => {
  it("holds out whole sessions per class when possible", () => {
    const split = splitDataset(makeSet(8, ["a", "b", "c", "d"]), 1);
    assert.equal(split.strategy, "session_holdout");
    for (const s of split.validation) {
      assert.ok(!split.train.some((t) => t.label === s.label && t.session_id === s.session_id));
    }
  });

  it("keeps every class in training when each class has its own single session", () => {
    const samples = Object.keys(patterns).flatMap((label) =>
      Array.from({ length: 8 }, (_, i) => makeSample(label, i, `session-${label}`)),
    );
    const split = splitDataset(samples, 1);
    assert.equal(split.strategy, "stratified_random");
    for (const label of Object.keys(patterns)) {
      assert.ok(split.train.some((s) => s.label === label), `${label} missing from training`);
      assert.ok(split.validation.some((s) => s.label === label), `${label} missing from validation`);
    }
  });

  it("falls back to a stratified split for a single session and never overlaps", () => {
    const split = splitDataset(makeSet(8), 1);
    assert.equal(split.strategy, "stratified_random");
    const trainIds = new Set(split.train.map((s) => s.sample_id));
    assert.ok(split.validation.length > 0 && split.validation.every((s) => !trainIds.has(s.sample_id)));
  });

  it("is deterministic for a seed", () => {
    assert.deepEqual(splitDataset(makeSet(8), 7).validation.map((s) => s.sample_id), splitDataset(makeSet(8), 7).validation.map((s) => s.sample_id));
  });

  it("builds a confusion matrix and warns about small data", () => {
    const report = trainAndEvaluate(makeSet(8));
    assert.ok(report.evaluation);
    const e = report.evaluation!;
    assert.equal(e.confusion.flat().reduce((a, b) => a + b, 0), e.n);
    assert.ok(report.warnings.some((w) => w.includes("too small")));
    assert.ok(report.warnings.some((w) => w.includes("Single signer")));
    assert.equal(report.model.training.samples, 24);
  });

  it("computes per-class metrics", () => {
    const model = trainModel(makeSet(8));
    const e = evaluate(model, [makeSample("HELLO", 50)]);
    const hello = e.perClass.find((c) => c.label === "HELLO")!;
    assert.equal(hello.support, 1);
  });
});

describe("dataset validation", () => {
  it("round-trips export/import", () => {
    const samples = makeSet(2);
    const v = validateDataset(JSON.parse(JSON.stringify(toDataset(samples))), ALLOWED);
    assert.equal(v.errors.length, 0);
    assert.equal(v.samples.length, samples.length);
  });

  it("drops invalid samples with reasons", () => {
    const good = makeSample("HELLO", 0);
    const data = toDataset([
      good,
      { ...good, sample_id: "bad-label", label: "WHERE_BATHROOM" },
      { ...good, sample_id: "short", frames: good.frames.slice(0, 3) },
      { ...good, sample_id: "nan", frames: good.frames.map((f, i) => (i === 2 ? { ...f, right_hand: [Number.NaN] } : f)) },
      { ...good, sample_id: "time", frames: [...good.frames].reverse() },
      good,
    ]);
    const v = validateDataset(data, ALLOWED);
    assert.equal(v.samples.length, 1);
    assert.equal(v.errors.length, 5);
    assert.ok(v.errors.some((e) => e.includes("WHERE_BATHROOM is not a training target")));
  });

  it("rejects non-datasets", () => {
    assert.equal(validateDataset({ foo: 1 }).samples.length, 0);
    assert.equal(validateDataset(null).errors.length, 1);
  });

  it("warns when data is insufficient", () => {
    const v = validateDataset(toDataset(makeSet(2)));
    assert.ok(v.warnings.some((w) => w.includes("Record at least")));
  });
});

describe("realtime recognizer", () => {
  const model = trainModel(makeSet(10));

  function stream(rec: RealtimeSignRecognizer, label: string | null, start: number, frames: number) {
    const events: string[] = [];
    for (let f = 0; f < frames; f++) {
      const t = (f % 45) / 44;
      const base = label ? patterns[label](t) : { left_hand: null, right_hand: null };
      const step = rec.push({ timestamp_ms: start + f * 66, ...base });
      if (step.event) events.push(step.event.label);
    }
    return events;
  }

  it("emits a stable intent once and resets", () => {
    const rec = new RealtimeSignRecognizer(model);
    const events = stream(rec, "HELLO", 0, 200);
    assert.ok(events.length >= 1);
    assert.equal(events[0], "HELLO");
    assert.ok(events.every((e) => e === "HELLO"));
    assert.equal(events.length, 1, "duplicate suppression while the same intent repeats");
  });

  it("never emits for empty frames or rest", () => {
    const rec = new RealtimeSignRecognizer(model);
    assert.deepEqual(stream(rec, null, 0, 120), []);
    assert.deepEqual(stream(rec, "UNKNOWN", 10_000, 120), []);
  });

  it("allows the same intent again after hands disappear", () => {
    const rec = new RealtimeSignRecognizer(model);
    const first = stream(rec, "HELLO", 0, 120);
    stream(rec, null, 8_000, 60);
    const second = stream(rec, "HELLO", 20_000, 120);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
  });
});

describe("toLandmarkFrame", () => {
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: i / 100, y: 0.5, z: 0 }));

  it("assigns hands by handedness and handles duplicates and missing hands", () => {
    const f = toLandmarkFrame({ timestampMs: 0, hands: [{ landmarks: pts, handedness: "Right", gesture: null }] }, 12.4);
    assert.equal(f.timestamp_ms, 12);
    assert.equal(f.left_hand, null);
    assert.equal(f.right_hand?.length, 63);

    const both = toLandmarkFrame({ timestampMs: 0, hands: [
      { landmarks: pts, handedness: "Left", gesture: null },
      { landmarks: pts, handedness: "Left", gesture: null },
    ] }, 0);
    assert.ok(both.left_hand && both.right_hand);

    const empty = toLandmarkFrame({ timestampMs: 0, hands: [] }, 0);
    assert.deepEqual(empty, { timestamp_ms: 0, left_hand: null, right_hand: null });
  });
});

describe("vocabulary registry", () => {
  it("derives training targets from the registry, not hardcoded IDs", () => {
    assert.deepEqual([...ALLOWED].sort(), ["HELLO", "NEED_DOCTOR", "NEED_HELP", "THANK_YOU", "UNKNOWN"]);
    assert.ok(!ALLOWED.includes("WHERE_BATHROOM"));
  });

  it("only supported registry entries are interpretable", () => {
    assert.equal(isInterpretable("HELLO", registry), true);
    assert.equal(isInterpretable("WHERE_BATHROOM", registry), false);
    assert.equal(isInterpretable("UNKNOWN", registry), false);
    assert.equal(isInterpretable("SOME_FUTURE_SIGN", registry), false);
    assert.equal(isInterpretable("HELLO", null), false, "no registry, no recognitions");
  });

  it("reports model labels the registry does not support", () => {
    const c = modelCoverage(["HELLO", "UNKNOWN", "WAVE"], registry);
    assert.deepEqual(c.active, ["HELLO"]);
    assert.deepEqual(c.ignored, ["WAVE"]);
    assert.equal(c.hasUnknown, true);
  });

  it("accepts any well-formed label when no registry list is given", () => {
    const s = makeSample("HELLO", 0);
    assert.equal(validateDataset(toDataset([{ ...s, label: "FUTURE_SIGN" }])).samples.length, 1);
    assert.equal(validateDataset(toDataset([{ ...s, label: "bad label" }])).samples.length, 0);
  });

  it("trained models expose their labels and recognizer", () => {
    const m = trainModel(makeSet(4));
    assert.equal(m.target, "phrase_intent");
    assert.equal(m.recognizer, "knn-sequence-v1");
    assert.ok(registry.filter((e) => e.training_target).every((e) => e.recognizer === m.recognizer));
  });
});

describe("recognition pipeline state machine", () => {
  it("runs the automatic happy path", () => {
    let p: PipelinePhase = "recognizing";
    p = transition(p, { type: "recognized" });
    assert.equal(p, "confirmed");
    p = transition(p, { type: "interpret" });
    assert.equal(p, "interpreting");
    p = transition(p, { type: "result", speak: true });
    assert.equal(p, "speaking");
    p = transition(p, { type: "speech_end" });
    assert.equal(p, "cooldown");
    p = transition(p, { type: "cooldown_end" });
    assert.equal(p, "recognizing");
  });

  it("ignores recognitions until it is back in RECOGNIZING", () => {
    for (const p of ["confirmed", "interpreting", "speaking", "cooldown"] as PipelinePhase[]) {
      assert.equal(acceptsRecognition(p), false);
      assert.equal(transition(p, { type: "recognized" }), p);
    }
    assert.equal(acceptsRecognition("recognizing"), true);
  });

  it("does not start a second interpretation or overlap speech", () => {
    assert.equal(transition("interpreting", { type: "interpret" }), "interpreting");
    assert.equal(transition("speaking", { type: "interpret" }), "speaking");
    assert.equal(transition("interpreting", { type: "replay" }), "interpreting");
  });

  it("goes to cooldown without speech when muted or on failure", () => {
    assert.equal(transition("interpreting", { type: "result", speak: false }), "cooldown");
    assert.equal(transition("interpreting", { type: "failed" }), "cooldown");
  });

  it("reset (clear / camera stop) always returns to RECOGNIZING; IDLE is derived from the camera", () => {
    assert.equal(transition("speaking", { type: "reset" }), "recognizing");
    assert.equal(displayPhase("recognizing", false), "idle");
    assert.equal(displayPhase("recognizing", true), "recognizing");
    assert.equal(displayPhase("speaking", false), "speaking");
  });
});

describe("voice selection", () => {
  const v = (lang: string, name = lang) => ({ lang, name }) as SpeechSynthesisVoice;

  it("prefers es-DO, then other Spanish voices", () => {
    assert.equal(pickVoice([v("en-US"), v("es-ES"), v("es-DO")], "es-DO")?.lang, "es-DO");
    assert.equal(pickVoice([v("en-US"), v("es-ES"), v("es-MX")], "es-DO")?.lang, "es-MX");
    assert.equal(pickVoice([v("en-US"), v("es_AR")], "es-DO")?.lang, "es_AR");
  });

  it("prefers en-US for English and returns null when nothing matches", () => {
    assert.equal(pickVoice([v("en-GB"), v("en-US")], "en-US")?.lang, "en-US");
    assert.equal(pickVoice([v("fr-FR")], "es-DO"), null);
  });
});

describe("configurable recording length", () => {
  it("sets the real-time window from the median sample length", () => {
    const at = (ms: number) => ({ ...makeSample("HELLO", ms), duration_ms: ms });
    assert.equal(windowFromSamples([at(3900), at(4000), at(4100)]), 4000);
    assert.equal(windowFromSamples([at(500)]), 1500);
    assert.equal(windowFromSamples([]), 3000);
    assert.equal(trainModel([at(2000), at(2000), makeSample("UNKNOWN", 1)].map((s) => ({ ...s, duration_ms: 2000 }))).feature.windowMs, 2000);
  });

  it("warns when recording lengths are mixed", () => {
    const mixed = [{ ...makeSample("HELLO", 1), duration_ms: 2000 }, { ...makeSample("HELLO", 2), duration_ms: 5000 }, { ...makeSample("HELLO", 3), duration_ms: 3000 }];
    assert.ok(validateDataset(toDataset(mixed)).warnings.some((w) => w.includes("Recording lengths vary")));
  });
});
