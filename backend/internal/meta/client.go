// Package meta is a minimal client for the Meta Model API Chat Completions
// endpoint (OpenAI-compatible). See https://dev.meta.ai/docs/protocols/chat-completions.
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Provider is the provider name reported in API responses.
const Provider = "meta"

// maxResponseBytes bounds how much of a provider response is read.
const maxResponseBytes = 1 << 20

var (
	// ErrNotConfigured is returned when the API key, model, or base URL is missing.
	ErrNotConfigured = errors.New("meta: client is not configured")
	// ErrInvalidResponse is returned when the provider response cannot be parsed.
	ErrInvalidResponse = errors.New("meta: invalid response from provider")
	// ErrUnavailable is returned for network-level failures reaching the provider.
	ErrUnavailable = errors.New("meta: provider unreachable")
)

// APIError is a non-2xx response from the Meta Model API. Its fields come
// from the documented error envelope {"error":{"message","type","param","code"}}.
// Message may echo request details: log it, never return it to clients.
type APIError struct {
	StatusCode int
	Type       string
	Code       string
	Param      string
	Message    string
	RetryAfter time.Duration
}

func (e *APIError) Error() string {
	return fmt.Sprintf("meta: api error status=%d type=%q code=%q param=%q: %s",
		e.StatusCode, e.Type, e.Code, e.Param, e.Message)
}

// Message roles. Meta recommends "developer" over "system" for instructions.
const (
	RoleDeveloper = "developer"
	RoleUser      = "user"
)

// Message is a single chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ResponseFormat requests structured output.
type ResponseFormat struct {
	Type       string      `json:"type"`
	JSONSchema *JSONSchema `json:"json_schema,omitempty"`
}

// JSONSchema describes the schema the model output must follow.
type JSONSchema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
	Strict bool            `json:"strict,omitempty"`
}

// ChatRequest is a provider-agnostic chat completion request. The client
// fills in the configured model.
type ChatRequest struct {
	Messages []Message
	// MaxCompletionTokens includes reasoning tokens (Muse Spark always reasons).
	MaxCompletionTokens int
	// ReasoningEffort is one of minimal, low, medium, high, xhigh. Empty uses the model default.
	ReasoningEffort string
	ResponseFormat  *ResponseFormat
}

// Usage reports token consumption, when the provider returns it.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	ReasoningTokens  int `json:"reasoning_tokens,omitempty"`
}

// ChatResponse is the parsed result of a chat completion.
type ChatResponse struct {
	ID           string
	Model        string
	Content      string
	Refusal      string
	FinishReason string
	Usage        *Usage
	Latency      time.Duration
}

// Client is the interface the service layer depends on.
type Client interface {
	ChatCompletion(ctx context.Context, req ChatRequest) (ChatResponse, error)
	Configured() bool
	Model() string
}

// HTTPDoer is satisfied by *http.Client; injectable for tests.
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// Options configures an HTTPClient.
type Options struct {
	APIKey     string
	Model      string
	BaseURL    string
	Timeout    time.Duration
	HTTPClient HTTPDoer
	Logger     *slog.Logger
}

// HTTPClient calls the Meta Model API over net/http.
// The API key is held only in memory and is never logged or returned.
type HTTPClient struct {
	apiKey  string
	model   string
	baseURL string
	http    HTTPDoer
	logger  *slog.Logger
	now     func() time.Time
}

// NewHTTPClient builds a client. It does not contact the API.
func NewHTTPClient(opts Options) *HTTPClient {
	doer := opts.HTTPClient
	if doer == nil {
		timeout := opts.Timeout
		if timeout <= 0 {
			timeout = 45 * time.Second
		}
		doer = &http.Client{Timeout: timeout}
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &HTTPClient{
		apiKey:  opts.APIKey,
		model:   opts.Model,
		baseURL: strings.TrimRight(opts.BaseURL, "/"),
		http:    doer,
		logger:  logger,
		now:     time.Now,
	}
}

// Configured reports whether the client has everything needed to make calls.
func (c *HTTPClient) Configured() bool {
	return c.apiKey != "" && c.model != "" && c.baseURL != ""
}

// Model returns the configured model identifier.
func (c *HTTPClient) Model() string { return c.model }

// Wire types for POST /chat/completions.
type chatCompletionRequest struct {
	Model               string          `json:"model"`
	Messages            []Message       `json:"messages"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string          `json:"reasoning_effort,omitempty"`
	ResponseFormat      *ResponseFormat `json:"response_format,omitempty"`
	Stream              bool            `json:"stream"`
}

type chatCompletionResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content *string `json:"content"`
			Refusal *string `json:"refusal"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens            int `json:"prompt_tokens"`
		CompletionTokens        int `json:"completion_tokens"`
		TotalTokens             int `json:"total_tokens"`
		CompletionTokensDetails *struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	} `json:"usage"`
}

