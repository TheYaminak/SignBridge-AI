/**
 * Public frontend configuration. Only NEXT_PUBLIC_ values belong here;
 * secrets such as the Meta API key live exclusively in the Go backend.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");

/**
 * Development-only tools (Meta connection check, manual interpretation test).
 * On in `next dev`; in production builds only when explicitly enabled.
 */
function parseConfidence(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/** Per-frame confidence a gesture needs before it can be recognized. */
export const GESTURE_MIN_CONFIDENCE = parseConfidence(
  process.env.NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE,
  0.8,
);

export const DEV_TOOLS_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";
