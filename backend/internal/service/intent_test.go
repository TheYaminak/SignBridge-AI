package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

func intentReq(intent string, conf float64) domain.IntentRequest {
	return domain.IntentRequest{
		RecognitionType: "custom_sign_sequence", Intent: intent, Confidence: conf,
		Language: "es", RawLabels: []string{intent}, Source: domain.SourceCamera,
	}
}

const validIntentOutput = `{"text_es":"Necesito ayuda.","text_en":"I need help.","uncertain":false}`

func TestInterpretIntentMeta(t *testing.T) {
	client := okClient(validIntentOutput)
	got, err := NewMetaIntentInterpreter(client, 0.75, nil).InterpretIntent(context.Background(), intentReq("need_help", 0.93))
	if err != nil {
		t.Fatal(err)
	}
	if got.Intent != "NEED_HELP" || got.Source != "meta" || got.TextES != "Necesito ayuda." || got.TextEN != "I need help." ||
		got.Uncertain || got.Model != "muse-spark-1.3" || got.FallbackReason != "" {
		t.Errorf("got %+v", got)
	}
	if got.Verification.Status != domain.StatusWordReferences || len(got.Verification.References) == 0 || got.PredictionNote == "" {
		t.Errorf("verification = %+v", got.Verification)
	}
	// NEED_HELP's LSRD sign order is unverified: the result must say so.
	if !got.Experimental || got.Verification.SequenceVerified {
		t.Errorf("NEED_HELP must be experimental, got %+v", got.Verification)
	}
	if !strings.Contains(client.lastReq.Messages[1].Content, `"experimental":true`) {
		t.Error("model must be told the intent is experimental")
	}
	prompt := client.lastReq.Messages[0].Content
	for _, rule := range []string{"Preserve the intent exactly", "medical or safety details", "did not see any video"} {
		if !strings.Contains(prompt, rule) {
			t.Errorf("prompt missing rule %q", rule)
		}
	}
	if !strings.Contains(client.lastReq.Messages[1].Content, `"canonical_es":"Necesito ayuda"`) {
		t.Errorf("user prompt = %s", client.lastReq.Messages[1].Content)
	}
}

func TestInterpretIntentLowConfidenceIsUncertain(t *testing.T) {
	// Model claims certainty, but the prediction is below threshold.
	client := okClient(validIntentOutput)
	got, err := NewMetaIntentInterpreter(client, 0.75, nil).InterpretIntent(context.Background(), intentReq("NEED_HELP", 0.6))
	if err != nil {
		t.Fatal(err)
	}
	if !got.Uncertain {
		t.Error("low-confidence prediction must be uncertain")
	}
	if !strings.Contains(client.lastReq.Messages[1].Content, `"uncertain":true`) {
		t.Error("model must be told the prediction is uncertain")
	}
}

func TestInterpretIntentFallbacks(t *testing.T) {
	tests := []struct {
		name   string
		client *fakeClient
		reason string
	}{
		{"not configured", &fakeClient{configured: false}, FallbackNotConfigured},
		{"provider error", &fakeClient{configured: true, err: &meta.APIError{StatusCode: 503}}, FallbackUnavailable},
		{"timeout", &fakeClient{configured: true, err: context.DeadlineExceeded}, FallbackTimeout},
		{"invalid output", okClient(`{"text_es":"Hola"}`), FallbackInvalidOutput},
		{"refusal", &fakeClient{configured: true, resp: meta.ChatResponse{Refusal: "no", FinishReason: "stop"}}, FallbackRefused},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewMetaIntentInterpreter(tt.client, 0.75, nil).InterpretIntent(context.Background(), intentReq("THANK_YOU", 0.9))
			if err != nil {
				t.Fatal(err)
			}
			if got.Source != "local_fallback" || got.FallbackReason != tt.reason || got.Model != "" {
				t.Errorf("got source=%q reason=%q model=%q", got.Source, got.FallbackReason, got.Model)
			}
			if got.TextES != "Gracias" || got.TextEN != "Thank you" {
				t.Errorf("fallback text = %q / %q", got.TextES, got.TextEN)
			}
		})
	}
}

func TestInterpretIntentFallbackUncertainIsHedged(t *testing.T) {
	got, _ := NewMetaIntentInterpreter(&fakeClient{}, 0.75, nil).InterpretIntent(context.Background(), intentReq("HELLO", 0.5))
	if !got.Uncertain || got.TextES != "Posiblemente: Hola" || got.TextEN != "Possibly: Hello" {
		t.Errorf("got %+v", got)
	}
}

func TestInterpretIntentRejections(t *testing.T) {
	tests := []struct {
		name string
		req  domain.IntentRequest
		want error
	}{
		{"unknown", intentReq("UNKNOWN", 0.99), domain.ErrUnknownIntent},
		{"unavailable", intentReq("WHERE_BATHROOM", 0.99), domain.ErrIntentUnavailable},
		{"unsupported", intentReq("FLY", 0.9), domain.ErrInvalidRequest},
		{"wrong type", func() domain.IntentRequest { r := intentReq("HELLO", 0.9); r.RecognitionType = "gesture"; return r }(), domain.ErrInvalidRequest},
		{"confidence", intentReq("HELLO", 1.5), domain.ErrInvalidRequest},
		{"raw labels missing intent", func() domain.IntentRequest {
			r := intentReq("HELLO", 0.9)
			r.RawLabels = []string{"THANK_YOU"}
			return r
		}(), domain.ErrInvalidRequest},
		{"raw labels empty", func() domain.IntentRequest { r := intentReq("HELLO", 0.9); r.RawLabels = nil; return r }(), domain.ErrInvalidRequest},
		{"language", func() domain.IntentRequest { r := intentReq("HELLO", 0.9); r.Language = "fr"; return r }(), domain.ErrInvalidRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := okClient(validIntentOutput)
			_, err := NewMetaIntentInterpreter(client, 0.75, nil).InterpretIntent(context.Background(), tt.req)
			if !errors.Is(err, tt.want) {
				t.Fatalf("expected %v, got %v", tt.want, err)
			}
			if client.calls != 0 {
				t.Error("Meta must not be called for rejected requests")
			}
		})
	}
}

func TestInterpretIntentVerifiedSignIsNotExperimental(t *testing.T) {
	got, err := NewMetaIntentInterpreter(okClient(validIntentOutput), 0.75, nil).InterpretIntent(context.Background(), intentReq("HELLO", 0.9))
	if err != nil {
		t.Fatal(err)
	}
	if got.Experimental || !got.Verification.SequenceVerified {
		t.Errorf("HELLO is a documented single sign: %+v", got.Verification)
	}
}

func TestInterpretIntentAcceptsLegacyRecognitionType(t *testing.T) {
	req := intentReq("HELLO", 0.9)
	req.RecognitionType = "custom_sign"
	if _, err := NewMetaIntentInterpreter(okClient(validIntentOutput), 0.75, nil).InterpretIntent(context.Background(), req); err != nil {
		t.Fatalf("Phase 4 clients must keep working: %v", err)
	}
}
