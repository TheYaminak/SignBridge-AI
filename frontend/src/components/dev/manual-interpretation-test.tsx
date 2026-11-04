"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FlaskConical,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSpeechSynthesis } from "@/hooks/use-speech-synthesis";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatPercent, formatUsage } from "@/lib/format";
import {
  OUTPUT_LANGUAGES,
  speechLangFor,
  type OutputLanguage,
} from "@/lib/languages";
import type { InterpretationResult, SignSequence } from "@/types/sign";

interface Row {
  id: number;
  label: string;
  confidence: string;
}

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; result: InterpretationResult }
  | { kind: "error"; code: string; message: string };

const MAX_ROWS = 16;

let nextRowId = 1;
const emptyRow = (): Row => ({ id: nextRowId++, label: "", confidence: "" });

/** Returns signs, or an error message describing the first invalid row. */
function buildSigns(rows: Row[]): SignSequence | string {
  const now = Date.now();
  const filled = rows.filter((r) => r.label.trim() || r.confidence.trim());
  if (filled.length === 0) return "Enter at least one sign label and confidence.";
  const signs: SignSequence = [];
  for (const [i, row] of filled.entries()) {
    const confidence = Number(row.confidence);
    if (!row.label.trim()) return `Row ${i + 1}: label is required.`;
    if (row.confidence.trim() === "" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
      return `Row ${i + 1}: confidence must be a number between 0 and 1.`;
    }
    // Timestamps record entry order; these are not camera events.
    signs.push({ label: row.label.trim(), confidence, timestamp: now + i });
  }
  return signs;
}

function SignChip({ label, confidence }: { label: string; confidence: number }) {
  return (
    <Badge variant="secondary" className="font-mono">
      {label}
      <span className="text-muted-foreground">{formatPercent(confidence)}</span>
    </Badge>
  );
}

