import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MediaPipeGestureClassifier } from "./classifier";
import { GestureStabilizer } from "./stabilizer";
import type { Classification, FrameObservation, StableRecognition } from "./types";

const FRAME_MS = 33;

function cls(label: string, confidence = 0.95): Classification {
  return { label, confidence, kind: "gesture", handIndex: 0 };
}

/** Feeds `frames` identical frames and returns emitted events. */
function feed(
  s: GestureStabilizer,
  clock: { t: number },
  frames: number,
  classification: Classification | null,
  handsPresent = true,
): StableRecognition[] {
  const events: StableRecognition[] = [];
  for (let i = 0; i < frames; i++) {
    clock.t += FRAME_MS;
    const out = s.push({ timestampMs: clock.t, handsPresent, classification });
    if (out.event) events.push(out.event);
  }
  return events;
}

describe("GestureStabilizer", () => {
  it("emits once after a full window of agreement", () => {
    const s = new GestureStabilizer({ windowSize: 10, minAgreement: 0.7 });
    const clock = { t: 0 };
    assert.equal(feed(s, clock, 9, cls("Thumb_Up")).length, 0);
    const events = feed(s, clock, 1, cls("Thumb_Up"));
    assert.equal(events.length, 1);
    assert.equal(events[0].label, "Thumb_Up");
    assert.ok(Math.abs(events[0].confidence - 0.95) < 1e-9);
  });

  it("ignores predictions below the confidence threshold", () => {
    const s = new GestureStabilizer({ minConfidence: 0.8 });
    const clock = { t: 0 };
    assert.equal(feed(s, clock, 30, cls("Thumb_Up", 0.79)).length, 0);
  });

  it("smooths over brief flicker", () => {
    const s = new GestureStabilizer({ windowSize: 10, minAgreement: 0.7 });
    const clock = { t: 0 };
    const events: StableRecognition[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(...feed(s, clock, 1, i % 4 === 3 ? cls("Victory") : cls("Open_Palm")));
    }
    assert.deepEqual(events.map((e) => e.label), ["Open_Palm"]);
  });

  it("suppresses duplicates while the gesture is held", () => {
    const s = new GestureStabilizer({ cooldownMs: 0 });
    const clock = { t: 0 };
    assert.equal(feed(s, clock, 200, cls("Thumb_Up")).length, 1);
  });

  it("allows the same gesture again after the hand relaxes", () => {
    const s = new GestureStabilizer({ cooldownMs: 0 });
    const clock = { t: 0 };
    feed(s, clock, 15, cls("Thumb_Up"));
    feed(s, clock, 15, null); // hand visible, no gesture
    assert.equal(feed(s, clock, 15, cls("Thumb_Up")).length, 1);
  });

  it("enforces the cooldown between different gestures", () => {
    const s = new GestureStabilizer({ cooldownMs: 1000, windowSize: 5, minAgreement: 0.6 });
    const clock = { t: 0 };
    assert.equal(feed(s, clock, 5, cls("Thumb_Up")).length, 1);
    // Switch immediately: Open_Palm wins the window at ~100ms, still in cooldown.
    const early = feed(s, clock, 10, cls("Open_Palm"));
    assert.equal(early.length, 0);
    // Keep holding until the cooldown expires.
    const later = feed(s, clock, 30, cls("Open_Palm"));
    assert.equal(later.length, 1);
    assert.ok(later[0].timestampMs >= 1000);
  });

  it("resets when hands disappear", () => {
    const s = new GestureStabilizer({ cooldownMs: 0, resetAfterEmptyFrames: 5 });
    const clock = { t: 0 };
    feed(s, clock, 15, cls("Victory"));
    feed(s, clock, 5, null, false);
    assert.equal(feed(s, clock, 15, cls("Victory")).length, 1);
  });

  it("does not reset on a brief tracking dropout", () => {
    const s = new GestureStabilizer({ cooldownMs: 0, resetAfterEmptyFrames: 5 });
    const clock = { t: 0 };
    feed(s, clock, 15, cls("Victory"));
    feed(s, clock, 2, null, false);
    assert.equal(feed(s, clock, 15, cls("Victory")).length, 0);
  });

  it("reports the current candidate for UI feedback", () => {
    const s = new GestureStabilizer({ windowSize: 10 });
    const out = s.push({ timestampMs: 1, handsPresent: true, classification: cls("ILoveYou") });
    assert.equal(out.candidate?.label, "ILoveYou");
    assert.equal(out.candidate?.agreement, 0.1);
  });
});

describe("MediaPipeGestureClassifier", () => {
  const classifier = new MediaPipeGestureClassifier();
  const hand = (label: string, score: number) => ({
    landmarks: [],
    handedness: "Right",
    gesture: { label, score },
  });

  it("picks the best supported gesture across hands", () => {
    const frame: FrameObservation = {
      timestampMs: 0,
      hands: [hand("Open_Palm", 0.7), hand("Thumb_Up", 0.9)],
    };
    assert.deepEqual(classifier.classify(frame), {
      label: "Thumb_Up",
      confidence: 0.9,
      kind: "gesture",
      handIndex: 1,
    });
  });

  it("ignores None and unknown categories", () => {
    const frame: FrameObservation = {
      timestampMs: 0,
      hands: [hand("None", 0.99), hand("Wave", 0.99)],
    };
    assert.equal(classifier.classify(frame), null);
  });

  it("returns null without hands", () => {
    assert.equal(classifier.classify({ timestampMs: 0, hands: [] }), null);
  });
});
