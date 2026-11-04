/**
 * Recognition → interpretation → speech state machine for custom signs.
 *
 *   IDLE (camera off)
 *   RECOGNIZING ──stable intent──▶ CONFIRMED ──auto or manual──▶ INTERPRETING
 *   INTERPRETING ──result──▶ SPEAKING ──speech end──▶ COOLDOWN ──timer──▶ RECOGNIZING
 *   INTERPRETING ──result (muted / auto speak off) or failure──▶ COOLDOWN
 *
 * New recognitions are accepted only in RECOGNIZING, so a held sign can't
 * trigger repeated Meta requests or overlapping speech. IDLE is derived from
 * the camera state (see displayPhase). Pure functions, unit-tested.
 */
export type PipelinePhase = "recognizing" | "confirmed" | "interpreting" | "speaking" | "cooldown";
export type DisplayPhase = PipelinePhase | "idle";

export type PipelineEvent =
  | { type: "recognized" }
  | { type: "interpret" }
  | { type: "result"; speak: boolean }
  | { type: "failed" }
  | { type: "replay" }
  | { type: "speech_end" }
  | { type: "cooldown_end" }
  | { type: "reset" };

export const COOLDOWN_MS = 1500;

export function transition(phase: PipelinePhase, event: PipelineEvent): PipelinePhase {
  switch (event.type) {
    case "reset":
      return "recognizing";
    case "recognized":
      return phase === "recognizing" ? "confirmed" : phase;
    case "interpret":
      return phase === "interpreting" || phase === "speaking" ? phase : "interpreting";
    case "result":
      if (phase !== "interpreting") return phase;
      return event.speak ? "speaking" : "cooldown";
    case "failed":
      return phase === "interpreting" ? "cooldown" : phase;
    case "replay":
      return phase === "interpreting" ? phase : "speaking";
    case "speech_end":
      return phase === "speaking" ? "cooldown" : phase;
    case "cooldown_end":
      return phase === "cooldown" ? "recognizing" : phase;
  }
}

/** Only RECOGNIZING accepts new recognition events. */
export function acceptsRecognition(phase: PipelinePhase): boolean {
  return phase === "recognizing";
}

export function displayPhase(phase: PipelinePhase, cameraActive: boolean): DisplayPhase {
  return phase === "recognizing" && !cameraActive ? "idle" : phase;
}