export function ManualInterpretationTest() {
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);
  const [language, setLanguage] = useState<OutputLanguage>("es");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const speech = useSpeechSynthesis();

  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const signs = buildSigns(rows);
    if (typeof signs === "string") {
      setRun({ kind: "error", code: "invalid_input", message: signs });
      return;
    }
    speech.cancel();
    setRun({ kind: "running" });
    try {
      const result = await apiClient.interpret({ signs, language, source: "manual" });
      setRun({ kind: "success", result });
    } catch (err) {
      setRun(
        err instanceof ApiError
          ? { kind: "error", code: err.code, message: err.message }
          : { kind: "error", code: "unknown", message: "Interpretation failed." },
      );
    }
  };

  const reset = () => {
    speech.cancel();
    setRows([emptyRow()]);
    setRun({ kind: "idle" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" aria-hidden="true" />
          Manual AI Integration Test
        </CardTitle>
        <CardDescription>
          Type sign labels and confidence scores to test the Muse Spark interpretation
          pipeline. These are <strong>manually entered</strong>, not camera recognition.
        </CardDescription>
        <CardAction>
          <Badge variant="outline">Manual input</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Manual sign entry">
          <div className="hidden grid-cols-[1fr_8rem_2rem] gap-2 px-0.5 text-xs text-muted-foreground sm:grid">
            <span>Sign label</span>
            <span>Confidence (0–1)</span>
            <span className="sr-only">Remove</span>
          </div>
          <ol className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <li key={row.id} className="grid grid-cols-[1fr_6rem_2rem] gap-2 sm:grid-cols-[1fr_8rem_2rem]">
                <Input
                  value={row.label}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                  placeholder="Label, e.g. HELP"
                  aria-label={`Sign ${i + 1} label`}
                  maxLength={40}
                  autoComplete="off"
                  className="font-mono uppercase placeholder:normal-case"
                />
                <Input
                  value={row.confidence}
                  onChange={(e) => updateRow(row.id, { confidence: e.target.value })}
                  placeholder="0.90"
                  aria-label={`Sign ${i + 1} confidence`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1}
                  step={0.01}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                  disabled={rows.length === 1}
                  aria-label={`Remove sign ${i + 1}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
              disabled={rows.length >= MAX_ROWS}
            >
              <Plus aria-hidden="true" />
              Add sign
            </Button>
            <div className="flex items-center gap-2">
              <span id="manual-language-label" className="text-xs text-muted-foreground">
                Output
              </span>
              <Select
                value={language}
                onValueChange={(v) => v && setLanguage(v as OutputLanguage)}
                items={OUTPUT_LANGUAGES.map(({ value, label }) => ({ value, label }))}
              >
                <SelectTrigger aria-labelledby="manual-language-label">
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
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button type="button" variant="ghost" onClick={reset}>
                Reset
              </Button>
              <Button type="submit" size="lg" disabled={run.kind === "running"}>
                {run.kind === "running" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send aria-hidden="true" />
                )}
                {run.kind === "running" ? "Interpreting…" : "Interpret with Muse Spark"}
              </Button>
            </div>
          </div>
        </form>

        <div aria-live="polite">
          {run.kind === "error" && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Interpretation failed</AlertTitle>
              <AlertDescription>
                {run.message}{" "}
                <span className="font-mono text-xs opacity-80">({run.code})</span>
              </AlertDescription>
            </Alert>
          )}

          {run.kind === "success" && (
            <ResultView
              result={run.result}
              speech={{
                supported: speech.supported,
                speaking: speech.speaking,
                onSpeak: () =>
                  speech.speak(
                    run.result.interpretation.text,
                    speechLangFor(run.result.interpretation.language as OutputLanguage),
                  ),
                onStop: speech.cancel,
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultView({
  result,
  speech,
}: {
  result: InterpretationResult;
  speech: { supported: boolean; speaking: boolean; onSpeak: () => void; onStop: () => void };
}) {
  const { interpretation } = result;
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <section aria-labelledby="manual-input-heading" className="flex flex-col gap-2">
        <h3 id="manual-input-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Input labels sent to the model (manual, normalized)
        </h3>
        <ol className="flex flex-wrap gap-2">
          {result.recognized_signs.map((s) => (
            <li key={s.timestamp}>
              <SignChip label={s.label} confidence={s.confidence} />
            </li>
          ))}
        </ol>
        {result.discarded_signs.length > 0 && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>
              Discarded below the {formatPercent(result.min_confidence)} threshold (not sent):
            </span>
            <ul className="flex flex-wrap gap-2">
              {result.discarded_signs.map((s) => (
                <li key={s.timestamp} title={s.reason}>
                  <Badge variant="outline" className="font-mono line-through decoration-muted-foreground/60">
                    {s.label} {formatPercent(s.confidence)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Separator />

      <section aria-labelledby="ai-output-heading" className="flex flex-col gap-3">
        <h3 id="ai-output-heading" className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          AI-generated interpretation · Muse Spark
        </h3>
        <p lang={interpretation.language} className="text-lg leading-relaxed">
          {interpretation.text}
        </p>
        {interpretation.needs_clarification && (
          <Alert>
            <AlertTriangle aria-hidden="true" className="text-warning" />
            <AlertTitle>Uncertain interpretation</AlertTitle>
            {interpretation.clarification_note && (
              <AlertDescription lang={interpretation.language}>
                {interpretation.clarification_note}
              </AlertDescription>
            )}
          </Alert>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">AI confidence (self-reported)</dt>
            <dd className="font-medium">{formatPercent(interpretation.confidence)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Model</dt>
            <dd className="font-mono font-medium">{result.model}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Latency</dt>
            <dd className="font-medium">{result.latency_ms} ms</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tokens</dt>
            <dd className="font-medium">{formatUsage(result.usage)}</dd>
          </div>
        </dl>
        <div>
          {speech.speaking ? (
            <Button variant="secondary" onClick={speech.onStop}>
              <Square aria-hidden="true" />
              Stop speaking
            </Button>
          ) : (
            <Button variant="outline" onClick={speech.onSpeak} disabled={!speech.supported}>
              <Volume2 aria-hidden="true" />
              Speak interpretation
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
