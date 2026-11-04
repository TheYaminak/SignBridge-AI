"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { CameraPanel } from "@/components/workspace/camera-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useCamera } from "@/hooks/use-camera";
import { useHandTracking } from "@/hooks/use-hand-tracking";
import { useIntents } from "@/hooks/use-intents";
import { countByLabel, datasetWarnings, MIN_FRAMES, RECOMMENDED_SAMPLES, toDataset, validateDataset } from "@/lib/signs/dataset";
import { trainAndEvaluate, type TrainingReport } from "@/lib/signs/evaluate";
import { DEFAULT_FEATURE_CONFIG, handPresenceRatio } from "@/lib/signs/features";
import { toLandmarkFrame } from "@/lib/signs/landmarks";
import { clearSamples, deleteSample, downloadJson, listSamples, putSamples, saveActiveModel } from "@/lib/signs/storage";
import { TRAINABLE_LABELS, UNKNOWN_LABEL, type LandmarkFrame, type Sample } from "@/lib/signs/types";
import type { FrameObservation } from "@/lib/vision/types";
import type { IntentInfo } from "@/types/api";
import { cn } from "@/lib/utils";

const RECORD_MS = DEFAULT_FEATURE_CONFIG.windowMs;
const COUNTDOWN_S = 3;
const MIN_PRESENCE = 0.5;

type RecState =
  | { phase: "idle" }
  | { phase: "countdown"; n: number }
  | { phase: "recording"; progress: number }
  | { phase: "saved" | "rejected"; message: string };

const UNKNOWN_INFO: IntentInfo = {
  id: UNKNOWN_LABEL,
  text_es: "Ninguna / desconocido",
  text_en: "None / unknown",
  status: "verified_sign",
  sign_count: 0,
  references: [],
  note: "Rejection class: resting hands, transitions, ordinary movement, generic gestures, and no hands in view.",
};

function instructions(info: IntentInfo): string[] {
  if (info.id === UNKNOWN_LABEL) {
    return [
      "Do anything that is NOT one of the intents: rest your hands, scratch, adjust hair, wave, show 👍 or ✋, move between signs.",
      "Include some takes with no hands in view and some with hands half in frame.",
      "Vary these a lot: UNKNOWN is what keeps the app from guessing.",
    ];
  }
  const base = [
    "Open the dictionary entry below and watch the sign first.",
    `Click Record, wait for 3-2-1, then sign once at natural speed within ${RECORD_MS / 1000} seconds.`,
    "Start and end with your hands relaxed. Keep hands and upper body in frame.",
    "Repeat many times; vary distance and position slightly between takes.",
  ];
  if (info.sign_count > 1) {
    base.splice(1, 0, `This phrase is a proposed sequence of ${info.sign_count} documented signs (${info.references.map((r) => r.gloss).slice(0, 2).join(" + ")}). Perform them in one continuous take.`);
  }
  return base;
}

