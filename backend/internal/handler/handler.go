// Package handler wires HTTP routes to the service layer.
package handler

import (
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

// MetaStatus exposes safe, non-secret Meta client configuration.
type MetaStatus interface {
	Configured() bool
	Model() string
}

// Options configures the router.
type Options struct {
	Logger         *slog.Logger
	Interpreter    service.Interpreter
	Meta           MetaStatus
	Tester         service.ConnectionTester
	AllowedOrigins []string
	RequestTimeout time.Duration
	// EnableDevEndpoints registers development-only routes such as
	// POST /api/v1/meta/test. Must be false in production.
	EnableDevEndpoints bool
}

// NewRouter builds the HTTP handler with middleware and routes.
func NewRouter(opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	timeout := opts.RequestTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
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

	h := &handlers{
		interpreter: opts.Interpreter,
		meta:        opts.Meta,
		tester:      opts.Tester,
		logger:      logger,
	}

	r.Get("/health", h.health)
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/interpret", h.interpret)
		r.Get("/meta/status", h.metaStatus)
		if opts.EnableDevEndpoints {
			r.Post("/meta/test", h.metaTest)
		}
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
	meta        MetaStatus
	tester      service.ConnectionTester
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

// MetaStatusResponse is returned by GET /api/v1/meta/status. It reflects
// configuration only; it never contacts the provider.
type MetaStatusResponse struct {
	Configured bool   `json:"configured"`
	Model      string `json:"model"`
}

func (h *handlers) metaStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, MetaStatusResponse{
		Configured: h.meta.Configured(),
		Model:      h.meta.Model(),
	})
}

func (h *handlers) metaTest(w http.ResponseWriter, r *http.Request) {
	result, err := h.tester.TestConnection(r.Context())
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) interpret(w http.ResponseWriter, r *http.Request) {
	var req domain.InterpretationRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	result, err := h.interpreter.Interpret(r.Context(), req)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
