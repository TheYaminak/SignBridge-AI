"use client";

import {
  AlertTriangle,
  Eraser,
  Languages,
  Loader2,
  Send,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";

import { StatusDot } from "@/components/status-dot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { useHandTracking } from "@/hooks/use-hand-tracking";
import { formatPercent } from "@/lib/format";
import { OUTPUT_LANGUAGES, type OutputLanguage } from "@/lib/languages";
import {
  SUPPORTED_GESTURES,
  gestureDisplayName,
  gestureEmoji,
} from "@/lib/vision/gestures";
import type { InterpretationResult, SignSequence } from "@/types/sign";

type Vision = ReturnType<typeof useHandTracking>;

interface TranslationPanelProps {
  vision: Vision;
  minConfidence: number;
  gestures: SignSequence;
  result: InterpretationResult | null;
  interpreting: boolean;
  interpretError: { code: string; message: string } | null;
  language: OutputLanguage;
  onLanguageChange: (language: OutputLanguage) => void;
  onInterpret: () => void;
  onClear: () => void;
  speech: {
    supported: boolean;
    speaking: boolean;
    onSpeak: () => void;
    onStop: () => void;
  };
}

function visionCopy(vision: Vision): {
  label: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  switch (vision.status) {
    case "off":
      return { label: "Camera off", detail: "Start the camera to begin hand tracking.", tone: "muted" };
    case "loading":
      return { label: "Loading hand model", detail: "Preparing MediaPipe in your browser…", tone: "warning" };
    case "error":
      return { label: "Hand tracking error", detail: vision.error ?? "Hand tracking is unavailable.", tone: "danger" };
    case "running":
      return vision.snapshot.handCount > 0
        ? { label: "Tracking hands", detail: "Hold a supported gesture steady to add it to the sequence.", tone: "success" }
        : { label: "No hands detected", detail: "Raise one or both hands into view.", tone: "warning" };
  }
}

const sectionHeading = "text-xs font-medium tracking-wide text-muted-foreground uppercase";

export function TranslationPanel({
  vision,
  minConfidence,
  gestures,
  result,
  interpreting,
  interpretError,
  language,
  onLanguageChange,
  onInterpret,
  onClear,
  speech,
}: TranslationPanelProps) {
  const copy = visionCopy(vision);
  const { snapshot } = vision;
  const current = snapshot.gesture;
  const currentPct = current ? Math.round(current.confidence * 100) : null;
  const hasContent = gestures.length > 0 || result !== null || interpretError !== null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" aria-hidden="true" />
          Translation
        </CardTitle>
        <CardDescription>
          Detects generic hand gestures, not full sign language.
        </CardDescription>
        <CardAction>
          <Select
            value={language}
            onValueChange={(value) => {
              if (value) onLanguageChange(value as OutputLanguage);
            }}
            items={OUTPUT_LANGUAGES.map(({ value, label }) => ({ value, label }))}
          >
            <SelectTrigger size="sm" aria-label="Output language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3"
        >
          <StatusDot tone={copy.tone} pulse={copy.tone === "success"} className="mt-1.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium">{copy.label}</p>
            <p className="text-muted-foreground">{copy.detail}</p>
          </div>
          <Badge variant="outline" className="shrink-0 tabular-nums">
            {snapshot.handCount} {snapshot.handCount === 1 ? "hand" : "hands"}
          </Badge>
        </div>

        <section aria-labelledby="current-gesture-heading" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 id="current-gesture-heading" className={sectionHeading}>
              Current gesture
            </h3>
            <span className="text-xs text-muted-foreground">
              Threshold {formatPercent(minConfidence)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg border bg-background/40 text-2xl" aria-hidden="true">
              {current ? gestureEmoji(current.label) || "✋" : "·"}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {current ? gestureDisplayName(current.label) : "No gesture"}
                </span>
                <span id="gesture-confidence-label" className="tabular-nums text-muted-foreground">
                  {currentPct === null ? "—" : `${currentPct}%`}
                </span>
              </div>
              <Progress
                value={currentPct}
                aria-labelledby="gesture-confidence-label"
                aria-valuetext={currentPct === null ? "No gesture" : `${currentPct} percent confidence`}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Supported:{" "}
            {SUPPORTED_GESTURES.map((g) => (
              <span key={g} title={gestureDisplayName(g)} className="mr-1">
                {gestureEmoji(g)}
              </span>
            ))}
          </p>
        </section>

        <section aria-labelledby="sequence-heading" className="flex flex-col gap-2">
          <h3 id="sequence-heading" className={sectionHeading}>
            Recognized gesture sequence
          </h3>
          {gestures.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No gestures recognized yet.
            </p>
          ) : (
            <ol className="flex flex-wrap gap-2" aria-label="Recognized gesture sequence">
              {gestures.map((g) => (
                <li key={g.timestamp}>
                  <Badge variant="secondary" className="gap-1.5">
                    <span aria-hidden="true">{gestureEmoji(g.label)}</span>
                    <span className="font-mono">{g.label}</span>
                    <span className="text-muted-foreground">{formatPercent(g.confidence)}</span>
                  </Badge>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted-foreground">
            Generic MediaPipe gestures, not sign-language words.
          </p>
          <Button
            onClick={onInterpret}
            disabled={gestures.length === 0 || interpreting}
            className="self-start"
          >
            {interpreting ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
            {interpreting ? "Interpreting…" : "Interpret recognized gestures"}
          </Button>
        </section>

        <section aria-labelledby="translation-heading" className="flex flex-col gap-2">
          <h3 id="translation-heading" className={`${sectionHeading} flex items-center gap-1.5`}>
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            AI-generated description
          </h3>
          <div
            aria-live="polite"
            className="min-h-20 rounded-lg border bg-background/40 p-4 text-lg leading-relaxed"
          >
            {result ? (
              <p lang={result.interpretation.language}>{result.interpretation.text}</p>
            ) : (
              <p className="text-base text-muted-foreground">
                Recognize one or more gestures, then select &quot;Interpret recognized gestures&quot;.
              </p>
            )}
          </div>
          {result?.interpretation.needs_clarification && (
            <Alert>
              <AlertTriangle aria-hidden="true" className="text-warning" />
              <AlertTitle>Uncertain description</AlertTitle>
              {result.interpretation.clarification_note && (
                <AlertDescription lang={result.interpretation.language}>
                  {result.interpretation.clarification_note}
                </AlertDescription>
              )}
            </Alert>
          )}
          {result && (
            <p className="text-xs text-muted-foreground">
              Generated by Muse Spark (<span className="font-mono">{result.model}</span>) ·{" "}
              {result.latency_ms} ms · AI confidence {formatPercent(result.interpretation.confidence)}
            </p>
          )}
          {interpretError && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Interpretation failed</AlertTitle>
              <AlertDescription>
                {interpretError.message}{" "}
                <span className="font-mono text-xs opacity-80">({interpretError.code})</span>
              </AlertDescription>
            </Alert>
          )}
        </section>
      </CardContent>

      <Separator />

      <CardFooter className="flex flex-wrap gap-3">
        {speech.speaking ? (
          <Button variant="secondary" size="lg" onClick={speech.onStop}>
            <Square aria-hidden="true" />
            Stop speaking
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={speech.onSpeak}
            disabled={!speech.supported || !result}
            title={
              speech.supported
                ? undefined
                : "Speech synthesis is not supported in this browser"
            }
          >
            <Volume2 aria-hidden="true" />
            Speak
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          onClick={onClear}
          disabled={!hasContent}
        >
          <Eraser aria-hidden="true" />
          Clear
        </Button>
      </CardFooter>
    </Card>
  );
}
