package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// contractDir holds request fixtures shared with the frontend tests
// (frontend/src/lib/api-requests.test.ts). Both sides must accept them.
var contractDir = filepath.Join("..", "..", "..", "contracts", "fixtures")

var fixtureEndpoints = map[string]string{
	"interpret-gesture.request.json": "/api/v1/interpret",
	"interpret-manual.request.json":  "/api/v1/interpret",
	"intent-interpret.request.json":  "/api/v1/intents/interpret",
}

// newContractMeta answers each kind of request with output that matches the
// schema the backend asked for.
func newContractMeta(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		content := validModelJSON
		if strings.Contains(string(body), `"intent_message"`) {
			content = `{"text_es":"Necesito ayuda.","text_en":"I need help.","uncertain":false}`
		}
		_, _ = io.WriteString(w, completion(content))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSharedContractFixtures(t *testing.T) {
	entries, err := os.ReadDir(contractDir)
	if err != nil {
		t.Fatalf("read contracts: %v", err)
	}
	seen := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".request.json") {
			continue
		}
		seen++
		endpoint, ok := fixtureEndpoints[e.Name()]
		if !ok {
			t.Errorf("fixture %s has no endpoint mapping", e.Name())
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(contractDir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			fake := newContractMeta(t)
			rec := do(newRouter(routerConfig{apiKey: testAPIKey, baseURL: fake.URL}), http.MethodPost, endpoint, string(raw))
			if rec.Code != http.StatusOK {
				t.Fatalf("%s rejected the shared fixture: %d %s", endpoint, rec.Code, rec.Body)
			}
		})
	}
	if seen != len(fixtureEndpoints) {
		t.Fatalf("expected %d fixtures, found %d", len(fixtureEndpoints), seen)
	}
}

// Regression: an outdated backend rejected the frontend's recognition_type
// field with "unknown field". Unknown fields must still be rejected.
func TestInterpretAcceptsRecognitionTypeButRejectsUnknownFields(t *testing.T) {
	fake := newContractMeta(t)
	h := newRouter(routerConfig{apiKey: testAPIKey, baseURL: fake.URL})

	ok := `{"signs":[{"label":"Thumb_Up","confidence":0.9,"timestamp":1}],"language":"en","recognition_type":"gesture"}`
	if rec := do(h, http.MethodPost, "/api/v1/interpret", ok); rec.Code != http.StatusOK {
		t.Fatalf("recognition_type rejected: %d %s", rec.Code, rec.Body)
	}
	bad := `{"signs":[{"label":"Thumb_Up","confidence":0.9,"timestamp":1}],"language":"en","recognition_kind":"gesture"}`
	rec := do(h, http.MethodPost, "/api/v1/interpret", bad)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unknown field") {
		t.Fatalf("unknown field accepted: %d %s", rec.Code, rec.Body)
	}
}

func TestHealthReportsAPIVersion(t *testing.T) {
	rec := do(newRouter(routerConfig{}), http.MethodGet, "/health", "")
	var body HealthResponse
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body.APIVersion != APIVersion || APIVersion < 3 {
		t.Fatalf("api_version = %d", body.APIVersion)
	}
}

func TestIntentsCatalog(t *testing.T) {
	rec := do(newRouter(routerConfig{}), http.MethodGet, "/api/v1/intents", "")
	var body IntentsResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Intents) != 5 || body.Unknown != "UNKNOWN" {
		t.Fatalf("catalog = %+v", body)
	}
	for _, in := range body.Intents {
		if in.Status != "unavailable" && len(in.References) == 0 {
			t.Errorf("%s has no dictionary reference", in.ID)
		}
	}
}

func TestIntentInterpretEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		apiKey   string
		body     string
		wantCode int
		check    string
	}{
		{"meta", testAPIKey, `{"recognition_type":"custom_sign","intent":"NEED_HELP","confidence":0.93,"language":"es","raw_labels":["NEED_HELP"]}`, 200, `"source":"meta"`},
		{"fallback without key", "", `{"recognition_type":"custom_sign","intent":"THANK_YOU","confidence":0.93,"language":"en","raw_labels":["THANK_YOU"]}`, 200, `"source":"local_fallback"`},
		{"unknown", testAPIKey, `{"recognition_type":"custom_sign","intent":"UNKNOWN","confidence":0.99,"language":"es","raw_labels":["UNKNOWN"]}`, 422, "unknown_intent"},
		{"unavailable", testAPIKey, `{"recognition_type":"custom_sign","intent":"WHERE_BATHROOM","confidence":0.99,"language":"es","raw_labels":["WHERE_BATHROOM"]}`, 422, "intent_unavailable"},
		{"unknown field", testAPIKey, `{"recognition_type":"custom_sign","intent":"HELLO","confidence":0.9,"language":"es","raw_labels":["HELLO"],"video":"x"}`, 400, "unknown field"},
		{"bad type", testAPIKey, `{"recognition_type":"gesture","intent":"HELLO","confidence":0.9,"language":"es","raw_labels":["HELLO"]}`, 400, "invalid_request"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := newContractMeta(t)
			rec := do(newRouter(routerConfig{apiKey: tt.apiKey, baseURL: fake.URL}), http.MethodPost, "/api/v1/intents/interpret", tt.body)
			if rec.Code != tt.wantCode || !strings.Contains(rec.Body.String(), tt.check) {
				t.Fatalf("got %d %s", rec.Code, rec.Body)
			}
		})
	}
}
