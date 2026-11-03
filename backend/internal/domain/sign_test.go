package domain

import (
	"errors"
	"testing"
)

func validRequest() InterpretationRequest {
	return InterpretationRequest{
		Signs:    SignSequence{{Label: "HELP", Confidence: 0.94, Timestamp: 1730000000000}},
		Language: "es",
	}
}

func TestInterpretationRequestValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*InterpretationRequest)
		wantErr bool
	}{
		{name: "valid", mutate: func(*InterpretationRequest) {}},
		{name: "empty signs", mutate: func(r *InterpretationRequest) { r.Signs = nil }, wantErr: true},
		{name: "missing language", mutate: func(r *InterpretationRequest) { r.Language = " " }, wantErr: true},
		{name: "blank label", mutate: func(r *InterpretationRequest) { r.Signs[0].Label = "" }, wantErr: true},
		{name: "confidence above 1", mutate: func(r *InterpretationRequest) { r.Signs[0].Confidence = 1.2 }, wantErr: true},
		{name: "negative confidence", mutate: func(r *InterpretationRequest) { r.Signs[0].Confidence = -0.1 }, wantErr: true},
		{name: "zero timestamp", mutate: func(r *InterpretationRequest) { r.Signs[0].Timestamp = 0 }, wantErr: true},
		{name: "too many signs", mutate: func(r *InterpretationRequest) {
			r.Signs = make(SignSequence, MaxSequenceLength+1)
			for i := range r.Signs {
				r.Signs[i] = RecognizedSign{Label: "HELP", Confidence: 0.5, Timestamp: 1}
			}
		}, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := validRequest()
			tt.mutate(&req)
			err := req.Validate()
			if tt.wantErr {
				if !errors.Is(err, ErrInvalidRequest) {
					t.Fatalf("expected ErrInvalidRequest, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
