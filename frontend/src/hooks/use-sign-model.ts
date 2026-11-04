"use client";

import { useCallback, useEffect, useState } from "react";

import { isSignModel, type SignModel } from "@/lib/signs/knn";
import { loadActiveModel } from "@/lib/signs/storage";

/** Model shipped with the app (optional): frontend/public/models/sign-classifier.json */
export const BUNDLED_MODEL_PATH = "/models/sign-classifier.json";

export type ModelSource = "browser" | "bundled";

interface State {
  status: "loading" | "ready" | "missing" | "error";
  model: SignModel | null;
  source: ModelSource | null;
  error: string | null;
}

/**
 * Loads the custom sign model: the one trained in this browser (/training)
 * takes precedence, then the bundled file. Never fabricates a model.
 */
export function useSignModel() {
  const [state, setState] = useState<State>({ status: "loading", model: null, source: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await loadActiveModel().catch(() => null);
        if (local) {
          if (!cancelled) setState({ status: "ready", model: local, source: "browser", error: null });
          return;
        }
        const res = await fetch(BUNDLED_MODEL_PATH, { cache: "no-store" });
        if (res.ok) {
          const json: unknown = await res.json();
          if (!isSignModel(json)) throw new Error("Bundled model file is invalid.");
          if (!cancelled) setState({ status: "ready", model: json, source: "bundled", error: null });
          return;
        }
        if (!cancelled) setState({ status: "missing", model: null, source: null, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ status: "error", model: null, source: null, error: err instanceof Error ? err.message : "Could not load the model." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
