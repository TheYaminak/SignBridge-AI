import type { TokenUsage } from "@/types/sign";

/** Response body of GET /health. */
export interface HealthResponse {
  status: "ok";
  service: string;
  /** Request-contract version; missing on backends older than Phase 4. */
  api_version?: number;
}

/** Contract version this frontend needs (see backend handler.APIVersion). */
export const REQUIRED_API_VERSION = 3;

export type VerificationStatus = "verified_sign" | "word_references" | "unavailable";

export interface IntentReference {
  gloss: string;
  url: string;
}

export type FeatureRequirement = "yes" | "no" | "unknown";

/** An entry of the vocabulary registry (GET /api/v1/intents, backend vocabulary.json). */
export interface IntentInfo {
  id: string;
  /** "phrase_intent" today; "sign" is reserved for future single-sign entries. */
  kind: "phrase_intent" | "sign";
  text_es: string;
  text_en: string;
  status: VerificationStatus;
  supported: boolean;
  training_target: boolean;
  training_status: string;
  recognizer: string;
  sign_count: number;
  components: string[];
  /** True only when the complete expression, including sign order, is documented. */
  sequence_verified: boolean;
  requires_motion: FeatureRequirement;
  requires_non_manual: FeatureRequirement;
  references: IntentReference[];
  note: string;
}

export interface IntentsResponse {
  version: number;
  intents: IntentInfo[];
  unknown: string;
}

/** Body of POST /api/v1/intents/interpret. */
export interface IntentRequest {
  /** Phrase-level temporal classifier. "custom_sign" is the Phase 4 alias. */
  recognition_type: "custom_sign_sequence" | "custom_sign";
  intent: string;
  confidence: number;
  language: string;
  raw_labels: string[];
  source?: "camera" | "manual";
  model_id?: string;
}

/** Response of POST /api/v1/intents/interpret. */
export interface IntentResult {
  intent: string;
  raw_labels: string[];
  confidence: number;
  language: string;
  text_es: string;
  text_en: string;
  uncertain: boolean;
  source: "meta" | "local_fallback";
  fallback_reason?: string;
  model: string;
  provider?: string;
  latency_ms: number;
  usage?: TokenUsage;
  verification: { status: VerificationStatus; sequence_verified: boolean; references: IntentReference[] };
  /** The LSRD sign sequence for this expression is not verified. */
  experimental: boolean;
  prediction_note: string;
}

/** Shape of every error response returned by the Go backend. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** GET /api/v1/meta/status: configuration only, never a live check. */
export interface MetaStatusResponse {
  configured: boolean;
  model: string;
}

/** POST /api/v1/meta/test: result of a real request to the Meta Model API. */
export interface MetaTestResponse {
  success: boolean;
  provider: string;
  model: string;
  response: string;
  latency_ms: number;
  usage?: TokenUsage;
}
