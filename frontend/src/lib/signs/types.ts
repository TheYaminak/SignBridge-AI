/**
 * Landmark dataset and model types for the custom sign classifier.
 * Datasets store raw MediaPipe landmarks (not features), so they stay
 * reusable if preprocessing changes. No video or images are stored.
 */

export const DATASET_FORMAT = "signbridge-landmarks";
export const DATASET_VERSION = 1;

/** Rejection class: rest, transitions, unrelated movement. */
export const UNKNOWN_LABEL = "UNKNOWN";

/** Format of a registry ID / sample label. Which labels are trainable comes from the registry. */
export const LABEL_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

/** 21 landmarks × (x, y, z), MediaPipe normalized image coordinates of the unmirrored frame. */
export type HandLandmarks = number[];
export const LANDMARK_VALUES = 63;

export interface LandmarkFrame {
  /** Milliseconds since the start of the sample (or a monotonic clock in real time). */
  timestamp_ms: number;
  /** Signer's left/right hand as reported by MediaPipe handedness; null when not detected. */
  left_hand: HandLandmarks | null;
  right_hand: HandLandmarks | null;
}

export interface Sample {
  sample_id: string;
  label: string;
  source: "local_webcam";
  reference_urls: string[];
  session_id: string;
  signer_id: string;
  recorded_at: string;
  duration_ms: number;
  frames: LandmarkFrame[];
}

export interface Dataset {
  format: typeof DATASET_FORMAT;
  version: typeof DATASET_VERSION;
  exported_at: string;
  samples: Sample[];
}
