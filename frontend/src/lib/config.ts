/**
 * Public frontend configuration. Only NEXT_PUBLIC_ values belong here;
 * secrets such as the Meta API key live exclusively in the Go backend.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");
