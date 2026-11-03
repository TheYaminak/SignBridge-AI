package service

import (
	"context"
	"errors"
	"testing"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

func TestInterpretInvalidRequest(t *testing.T) {
	s := NewMetaInterpreter(meta.NewHTTPClient(meta.Options{}))
	_, err := s.Interpret(context.Background(), domain.InterpretationRequest{})
	if !errors.Is(err, domain.ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest, got %v", err)
	}
}

func TestInterpretNotImplemented(t *testing.T) {
	s := NewMetaInterpreter(meta.NewHTTPClient(meta.Options{}))
	req := domain.InterpretationRequest{
		Signs:    domain.SignSequence{{Label: "HELP", Confidence: 0.94, Timestamp: 1730000000000}},
		Language: "es",
	}
	_, err := s.Interpret(context.Background(), req)
	if !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("expected ErrNotImplemented, got %v", err)
	}
}
