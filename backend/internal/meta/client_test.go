package meta

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testKey = "LLM_123_secret-test-key"

func newTestClient(t *testing.T, handler http.HandlerFunc) (*HTTPClient, *strings.Builder) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	logs := &strings.Builder{}
	c := NewHTTPClient(Options{
		APIKey:  testKey,
		Model:   "muse-spark-1.3",
		BaseURL: srv.URL + "/v1/",
		Logger:  slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	return c, logs
}

func userRequest() ChatRequest {
	return ChatRequest{Messages: []Message{{Role: RoleUser, Content: "Reply with the single word READY."}}}
}

func TestChatCompletionNotConfigured(t *testing.T) {
	for name, opts := range map[string]Options{
		"missing key":   {Model: "m", BaseURL: "https://x.test"},
		"missing model": {APIKey: "k", BaseURL: "https://x.test"},
		"missing url":   {APIKey: "k", Model: "m"},
	} {
		t.Run(name, func(t *testing.T) {
			c := NewHTTPClient(opts)
			if c.Configured() {
				t.Fatal("Configured() = true")
			}
			if _, err := c.ChatCompletion(context.Background(), userRequest()); !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("expected ErrNotConfigured, got %v", err)
			}
		})
	}
}

func TestChatCompletionRequestSerialization(t *testing.T) {
	var gotBody map[string]any
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+testKey {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode: %v", err)
		}
		_, _ = io.WriteString(w, `{"id":"x","model":"muse-spark-1.3","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
	})

	_, err := c.ChatCompletion(context.Background(), ChatRequest{
		Messages:            []Message{{Role: RoleDeveloper, Content: "rules"}, {Role: RoleUser, Content: "hi"}},
		MaxCompletionTokens: 256,
		ReasoningEffort:     "low",
		ResponseFormat: &ResponseFormat{Type: "json_schema", JSONSchema: &JSONSchema{
			Name: "x", Strict: true, Schema: json.RawMessage(`{"type":"object"}`),
		}},
	})
	if err != nil {
		t.Fatalf("ChatCompletion: %v", err)
	}

	if gotBody["model"] != "muse-spark-1.3" {
		t.Errorf("model = %v", gotBody["model"])
	}
	if gotBody["max_completion_tokens"] != float64(256) {
		t.Errorf("max_completion_tokens = %v", gotBody["max_completion_tokens"])
	}
	if gotBody["reasoning_effort"] != "low" {
		t.Errorf("reasoning_effort = %v", gotBody["reasoning_effort"])
	}
	if gotBody["stream"] != false {
		t.Errorf("stream = %v", gotBody["stream"])
	}
	if _, ok := gotBody["max_tokens"]; ok {
		t.Error("deprecated max_tokens must not be sent")
	}
	msgs, _ := gotBody["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["role"] != "developer" {
		t.Errorf("messages = %v", gotBody["messages"])
	}
	rf, _ := gotBody["response_format"].(map[string]any)
	js, _ := rf["json_schema"].(map[string]any)
	if rf["type"] != "json_schema" || js["name"] != "x" || js["strict"] != true {
		t.Errorf("response_format = %v", rf)
	}
}

func TestChatCompletionOmitsOptionalFields(t *testing.T) {
	var gotBody map[string]any
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
	})
	if _, err := c.ChatCompletion(context.Background(), userRequest()); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"max_completion_tokens", "reasoning_effort", "response_format"} {
		if _, ok := gotBody[k]; ok {
			t.Errorf("%s should be omitted", k)
		}
	}
}

func TestChatCompletionResponseParsing(t *testing.T) {
	c, logs := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"id":"chatcmpl-abc123","object":"chat.completion","created":1714502400,"model":"muse-spark-1.3",
			"choices":[{"index":0,"message":{"role":"assistant","content":"READY","refusal":null,"reasoning_content":"..."},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":25,"completion_tokens":19,"total_tokens":44,"completion_tokens_details":{"reasoning_tokens":12}}
		}`)
	})

	got, err := c.ChatCompletion(context.Background(), userRequest())
	if err != nil {
		t.Fatalf("ChatCompletion: %v", err)
	}
	if got.Content != "READY" || got.Model != "muse-spark-1.3" || got.ID != "chatcmpl-abc123" || got.FinishReason != "stop" {
		t.Errorf("unexpected response: %+v", got)
	}
	if got.Usage == nil || got.Usage.PromptTokens != 25 || got.Usage.CompletionTokens != 19 ||
		got.Usage.TotalTokens != 44 || got.Usage.ReasoningTokens != 12 {
		t.Errorf("usage = %+v", got.Usage)
	}
	if strings.Contains(logs.String(), testKey) || strings.Contains(logs.String(), "secret") {
		t.Error("API key leaked into logs")
	}
}

