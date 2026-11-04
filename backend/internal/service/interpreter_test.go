package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
)

// fakeClient is an in-memory meta.Client used to test service logic.
type fakeClient struct {
	configured bool
	resp       meta.ChatResponse
	err        error
	calls      int
	lastReq    meta.ChatRequest
}

func (f *fakeClient) Configured() bool { return f.configured }
func (f *fakeClient) Model() string    { return "muse-spark-1.3" }
func (f *fakeClient) ChatCompletion(_ context.Context, req meta.ChatRequest) (meta.ChatResponse, error) {
	f.calls++
	f.lastReq = req
	return f.resp, f.err
}

func okClient(content string) *fakeClient {
	return &fakeClient{configured: true, resp: meta.ChatResponse{
		Model: "muse-spark-1.3", Content: content, FinishReason: "stop", Latency: 1200 * time.Millisecond,
		Usage: &meta.Usage{PromptTokens: 300, CompletionTokens: 80, TotalTokens: 380, ReasoningTokens: 50},
	}}
}

const validOutput = `{"interpretation":"Necesito ayuda, por favor llamen a un médico.","confidence":0.82,"needs_clarification":false,"clarification_note":""}`

func request(signs ...domain.RecognizedSign) domain.InterpretationRequest {
	return domain.InterpretationRequest{Signs: signs, Language: "es", Source: domain.SourceManual}
}

func sign(label string, conf float64) domain.RecognizedSign {
	return domain.RecognizedSign{Label: label, Confidence: domain.RecognitionConfidence(conf), Timestamp: 1730000000000}
}

func TestInterpretSuccess(t *testing.T) {
	client := okClient(validOutput)
	s := NewMetaInterpreter(client, 0.6)

	got, err := s.Interpret(context.Background(), request(sign(" help", 0.94), sign("doctor", 0.91), sign("water", 0.3)))
	if err != nil {
		t.Fatalf("Interpret: %v", err)
	}

	if got.Interpretation.Text != "Necesito ayuda, por favor llamen a un médico." || got.Interpretation.GeneratedBy != "ai" ||
		got.Interpretation.Language != "es" || got.Interpretation.Confidence != 0.82 {
		t.Errorf("interpretation = %+v", got.Interpretation)
	}
	if len(got.RecognizedSigns) != 2 || got.RecognizedSigns[0].Label != "HELP" || got.RecognizedSigns[1].Label != "DOCTOR" {
		t.Errorf("recognized = %+v", got.RecognizedSigns)
	}
	if len(got.DiscardedSigns) != 1 || got.DiscardedSigns[0].Label != "WATER" {
		t.Errorf("discarded = %+v", got.DiscardedSigns)
	}
	if got.Source != domain.SourceManual || got.Provider != "meta" || got.Model != "muse-spark-1.3" ||
		got.LatencyMS != 1200 || got.MinConfidence != 0.6 {
		t.Errorf("metadata = %+v", got)
	}
	if got.Usage == nil || got.Usage.TotalTokens != 380 || got.Usage.ReasoningTokens != 50 {
		t.Errorf("usage = %+v", got.Usage)
	}

	// The model receives only accepted, normalized labels, as data.
	req := client.lastReq
	if len(req.Messages) != 2 || req.Messages[0].Role != meta.RoleDeveloper || req.Messages[1].Role != meta.RoleUser {
		t.Fatalf("messages = %+v", req.Messages)
	}
	if !strings.Contains(req.Messages[0].Content, "Spanish") || !strings.Contains(req.Messages[0].Content, "Never invent signs") {
		t.Error("system prompt missing language or no-invention rule")
	}
	user := req.Messages[1].Content
	if !strings.Contains(user, `"label":"HELP"`) || !strings.Contains(user, `"label":"DOCTOR"`) || strings.Contains(user, "WATER") {
		t.Errorf("user prompt = %s", user)
	}
	if req.ResponseFormat == nil || req.ResponseFormat.Type != "json_schema" || !req.ResponseFormat.JSONSchema.Strict {
		t.Error("expected strict json_schema response format")
	}
	if !json.Valid(req.ResponseFormat.JSONSchema.Schema) {
		t.Error("schema is not valid JSON")
	}
}

func TestInterpretEnglishPrompt(t *testing.T) {
	client := okClient(validOutput)
	req := request(sign("HELP", 0.9))
	req.Language = "en"
	if _, err := NewMetaInterpreter(client, 0.6).Interpret(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(client.lastReq.Messages[0].Content, "English") {
		t.Error("expected English system prompt")
	}
}

func TestInterpretValidationAndThresholds(t *testing.T) {
	tests := []struct {
		name    string
		req     domain.InterpretationRequest
		wantErr error
	}{
		{name: "empty sequence", req: request(), wantErr: domain.ErrInvalidRequest},
		{name: "invalid label", req: request(sign("help; drop table", 0.9)), wantErr: domain.ErrInvalidRequest},
		{name: "all below threshold", req: request(sign("HELP", 0.59), sign("DOCTOR", 0.1)), wantErr: ErrNoConfidentSigns},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := okClient(validOutput)
			_, err := NewMetaInterpreter(client, 0.6).Interpret(context.Background(), tt.req)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected %v, got %v", tt.wantErr, err)
			}
			if client.calls != 0 {
				t.Error("model must not be called for rejected input")
			}
		})
	}
}

