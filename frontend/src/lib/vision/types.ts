/**
 * Types for the on-device vision pipeline. The stages are deliberately
 * separate so a custom sign classifier can replace the gesture stage later:
 *
 *   1. Landmark extraction   (MediaPipe, hand-tracker.ts)  -> FrameObservation
 *   2. Classification        (classifier.ts)                -> Classification
 *   3. Temporal processing   (stabilizer.ts)                -> StableRecognition
 *   4. Interpretation        (Go API /api/v1/interpret)
 */

export interface NormalizedPoint {
  /** 0..1 across the (unmirrored) video frame. */
  x: number;
  y: number;
  z: number;
}

/** What kind of label a classifier produces. */
export type RecognitionKind = "gesture" | "sign";

export interface HandObservation {
  /** 21 landmarks, MediaPipe hand topology. */
  landmarks: NormalizedPoint[];
  /** Subject's hand ("Left"/"Right"), as reported by MediaPipe. */
  handedness: string;
  /** MediaPipe's built-in (canned) gesture for this hand, if any. */
  gesture: { label: string; score: number } | null;
}

/** Output of the landmark extraction stage for one video frame. */
export interface FrameObservation {
  timestampMs: number;
  hands: HandObservation[];
}

/** Output of the classification stage for one frame. */
export interface Classification {
  label: string;
  confidence: number;
  kind: RecognitionKind;
  handIndex: number;
}

/**
 * Classification stage. Implement this to plug in a custom sign-language
 * classifier (e.g. a model over landmark sequences) without touching the
 * camera, tracking, stabilization, or API code.
 */
export interface FrameClassifier {
  readonly id: string;
  readonly kind: RecognitionKind;
  classify(frame: FrameObservation): Classification | null;
}

/** A label that stayed consistent long enough to count as recognized. */
export interface StableRecognition {
  label: string;
  confidence: number;
  kind: RecognitionKind;
  /** performance.now() timestamp of the frame that confirmed it. */
  timestampMs: number;
}
