package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/signbridge-ai/backend/internal/meta"
	"github.com/signbridge-ai/backend/internal/service"
)

func newTestRouter() http.Handler {
	return NewRouter(Options{
		Logger:         slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Interpreter:    service.NewMetaInterpreter(meta.NewHTTPClient(meta.Options{})),
		AllowedOrigins: []string{"http://localhost:3000"},
	})
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" || body.Service != "signbridge-api" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestInterpret(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode int
		wantErr  string
	}{
		{
			name:     "valid request is not implemented",
			body:     `{"signs":[{"label":"HELP","confidence":0.94,"timestamp":1730000000000}],"language":"es"}`,
			wantCode: http.StatusNotImplemented,
			wantErr:  "not_implemented",
		},
		{name: "malformed json", body: `{"signs":`, wantCode: http.StatusBadRequest, wantErr: "invalid_request"},
		{name: "empty body", body: ``, wantCode: http.StatusBadRequest, wantErr: "invalid_request"},
		{name: "unknown field", body: `{"signs":[],"language":"es","extra":1}`, wantCode: http.StatusBadRequest, wantErr: "invalid_request"},
		{name: "empty signs", body: `{"signs":[],"language":"es"}`, wantCode: http.StatusBadRequest, wantErr: "invalid_request"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/interpret", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			newTestRouter().ServeHTTP(rec, req)

			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantCode, rec.Body.String())
			}
			var body ErrorBody
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body.Error.Code != tt.wantErr {
				t.Fatalf("error code = %q, want %q", body.Error.Code, tt.wantErr)
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/interpret", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCORSDisallowedOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://evil.test")
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header, got %q", got)
	}
}

func TestNotFound(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
