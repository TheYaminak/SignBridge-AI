package domain

import (
	"strings"
	"testing"
)

func TestEmbeddedVocabulary(t *testing.T) {
	if VocabularyRegistry.Version < 1 || len(IntentCatalog) != 5 {
		t.Fatalf("registry = %+v", VocabularyRegistry)
	}
	targets := 0
	for _, e := range IntentCatalog {
		if e.TrainingTarget {
			targets++
		}
		// No entry may claim a trained model unless one is bundled.
		if e.TrainingStatus == "trained" || e.TrainingStatus == "validated" {
			t.Errorf("%s claims %s but no validated model is bundled", e.ID, e.TrainingStatus)
		}
	}
	if targets != 4 {
		t.Errorf("training targets = %d, want 4", targets)
	}
	if e, _ := LookupIntent("WHERE_BATHROOM"); e.Supported || e.TrainingTarget {
		t.Error("WHERE_BATHROOM must stay unsupported")
	}
}

func TestParseVocabularyRejectsInvalidEntries(t *testing.T) {
	valid := `{"id":"HELLO","kind":"phrase_intent","text_es":"Hola","text_en":"Hello","status":"verified_sign","supported":true,"training_target":true,"training_status":"not_trained","recognizer":"knn-sequence-v1","sign_count":1,"components":["HOLA"],"requires_motion":"unknown","requires_non_manual":"unknown","references":[{"gloss":"HOLA","url":"https://x.test"}],"note":""}`
	wrap := func(entries ...string) []byte {
		return []byte(`{"version":1,"reference_source":"x","entries":[` + strings.Join(entries, ",") + `]}`)
	}
	if _, err := ParseVocabulary(wrap(valid)); err != nil {
		t.Fatalf("valid registry rejected: %v", err)
	}
	tests := map[string]string{
		"duplicate id":           valid + "," + valid,
		"reserved UNKNOWN":       strings.Replace(valid, `"HELLO"`, `"UNKNOWN"`, 1),
		"lowercase id":           strings.Replace(valid, `"HELLO"`, `"hello"`, 1),
		"supported w/o refs":     strings.Replace(valid, `[{"gloss":"HOLA","url":"https://x.test"}]`, `[]`, 1),
		"target w/o recognizer":  strings.Replace(valid, `"knn-sequence-v1"`, `""`, 1),
		"bad feature flag":       strings.Replace(valid, `"requires_motion":"unknown"`, `"requires_motion":"maybe"`, 1),
		"bad kind":               strings.Replace(valid, `"phrase_intent"`, `"word"`, 1),
		"unknown field":          strings.Replace(valid, `"note":""`, `"note":"","extra":1`, 1),
		"supported but unavail.": strings.Replace(valid, `"verified_sign"`, `"unavailable"`, 1),
	}
	for name, entry := range tests {
		t.Run(name, func(t *testing.T) {
			raw := wrap(entry)
			if name == "duplicate id" {
				raw = wrap(valid, valid)
			}
			if _, err := ParseVocabulary(raw); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
