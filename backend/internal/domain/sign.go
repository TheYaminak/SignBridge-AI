// Package domain defines the core types exchanged between the frontend
// recognizer and the interpretation service. The backend never receives
// raw video; it only receives sequences of already-recognized signs.
package domain

import (
	"errors"
	"fmt"
	"strings"
)

// RecognitionConfidence is a classifier confidence score in the range [0, 1].
type RecognitionConfidence float64

// Valid reports whether the confidence is within [0, 1].
func (c RecognitionConfidence) Valid() bool {
	return c >= 0 && c <= 1
}

// RecognizedSign is a single sign label produced by the on-device recognizer.
type RecognizedSign struct {
	Label      string                `json:"label"`
	Confidence RecognitionConfidence `json:"confidence"`
	// Timestamp is a Unix epoch time in milliseconds.
	Timestamp int64 `json:"timestamp"`
}

// SignSequence is an ordered list of recognized signs.
type SignSequence []RecognizedSign

// InterpretationRequest asks the service to turn a sign sequence into text.
type InterpretationRequest struct {
	Signs SignSequence `json:"signs"`
	// Language is the BCP 47 language tag for the output text (e.g. "en", "es").
	Language string `json:"language"`
}

// InterpretationResult is the natural-language interpretation of a sequence.
type InterpretationResult struct {
	Text       string                `json:"text"`
	Language   string                `json:"language"`
	Confidence RecognitionConfidence `json:"confidence"`
	Model      string                `json:"model,omitempty"`
}

// MaxSequenceLength bounds the number of signs accepted per request.
const MaxSequenceLength = 64

// ErrInvalidRequest wraps all request validation failures.
var ErrInvalidRequest = errors.New("invalid interpretation request")

// Validate checks the request for structural correctness.
func (r InterpretationRequest) Validate() error {
	if len(r.Signs) == 0 {
		return fmt.Errorf("%w: signs must not be empty", ErrInvalidRequest)
	}
	if len(r.Signs) > MaxSequenceLength {
		return fmt.Errorf("%w: at most %d signs are allowed", ErrInvalidRequest, MaxSequenceLength)
	}
	if strings.TrimSpace(r.Language) == "" {
		return fmt.Errorf("%w: language is required", ErrInvalidRequest)
	}
	for i, s := range r.Signs {
		if strings.TrimSpace(s.Label) == "" {
			return fmt.Errorf("%w: signs[%d].label is required", ErrInvalidRequest, i)
		}
		if !s.Confidence.Valid() {
			return fmt.Errorf("%w: signs[%d].confidence must be between 0 and 1", ErrInvalidRequest, i)
		}
		if s.Timestamp <= 0 {
			return fmt.Errorf("%w: signs[%d].timestamp must be a positive epoch milliseconds value", ErrInvalidRequest, i)
		}
	}
	return nil
}
