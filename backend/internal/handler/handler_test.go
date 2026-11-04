package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/signbridge-ai/backend/internal/meta"
	"github.com/signbridge-ai/backend/internal/service"
)

const testAPIKey = "LLM_42_super-secret"

const validModelJSON = `{"interpretation":"Necesito ayuda.","confidence":0.8,"needs_clarification":false,"clarification_note":""}`

// fakeMetaServer stands in for https://api.meta.ai/v1 and counts calls.
type fakeMetaServer struct {
	*httptest.Server
	calls  int
	status int
	body   string
}

func newFakeMeta(t *testing.T, status int, body string) *fakeMetaServer {
	t.Helper()
	f := &fakeMetaServer{status: status, body: body}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls++
		if r.Header.Get("Authorization") != "Bearer "+testAPIKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":{"message":"Unauthorized","type":"authentication_error","code":"invalid_api_key"}}`)
			return
		}
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, f.body)
	}))
	t.Cleanup(f.Close)
	return f
}

func completion(content string) string {
	b, _ := json.Marshal(content)
	return fmt.Sprintf(`{"id":"c1","model":"muse-spark-1.3","choices":[{"message":{"role":"assistant","content":%s},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`, b)
}

type routerConfig struct {
	apiKey   string
	baseURL  string
	devTools bool
}

func newRouter(cfg routerConfig) http.Handler {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	client := meta.NewHTTPClient(meta.Options{
		APIKey: cfg.apiKey, Model: "muse-spark-1.3", BaseURL: cfg.baseURL, Logger: logger,
	})
	return NewRouter(Options{
		Logger:             logger,
		Interpreter:        service.NewMetaInterpreter(client, 0.6),
		IntentInterpreter:  service.NewMetaIntentInterpreter(client, 0.75, logger),
		Meta:               client,
		Tester:             service.NewMetaConnectionTester(client),
		AllowedOrigins:     []string{"http://localhost:3000"},
		EnableDevEndpoints: cfg.devTools,
	})
}

func do(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v
}

