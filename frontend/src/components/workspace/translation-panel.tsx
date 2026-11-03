"use client";

import { Eraser, Languages, Square, Volume2 } from "lucide-react";

import { StatusDot } from "@/components/status-dot";
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
import { OUTPUT_LANGUAGES, type OutputLanguage } from "@/lib/languages";
import type {
  InterpretationResult,
  RecognitionStatus,
  SignSequence,
} from "@/types/sign";

const RECOGNITION_COPY: Record<
  RecognitionStatus,
  { label: string; detail: string; tone: "success" | "warning" | "muted" }
> = {
  "camera-off": {
    label: "Camera off",
    detail: "Start the camera to prepare for recognition.",
    tone: "muted",
  },
  "recognizer-unavailable": {
    label: "Recognizer not loaded",
    detail:
      "On-device sign recognition is not enabled yet. No signs will be detected.",
    tone: "warning",
  },
  listening: {
    label: "Listening",
    detail: "Watching for signs from the supported vocabulary.",
    tone: "success",
  },
  interpreting: {
    label: "Interpreting",
    detail: "Turning recognized signs into text.",
    tone: "success",
  },
};

interface TranslationPanelProps {
  signs: SignSequence;
  result: InterpretationResult | null;
  recognitionStatus: RecognitionStatus;
  language: OutputLanguage;
  onLanguageChange: (language: OutputLanguage) => void;
  onClear: () => void;
  speech: {
    supported: boolean;
    speaking: boolean;
    onSpeak: () => void;
    onStop: () => void;
  };
}

function averageConfidence(signs: SignSequence): number | null {
  if (signs.length === 0) return null;
  return signs.reduce((sum, s) => sum + s.confidence, 0) / signs.length;
}

export function TranslationPanel({
  signs,
  result,
  recognitionStatus,
  language,
  onLanguageChange,
  onClear,
  speech,
}: TranslationPanelProps) {
  const recognition = RECOGNITION_COPY[recognitionStatus];
  const confidence = result?.confidence ?? averageConfidence(signs);
  const confidencePct =
    confidence === null ? null : Math.round(confidence * 100);
  const hasContent = signs.length > 0 || result !== null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" aria-hidden="true" />
          Translation
        </CardTitle>
        <CardDescription>
          Limited-vocabulary recognition, not full sign language translation.
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
          <StatusDot
            tone={recognition.tone}
            pulse={recognition.tone === "success"}
            className="mt-1.5"
          />
          <div className="text-sm">
            <p className="font-medium">{recognition.label}</p>
            <p className="text-muted-foreground">{recognition.detail}</p>
          </div>
        </div>

        <section aria-labelledby="signs-heading" className="flex flex-col gap-2">
          <h3
            id="signs-heading"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Recognized signs
          </h3>
          {signs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No signs recognized yet.
            </p>
          ) : (
            <ol className="flex flex-wrap gap-2" aria-label="Recognized sign sequence">
              {signs.map((s) => (
                <li key={`${s.timestamp}-${s.label}`}>
                  <Badge variant="secondary" className="font-mono">
                    {s.label}
                    <span className="text-muted-foreground">
                      {Math.round(s.confidence * 100)}%
                    </span>
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="translation-heading"
          className="flex flex-col gap-2"
        >
          <h3
            id="translation-heading"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            Translation
          </h3>
          <div
            aria-live="polite"
            className="min-h-24 rounded-lg border bg-background/40 p-4 text-lg leading-relaxed"
          >
            {result ? (
              <p lang={result.language}>{result.text}</p>
            ) : (
              <p className="text-base text-muted-foreground">
                The translation will appear here once signs are recognized.
              </p>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span id="confidence-label" className="font-medium text-muted-foreground">
              Confidence
            </span>
            <span className="tabular-nums text-muted-foreground">
              {confidencePct === null ? "—" : `${confidencePct}%`}
            </span>
          </div>
          <Progress
            value={confidencePct}
            aria-labelledby="confidence-label"
            aria-valuetext={
              confidencePct === null ? "No data" : `${confidencePct} percent`
            }
          />
        </div>
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
