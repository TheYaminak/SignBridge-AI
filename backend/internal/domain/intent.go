package domain

import (
	"errors"
	"fmt"
	"strings"
)

// VerificationStatus records how an intent relates to the Dominican Sign
// Language (LSRD) dictionary. See README "Verified LSRD references".
type VerificationStatus string

const (
	// StatusVerifiedSign: the expression is a single documented dictionary sign.
	StatusVerifiedSign VerificationStatus = "verified_sign"
	// StatusWordReferences: each word is documented, but the full phrase is
	// not a dictionary entry; it is our proposed sign sequence.
	StatusWordReferences VerificationStatus = "word_references"
	// StatusUnavailable: required signs were not found; not trainable.
	StatusUnavailable VerificationStatus = "unavailable"
)

// Reference is a dictionary entry used as a linguistic reference.
type Reference struct {
	Gloss string `json:"gloss"`
	URL   string `json:"url"`
}

// Intent is a communication intent the custom classifier can predict.
type Intent struct {
	ID         string             `json:"id"`
	TextES     string             `json:"text_es"`
	TextEN     string             `json:"text_en"`
	Status     VerificationStatus `json:"status"`
	SignCount  int                `json:"sign_count"`
	References []Reference        `json:"references"`
	Note       string             `json:"note"`
}

// UnknownIntent is the rejection class. It is never interpreted.
const UnknownIntent = "UNKNOWN"

// lsrd is the LSRD dictionary base. The official entry point
// https://diccionariolsrd.conadis.gob.do/ redirects (301) here.
const lsrd = "https://diccionariolsrd.cc/diccionario/"

// IntentCatalog lists the supported intents, in display order. Entries were
// checked against the dictionary index on 2026-11-03; sign descriptions are
// video-only on the site, so no movements are encoded here.
var IntentCatalog = []Intent{
	{
		ID: "HELLO", TextES: "Hola", TextEN: "Hello",
		Status: StatusVerifiedSign, SignCount: 1,
		References: []Reference{{Gloss: "HOLA", URL: lsrd + "hola/"}},
		Note:       "Single sign documented in the LSRD dictionary.",
	},
	{
		ID: "NEED_HELP", TextES: "Necesito ayuda", TextEN: "I need help",
		Status: StatusWordReferences, SignCount: 2,
		References: []Reference{
			{Gloss: "NECESITAR", URL: lsrd + "necesitar/"},
			{Gloss: "AYUDA", URL: lsrd + "ayuda/"},
			{Gloss: "AYUDAR", URL: lsrd + "ayudar/"},
		},
		Note: "Words are documented individually; the phrase is not a dictionary entry. Proposed sequence: NECESITAR + AYUDA.",
	},
	{
		ID: "WHERE_BATHROOM", TextES: "¿Dónde está el baño?", TextEN: "Where is the bathroom?",
		Status: StatusUnavailable, SignCount: 0,
		References: []Reference{},
		Note:       "No \"Baño\" or \"Dónde\" entry was found in the LSRD dictionary index, so this expression is not trainable.",
	},
	{
		ID: "THANK_YOU", TextES: "Gracias", TextEN: "Thank you",
		Status: StatusVerifiedSign, SignCount: 1,
		References: []Reference{{Gloss: "GRACIAS", URL: lsrd + "gracias/"}},
		Note:       "Single sign documented in the LSRD dictionary.",
	},
	{
		ID: "NEED_DOCTOR", TextES: "Necesito un médico", TextEN: "I need a doctor",
		Status: StatusWordReferences, SignCount: 2,
		References: []Reference{
			{Gloss: "NECESITAR", URL: lsrd + "necesitar/"},
			{Gloss: "DOCTOR", URL: lsrd + "doctor/"},
			{Gloss: "MÉDICO", URL: lsrd + "medicoca/"},
		},
		Note: "Words are documented individually; the phrase is not a dictionary entry. Proposed sequence: NECESITAR + DOCTOR (or MÉDICO).",
	},
}

// LookupIntent returns the catalog entry for id.
func LookupIntent(id string) (Intent, bool) {
	for _, in := range IntentCatalog {
		if in.ID == id {
			return in, true
		}
	}
	return Intent{}, false
}

// RecognitionCustomSign identifies requests from the custom sign classifier.
const RecognitionCustomSign = "custom_sign"

