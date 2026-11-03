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
