"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CameraPanel } from "@/components/workspace/camera-panel";
import { CustomSignPanel, type LastSpoken, type RecognizedIntent } from "@/components/workspace/custom-sign-panel";
import { TranslationPanel } from "@/components/workspace/translation-panel";
import { useCamera } from "@/hooks/use-camera";
import { useHandTracking, type RecognitionEvent } from "@/hooks/use-hand-tracking";
import { useIntents } from "@/hooks/use-intents";
import { useSignModel } from "@/hooks/use-sign-model";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { apiClient, ApiError } from "@/lib/api-client";
import { buildGestureInterpretRequest, buildIntentRequest } from "@/lib/api-requests";
import { GESTURE_MIN_CONFIDENCE } from "@/lib/config";
import { speechLangFor, type OutputLanguage } from "@/lib/languages";
import type { Prediction } from "@/lib/signs/knn";
import { toLandmarkFrame } from "@/lib/signs/landmarks";
import {
  acceptsRecognition,
  COOLDOWN_MS,
  displayPhase,
  transition,
  type PipelineEvent,
  type PipelinePhase,
} from "@/lib/signs/pipeline";
import { RealtimeSignRecognizer } from "@/lib/signs/realtime";
import { isInterpretable } from "@/lib/signs/vocabulary";
import type { FrameObservation } from "@/lib/vision/types";
import type { IntentResult } from "@/types/api";
import type { InterpretationResult, SignSequence } from "@/types/sign";
import { cn } from "@/lib/utils";

/** Keep the sequence short; older gestures drop off the front. */
const MAX_SEQUENCE = 12;

type Mode = "gesture" | "custom";
type ApiFailure = { code: string; message: string };

const toFailure = (err: unknown): ApiFailure =>
  err instanceof ApiError ? { code: err.code, message: err.message } : { code: "unknown", message: "Interpretation failed." };

