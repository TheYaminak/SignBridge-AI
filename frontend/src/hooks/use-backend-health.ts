"use client";

import { useCallback, useEffect, useState } from "react";

import { apiClient, ApiError } from "@/lib/api-client";

export type BackendStatus = "checking" | "online" | "offline";

interface HealthState {
  status: BackendStatus;
  service: string | null;
  error: string | null;
  lastCheckedAt: number | null;
}

const INITIAL_STATE: HealthState = {
  status: "checking",
  service: null,
  error: null,
  lastCheckedAt: null,
};

/** Polls the backend health endpoint and exposes connectivity status. */
export function useBackendHealth(intervalMs = 15_000) {
  const [state, setState] = useState<HealthState>(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const res = await apiClient.health({
          signal: controller.signal,
          timeoutMs: 5_000,
        });
        setState({
          status: res.status === "ok" ? "online" : "offline",
          service: res.service,
          error: null,
          lastCheckedAt: Date.now(),
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          status: "offline",
          service: null,
          error: err instanceof ApiError ? err.message : "Health check failed.",
          lastCheckedAt: Date.now(),
        });
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(check, intervalMs);
      }
    };

    void check();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [intervalMs, attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: "checking" }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
