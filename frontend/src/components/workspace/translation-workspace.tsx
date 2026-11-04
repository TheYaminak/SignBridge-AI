"use client";

import { useCallback, useState } from "react";

import { CameraPanel } from "@/components/workspace/camera-panel";
import { TranslationPanel } from "@/components/workspace/translation-panel";
import { useCamera } from "@/hooks/use-camera";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { speechLangFor, type OutputLanguage } from "@/lib/languages";
import type {
  InterpretationResult,
  RecognitionStatus,
  SignSequence,
} from "@/types/sign";

export function TranslationWorkspace() {
  const camera = useCamera();
  const speech = useSpeechSynthesis();
  const [language, setLanguage] = useState<OutputLanguage>("en");
  // Populated by the on-device recognizer (Phase 2) and the Go API (Phase 3).
  const [signs, setSigns] = useState<SignSequence>([]);
  const [result, setResult] = useState<InterpretationResult | null>(null);

  const recognitionStatus: RecognitionStatus =
    camera.status === "active" ? "recognizer-unavailable" : "camera-off";

  const { cancel } = speech;
  const clear = useCallback(() => {
    cancel();
    setSigns([]);
    setResult(null);
  }, [cancel]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <CameraPanel camera={camera} />
      <TranslationPanel
        signs={signs}
        result={result}
        recognitionStatus={recognitionStatus}
        language={language}
        onLanguageChange={setLanguage}
        onClear={clear}
        speech={{
          supported: speech.supported,
          speaking: speech.speaking,
          onSpeak: () => {
            if (result) {
              speech.speak(result.interpretation.text, speechLangFor(language));
            }
          },
          onStop: speech.cancel,
        }}
      />
    </div>
  );
}