// IntentRequest is the body of POST /api/v1/intents/interpret.
// See contracts/README.md for the shared contract.
type IntentRequest struct {
	RecognitionType string     `json:"recognition_type"`
	Intent          string     `json:"intent"`
	Confidence      float64    `json:"confidence"`
	Language        string     `json:"language"`
	RawLabels       []string   `json:"raw_labels"`
	Source          SignSource `json:"source,omitempty"`
	// ModelID identifies the classifier that produced the prediction.
	ModelID string `json:"model_id,omitempty"`
}

var (
	// ErrUnknownIntent: UNKNOWN predictions are never turned into text.
	ErrUnknownIntent = errors.New("UNKNOWN predictions are not interpreted")
	// ErrIntentUnavailable: the intent is not backed by dictionary references.
	ErrIntentUnavailable = errors.New("intent is unavailable")
)

const maxRawLabels = 8

// Normalize validates the request and returns a normalized copy.
func (r IntentRequest) Normalize() (IntentRequest, error) {
	if r.RecognitionType != RecognitionCustomSign {
		return r, fmt.Errorf("%w: recognition_type must be %q", ErrInvalidRequest, RecognitionCustomSign)
	}
	id := strings.ToUpper(strings.TrimSpace(r.Intent))
	if id == UnknownIntent {
		return r, ErrUnknownIntent
	}
	intent, ok := LookupIntent(id)
	if !ok {
		return r, fmt.Errorf("%w: unsupported intent %q", ErrInvalidRequest, r.Intent)
	}
	if intent.Status == StatusUnavailable {
		return r, fmt.Errorf("%w: %s (%s)", ErrIntentUnavailable, id, intent.Note)
	}
	if r.Confidence < 0 || r.Confidence > 1 {
		return r, fmt.Errorf("%w: confidence must be between 0 and 1", ErrInvalidRequest)
	}
	lang := strings.ToLower(strings.TrimSpace(r.Language))
	if _, ok := SupportedLanguages[lang]; !ok {
		return r, fmt.Errorf("%w: language must be \"es\" or \"en\"", ErrInvalidRequest)
	}
	switch r.Source {
	case "", SourceCamera, SourceManual:
	default:
		return r, fmt.Errorf("%w: source must be \"camera\" or \"manual\"", ErrInvalidRequest)
	}
	if len(r.RawLabels) == 0 || len(r.RawLabels) > maxRawLabels {
		return r, fmt.Errorf("%w: raw_labels must contain 1-%d labels", ErrInvalidRequest, maxRawLabels)
	}
	labels := make([]string, len(r.RawLabels))
	hasIntent := false
	for i, l := range r.RawLabels {
		n, err := NormalizeLabel(l)
		if err != nil {
			return r, fmt.Errorf("%w: raw_labels[%d]: %v", ErrInvalidRequest, i, err)
		}
		labels[i] = n
		hasIntent = hasIntent || n == id
	}
	if !hasIntent {
		return r, fmt.Errorf("%w: raw_labels must include the predicted intent", ErrInvalidRequest)
	}
	if len(r.ModelID) > 64 {
		return r, fmt.Errorf("%w: model_id is too long", ErrInvalidRequest)
	}
	return IntentRequest{
		RecognitionType: r.RecognitionType,
		Intent:          id,
		Confidence:      r.Confidence,
		Language:        lang,
		RawLabels:       labels,
		Source:          r.Source,
		ModelID:         r.ModelID,
	}, nil
}

// IntentResult is the response of POST /api/v1/intents/interpret.
type IntentResult struct {
	Intent     string   `json:"intent"`
	RawLabels  []string `json:"raw_labels"`
	Confidence float64  `json:"confidence"`
	Language   string   `json:"language"`
	TextES     string   `json:"text_es"`
	TextEN     string   `json:"text_en"`
	Uncertain  bool     `json:"uncertain"`
	// Source is "meta" (generated by Muse Spark) or "local_fallback"
	// (canonical catalog phrase used because Meta was unavailable).
	Source         string      `json:"source"`
	FallbackReason string      `json:"fallback_reason,omitempty"`
	Model          string      `json:"model"`
	Provider       string      `json:"provider,omitempty"`
	LatencyMS      int64       `json:"latency_ms"`
	Usage          *TokenUsage `json:"usage,omitempty"`
	// Verification restates the intent's dictionary status. A prediction is
	// never a verified linguistic translation.
	Verification struct {
		Status     VerificationStatus `json:"status"`
		References []Reference        `json:"references"`
	} `json:"verification"`
	PredictionNote string `json:"prediction_note"`
}

// PredictionNote is attached to every intent result.
const PredictionNote = "Prediction from an experimental classifier trained on a small set of recordings. Not a verified sign-language translation."
