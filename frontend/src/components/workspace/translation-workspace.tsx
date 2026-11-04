"use client";

import { useCallback, useRef, useState } from "react";

import { CameraPanel } from "@/components/workspace/camera-panel";
import { TranslationPanel } from "@/components/workspace/translation-panel";
import { useCamera } from "@/hooks/use-camera";
import { useHandTracking, type RecognitionEvent } from "@/hooks/use-hand-tracking";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { apiClient, ApiError } from "@/lib/api-client";
import { GESTURE_MIN_CONFIDENCE } from "@/lib/config";
import { speechLangFor, type OutputLanguage } from "@/lib/languages";
import type { InterpretationResult, SignSequence } from "@/types/sign";

/** Keep the sequence short; older gestures drop off the front. */
const MAX_SEQUENCE = 12;

export function TranslationWorkspace() {
  const camera = useCamera();
  const speech = useSpeechSynthesis();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [showSkeleton, setShowSkeleton] = useState(true);
  const [language, setLanguage] = useState<OutputLanguage>("es");
  const [gestures, setGestures] = useState<SignSequence>([]);
  const [result, setResult] = useState<InterpretationResult | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<{ code: string; message: string } | null>(null);

  const onRecognition = useCallback((event: RecognitionEvent) => {
    setGestures((prev) =>
      [
        ...prev,
        {
          label: event.label,
          confidence: Math.round(event.confidence * 1000) / 1000,
          timestamp: event.timestamp,
        },
      ].slice(-MAX_SEQUENCE),
    );
  }, []);

  const vision = useHandTracking({
    videoRef,
    canvasRef,
    enabled: camera.status === "active",
    showSkeleton,
    minConfidence: GESTURE_MIN_CONFIDENCE,
    onRecognition,
  });

  // Only an explicit click sends gestures to the Go API (and on to Meta).
  const interpret = async () => {
    if (gestures.length === 0) return;
    speech.cancel();
    setInterpreting(true);
    setInterpretError(null);
    try {
      const res = await apiClient.interpret({
        signs: gestures,
        language,
        source: "camera",
        recognition_type: "gesture",
      });
      setResult(res);
    } catch (err) {
      setResult(null);
      setInterpretError(
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: "unknown", message: "Interpretation failed." },
      );
    } finally {
      setInterpreting(false);
    }
  };

  const { cancel } = speech;
  const clear = useCallback(() => {
    cancel();
    setGestures([]);
    setResult(null);
    setInterpretError(null);
  }, [cancel]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <CameraPanel
        camera={camera}
        vision={vision}
        videoRef={videoRef}
        canvasRef={canvasRef}
        showSkeleton={showSkeleton}
        onToggleSkeleton={() => setShowSkeleton((s) => !s)}
      />
      <TranslationPanel
        vision={vision}
        minConfidence={GESTURE_MIN_CONFIDENCE}
        gestures={gestures}
        result={result}
        interpreting={interpreting}
        interpretError={interpretError}
        language={language}
        onLanguageChange={setLanguage}
        onInterpret={interpret}
        onClear={clear}
        speech={{
          supported: speech.supported,
          speaking: speech.speaking,
          onSpeak: () => {
            if (result) {
              speech.speak(
                result.interpretation.text,
                speechLangFor(result.interpretation.language as OutputLanguage),
              );
            }
          },
          onStop: speech.cancel,
        }}
      />
    </div>
  );
}
