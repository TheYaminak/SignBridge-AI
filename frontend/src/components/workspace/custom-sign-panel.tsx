"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BrainCircuit,
  Eraser,
  ExternalLink,
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
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { useHandTracking } from "@/hooks/use-hand-tracking";
import type { useSignModel } from "@/hooks/use-sign-model";
import { DEV_TOOLS_ENABLED } from "@/lib/config";
import { formatPercent } from "@/lib/format";
import { OUTPUT_LANGUAGES, type OutputLanguage } from "@/lib/languages";
import type { Prediction } from "@/lib/signs/knn";
import { UNKNOWN_LABEL } from "@/lib/signs/types";
import { modelCoverage } from "@/lib/signs/vocabulary";
import type { IntentInfo, IntentResult, VerificationStatus } from "@/types/api";

export interface RecognizedIntent {
  intent: string;
  confidence: number;
  /** Unix epoch ms. */
  at: number;
}

interface CustomSignPanelProps {
  vision: ReturnType<typeof useHandTracking>;
  model: ReturnType<typeof useSignModel>;
  intents: IntentInfo[] | null;
  live: Prediction | null;
  recognized: RecognizedIntent | null;
  result: IntentResult | null;
  interpreting: boolean;
  error: { code: string; message: string } | null;
  language: OutputLanguage;
  onLanguageChange: (language: OutputLanguage) => void;
  onInterpret: () => void;
  onClear: () => void;
  speech: { supported: boolean; speaking: boolean; onSpeak: () => void; onStop: () => void };
}

const REASONS: Record<Prediction["reason"], string> = {
  accepted: "Accepted",
  unknown_class: "Looks like rest / unrelated movement",
  low_confidence: "Confidence too low",
  out_of_distribution: "Unlike any trained example",
  no_hands: "No hands in view",
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  if (status === "verified_sign") {
    return <Badge variant="outline" className="border-success/50 text-success">LSRD sign verified</Badge>;
  }
  if (status === "word_references") {
    return <Badge variant="outline" className="border-warning/50 text-warning">LSRD words verified · phrase proposed</Badge>;
  }
  return <Badge variant="destructive">Unavailable</Badge>;
}

const heading = "text-xs font-medium tracking-wide text-muted-foreground uppercase";

