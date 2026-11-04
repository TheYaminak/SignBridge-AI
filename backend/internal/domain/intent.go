package domain

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
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

// Tri-state for properties that are only known when verified.
const (
	FeatureYes     = "yes"
	FeatureNo      = "no"
	FeatureUnknown = "unknown"
)

// Entry kinds. Today every entry is a complete communication intent; "sign"
// is reserved for future single-sign vocabulary (see README "Extending the
// vocabulary").
const (
	KindPhraseIntent = "phrase_intent"
	KindSign         = "sign"
)

// Intent is one entry of the sign vocabulary registry (vocabulary.json).
type Intent struct {
	ID     string             `json:"id"`
	Kind   string             `json:"kind"`
	TextES string             `json:"text_es"`
	TextEN string             `json:"text_en"`
	Status VerificationStatus `json:"status"`
	// Supported entries may be interpreted; unsupported ones are always rejected.
	Supported bool `json:"supported"`
	// TrainingTarget entries can be recorded on /training.
	TrainingTarget bool `json:"training_target"`
	// TrainingStatus describes the bundled state: not_trained, trained,
	// validated, or not_trainable. Models trained locally are reported by the
	// model itself (its labels), not by this field.
	TrainingStatus string `json:"training_status"`
	// Recognizer names the classifier family expected to predict this entry.
	Recognizer string `json:"recognizer"`
	SignCount  int    `json:"sign_count"`
	// Components are the dictionary glosses a phrase intent is made of.
	Components []string `json:"components"`
	// SequenceVerified is true only when the complete expression (including
	// sign order) is documented. Multi-sign phrases built from individually
	// documented words are experimental intents.
	SequenceVerified bool `json:"sequence_verified"`
	// RequiresMotion / RequiresNonManual (face or body): yes, no, or unknown.
	// "unknown" means not verified; dictionary entries are video-only.
	RequiresMotion    string      `json:"requires_motion"`
	RequiresNonManual string      `json:"requires_non_manual"`
	References        []Reference `json:"references"`
	Note              string      `json:"note"`
}

// UnknownIntent is the rejection class. It is never interpreted and is
// reserved: it cannot appear in the registry.
const UnknownIntent = "UNKNOWN"

// Vocabulary is the declarative registry file.
type Vocabulary struct {
	Version         int      `json:"version"`
	ReferenceSource string   `json:"reference_source"`
	Entries         []Intent `json:"entries"`
}

//go:embed vocabulary.json
var vocabularyJSON []byte

// VocabularyRegistry is the parsed registry; IntentCatalog lists its entries
// in display order.
var (
	VocabularyRegistry = mustLoadVocabulary(vocabularyJSON)
	IntentCatalog      = VocabularyRegistry.Entries
)

func mustLoadVocabulary(raw []byte) Vocabulary {
	v, err := ParseVocabulary(raw)
	if err != nil {
		panic(err)
	}
	return v
}

var labelPattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,31}$`)

// ParseVocabulary decodes and validates a registry.
func ParseVocabulary(raw []byte) (Vocabulary, error) {
	var v Vocabulary
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&v); err != nil {
		return Vocabulary{}, fmt.Errorf("vocabulary: %w", err)
	}
	seen := map[string]bool{}
	for _, e := range v.Entries {
		switch {
		case !labelPattern.MatchString(e.ID):
			return Vocabulary{}, fmt.Errorf("vocabulary: invalid id %q", e.ID)
		case e.ID == UnknownIntent:
			return Vocabulary{}, fmt.Errorf("vocabulary: %s is reserved", UnknownIntent)
		case seen[e.ID]:
			return Vocabulary{}, fmt.Errorf("vocabulary: duplicate id %q", e.ID)
		case e.Kind != KindPhraseIntent && e.Kind != KindSign:
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: invalid kind %q", e.ID, e.Kind)
		case e.TextES == "" || e.TextEN == "":
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: texts are required", e.ID)
		case e.Supported && len(e.References) == 0:
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: supported entries need a dictionary reference", e.ID)
		case e.Supported && e.Status == StatusUnavailable, !e.Supported && e.Status != StatusUnavailable:
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: supported must match status", e.ID)
		case e.TrainingTarget && (!e.Supported || e.Recognizer == ""):
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: training targets must be supported and name a recognizer", e.ID)
		case e.SequenceVerified && e.Status != StatusVerifiedSign:
			return Vocabulary{}, fmt.Errorf("vocabulary: %s: only dictionary-documented expressions can be sequence_verified", e.ID)
		}
		for _, f := range []string{e.RequiresMotion, e.RequiresNonManual} {
			if f != FeatureYes && f != FeatureNo && f != FeatureUnknown {
				return Vocabulary{}, fmt.Errorf("vocabulary: %s: feature flags must be yes, no, or unknown", e.ID)
			}
		}
		seen[e.ID] = true
	}
	return v, nil
}

// LookupIntent returns the registry entry for id.
func LookupIntent(id string) (Intent, bool) {
	for _, in := range IntentCatalog {
		if in.ID == id {
			return in, true
		}
	}
	return Intent{}, false
}

// Recognition types accepted by /intents/interpret. custom_sign_sequence is
// the canonical value (a phrase-level temporal classifier over complete
// recordings); custom_sign is accepted for Phase 4 clients.
const (
	RecognitionCustomSignSequence = "custom_sign_sequence"
	RecognitionCustomSign         = "custom_sign"
)

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
	if r.RecognitionType != RecognitionCustomSignSequence && r.RecognitionType != RecognitionCustomSign {
		return r, fmt.Errorf("%w: recognition_type must be %q", ErrInvalidRequest, RecognitionCustomSignSequence)
	}
	id := strings.ToUpper(strings.TrimSpace(r.Intent))
	if id == UnknownIntent {
		return r, ErrUnknownIntent
	}
	intent, ok := LookupIntent(id)
	if !ok {
		return r, fmt.Errorf("%w: unsupported intent %q", ErrInvalidRequest, r.Intent)
	}
	if !intent.Supported {
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
		Status           VerificationStatus `json:"status"`
		SequenceVerified bool               `json:"sequence_verified"`
		References       []Reference        `json:"references"`
	} `json:"verification"`
	// Experimental is true when the expression's LSRD sign sequence is not
	// verified; the UI must label the output as an experimental intent.
	Experimental   bool   `json:"experimental"`
	PredictionNote string `json:"prediction_note"`
}

// PredictionNote is attached to every intent result.
const PredictionNote = "Prediction from an experimental classifier trained on a small set of recordings. Not a verified sign-language translation."