func TestHealth(t *testing.T) {
	rec := do(newRouter(routerConfig{}), http.MethodGet, "/health", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := decode[HealthResponse](t, rec)
	if body.Status != "ok" || body.Service != "signbridge-api" {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestMetaStatusDoesNotCallProvider(t *testing.T) {
	fake := newFakeMeta(t, 200, completion("READY"))

	for name, cfg := range map[string]routerConfig{
		"configured":     {apiKey: testAPIKey, baseURL: fake.URL},
		"not configured": {baseURL: fake.URL},
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(newRouter(cfg), http.MethodGet, "/api/v1/meta/status", "")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			raw := rec.Body.String()
			if strings.Contains(raw, testAPIKey) {
				t.Fatal("API key leaked")
			}
			var body map[string]any
			_ = json.Unmarshal([]byte(raw), &body)
			if len(body) != 2 || body["model"] != "muse-spark-1.3" || body["configured"] != (cfg.apiKey != "") {
				t.Fatalf("unexpected body: %s", raw)
			}
		})
	}
	if fake.calls != 0 {
		t.Fatalf("status endpoint called the provider %d times", fake.calls)
	}
}

func TestMetaTest(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := newFakeMeta(t, 200, completion("READY"))
		rec := do(newRouter(routerConfig{apiKey: testAPIKey, baseURL: fake.URL, devTools: true}), http.MethodPost, "/api/v1/meta/test", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
		}
		body := decode[service.ConnectionTestResult](t, rec)
		if !body.Success || body.Response != "READY" || body.Provider != "meta" || body.Model != "muse-spark-1.3" || body.Usage == nil {
			t.Fatalf("unexpected body: %+v", body)
		}
		if fake.calls != 1 {
			t.Fatalf("calls = %d", fake.calls)
		}
	})

	t.Run("disabled in production", func(t *testing.T) {
		fake := newFakeMeta(t, 200, completion("READY"))
		rec := do(newRouter(routerConfig{apiKey: testAPIKey, baseURL: fake.URL, devTools: false}), http.MethodPost, "/api/v1/meta/test", "")
		if rec.Code != http.StatusNotFound || fake.calls != 0 {
			t.Fatalf("status = %d calls = %d", rec.Code, fake.calls)
		}
	})

	t.Run("not configured", func(t *testing.T) {
		rec := do(newRouter(routerConfig{baseURL: "http://unused.test", devTools: true}), http.MethodPost, "/api/v1/meta/test", "")
		if rec.Code != http.StatusServiceUnavailable || decode[ErrorBody](t, rec).Error.Code != "ai_not_configured" {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("bad key is sanitized", func(t *testing.T) {
		fake := newFakeMeta(t, 200, completion("READY"))
		rec := do(newRouter(routerConfig{apiKey: "LLM_1_wrong", baseURL: fake.URL, devTools: true}), http.MethodPost, "/api/v1/meta/test", "")
		raw := rec.Body.String()
		if rec.Code != http.StatusBadGateway || !strings.Contains(raw, "ai_auth_failed") {
			t.Fatalf("status = %d body=%s", rec.Code, raw)
		}
		if strings.Contains(raw, "LLM_1_wrong") || strings.Contains(raw, "authentication_error") || strings.Contains(raw, "invalid_api_key") {
			t.Fatalf("provider details leaked: %s", raw)
		}
	})
}

const interpretBody = `{"signs":[{"label":"help","confidence":0.94,"timestamp":1730000000000},{"label":"water","confidence":0.2,"timestamp":1730000000500}],"language":"es","source":"manual"}`

func TestInterpretSuccess(t *testing.T) {
	fake := newFakeMeta(t, 200, completion(validModelJSON))
	rec := do(newRouter(routerConfig{apiKey: testAPIKey, baseURL: fake.URL}), http.MethodPost, "/api/v1/interpret", interpretBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
	}

	var body struct {
		Source          string `json:"source"`
		RecognizedSigns []struct {
			Label string `json:"label"`
		} `json:"recognized_signs"`
		DiscardedSigns []struct {
			Label  string `json:"label"`
			Reason string `json:"reason"`
		} `json:"discarded_signs"`
		Interpretation struct {
			Text        string `json:"text"`
			GeneratedBy string `json:"generated_by"`
			Language    string `json:"language"`
		} `json:"interpretation"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Usage    *struct {
			TotalTokens int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if body.Source != "manual" || body.Provider != "meta" || body.Model != "muse-spark-1.3" {
		t.Errorf("metadata = %+v", body)
	}
	if len(body.RecognizedSigns) != 1 || body.RecognizedSigns[0].Label != "HELP" {
		t.Errorf("recognized = %+v", body.RecognizedSigns)
	}
	if len(body.DiscardedSigns) != 1 || body.DiscardedSigns[0].Label != "WATER" || body.DiscardedSigns[0].Reason == "" {
		t.Errorf("discarded = %+v", body.DiscardedSigns)
	}
	if body.Interpretation.Text != "Necesito ayuda." || body.Interpretation.GeneratedBy != "ai" || body.Interpretation.Language != "es" {
		t.Errorf("interpretation = %+v", body.Interpretation)
	}
	if body.Usage == nil || body.Usage.TotalTokens != 15 {
		t.Errorf("usage = %+v", body.Usage)
	}
}

func TestInterpretErrors(t *testing.T) {
	tests := []struct {
		name       string
		apiKey     string
		metaStatus int
		metaBody   string
		body       string
		wantCode   int
		wantErr    string
		wantCalls  int
	}{
		{name: "malformed json", apiKey: testAPIKey, body: `{"signs":`, wantCode: 400, wantErr: "invalid_request"},
		{name: "empty body", apiKey: testAPIKey, body: ``, wantCode: 400, wantErr: "invalid_request"},
		{name: "unknown field", apiKey: testAPIKey, body: `{"signs":[],"language":"es","extra":1}`, wantCode: 400, wantErr: "invalid_request"},
		{name: "empty signs", apiKey: testAPIKey, body: `{"signs":[],"language":"es"}`, wantCode: 400, wantErr: "invalid_request"},
		{name: "unsupported language", apiKey: testAPIKey, body: `{"signs":[{"label":"HELP","confidence":0.9,"timestamp":1}],"language":"fr"}`, wantCode: 400, wantErr: "invalid_request"},
		{name: "below threshold", apiKey: testAPIKey, body: `{"signs":[{"label":"HELP","confidence":0.3,"timestamp":1}],"language":"es"}`, wantCode: 422, wantErr: "no_confident_signs"},
		{name: "not configured", apiKey: "", body: interpretBody, wantCode: 503, wantErr: "ai_not_configured"},
		{name: "provider rate limit", apiKey: testAPIKey, metaStatus: 429, metaBody: `{"error":{"message":"slow","type":"rate_limit_error"}}`, body: interpretBody, wantCode: 503, wantErr: "ai_rate_limited", wantCalls: 1},
		{name: "provider 500", apiKey: testAPIKey, metaStatus: 500, metaBody: `{"error":{"message":"boom","type":"server_error"}}`, body: interpretBody, wantCode: 502, wantErr: "ai_unavailable", wantCalls: 1},
		{name: "unknown model", apiKey: testAPIKey, metaStatus: 404, metaBody: `{"error":{"message":"no such model","type":"invalid_request_error","code":"model_not_found"}}`, body: interpretBody, wantCode: 502, wantErr: "ai_model_not_found", wantCalls: 1},
		{name: "model breaks contract", apiKey: testAPIKey, metaStatus: 200, metaBody: completion("Necesito ayuda."), body: interpretBody, wantCode: 502, wantErr: "ai_invalid_output", wantCalls: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := tt.metaStatus
			if status == 0 {
				status = 200
			}
			fake := newFakeMeta(t, status, tt.metaBody)
			rec := do(newRouter(routerConfig{apiKey: tt.apiKey, baseURL: fake.URL}), http.MethodPost, "/api/v1/interpret", tt.body)
			if rec.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tt.wantCode, rec.Body)
			}
			raw := rec.Body.String()
			for _, leak := range []string{"slow", "boom", "no such model", testAPIKey} {
				if strings.Contains(raw, leak) {
					t.Fatalf("provider detail %q leaked: %s", leak, raw)
				}
			}
			var body ErrorBody
			_ = json.Unmarshal([]byte(raw), &body)
			if body.Error.Code != tt.wantErr {
				t.Fatalf("error code = %q, want %q", body.Error.Code, tt.wantErr)
			}
			if fake.calls != tt.wantCalls {
				t.Fatalf("provider calls = %d, want %d", fake.calls, tt.wantCalls)
			}
		})
	}
}

type slowTester struct{}

func (slowTester) TestConnection(ctx context.Context) (service.ConnectionTestResult, error) {
	<-ctx.Done()
	return service.ConnectionTestResult{}, ctx.Err()
}

func TestProviderTimeoutMapsTo504(t *testing.T) {
	h := &handlers{logger: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err := slowTester{}.TestConnection(ctx)
	rec := httptest.NewRecorder()
	h.writeServiceError(rec, httptest.NewRequest(http.MethodPost, "/", nil), err)
	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d", rec.Code)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expected deadline error")
	}
}

func TestCORSPreflight(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/interpret", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()
	newRouter(routerConfig{}).ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCORSDisallowedOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://evil.test")
	rec := httptest.NewRecorder()
	newRouter(routerConfig{}).ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no CORS header, got %q", got)
	}
}

func TestNotFound(t *testing.T) {
	rec := do(newRouter(routerConfig{}), http.MethodGet, "/nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