function statusBadge(info: IntentInfo) {
  if (info.id === UNKNOWN_LABEL) return <Badge variant="outline">Rejection class</Badge>;
  switch (info.status) {
    case "verified_sign":
      return <Badge variant="outline" className="border-success/50 text-success">Verified sign (LSRD)</Badge>;
    case "word_references":
      return <Badge variant="outline" className="border-warning/50 text-warning">Words verified · phrase proposed</Badge>;
    default:
      return <Badge variant="destructive">Unavailable</Badge>;
  }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function TrainingStudio() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const { intents, error: intentsError } = useIntents();

  const [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState<string>("HELLO");
  const [signerId, setSignerId] = useState("signer-1");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rec, setRec] = useState<RecState>({ phase: "idle" });
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [training, setTraining] = useState(false);

  const recordingRef = useRef(false);
  const startRef = useRef(0);
  const framesRef = useRef<LandmarkFrame[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFrame = useCallback((frame: FrameObservation, ts: number) => {
    if (recordingRef.current) framesRef.current.push(toLandmarkFrame(frame, ts - startRef.current));
  }, []);

  const vision = useHandTracking({
    videoRef,
    canvasRef,
    enabled: camera.status === "active",
    showSkeleton,
    minConfidence: 0.8,
    onFrame,
  });

  useEffect(() => {
    listSamples()
      .then(setSamples)
      .catch(() => setNotice({ kind: "error", text: "Could not open local storage (IndexedDB)." }));
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      recordingRef.current = false;
    },
    [],
  );

  const catalog: IntentInfo[] = [
    ...(intents ?? TRAINABLE_LABELS.filter((l) => l !== UNKNOWN_LABEL).map((id) => ({ ...UNKNOWN_INFO, id, text_es: id, text_en: id, note: "", status: "word_references" as const }))),
    UNKNOWN_INFO,
  ];
  const info = catalog.find((i) => i.id === selected) ?? UNKNOWN_INFO;
  const trainable = info.status !== "unavailable" && (TRAINABLE_LABELS as readonly string[]).includes(info.id);
  const counts = countByLabel(samples);
  const ready = camera.status === "active" && vision.status === "running";
  const busy = rec.phase === "countdown" || rec.phase === "recording";

  const finish = (label: string, sid: string, refs: string[]) => {
    recordingRef.current = false;
    const frames = framesRef.current;
    framesRef.current = [];
    const presence = handPresenceRatio(frames);
    if (frames.length < MIN_FRAMES) {
      setRec({ phase: "rejected", message: `Only ${frames.length} frames were captured. Is hand tracking running?` });
      return;
    }
    if (label !== UNKNOWN_LABEL && presence < MIN_PRESENCE) {
      setRec({ phase: "rejected", message: `Hands were visible in only ${pct(presence)} of frames. Not saved; try again.` });
      return;
    }
    const sample: Sample = {
      sample_id: crypto.randomUUID(),
      label,
      source: "local_webcam",
      reference_urls: refs,
      session_id: sid,
      signer_id: signerId.trim() || "signer-1",
      recorded_at: new Date().toISOString(),
      duration_ms: frames[frames.length - 1].timestamp_ms - frames[0].timestamp_ms,
      frames,
    };
    putSamples([sample])
      .then(() => {
        setSamples((prev) => [...prev, sample]);
        setRec({ phase: "saved", message: `Saved ${label}: ${frames.length} frames, hands in ${pct(presence)}.` });
      })
      .catch(() => setRec({ phase: "rejected", message: "Could not save to local storage." }));
  };

  const record = () => {
    if (!ready || busy || !trainable) return;
    const sid = sessionId ?? crypto.randomUUID();
    setSessionId(sid);
    setNotice(null);
    const label = info.id;
    const refs = info.references.map((r) => r.url);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    for (let i = 0; i < COUNTDOWN_S; i++) {
      timersRef.current.push(setTimeout(() => setRec({ phase: "countdown", n: COUNTDOWN_S - i }), i * 1000));
    }
    timersRef.current.push(
      setTimeout(() => {
        framesRef.current = [];
        startRef.current = performance.now();
        recordingRef.current = true;
        setRec({ phase: "recording", progress: 0 });
        for (let t = 100; t < RECORD_MS; t += 100) {
          timersRef.current.push(setTimeout(() => setRec({ phase: "recording", progress: t / RECORD_MS }), t));
        }
        timersRef.current.push(setTimeout(() => finish(label, sid, refs), RECORD_MS));
      }, COUNTDOWN_S * 1000),
    );
  };

  const remove = (id: string) => {
    deleteSample(id).then(() => setSamples((prev) => prev.filter((s) => s.sample_id !== id)));
  };

  const exportData = () => {
    downloadJson(`signbridge-dataset-${new Date().toISOString().slice(0, 10)}.json`, toDataset(samples));
  };

  const importData = async (file: File) => {
    try {
      const v = validateDataset(JSON.parse(await file.text()));
      const known = new Set(samples.map((s) => s.sample_id));
      const fresh = v.samples.filter((s) => !known.has(s.sample_id));
      await putSamples(fresh);
      setSamples((prev) => [...prev, ...fresh]);
      setNotice({
        kind: v.errors.length ? "error" : "ok",
        text: `Imported ${fresh.length} samples (${v.samples.length - fresh.length} already present).${v.errors.length ? ` Skipped ${v.errors.length} invalid: ${v.errors.slice(0, 3).join(" ")}` : ""}`,
      });
    } catch {
      setNotice({ kind: "error", text: "That file is not valid JSON." });
    }
  };

  const clearAll = () => {
    if (!window.confirm(`Delete all ${samples.length} samples from this browser? Export first if you want to keep them.`)) return;
    clearSamples().then(() => setSamples([]));
  };

  const train = () => {
    setTraining(true);
    setReport(null);
    // Yield so the spinner renders before the synchronous training run.
    setTimeout(() => {
      try {
        setReport(trainAndEvaluate(samples.filter((s) => (TRAINABLE_LABELS as readonly string[]).includes(s.label))));
      } catch (err) {
        setNotice({ kind: "error", text: err instanceof Error ? err.message : "Training failed." });
      } finally {
        setTraining(false);
      }
    }, 20);
  };

  const activate = () => {
    if (!report) return;
    saveActiveModel(report.model)
      .then(() => setNotice({ kind: "ok", text: `Model ${report.model.model_id} is active in this browser. Open the main page and choose "Custom signs".` }))
      .catch(() => setNotice({ kind: "error", text: "Could not save the model." }));
  };

  const warnings = datasetWarnings(samples);
  const labelSamples = samples.filter((s) => s.label === selected).slice(-12).reverse();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CameraPanel
          camera={camera}
          vision={vision}
          videoRef={videoRef}
          canvasRef={canvasRef}
          showSkeleton={showSkeleton}
          onToggleSkeleton={() => setShowSkeleton((s) => !s)}
        />

        <Card>
          <CardHeader>
            <CardTitle>Record samples</CardTitle>
            <CardDescription>Only MediaPipe landmarks are stored, locally in this browser. No video.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {intentsError && (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Intent catalog unavailable</AlertTitle>
                <AlertDescription>{intentsError} Start the Go backend to see dictionary references.</AlertDescription>
              </Alert>
            )}
            <div role="radiogroup" aria-label="Intent to record" className="flex flex-wrap gap-2">
              {catalog.map((i) => (
                <Button
                  key={i.id}
                  role="radio"
                  aria-checked={selected === i.id}
                  variant={selected === i.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelected(i.id)}
                  disabled={busy}
                  className={cn(i.status === "unavailable" && "opacity-60")}
                >
                  <span className="font-mono">{i.id}</span>
                  <span className="tabular-nums opacity-70">{counts[i.id] ?? 0}</span>
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-medium">{info.text_es}</p>
                {statusBadge(info)}
              </div>
              <p className="text-sm text-muted-foreground">{info.text_en}</p>
              {info.note && <p className="text-xs text-muted-foreground">{info.note}</p>}
              {info.references.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {info.references.map((r) => (
                    <li key={r.url}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                        LSRD: {r.gloss} <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {trainable ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                {instructions(info).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            ) : (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Not trainable</AlertTitle>
                <AlertDescription>{info.note || "This expression has no verified dictionary reference."}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="signer-id" className="text-xs text-muted-foreground">Signer ID (no real names needed)</label>
                <Input id="signer-id" value={signerId} onChange={(e) => setSignerId(e.target.value)} className="w-40" disabled={busy} maxLength={32} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSessionId(null)} disabled={busy} title="Start a new recording session (used to split validation data)">
                New session
              </Button>
            </div>

            <div aria-live="assertive" className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center">
              {rec.phase === "countdown" && <span className="text-5xl font-semibold tabular-nums text-primary">{rec.n}</span>}
              {rec.phase === "recording" && (
                <>
                  <span className="flex items-center gap-2 font-medium text-destructive">
                    <Circle className="size-3 animate-pulse fill-current" aria-hidden="true" /> Recording {info.id}…
                  </span>
                  <Progress value={Math.round(rec.progress * 100)} className="w-full" aria-label="Recording progress" />
                </>
              )}
              {rec.phase === "saved" && (
                <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden="true" />{rec.message}</p>
              )}
              {rec.phase === "rejected" && (
                <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4" aria-hidden="true" />{rec.message}</p>
              )}
              {rec.phase === "idle" && (
                <p className="text-sm text-muted-foreground">
                  {ready ? `Ready. Recording lasts ${RECORD_MS / 1000} s after a 3 s countdown.` : "Start the camera and wait for hand tracking to load."}
                </p>
              )}
            </div>

            <Button size="lg" onClick={record} disabled={!ready || busy || !trainable}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Circle className="fill-current" aria-hidden="true" />}
              {busy ? "Recording…" : `Record ${info.id}`}
            </Button>
          </CardContent>
        </Card>
      </div>

      {notice && (
        <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
          {notice.kind === "error" ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" className="text-success" />}
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dataset</CardTitle>
            <CardDescription>
              {samples.length} samples · {new Set(samples.map((s) => s.session_id)).size} sessions · aim for {RECOMMENDED_SAMPLES}–30 per class
            </CardDescription>
            <CardAction className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportData} disabled={samples.length === 0}>
                <Download aria-hidden="true" /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden="true" /> Import
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importData(f);
                  e.target.value = "";
                }}
              />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1 font-medium">Class</th><th className="font-medium">Samples</th><th className="w-1/2 font-medium">Progress</th></tr>
              </thead>
              <tbody>
                {catalog.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-1.5 font-mono text-xs">{i.id}</td>
                    <td className="tabular-nums">{i.status === "unavailable" ? "—" : (counts[i.id] ?? 0)}</td>
                    <td>
                      {i.status === "unavailable" ? (
                        <span className="text-xs text-muted-foreground">unavailable</span>
                      ) : (
                        <Progress value={Math.min(100, ((counts[i.id] ?? 0) / RECOMMENDED_SAMPLES) * 100)} aria-label={`${i.id} progress`} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-warning">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}

            <div>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent {selected} samples</h3>
              {labelSamples.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-lg border text-xs">
                  {labelSamples.map((s) => (
                    <li key={s.sample_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="tabular-nums text-muted-foreground">
                        {new Date(s.recorded_at).toLocaleTimeString()} · {s.frames.length} frames · hands {pct(handPresenceRatio(s.frames))} · {s.signer_id}
                      </span>
                      <Button variant="ghost" size="icon-xs" onClick={() => remove(s.sample_id)} aria-label="Delete sample">
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button variant="ghost" size="sm" className="self-start text-destructive" onClick={clearAll} disabled={samples.length === 0}>
              Delete all samples
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-primary" aria-hidden="true" />Train &amp; evaluate</CardTitle>
            <CardDescription>k-nearest-neighbor classifier over normalized landmark sequences. Runs locally.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={train} disabled={training || samples.length < 4} className="self-start">
              {training ? <Loader2 className="animate-spin" aria-hidden="true" /> : <BrainCircuit aria-hidden="true" />}
              {training ? "Training…" : "Train and evaluate"}
            </Button>
            {report && <ReportView report={report} onActivate={activate} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReportView({ report, onActivate }: { report: TrainingReport; onActivate: () => void }) {
  const e = report.evaluation;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        Split: <strong>{report.split.strategy === "session_holdout" ? "held-out sessions" : report.split.strategy === "mixed" ? "held-out sessions where possible" : "stratified random (same session)"}</strong> · train {report.split.train} · validation {report.split.validation} · seed {report.split.seed}
      </p>
      {e ? (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {(e.accuracy * 100).toFixed(1)}% <span className="text-sm font-normal text-muted-foreground">validation accuracy on {e.n} held-out samples</span>
          </p>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-1 font-medium">Class</th><th className="font-medium">Support</th><th className="font-medium">Precision</th><th className="font-medium">Recall</th><th className="font-medium">F1</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {e.perClass.filter((c) => c.support > 0 || c.precision > 0).map((c) => (
                <tr key={c.label} className="border-t">
                  <td className="py-1 font-mono">{c.label}</td><td>{c.support}</td><td>{c.precision.toFixed(2)}</td><td>{c.recall.toFixed(2)}</td><td>{c.f1.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="overflow-x-auto">
            <p className="mb-1 text-xs text-muted-foreground">Confusion matrix (rows = true, columns = predicted)</p>
            <table className="text-xs tabular-nums">
              <thead><tr><th />{e.labels.map((l) => <th key={l} className="px-1.5 font-mono font-normal text-muted-foreground">{l.slice(0, 7)}</th>)}</tr></thead>
              <tbody>
                {e.confusion.map((row, i) => (
                  <tr key={e.labels[i]}>
                    <th className="pr-2 text-left font-mono font-normal text-muted-foreground">{e.labels[i]}</th>
                    {row.map((n, j) => (
                      <td key={j} className={cn("px-1.5 text-center", n > 0 && (i === j ? "text-success font-medium" : "text-destructive font-medium"))}>{n}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">Not evaluated.</p>
      )}
      {report.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-warning">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <p className="text-xs text-muted-foreground">
        Final model <span className="font-mono">{report.model.model_id}</span> is trained on all {report.model.training.samples} samples ({report.model.labels.join(", ")}).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onActivate}><CheckCircle2 aria-hidden="true" />Use this model</Button>
        <Button variant="outline" onClick={() => downloadJson("sign-classifier.json", report.model)}>
          <Download aria-hidden="true" />Download model
        </Button>
      </div>
    </div>
  );
}
