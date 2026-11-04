"use client";

import { useEffect, useState } from "react";

import { apiClient, ApiError } from "@/lib/api-client";
import type { IntentInfo } from "@/types/api";

/** Intent catalog (texts, LSRD references, status) from the Go API. */
export function useIntents() {
  const [intents, setIntents] = useState<IntentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .intents({ signal: controller.signal })
      .then((res) => setIntents(res.intents))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load the intent catalog.");
      });
    return () => controller.abort();
  }, []);

  return { intents, error };
}