export function CustomSignPanel({
  vision,
  model,
  intents,
  live,
  recognized,
  result,
  interpreting,
  error,
  language,
  onLanguageChange,
  onInterpret,
  onClear,
  speech,
}: CustomSignPanelProps) {
  const info = recognized ? intents?.find((i) => i.id === recognized.intent) : undefined;
  const coverage = model.model ? modelCoverage(model.model.labels, intents) : null;
  const livePct = live ? Math.round(live.confidence * 100) : null;
  const text = result ? (language === "es" ? result.text_es : result.text_en) : null;
  const otherText = result ? (language === "es" ? result.text_en : result.text_es) : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-4 text-primary" aria-hidden="true" />
          Translation
        </CardTitle>
        <CardDescription>Custom sign recognition (experimental, limited vocabulary).</CardDescription>
        <CardAction>
          <Select
            value={language}
            onValueChange={(v) => v && onLanguageChange(v as OutputLanguage)}
            items={OUTPUT_LANGUAGES.map(({ value, label }) => ({ value, label }))}
          >
            <SelectTrigger size="sm" aria-label="Output language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTPUT_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <StatusDot
            className="mt-1.5"
            tone={model.status === "ready" ? (vision.status === "running" ? "success" : "muted") : model.status === "loading" ? "warning" : "danger"}
            pulse={model.status === "ready" && vision.status === "running"}
          />
          <div className="flex-1">
            {model.status === "ready" && model.model ? (
              <>
                <p className="font-medium">
                  Custom model loaded <span className="font-mono text-xs text-muted-foreground">{model.model.model_id}</span>
                </p>
                <p className="text-muted-foreground">
                  {model.source === "browser" ? "Trained in this browser" : "Bundled with the app"} · {model.model.training.samples} samples ·{" "}
                  {coverage?.active.length ? coverage.active.join(", ") : "no supported labels"}
                </p>
                {coverage && coverage.ignored.length > 0 && (
                  <p className="text-xs text-warning">Ignored (not supported in the vocabulary registry): {coverage.ignored.join(", ")}</p>
                )}
                {coverage && !coverage.hasUnknown && (
                  <p className="text-xs text-warning">This model has no UNKNOWN class, so it can only reject by distance.</p>
                )}
                {!intents && <p className="text-xs text-warning">Vocabulary registry unavailable: recognitions are paused.</p>}
              </>
            ) : model.status === "loading" ? (
              <p className="font-medium">Loading custom model…</p>
            ) : (
              <>
                <p className="font-medium text-destructive">No trained custom model</p>
                <p className="text-muted-foreground">
                  Custom sign recognition is disabled until a model is trained.{" "}
                  {DEV_TOOLS_ENABLED && (
                    <Link href="/training" className="text-primary underline-offset-2 hover:underline">Record samples and train →</Link>
                  )}
                  {model.error && ` (${model.error})`}
                </p>
              </>
            )}
          </div>
          <Badge variant="outline" className="shrink-0 tabular-nums">
            {vision.snapshot.handCount} {vision.snapshot.handCount === 1 ? "hand" : "hands"}
          </Badge>
        </div>

        {model.status === "ready" && (
          <section aria-labelledby="live-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 id="live-heading" className={heading}>Live prediction (3 s window)</h3>
              <span className="text-xs text-muted-foreground">
                {live ? REASONS[live.reason] : vision.status === "running" ? "Collecting frames…" : "Camera off"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-lg font-medium">{live ? live.label : "—"}</span>
              <span id="live-confidence" className="tabular-nums text-muted-foreground">
                {live && live.label !== UNKNOWN_LABEL ? `${livePct}%` : live?.candidate && live.candidate !== UNKNOWN_LABEL ? `(${live.candidate} ${livePct}%)` : ""}
              </span>
            </div>
            <Progress value={live && live.label !== UNKNOWN_LABEL ? livePct : 0} aria-labelledby="live-confidence" />
          </section>
        )}

        <section aria-labelledby="recognized-heading" className="flex flex-col gap-2">
          <h3 id="recognized-heading" className={heading}>Recognized intent</h3>
          {recognized ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold">{recognized.intent}</span>
                <span className="text-sm tabular-nums text-muted-foreground">confidence {formatPercent(recognized.confidence)}</span>
              </div>
              {info && (
                <>
                  <p className="text-sm text-muted-foreground">Label meaning: “{info.text_es}” / “{info.text_en}”</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <VerificationBadge status={info.status} />
                    {info.references.map((r) => (
                      <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                        {r.gloss} <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">Model prediction, not a verified translation.</p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {model.status === "ready" ? "Perform a trained expression and hold still afterwards." : "No custom model, so nothing can be recognized."}
            </p>
          )}
          <Button onClick={onInterpret} disabled={!recognized || interpreting} className="self-start">
            {interpreting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {interpreting ? "Interpreting…" : "Interpret recognized intent"}
          </Button>
        </section>

        <section aria-labelledby="custom-ai-heading" className="flex flex-col gap-2">
          <h3 id="custom-ai-heading" className={`${heading} flex items-center gap-1.5`}>
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            Interpretation
          </h3>
          <div aria-live="polite" className="min-h-20 rounded-lg border bg-background/40 p-4 text-lg leading-relaxed">
            {text ? (
              <>
                <p lang={language}>{text}</p>
                <p lang={language === "es" ? "en" : "es"} className="mt-1 text-sm text-muted-foreground">{otherText}</p>
              </>
            ) : (
              <p className="text-base text-muted-foreground">Recognize an intent, then select “Interpret recognized intent” (sent to Muse Spark via Go).</p>
            )}
          </div>
          {result && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {result.source === "meta" ? (
                <Badge variant="outline" className="gap-1"><BrainCircuit className="size-3" aria-hidden="true" />Muse Spark · {result.model}</Badge>
              ) : (
                <Badge variant="outline" className="border-warning/50 text-warning">Local fallback phrase · not generated by Meta ({result.fallback_reason})</Badge>
              )}
              {result.source === "meta" && <span>{result.latency_ms} ms</span>}
              {result.uncertain && <Badge variant="outline" className="border-warning/50 text-warning">Uncertain</Badge>}
            </div>
          )}
          {result && <p className="text-xs text-muted-foreground">{result.prediction_note}</p>}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Interpretation failed</AlertTitle>
              <AlertDescription>
                {error.message} <span className="font-mono text-xs opacity-80">({error.code})</span>
              </AlertDescription>
            </Alert>
          )}
        </section>
      </CardContent>

      <Separator />

      <CardFooter className="flex flex-wrap gap-3">
        {speech.speaking ? (
          <Button variant="secondary" size="lg" onClick={speech.onStop}>
            <Square aria-hidden="true" />Stop speaking
          </Button>
        ) : (
          <Button size="lg" onClick={speech.onSpeak} disabled={!speech.supported || !result}>
            <Volume2 aria-hidden="true" />Speak
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={onClear} disabled={!recognized && !result && !error}>
          <Eraser aria-hidden="true" />Clear
        </Button>
      </CardFooter>
    </Card>
  );
}