func TestInterpretThresholdIsInclusive(t *testing.T) {
	client := okClient(validOutput)
	got, err := NewMetaInterpreter(client, 0.6).Interpret(context.Background(), request(sign("HELP", 0.6)))
	if err != nil || len(got.RecognizedSigns) != 1 {
		t.Fatalf("sign at exactly the threshold should be accepted: %v", err)
	}
}

func TestInterpretNotConfigured(t *testing.T) {
	client := &fakeClient{configured: false}
	_, err := NewMetaInterpreter(client, 0.6).Interpret(context.Background(), request(sign("HELP", 0.9)))
	if !errors.Is(err, meta.ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
	if client.calls != 0 {
		t.Error("model must not be called when not configured")
	}
}

func TestInterpretProviderError(t *testing.T) {
	client := &fakeClient{configured: true, err: &meta.APIError{StatusCode: 401, Type: "authentication_error"}}
	_, err := NewMetaInterpreter(client, 0.6).Interpret(context.Background(), request(sign("HELP", 0.9)))
	var apiErr *meta.APIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != 401 {
		t.Fatalf("expected APIError 401, got %v", err)
	}
}

func TestParseModelOutput(t *testing.T) {
	tests := []struct {
		name    string
		resp    meta.ChatResponse
		wantErr error
	}{
		{name: "valid", resp: meta.ChatResponse{Content: validOutput, FinishReason: "stop"}},
		{name: "valid with whitespace", resp: meta.ChatResponse{Content: "\n " + validOutput + "\n", FinishReason: "stop"}},
		{name: "refusal", resp: meta.ChatResponse{Refusal: "no", FinishReason: "stop"}, wantErr: ErrModelRefused},
		{name: "content filter", resp: meta.ChatResponse{Content: validOutput, FinishReason: "content_filter"}, wantErr: ErrModelRefused},
		{name: "truncated", resp: meta.ChatResponse{Content: `{"interpretation":"Nece`, FinishReason: "length"}, wantErr: ErrInvalidModelOutput},
		{name: "not json", resp: meta.ChatResponse{Content: "Necesito ayuda.", FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "empty", resp: meta.ChatResponse{Content: "", FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "missing field", resp: meta.ChatResponse{Content: `{"interpretation":"x","confidence":0.5,"needs_clarification":false}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "unknown field", resp: meta.ChatResponse{Content: `{"interpretation":"x","confidence":0.5,"needs_clarification":false,"clarification_note":"","extra":1}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "blank interpretation", resp: meta.ChatResponse{Content: `{"interpretation":"  ","confidence":0.5,"needs_clarification":false,"clarification_note":""}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "confidence out of range", resp: meta.ChatResponse{Content: `{"interpretation":"x","confidence":1.5,"needs_clarification":false,"clarification_note":""}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "too long", resp: meta.ChatResponse{Content: `{"interpretation":"` + strings.Repeat("a", maxInterpretationChars+1) + `","confidence":0.5,"needs_clarification":false,"clarification_note":""}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
		{name: "trailing data", resp: meta.ChatResponse{Content: validOutput + `{}`, FinishReason: "stop"}, wantErr: ErrInvalidModelOutput},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseModelOutput(tt.resp)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("expected %v, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Text == "" || got.GeneratedBy != "ai" {
				t.Errorf("got %+v", got)
			}
		})
	}
}

func TestParseModelOutputClarification(t *testing.T) {
	got, err := parseModelOutput(meta.ChatResponse{
		Content:      `{"interpretation":"Posiblemente: ayuda.","confidence":0.4,"needs_clarification":true,"clarification_note":"La secuencia es incompleta."}`,
		FinishReason: "stop",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !got.NeedsClarification || got.ClarificationNote != "La secuencia es incompleta." {
		t.Errorf("got %+v", got)
	}
}

func TestConnectionTester(t *testing.T) {
	client := okClient("READY")
	got, err := NewMetaConnectionTester(client).TestConnection(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !got.Success || got.Response != "READY" || got.Provider != "meta" || got.Model != "muse-spark-1.3" ||
		got.LatencyMS != 1200 || got.Usage == nil {
		t.Errorf("got %+v", got)
	}
	if client.lastReq.Messages[0].Content != ConnectionTestPrompt {
		t.Errorf("prompt = %q", client.lastReq.Messages[0].Content)
	}
}

func TestConnectionTesterErrors(t *testing.T) {
	if _, err := NewMetaConnectionTester(&fakeClient{}).TestConnection(context.Background()); !errors.Is(err, meta.ErrNotConfigured) {
		t.Errorf("expected ErrNotConfigured, got %v", err)
	}
	empty := okClient("  ")
	if _, err := NewMetaConnectionTester(empty).TestConnection(context.Background()); !errors.Is(err, ErrInvalidModelOutput) {
		t.Errorf("expected ErrInvalidModelOutput, got %v", err)
	}
}
