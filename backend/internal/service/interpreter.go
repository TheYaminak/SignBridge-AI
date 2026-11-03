// Package service holds the application's business logic.
package service

import (
	"context"
	"errors"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

// ErrNotImplemented signals that interpretation is not available yet.
var ErrNotImplemented = errors.New("interpretation is not implemented yet")

// Interpreter turns recognized sign sequences into natural language.
type Interpreter interface {
	Interpret(ctx context.Context, req domain.InterpretationRequest) (domain.InterpretationResult, error)
}

// MetaInterpreter will use the Meta Model API to interpret sign sequences.
type MetaInterpreter struct {
	client meta.Client
}

// NewMetaInterpreter returns an Interpreter backed by a Meta client.
func NewMetaInterpreter(client meta.Client) *MetaInterpreter {
	return &MetaInterpreter{client: client}
}

// Interpret validates the request, then reports that interpretation is not
// implemented in Phase 1. It never produces a fabricated result.
func (s *MetaInterpreter) Interpret(ctx context.Context, req domain.InterpretationRequest) (domain.InterpretationResult, error) {
	if err := req.Validate(); err != nil {
		return domain.InterpretationResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return domain.InterpretationResult{}, err
	}
	// TODO(phase-3): build a prompt from req.Signs and call s.client.Complete.
	return domain.InterpretationResult{}, ErrNotImplemented
}
