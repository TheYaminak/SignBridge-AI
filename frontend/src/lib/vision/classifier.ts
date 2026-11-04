import { isSupportedGesture } from "./gestures";
import type { Classification, FrameClassifier, FrameObservation } from "./types";

/**
 * Uses MediaPipe's built-in gesture output. Picks the highest-scoring
 * supported gesture across all visible hands. "None" and unknown categories
 * are ignored.
 */
export class MediaPipeGestureClassifier implements FrameClassifier {
  readonly id = "mediapipe-canned-gestures";
  readonly kind = "gesture" as const;

  classify(frame: FrameObservation): Classification | null {
    let best: Classification | null = null;
    frame.hands.forEach((hand, handIndex) => {
      const g = hand.gesture;
      if (!g || !isSupportedGesture(g.label)) return;
      if (!best || g.score > best.confidence) {
        best = { label: g.label, confidence: g.score, kind: this.kind, handIndex };
      }
    });
    return best;
  }
}

// Extension point: a future custom sign classifier would implement
// FrameClassifier (kind = "sign"), typically by buffering
// frame.hands[i].landmarks over time and running its own model.
