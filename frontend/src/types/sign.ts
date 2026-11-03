/**
 * Shared types for sign recognition and interpretation.
 * These mirror the Go backend's `internal/domain` package; keep them in sync.
 */

/** Classifier confidence score in the range [0, 1]. */
export type RecognitionConfidence = number;

/** A single sign label produced by the on-device recognizer. */
export interface RecognizedSign {
  label: string;
  confidence: RecognitionConfidence;
  /** Unix epoch time in milliseconds. */
  timestamp: number;
}

/** Ordered list of recognized signs. */
export type SignSequence = RecognizedSign[];

/** Request body for POST /api/v1/interpret. */
export interface InterpretationRequest {
  signs: SignSequence;
  /** BCP 47 language tag for the output text, e.g. "en" or "es". */
  language: string;
}

/** Natural-language interpretation returned by the backend. */
export interface InterpretationResult {
  text: string;
  language: string;
  confidence: RecognitionConfidence;
  model?: string;
}

/** Recognition pipeline state shown to the user. */
export type RecognitionStatus =
  | "camera-off"
  | "recognizer-unavailable"
  | "listening"
  | "interpreting";
