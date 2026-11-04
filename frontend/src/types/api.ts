import type { TokenUsage } from "@/types/sign";

/** Response body of GET /health. */
export interface HealthResponse {
  status: "ok";
  service: string;
}

/** Shape of every error response returned by the Go backend. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** GET /api/v1/meta/status: configuration only, never a live check. */
export interface MetaStatusResponse {
  configured: boolean;
  model: string;
}

/** POST /api/v1/meta/test: result of a real request to the Meta Model API. */
export interface MetaTestResponse {
  success: boolean;
  provider: string;
  model: string;
  response: string;
  latency_ms: number;
  usage?: TokenUsage;
}
