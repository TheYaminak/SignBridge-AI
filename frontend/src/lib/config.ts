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
export const DEV_TOOLS_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";