func TestChatCompletionNullContentAndMissingUsage(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":null,"refusal":"I can't help with that."},"finish_reason":"stop"}]}`)
	})
	got, err := c.ChatCompletion(context.Background(), userRequest())
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "" || got.Refusal == "" || got.Usage != nil {
		t.Errorf("unexpected: %+v", got)
	}
}

func TestChatCompletionInvalidResponses(t *testing.T) {
	for name, body := range map[string]string{
		"not json":   `<html>oops</html>`,
		"no choices": `{"choices":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			c, _ := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = io.WriteString(w, body)
			})
			if _, err := c.ChatCompletion(context.Background(), userRequest()); !errors.Is(err, ErrInvalidResponse) {
				t.Fatalf("expected ErrInvalidResponse, got %v", err)
			}
		})
	}
}

func TestChatCompletionProviderErrors(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		retryAfter string
		want       APIError
	}{
		{
			name:   "unauthorized",
			status: 401,
			body:   `{"error":{"message":"Unauthorized","type":"authentication_error","param":null,"code":"invalid_api_key"}}`,
			want:   APIError{StatusCode: 401, Type: "authentication_error", Code: "invalid_api_key", Message: "Unauthorized"},
		},
		{
			name:   "validation",
			status: 400,
			body:   `{"error":{"message":"bad top_p","type":"invalid_request_error","param":"top_p","code":null}}`,
			want:   APIError{StatusCode: 400, Type: "invalid_request_error", Param: "top_p", Message: "bad top_p"},
		},
		{
			name:       "rate limited",
			status:     429,
			body:       `{"error":{"message":"slow down","type":"rate_limit_error","code":"rate_limit_exceeded"}}`,
			retryAfter: "30",
			want:       APIError{StatusCode: 429, Type: "rate_limit_error", Code: "rate_limit_exceeded", Message: "slow down", RetryAfter: 30 * time.Second},
		},
		{
			name:   "empty body 404",
			status: 404,
			body:   ``,
			want:   APIError{StatusCode: 404, Message: "Not Found"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, logs := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				if tt.retryAfter != "" {
					w.Header().Set("Retry-After", tt.retryAfter)
				}
				w.WriteHeader(tt.status)
				_, _ = io.WriteString(w, tt.body)
			})
			_, err := c.ChatCompletion(context.Background(), userRequest())
			var apiErr *APIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("expected *APIError, got %v", err)
			}
			if *apiErr != tt.want {
				t.Errorf("got %+v, want %+v", *apiErr, tt.want)
			}
			if strings.Contains(logs.String(), testKey) {
				t.Error("API key leaked into logs")
			}
		})
	}
}

func TestChatCompletionContextCanceled(t *testing.T) {
	release := make(chan struct{})
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		// The server may not notice the client hanging up, so also exit when
		// the test ends; otherwise srv.Close blocks forever.
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	// Registered after newTestClient's srv.Close, so it runs first (LIFO).
	t.Cleanup(func() { close(release) })
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := c.ChatCompletion(ctx, userRequest()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context.DeadlineExceeded, got %v", err)
	}
}

type failingDoer struct{ err error }

func (f failingDoer) Do(*http.Request) (*http.Response, error) { return nil, f.err }

func TestChatCompletionNetworkError(t *testing.T) {
	c := NewHTTPClient(Options{
		APIKey: "k", Model: "m", BaseURL: "https://x.test",
		HTTPClient: failingDoer{err: errors.New("dial tcp: connection refused")},
		Logger:     slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
	if _, err := c.ChatCompletion(context.Background(), userRequest()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", err)
	}
}
