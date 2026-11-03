// Package meta contains the client abstraction for the Meta Model API.
//
// Phase 1 deliberately does not perform any network calls. The endpoint
// path, request schema, and model identifiers must be confirmed against
// official Meta documentation before Complete is implemented.
package meta

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// ErrNotConfigured is returned when required credentials or settings are missing.
var ErrNotConfigured = errors.New("meta: client is not configured")

// ErrNotImplemented is returned until the real API integration is built.
var ErrNotImplemented = errors.New("meta: model API integration is not implemented yet")

// Message is a single chat-style message sent to the model.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// CompletionRequest is a provider-agnostic text generation request.
type CompletionRequest struct {
	Messages    []Message
	MaxTokens   int
	Temperature float64
}

// CompletionResponse is the provider-agnostic generation result.
type CompletionResponse struct {
	Text  string
	Model string
}

// Client is the interface the service layer depends on.
type Client interface {
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
}

// Options configures an HTTPClient.
type Options struct {
	APIKey  string
	Model   string
	BaseURL string
	Timeout time.Duration
}

// HTTPClient will call the Meta Model API using net/http.
// The API key is held only in memory on the server and never returned.
type HTTPClient struct {
	apiKey  string
	model   string
	baseURL string
	http    *http.Client
}

// NewHTTPClient builds a client. It does not validate connectivity.
func NewHTTPClient(opts Options) *HTTPClient {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &HTTPClient{
		apiKey:  opts.APIKey,
		model:   opts.Model,
		baseURL: opts.BaseURL,
		http:    &http.Client{Timeout: timeout},
	}
}

// Configured reports whether the client has everything needed to make calls.
func (c *HTTPClient) Configured() bool {
	return c.apiKey != "" && c.model != "" && c.baseURL != ""
}

// Model returns the configured model identifier.
func (c *HTTPClient) Model() string { return c.model }

// Complete is a placeholder. It returns ErrNotConfigured when settings are
// missing and ErrNotImplemented otherwise; it never fabricates output.
func (c *HTTPClient) Complete(ctx context.Context, _ CompletionRequest) (CompletionResponse, error) {
	if err := ctx.Err(); err != nil {
		return CompletionResponse{}, err
	}
	if !c.Configured() {
		return CompletionResponse{}, ErrNotConfigured
	}
	// TODO(phase-3): build the request against the documented endpoint,
	// set the Authorization header from c.apiKey, and decode the response.
	return CompletionResponse{}, ErrNotImplemented
}
