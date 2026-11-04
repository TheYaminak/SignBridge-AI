// Package service holds the application's business logic.
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

var (
	// ErrNoConfidentSigns means every sign fell below the confidence threshold.
	ErrNoConfidentSigns = errors.New("no signs meet the confidence threshold")
	// ErrInvalidModelOutput means the model response broke the JSON contract.
	ErrInvalidModelOutput = errors.New("model output did not match the expected format")
	// ErrModelRefused means the model declined or the output was filtered.
	ErrModelRefused = errors.New("model declined to produce an interpretation")
)

const (
	maxInterpretationChars = 600
	maxNoteChars           = 400
	// Muse Spark always reasons; the budget covers reasoning plus output.
	interpretMaxCompletionTokens = 2048
	interpretReasoningEffort     = "low"
)

// Interpreter turns recognized sign sequences into natural language.
type Interpreter interface {
	Interpret(ctx context.Context, req domain.InterpretationRequest) (domain.InterpretationResult, error)
}

// MetaInterpreter uses Muse Spark via the Meta Model API.
type MetaInterpreter struct {
	client        meta.Client
	minConfidence float64
}

// NewMetaInterpreter returns an Interpreter backed by a Meta client.
// Signs with confidence below minConfidence are discarded before the model call.
func NewMetaInterpreter(client meta.Client, minConfidence float64) *MetaInterpreter {
	return &MetaInterpreter{client: client, minConfidence: minConfidence}
}

// modelOutput mirrors interpretationSchema.
type modelOutput struct {
	Interpretation     *string  `json:"interpretation"`
	Confidence         *float64 `json:"confidence"`
	NeedsClarification *bool    `json:"needs_clarification"`
	ClarificationNote  *string  `json:"clarification_note"`
}

// Interpret validates and normalizes the request, filters low-confidence
// signs, asks the model for an interpretation, and validates its output.
func (s *MetaInterpreter) Interpret(ctx context.Context, req domain.InterpretationRequest) (domain.InterpretationResult, error) {
	norm, err := req.Normalize()
	if err != nil {
		return domain.InterpretationResult{}, err
	}

	accepted, discarded := norm.Signs.SplitByConfidence(s.minConfidence)
	if len(accepted) == 0 {
		return domain.InterpretationResult{}, fmt.Errorf("%w (minimum %.2f)", ErrNoConfidentSigns, s.minConfidence)
	}
	if !s.client.Configured() {
		return domain.InterpretationResult{}, meta.ErrNotConfigured
	}

	user, err := userPrompt(norm.Language, norm.RecognitionType, accepted)
	if err != nil {
		return domain.InterpretationResult{}, fmt.Errorf("build prompt: %w", err)
	}
	languageName := domain.SupportedLanguages[norm.Language]
	system := systemPrompt(languageName)
	if norm.RecognitionType == domain.RecognitionGesture {
		system = gestureSystemPrompt(languageName)
	}

	resp, err := s.client.ChatCompletion(ctx, meta.ChatRequest{
		Messages: []meta.Message{
			{Role: meta.RoleDeveloper, Content: system},
			{Role: meta.RoleUser, Content: user},
		},
		MaxCompletionTokens: interpretMaxCompletionTokens,
		ReasoningEffort:     interpretReasoningEffort,
		ResponseFormat:      interpretationResponseFormat(),
	})
	if err != nil {
		return domain.InterpretationResult{}, err
	}

	interp, err := parseModelOutput(resp)
	if err != nil {
		return domain.InterpretationResult{}, err
	}
	interp.Language = norm.Language

	model := resp.Model
	if model == "" {
		model = s.client.Model()
	}
	return domain.InterpretationResult{
		Source:          norm.Source,
		RecognitionType: norm.RecognitionType,
		RecognizedSigns: accepted,
		DiscardedSigns:  discarded,
		MinConfidence:   s.minConfidence,
		Interpretation:  interp,
		Provider:        meta.Provider,
		Model:           model,
		LatencyMS:       resp.Latency.Milliseconds(),
		Usage:           toDomainUsage(resp.Usage),
	}, nil
}

// parseModelOutput enforces the JSON contract on the model's reply.
func parseModelOutput(resp meta.ChatResponse) (domain.Interpretation, error) {
	switch {
	case resp.Refusal != "":
		return domain.Interpretation{}, ErrModelRefused
	case resp.FinishReason == "content_filter":
		return domain.Interpretation{}, ErrModelRefused
	case resp.FinishReason == "length":
		return domain.Interpretation{}, fmt.Errorf("%w: response was truncated", ErrInvalidModelOutput)
	}

	dec := json.NewDecoder(bytes.NewReader([]byte(strings.TrimSpace(resp.Content))))
	dec.DisallowUnknownFields()
	var out modelOutput
	if err := dec.Decode(&out); err != nil {
		return domain.Interpretation{}, fmt.Errorf("%w: %v", ErrInvalidModelOutput, err)
	}
	if dec.More() {
		return domain.Interpretation{}, fmt.Errorf("%w: trailing data", ErrInvalidModelOutput)
	}
	if out.Interpretation == nil || out.Confidence == nil || out.NeedsClarification == nil || out.ClarificationNote == nil {
		return domain.Interpretation{}, fmt.Errorf("%w: missing required field", ErrInvalidModelOutput)
	}

	text := strings.TrimSpace(*out.Interpretation)
	note := strings.TrimSpace(*out.ClarificationNote)
	conf := domain.RecognitionConfidence(*out.Confidence)
	switch {
	case text == "":
		return domain.Interpretation{}, fmt.Errorf("%w: empty interpretation", ErrInvalidModelOutput)
	case utf8.RuneCountInString(text) > maxInterpretationChars:
		return domain.Interpretation{}, fmt.Errorf("%w: interpretation too long", ErrInvalidModelOutput)
	case utf8.RuneCountInString(note) > maxNoteChars:
		return domain.Interpretation{}, fmt.Errorf("%w: clarification note too long", ErrInvalidModelOutput)
	case !conf.Valid():
		return domain.Interpretation{}, fmt.Errorf("%w: confidence out of range", ErrInvalidModelOutput)
	}

	return domain.Interpretation{
		Text:               text,
		Confidence:         conf,
		NeedsClarification: *out.NeedsClarification,
		ClarificationNote:  note,
		GeneratedBy:        "ai",
	}, nil
}

func toDomainUsage(u *meta.Usage) *domain.TokenUsage {
	if u == nil {
		return nil
	}
	return &domain.TokenUsage{
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
		ReasoningTokens:  u.ReasoningTokens,
	}
}
