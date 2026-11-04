/**
 * Builders for every request body sent to the Go API. UI code must use these
 * instead of inline objects: api-requests.test.ts checks them against the
 * shared fixtures in contracts/fixtures, which the Go tests also replay.
 */
import type { IntentRequest } from "@/types/api";
import type { InterpretationRequest, SignSequence } from "@/types/sign";

export function buildGestureInterpretRequest(gestures: SignSequence, language: string): InterpretationRequest {
  return {
    signs: gestures.map(({ label, confidence, timestamp }) => ({ label, confidence, timestamp })),
    language,
    source: "camera",
    recognition_type: "gesture",
  };
}

export function buildManualInterpretRequest(signs: SignSequence, language: string): InterpretationRequest {
  return {
    signs: signs.map(({ label, confidence, timestamp }) => ({ label, confidence, timestamp })),
    language,
    source: "manual",
  };
}

export function buildIntentRequest(input: {
  intent: string;
  confidence: number;
  language: string;
  modelId: string;
}): IntentRequest {
  return {
    recognition_type: "custom_sign",
    intent: input.intent,
    confidence: Math.round(input.confidence * 1000) / 1000,
    language: input.language,
    raw_labels: [input.intent],
    source: "camera",
    model_id: input.modelId,
  };
}
