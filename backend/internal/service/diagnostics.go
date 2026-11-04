package service

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

// ConnectionTestPrompt is the fixed prompt used to verify live connectivity.
const ConnectionTestPrompt = "Reply with the single word READY."

const maxTestResponseChars = 200

// ConnectionTestResult is returned by POST /api/v1/meta/test.
type ConnectionTestResult struct {
	Success   bool               `json:"success"`
	Provider  string             `json:"provider"`
	Model     string             `json:"model"`
	Response  string             `json:"response"`
	LatencyMS int64              `json:"latency_ms"`
	Usage     *domain.TokenUsage `json:"usage,omitempty"`
}

// ConnectionTester makes a real, minimal request to verify the provider.
type ConnectionTester interface {
	TestConnection(ctx context.Context) (ConnectionTestResult, error)
}

// MetaConnectionTester verifies connectivity to the Meta Model API.
type MetaConnectionTester struct {
	client meta.Client
}

// NewMetaConnectionTester returns a ConnectionTester for the given client.
func NewMetaConnectionTester(client meta.Client) *MetaConnectionTester {
	return &MetaConnectionTester{client: client}
}

// TestConnection sends ConnectionTestPrompt and reports the real reply.
func (t *MetaConnectionTester) TestConnection(ctx context.Context) (ConnectionTestResult, error) {
	if !t.client.Configured() {
		return ConnectionTestResult{}, meta.ErrNotConfigured
	}
	resp, err := t.client.ChatCompletion(ctx, meta.ChatRequest{
		Messages:            []meta.Message{{Role: meta.RoleUser, Content: ConnectionTestPrompt}},
		MaxCompletionTokens: 1024,
		ReasoningEffort:     "low",
	})
	if err != nil {
		return ConnectionTestResult{}, err
	}
	if resp.Refusal != "" {
		return ConnectionTestResult{}, ErrModelRefused
	}
	text := strings.TrimSpace(resp.Content)
	if text == "" {
		return ConnectionTestResult{}, fmt.Errorf("%w: empty response (finish_reason=%q)", ErrInvalidModelOutput, resp.FinishReason)
	}
	if utf8.RuneCountInString(text) > maxTestResponseChars {
		text = string([]rune(text)[:maxTestResponseChars]) + "…"
	}

	model := resp.Model
	if model == "" {
		model = t.client.Model()
	}
	return ConnectionTestResult{
		Success:   true,
		Provider:  meta.Provider,
		Model:     model,
		Response:  text,
		LatencyMS: resp.Latency.Milliseconds(),
		Usage:     toDomainUsage(resp.Usage),
	}, nil
}