export function TranslationWorkspace() {
  const camera = useCamera();
  const speech = useSpeechSynthesis();
  const signModel = useSignModel();
  const { intents } = useIntents();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<Mode>("custom");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [language, setLanguage] = useState<OutputLanguage>("es");

  // Generic gesture mode
  const [gestures, setGestures] = useState<SignSequence>([]);
  const [result, setResult] = useState<InterpretationResult | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<ApiFailure | null>(null);

  // Custom sign mode
  const [live, setLive] = useState<Prediction | null>(null);
  const [recognized, setRecognized] = useState<RecognizedIntent | null>(null);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [intentError, setIntentError] = useState<ApiFailure | null>(null);

  // Recognition -> interpretation -> speech state machine (lib/signs/pipeline.ts)
  const [phase, setPhase] = useState<PipelinePhase>("recognizing");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [muted, setMuted] = useState(false);
  const [lastSpoken, setLastSpoken] = useState<LastSpoken | null>(null);
  const phaseRef = useRef<PipelinePhase>("recognizing");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef({ autoSpeak, muted, language });
  useEffect(() => {
    settingsRef.current = { autoSpeak, muted, language };
  }, [autoSpeak, muted, language]);
  const modelIdRef = useRef<string | null>(null);
  useEffect(() => {
    modelIdRef.current = signModel.model?.model_id ?? null;
  }, [signModel.model]);

  const recognizerRef = useRef<RealtimeSignRecognizer | null>(null);
  const modeRef = useRef<Mode>(mode);
  const liveKeyRef = useRef("");
  const intentsRef = useRef(intents);
  useEffect(() => {
    intentsRef.current = intents;
  }, [intents]);

  const cameraActive = camera.status === "active";
  // Fresh recognizer whenever the model, mode, or camera session changes.
  useEffect(() => {
    modeRef.current = mode;
    recognizerRef.current = signModel.model && mode === "custom" && cameraActive ? new RealtimeSignRecognizer(signModel.model) : null;
    liveKeyRef.current = "";
  }, [signModel.model, mode, cameraActive]);

  const dispatch = useCallback((event: PipelineEvent) => {
    const next = transition(phaseRef.current, event);
    phaseRef.current = next;
    setPhase(next);
    if (next === "cooldown") {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      cooldownRef.current = setTimeout(() => {
        cooldownRef.current = null;
        const after = transition(phaseRef.current, { type: "cooldown_end" });
        phaseRef.current = after;
        setPhase(after);
      }, COOLDOWN_MS);
    }
  }, []);

  const { speak, cancel } = speech;
  const speakResult = useCallback(
    (res: IntentResult, lang: OutputLanguage) => {
      const text = lang === "es" ? res.text_es : res.text_en;
      setLastSpoken({ intent: res.intent, text, language: lang, source: res.source, at: Date.now() });
      speak(text, speechLangFor(lang), {
        onEnd: () => dispatch({ type: "speech_end" }),
        onError: () => dispatch({ type: "speech_end" }),
      });
    },
    [speak, dispatch],
  );

  /** Cancels our own speech; cancelled utterances report no end, so advance the machine here. */
  const stopSpeech = useCallback(() => {
    cancel();
    if (phaseRef.current === "speaking") dispatch({ type: "speech_end" });
  }, [cancel, dispatch]);

  // Go -> Muse Spark (or labeled local fallback), then optional automatic speech.
  const runInterpret = useCallback(
    async (rec: RecognizedIntent, modelId: string) => {
      dispatch({ type: "interpret" });
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIntentError(null);
      const { language: lang, autoSpeak: auto, muted: mute } = settingsRef.current;
      try {
        const res = await apiClient.interpretIntent(
          buildIntentRequest({ intent: rec.intent, confidence: rec.confidence, language: lang, modelId }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setIntentResult(res);
        const shouldSpeak = auto && !mute;
        dispatch({ type: "result", speak: shouldSpeak });
        if (shouldSpeak) speakResult(res, lang);
      } catch (err) {
        if (controller.signal.aborted) return;
        setIntentResult(null);
        setIntentError(toFailure(err));
        dispatch({ type: "failed" });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [dispatch, speakResult],
  );
  const runInterpretRef = useRef(runInterpret);
  useEffect(() => {
    runInterpretRef.current = runInterpret;
  }, [runInterpret]);

  // Stopping the camera (or unmounting) cancels speech, pending requests, and cooldown.
  useEffect(() => {
    if (!cameraActive) return;
    return () => {
      cancel();
      abortRef.current?.abort();
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      phaseRef.current = "recognizing";
      setPhase("recognizing");
    };
  }, [cameraActive, cancel]);

  const onFrame = useCallback((frame: FrameObservation, ts: number) => {
    const rec = recognizerRef.current;
    if (!rec || modeRef.current !== "custom") return;
    const step = rec.push(toLandmarkFrame(frame, ts));
    if (step.prediction) {
      const key = `${step.prediction.label}|${step.prediction.candidate}|${step.prediction.reason}|${step.prediction.confidence.toFixed(2)}`;
      if (key !== liveKeyRef.current) {
        liveKeyRef.current = key;
        setLive(step.prediction);
      }
    }
    // Only registry-supported labels count, and only while RECOGNIZING: a held
    // sign or a sign during interpretation/speech/cooldown is ignored.
    if (step.event && isInterpretable(step.event.label, intentsRef.current) && acceptsRecognition(phaseRef.current)) {
      const rec = { intent: step.event.label, confidence: step.event.confidence, at: Date.now() };
      setRecognized(rec);
      setIntentResult(null);
      setIntentError(null);
      dispatch({ type: "recognized" });
      if (settingsRef.current.autoSpeak && modelIdRef.current) void runInterpretRef.current(rec, modelIdRef.current);
    }
  }, [dispatch]);

  const onRecognition = useCallback((event: RecognitionEvent) => {
    if (modeRef.current !== "gesture") return;
    setGestures((prev) =>
      [...prev, { label: event.label, confidence: Math.round(event.confidence * 1000) / 1000, timestamp: event.timestamp }].slice(-MAX_SEQUENCE),
    );
  }, []);

  const vision = useHandTracking({
    videoRef,
    canvasRef,
    enabled: cameraActive,
    showSkeleton,
    minConfidence: GESTURE_MIN_CONFIDENCE,
    onRecognition,
    onFrame,
  });

  // Only an explicit click sends anything to the Go API (and on to Meta).
  const interpretGestures = async () => {
    if (gestures.length === 0) return;
    speech.cancel();
    setInterpreting(true);
    setInterpretError(null);
    try {
      setResult(await apiClient.interpret(buildGestureInterpretRequest(gestures, language)));
    } catch (err) {
      setResult(null);
      setInterpretError(toFailure(err));
    } finally {
      setInterpreting(false);
    }
  };

  const interpretIntent = () => {
    if (!recognized || !signModel.model) return;
    stopSpeech();
    void runInterpret(recognized, signModel.model.model_id);
  };

  const replay = () => {
    if (!intentResult || phaseRef.current === "interpreting") return;
    dispatch({ type: "replay" });
    speakResult(intentResult, language);
  };

  const toggleMuted = () => {
    if (!muted) stopSpeech();
    setMuted(!muted);
  };

  const clear = useCallback(() => {
    cancel();
    abortRef.current?.abort();
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    phaseRef.current = "recognizing";
    setPhase("recognizing");
    setGestures([]);
    setResult(null);
    setInterpretError(null);
    setRecognized(null);
    setIntentResult(null);
    setIntentError(null);
    recognizerRef.current?.reset();
  }, [cancel]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    clear();
    setLive(null);
    setMode(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Recognition mode" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted-foreground">Recognition mode</span>
        {(
          [
            ["custom", "Custom signs (LSRD)"],
            ["gesture", "Generic gestures"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            role="radio"
            aria-checked={mode === value}
            size="sm"
            variant={mode === value ? "default" : "outline"}
            onClick={() => switchMode(value)}
          >
            {label}
          </Button>
        ))}
        {mode === "custom" && signModel.status !== "ready" && signModel.status !== "loading" && (
          <span className="text-xs text-destructive">No trained model, so custom recognition is off.</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CameraPanel
          camera={camera}
          vision={vision}
          videoRef={videoRef}
          canvasRef={canvasRef}
          showSkeleton={showSkeleton}
          onToggleSkeleton={() => setShowSkeleton((s) => !s)}
        />
        {mode === "custom" ? (
          <CustomSignPanel
            vision={vision}
            model={signModel}
            intents={intents}
            live={cameraActive ? live : null}
            recognized={recognized}
            result={intentResult}
            interpreting={phase === "interpreting"}
            error={intentError}
            phase={displayPhase(phase, cameraActive)}
            autoSpeak={autoSpeak}
            onToggleAutoSpeak={() => setAutoSpeak((a) => !a)}
            muted={muted}
            onToggleMuted={toggleMuted}
            lastSpoken={lastSpoken}
            language={language}
            onLanguageChange={setLanguage}
            onInterpret={interpretIntent}
            onClear={clear}
            speech={{
              supported: speech.supported,
              speaking: speech.speaking,
              error: speech.error,
              voiceLabel: speech.voiceLabel,
              onSpeak: replay,
              onStop: stopSpeech,
            }}
          />
        ) : (
          <TranslationPanel
            vision={vision}
            minConfidence={GESTURE_MIN_CONFIDENCE}
            gestures={gestures}
            result={result}
            interpreting={interpreting}
            interpretError={interpretError}
            language={language}
            onLanguageChange={setLanguage}
            onInterpret={interpretGestures}
            onClear={clear}
            speech={{
              supported: speech.supported,
              speaking: speech.speaking,
              onSpeak: () => {
                if (result) {
                  speech.speak(result.interpretation.text, speechLangFor(result.interpretation.language as OutputLanguage));
                }
              },
              onStop: speech.cancel,
            }}
          />
        )}
      </div>

      <p className={cn("flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground")}>
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Experimental recognition of a limited set of verified Dominican Sign Language expressions. Multi-sign phrases are experimental
        communication intents whose LSRD sign order is not verified. Not a replacement for a qualified sign language interpreter.
      </p>
    </div>
  );
}
