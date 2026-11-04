// Package domain defines the core types exchanged between the frontend
// recognizer and the interpretation service. The backend never receives
// raw video; it only receives sequences of already-recognized signs.
package domain

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// RecognitionConfidence is a classifier confidence score in the range [0, 1].
type RecognitionConfidence float64

// Valid reports whether the confidence is within [0, 1].
func (c RecognitionConfidence) Valid() bool {
	return c >= 0 && c <= 1
}

// RecognizedSign is a single sign label produced by the recognizer.
type RecognizedSign struct {
	Label      string                `json:"label"`
	Confidence RecognitionConfidence `json:"confidence"`
	// Timestamp is a Unix epoch time in milliseconds.
	Timestamp int64 `json:"timestamp"`
}

// SignSequence is an ordered list of recognized signs.
type SignSequence []RecognizedSign

// SignSource says where a sign sequence came from, so manually entered test
// data is never presented as camera recognition.
type SignSource string

const (
	SourceCamera SignSource = "camera"
	SourceManual SignSource = "manual"
)

// SupportedLanguages maps accepted output language codes to their names.
var SupportedLanguages = map[string]string{
	"es": "Spanish",
	"en": "English",
}

// InterpretationRequest asks the service to turn a sign sequence into text.
type InterpretationRequest struct {
	Signs SignSequence `json:"signs"`
	// Language is the output language code: "es" or "en".
	Language string     `json:"language"`
	Source   SignSource `json:"source,omitempty"`
}

// DiscardedSign is an input sign that was not sent for interpretation.
type DiscardedSign struct {
	RecognizedSign
	Reason string `json:"reason"`
}

// TokenUsage reports provider token consumption, when available.
type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	ReasoningTokens  int `json:"reasoning_tokens,omitempty"`
}

// Interpretation is AI-generated text. It is always kept separate from the
// raw recognized labels it was derived from.
type Interpretation struct {
	Text     string `json:"text"`
	Language string `json:"language"`
	// Confidence is the model's self-assessed confidence in its reading.
	Confidence         RecognitionConfidence `json:"confidence"`
	NeedsClarification bool                  `json:"needs_clarification"`
	ClarificationNote  string                `json:"clarification_note,omitempty"`
	// GeneratedBy is always "ai".
	GeneratedBy string `json:"generated_by"`
}

// InterpretationResult is the full response of POST /api/v1/interpret.
type InterpretationResult struct {
	Source SignSource `json:"source,omitempty"`
	// RecognizedSigns are the normalized input signs that met the confidence
	// threshold and were sent to the model, in order.
	RecognizedSigns SignSequence    `json:"recognized_signs"`
	DiscardedSigns  []DiscardedSign `json:"discarded_signs"`
	MinConfidence   float64         `json:"min_confidence"`
	Interpretation  Interpretation  `json:"interpretation"`
	Provider        string          `json:"provider"`
	Model           string          `json:"model"`
	LatencyMS       int64           `json:"latency_ms"`
	Usage           *TokenUsage     `json:"usage,omitempty"`
}

const (
	// MaxSequenceLength bounds the number of signs accepted per request.
	MaxSequenceLength = 64
	// MaxLabelLength bounds a normalized label, in characters.
	MaxLabelLength = 32
)

// ErrInvalidRequest wraps all request validation failures.
var ErrInvalidRequest = errors.New("invalid interpretation request")

// NormalizeLabel upper-cases a label and joins words with underscores, e.g.
// " thank you " -> "THANK_YOU". Only letters and digits are allowed in words,
// which also keeps free-form text (and prompt injection) out of the model input.
func NormalizeLabel(raw string) (string, error) {
	words := strings.FieldsFunc(strings.ToUpper(raw), func(r rune) bool {
		return unicode.IsSpace(r) || r == '_' || r == '-'
	})
	if len(words) == 0 {
		return "", errors.New("label is required")
	}
	label := strings.Join(words, "_")
	if utf8.RuneCountInString(label) > MaxLabelLength {
		return "", fmt.Errorf("label must be at most %d characters", MaxLabelLength)
	}
	for _, r := range label {
		if r != '_' && !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return "", fmt.Errorf("label may only contain letters, digits, spaces, '-' or '_'")
		}
	}
	return label, nil
}

// Normalize validates the request and returns a copy with normalized labels
// and language code.
func (r InterpretationRequest) Normalize() (InterpretationRequest, error) {
	if len(r.Signs) == 0 {
		return r, fmt.Errorf("%w: signs must not be empty", ErrInvalidRequest)
	}
	if len(r.Signs) > MaxSequenceLength {
		return r, fmt.Errorf("%w: at most %d signs are allowed", ErrInvalidRequest, MaxSequenceLength)
	}

	lang := strings.ToLower(strings.TrimSpace(r.Language))
	if lang == "" {
		return r, fmt.Errorf("%w: language is required", ErrInvalidRequest)
	}
	if _, ok := SupportedLanguages[lang]; !ok {
		return r, fmt.Errorf("%w: language %q is not supported (use \"es\" or \"en\")", ErrInvalidRequest, r.Language)
	}

	switch r.Source {
	case "", SourceCamera, SourceManual:
	default:
		return r, fmt.Errorf("%w: source must be \"camera\" or \"manual\"", ErrInvalidRequest)
	}

	out := InterpretationRequest{Language: lang, Source: r.Source, Signs: make(SignSequence, len(r.Signs))}
	for i, s := range r.Signs {
		label, err := NormalizeLabel(s.Label)
		if err != nil {
			return r, fmt.Errorf("%w: signs[%d]: %v", ErrInvalidRequest, i, err)
		}
		if !s.Confidence.Valid() {
			return r, fmt.Errorf("%w: signs[%d].confidence must be between 0 and 1", ErrInvalidRequest, i)
		}
		if s.Timestamp <= 0 {
			return r, fmt.Errorf("%w: signs[%d].timestamp must be a positive epoch milliseconds value", ErrInvalidRequest, i)
		}
		out.Signs[i] = RecognizedSign{Label: label, Confidence: s.Confidence, Timestamp: s.Timestamp}
	}
	return out, nil
}

// Validate checks the request for structural correctness.
func (r InterpretationRequest) Validate() error {
	_, err := r.Normalize()
	return err
}

// SplitByConfidence separates signs that meet min from those that do not,
// preserving order.
func (s SignSequence) SplitByConfidence(min float64) (accepted SignSequence, discarded []DiscardedSign) {
	accepted = SignSequence{}
	discarded = []DiscardedSign{}
	for _, sign := range s {
		if float64(sign.Confidence) >= min {
			accepted = append(accepted, sign)
			continue
		}
		discarded = append(discarded, DiscardedSign{
			RecognizedSign: sign,
			Reason:         fmt.Sprintf("confidence %.2f is below the %.2f threshold", sign.Confidence, min),
		})
	}
	return accepted, discarded
}
