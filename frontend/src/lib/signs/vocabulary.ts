import type { IntentInfo } from "@/types/api";

import { UNKNOWN_LABEL } from "./types";

/**
 * Helpers over the vocabulary registry served by the Go API. No intent IDs
 * are hardcoded in the frontend; everything is derived from the registry and
 * from the labels a loaded model exposes.
 */

/** Labels that may be recorded on /training: registry training targets + UNKNOWN. */
export function trainingLabels(registry: IntentInfo[]): string[] {
  return [...registry.filter((e) => e.supported && e.training_target).map((e) => e.id), UNKNOWN_LABEL];
}

/** Whether a predicted label may be shown as recognized and sent for interpretation. */
export function isInterpretable(label: string, registry: IntentInfo[] | null): boolean {
  if (!registry || label === UNKNOWN_LABEL) return false;
  return registry.some((e) => e.id === label && e.supported);
}

/**
 * Splits a model's labels into the ones the registry supports and the ones
 * that will be ignored (e.g. a model trained before an entry was removed).
 */
export function modelCoverage(modelLabels: string[], registry: IntentInfo[] | null) {
  const intents = modelLabels.filter((l) => l !== UNKNOWN_LABEL);
  return {
    active: intents.filter((l) => isInterpretable(l, registry)),
    ignored: registry ? intents.filter((l) => !isInterpretable(l, registry)) : [],
    hasUnknown: modelLabels.includes(UNKNOWN_LABEL),
  };
}
