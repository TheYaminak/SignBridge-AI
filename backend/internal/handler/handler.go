// Package handler wires HTTP routes to the service layer.
package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/service"
)

// ServiceName is reported by the health endpoint.
const ServiceName = "signbridge-api"

// Options configures the router.
type Options struct {
	Logger         *slog.Logger
	Interpreter    service.Interpreter
	AllowedOrigins []string
	RequestTimeout time.Duration
}

// NewRouter builds the HTTP handler with middleware and routes.
func NewRouter(opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	timeout := opts.RequestTimeout
	if timeout <= 0 {
		timeout = 25 * time.Second
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: opts.AllowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Content-Type", "X-Request-Id"},
		ExposedHeaders: []string{"X-Request-Id"},
		MaxAge:         300,
	}))
	r.Use(middleware.Timeout(timeout))

	h := &handlers{interpreter: opts.Interpreter, logger: logger}

	r.Get("/health", h.health)
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/interpret", h.interpret)
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	})

	return r
}

type handlers struct {
	interpreter service.Interpreter
	logger      *slog.Logger
}

// HealthResponse is returned by GET /health.
type HealthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

func (h *handlers) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, HealthResponse{Status: "ok", Service: ServiceName})
}

func (h *handlers) interpret(w http.ResponseWriter, r *http.Request) {
	var req domain.InterpretationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	result, err := h.interpreter.Interpret(r.Context(), req)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, result)
	case errors.Is(err, domain.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
	case errors.Is(err, service.ErrNotImplemented):
		writeError(w, http.StatusNotImplemented, "not_implemented",
			"Sign interpretation is not available yet. No interpretation was generated.")
	default:
		h.logger.ErrorContext(r.Context(), "interpret failed", "error", err,
			"request_id", middleware.GetReqID(r.Context()))
		writeError(w, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
