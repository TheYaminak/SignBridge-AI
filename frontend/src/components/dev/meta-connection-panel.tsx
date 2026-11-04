"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Sparkles } from "lucide-react";

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
import { apiClient, ApiError } from "@/lib/api-client";
import { formatUsage } from "@/lib/format";
import type { MetaStatusResponse, MetaTestResponse } from "@/types/api";

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; data: MetaStatusResponse }
  | { kind: "error"; message: string };

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; data: MetaTestResponse; roundTripMs: number }
  | { kind: "error"; code: string; message: string };

function toTestError(err: unknown): TestState {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return {
        kind: "error",
        code: "disabled",
        message: "The test endpoint is disabled (backend runs with APP_ENV=production).",
      };
    }
    return { kind: "error", code: err.code, message: err.message };
  }
  return { kind: "error", code: "unknown", message: "The connection test failed." };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function MetaConnectionPanel() {
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .metaStatus({ signal: controller.signal })
      .then((data) => setStatus({ kind: "loaded", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({
          kind: "error",
          message: err instanceof ApiError ? err.message : "Could not load status.",
        });
      });
    return () => controller.abort();
  }, []);

  const runTest = async () => {
    setTest({ kind: "testing" });
    const started = performance.now();
    try {
      const data = await apiClient.metaTest();
      setTest({
        kind: "success",
        data,
        roundTripMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      setTest(toTestError(err));
    }
  };

  const configured = status.kind === "loaded" && status.data.configured;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="size-4 text-primary" aria-hidden="true" />
          Meta AI Connection
        </CardTitle>
        <CardDescription>
          Checks the Go backend&apos;s Muse Spark setup. The API key never leaves the server.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className="gap-1.5">
            <StatusDot
              tone={
                status.kind === "loading"
                  ? "warning"
                  : configured
                    ? "success"
                    : "danger"
              }
            />
            {status.kind === "loading"
              ? "Loading"
              : configured
                ? "Configured"
                : "Not configured"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Configuration">
            {status.kind === "loaded"
              ? status.data.configured
                ? "API key loaded on server"
                : "MODEL_API_KEY missing"
              : status.kind === "error"
                ? "Unavailable"
                : "…"}
          </Field>
          <Field label="Active model">
            <span className="font-mono">
              {status.kind === "loaded" ? status.data.model || "—" : "…"}
            </span>
          </Field>
        </dl>
        <p className="text-xs text-muted-foreground">
          &quot;Configured&quot; only means settings are present. Use the test to verify a
          real request succeeds.
        </p>

        {status.kind === "error" && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}

        <div aria-live="polite" className="flex flex-col gap-3">
          {test.kind === "success" && (
            <Alert>
              <CheckCircle2 aria-hidden="true" className="text-success" />
              <AlertTitle>Live request succeeded</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <blockquote className="rounded-md border bg-background/50 px-3 py-2 font-mono text-sm text-foreground">
                  {test.data.response}
                </blockquote>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Model">
                    <span className="font-mono">{test.data.model}</span>
                  </Field>
                  <Field label="Provider latency">{test.data.latency_ms} ms</Field>
                  <Field label="Round trip">{test.roundTripMs} ms</Field>
                  <Field label="Tokens">{formatUsage(test.data.usage)}</Field>
                </dl>
              </AlertDescription>
            </Alert>
          )}
          {test.kind === "error" && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Connection test failed</AlertTitle>
              <AlertDescription>
                {test.message}{" "}
                <span className="font-mono text-xs opacity-80">({test.code})</span>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>

      <CardFooter>
        <Button
          size="lg"
          onClick={runTest}
          disabled={test.kind === "testing" || status.kind !== "loaded"}
        >
          {test.kind === "testing" ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {test.kind === "testing" ? "Testing…" : "Test connection"}
        </Button>
        <span className="ml-3 text-xs text-muted-foreground">
          Sends one short real request (uses a few tokens).
        </span>
      </CardFooter>
    </Card>
  );
}