type errorEnvelope struct {
	Error *struct {
		Message string  `json:"message"`
		Type    string  `json:"type"`
		Param   *string `json:"param"`
		Code    *string `json:"code"`
	} `json:"error"`
}

// ChatCompletion sends a non-streaming chat completion request.
func (c *HTTPClient) ChatCompletion(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	if !c.Configured() {
		return ChatResponse{}, ErrNotConfigured
	}
	if len(req.Messages) == 0 {
		return ChatResponse{}, errors.New("meta: at least one message is required")
	}

	body, err := json.Marshal(chatCompletionRequest{
		Model:               c.model,
		Messages:            req.Messages,
		MaxCompletionTokens: req.MaxCompletionTokens,
		ReasoningEffort:     req.ReasoningEffort,
		ResponseFormat:      req.ResponseFormat,
	})
	if err != nil {
		return ChatResponse{}, fmt.Errorf("meta: encode request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("meta: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	start := c.now()
	resp, err := c.http.Do(httpReq)
	latency := c.now().Sub(start)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ChatResponse{}, ctxErr
		}
		var netErr interface{ Timeout() bool }
		if errors.As(err, &netErr) && netErr.Timeout() {
			return ChatResponse{}, fmt.Errorf("%w: %w", ErrUnavailable, context.DeadlineExceeded)
		}
		c.logger.WarnContext(ctx, "meta request failed", "error", err, "latency_ms", latency.Milliseconds())
		return ChatResponse{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("%w: read body: %v", ErrInvalidResponse, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		apiErr := parseAPIError(resp, raw)
		c.logger.WarnContext(ctx, "meta api error",
			"status", apiErr.StatusCode, "type", apiErr.Type, "code", apiErr.Code,
			"param", apiErr.Param, "latency_ms", latency.Milliseconds())
		return ChatResponse{}, apiErr
	}

	var parsed chatCompletionResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ChatResponse{}, fmt.Errorf("%w: decode: %v", ErrInvalidResponse, err)
	}
	if len(parsed.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("%w: no choices", ErrInvalidResponse)
	}

	choice := parsed.Choices[0]
	out := ChatResponse{
		ID:           parsed.ID,
		Model:        parsed.Model,
		FinishReason: choice.FinishReason,
		Latency:      latency,
	}
	if choice.Message.Content != nil {
		out.Content = *choice.Message.Content
	}
	if choice.Message.Refusal != nil {
		out.Refusal = *choice.Message.Refusal
	}
	if u := parsed.Usage; u != nil {
		out.Usage = &Usage{
			PromptTokens:     u.PromptTokens,
			CompletionTokens: u.CompletionTokens,
			TotalTokens:      u.TotalTokens,
		}
		if u.CompletionTokensDetails != nil {
			out.Usage.ReasoningTokens = u.CompletionTokensDetails.ReasoningTokens
		}
	}

	attrs := []any{"model", out.Model, "finish_reason", out.FinishReason, "latency_ms", latency.Milliseconds()}
	if out.Usage != nil {
		attrs = append(attrs, "prompt_tokens", out.Usage.PromptTokens,
			"completion_tokens", out.Usage.CompletionTokens, "reasoning_tokens", out.Usage.ReasoningTokens)
	}
	c.logger.InfoContext(ctx, "meta chat completion", attrs...)

	return out, nil
}

func parseAPIError(resp *http.Response, raw []byte) *APIError {
	apiErr := &APIError{StatusCode: resp.StatusCode}
	var env errorEnvelope
	if err := json.Unmarshal(raw, &env); err == nil && env.Error != nil {
		apiErr.Type = env.Error.Type
		apiErr.Message = env.Error.Message
		if env.Error.Code != nil {
			apiErr.Code = *env.Error.Code
		}
		if env.Error.Param != nil {
			apiErr.Param = *env.Error.Param
		}
	} else {
		// Unknown paths return an empty body per the docs.
		apiErr.Message = http.StatusText(resp.StatusCode)
	}
	if s := resp.Header.Get("Retry-After"); s != "" {
		if secs, err := strconv.Atoi(s); err == nil && secs > 0 {
			apiErr.RetryAfter = time.Duration(secs) * time.Second
		}
	}
	return apiErr
}
