/**
 * Shared types for sign recognition and interpretation.
 * These mirror the Go backend's `internal/domain` package; keep them in sync.
 */

/** Classifier confidence score in the range [0, 1]. */
export type RecognitionConfidence = number;

/** A single sign label produced by the recognizer (or entered manually in dev tools). */
export interface RecognizedSign {
  label: string;
  confidence: RecognitionConfidence;
  /** Unix epoch time in milliseconds. */
  timestamp: number;
}

/** Ordered list of recognized signs. */
export type SignSequence = RecognizedSign[];

/** Where a sign sequence came from. Manual input is never camera recognition. */
export type SignSource = "camera" | "manual";

/**
 * What the labels are: "gesture" = generic MediaPipe hand gestures (not sign
 * language); "sign" = sign-language glosses (manual test / future classifier).
 */
export type RecognitionType = "sign" | "gesture";

/** Request body for POST /api/v1/interpret. */
export interface InterpretationRequest {
  signs: SignSequence;
  /** Output language: "es" or "en". */
  language: string;
  source?: SignSource;
  /** Defaults to "sign" on the backend. */
  recognition_type?: RecognitionType;
}

/** An input sign that was not sent to the model, and why. */
export interface DiscardedSign extends RecognizedSign {
  reason: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
}

/** AI-generated text, kept separate from the raw recognized labels. */
export interface Interpretation {
  text: string;
  language: string;
  /** The model's self-assessed confidence in its reading. */
  confidence: RecognitionConfidence;
  needs_clarification: boolean;
  clarification_note?: string;
  generated_by: "ai";
}

/** Response of POST /api/v1/interpret. */
export interface InterpretationResult {
  source?: SignSource;
  recognition_type: RecognitionType;
  /** Normalized input signs that met the threshold and were sent to the model. */
  recognized_signs: SignSequence;
  discarded_signs: DiscardedSign[];
  min_confidence: number;
  interpretation: Interpretation;
  provider: string;
  model: string;
  latency_ms: number;
  usage?: TokenUsage;
}
