import { API_BASE_URL } from "@/lib/config";
import type {
  ApiErrorBody,
  HealthResponse,
  MetaStatusResponse,
  MetaTestResponse,
} from "@/types/api";
import type {
  InterpretationRequest,
  InterpretationResult,
} from "@/types/sign";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Error raised for any failed backend call. `status` is 0 for network errors. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  get isNotImplemented(): boolean {
    return this.status === 501;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: combineSignals(timeoutMs, signal),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(0, "timeout", "The backend did not respond in time.");
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(0, "network_error", "Unable to reach the backend.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message);
    }
    throw new ApiError(
      response.status,
      "http_error",
      `Request failed with status ${response.status}.`,
    );
  }

  return body as T;
}

/** Typed client for the SignBridge Go API. */
export const apiClient = {
  health(options?: RequestOptions): Promise<HealthResponse> {
    return request<HealthResponse>("/health", { method: "GET" }, options);
  },

  interpret(
    payload: InterpretationRequest,
    options?: RequestOptions,
  ): Promise<InterpretationResult> {
    return request<InterpretationResult>(
      "/api/v1/interpret",
      { method: "POST", body: JSON.stringify(payload) },
      { timeoutMs: 65_000, ...options },
    );
  },

  /** Configuration status only; does not call Meta or use tokens. */
  metaStatus(options?: RequestOptions): Promise<MetaStatusResponse> {
    return request<MetaStatusResponse>(
      "/api/v1/meta/status",
      { method: "GET" },
      options,
    );
  },

  /** Development only: makes a real Meta Model API request via the backend. */
  metaTest(options?: RequestOptions): Promise<MetaTestResponse> {
    return request<MetaTestResponse>(
      "/api/v1/meta/test",
      { method: "POST" },
      { timeoutMs: 65_000, ...options },
    );
  },
};
