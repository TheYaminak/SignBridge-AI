package meta

import (
	"context"
	"errors"
	"testing"
)

func TestCompleteNotConfigured(t *testing.T) {
	c := NewHTTPClient(Options{})
	_, err := c.Complete(context.Background(), CompletionRequest{})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestCompleteNotImplemented(t *testing.T) {
	c := NewHTTPClient(Options{APIKey: "k", Model: "m", BaseURL: "https://example.test"})
	_, err := c.Complete(context.Background(), CompletionRequest{})
	if !errors.Is(err, ErrNotImplemented) {
		t.Fatalf("expected ErrNotImplemented, got %v", err)
	}
}

func TestCompleteCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := NewHTTPClient(Options{APIKey: "k", Model: "m", BaseURL: "https://example.test"})
	if _, err := c.Complete(ctx, CompletionRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}
