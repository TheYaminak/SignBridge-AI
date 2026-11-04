"use client";

import { useCallback, useEffect, useState } from "react";

import { apiClient, ApiError } from "@/lib/api-client";
import { REQUIRED_API_VERSION } from "@/types/api";

export type BackendStatus = "checking" | "online" | "offline" | "outdated";

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
        // A backend that predates the current contract rejects new request
        // fields ("unknown field ..."), so flag it instead of failing later.
        const outdated = (res.api_version ?? 0) < REQUIRED_API_VERSION;
        setState({
          status: res.status !== "ok" ? "offline" : outdated ? "outdated" : "online",
          service: res.service,
          error: outdated
            ? `Backend API version ${res.api_version ?? "1-2"} is older than required ${REQUIRED_API_VERSION}. Restart the Go backend.`
            : null,
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
