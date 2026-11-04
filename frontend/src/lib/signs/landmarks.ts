import type { FrameObservation } from "../vision/types";
import type { HandLandmarks, LandmarkFrame } from "./types";

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

function flatten(points: { x: number; y: number; z: number }[]): HandLandmarks | null {
  if (points.length !== 21) return null;
  const out: number[] = [];
  for (const p of points) out.push(r4(p.x), r4(p.y), r4(p.z));
  return out;
}

/**
 * Converts a MediaPipe frame into the dataset frame format: hands are placed
 * in the signer's left/right slot by MediaPipe handedness (the frame is not
 * mirrored). If both hands report the same side, the second goes to the free
 * slot. Missing hands are null.
 */
export function toLandmarkFrame(frame: FrameObservation, timestampMs: number): LandmarkFrame {
  const out: LandmarkFrame = { timestamp_ms: Math.round(timestampMs), left_hand: null, right_hand: null };
  for (const hand of frame.hands) {
    const flat = flatten(hand.landmarks);
    if (!flat) continue;
    const slot = hand.handedness === "Left" ? "left_hand" : "right_hand";
    const other = slot === "left_hand" ? "right_hand" : "left_hand";
    if (!out[slot]) out[slot] = flat;
    else if (!out[other]) out[other] = flat;
  }
  return out;
}
