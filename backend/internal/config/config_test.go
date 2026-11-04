package config

import (
	"testing"
	"time"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"PORT", "APP_ENV", "CORS_ALLOWED_ORIGINS", "HTTP_READ_TIMEOUT", "MIN_SIGN_CONFIDENCE",
		"MODEL_API_KEY", "META_API_KEY", "META_MODEL", "META_API_BASE_URL",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if len(cfg.CORSAllowedOrigins) != 1 || cfg.CORSAllowedOrigins[0] != "http://localhost:3000" {
		t.Errorf("CORSAllowedOrigins = %v", cfg.CORSAllowedOrigins)
	}
	if cfg.ReadTimeout != 10*time.Second {
		t.Errorf("ReadTimeout = %v", cfg.ReadTimeout)
	}
	if cfg.MinSignConfidence != 0.6 {
		t.Errorf("MinSignConfidence = %v", cfg.MinSignConfidence)
	}
	if cfg.Meta.Model != DefaultMetaModel || cfg.Meta.BaseURL != DefaultMetaBaseURL {
		t.Errorf("Meta defaults = %q %q", cfg.Meta.Model, cfg.Meta.BaseURL)
	}
	if cfg.Meta.Configured() {
		t.Error("Meta should not be configured without an API key")
	}
	if cfg.IsProduction() {
		t.Error("default env should not be production")
	}
}

func TestLoadOverrides(t *testing.T) {
	clearEnv(t)
	t.Setenv("PORT", "9090")
	t.Setenv("APP_ENV", "Production")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test ,")
	t.Setenv("HTTP_READ_TIMEOUT", "3s")
	t.Setenv("MIN_SIGN_CONFIDENCE", "0.8")
	t.Setenv("MODEL_API_KEY", "k")
	t.Setenv("META_MODEL", "m")
	t.Setenv("META_API_BASE_URL", "https://example.test/")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("Port = %q", cfg.Port)
	}
	if !cfg.IsProduction() {
		t.Error("expected production")
	}
	if got := cfg.CORSAllowedOrigins; len(got) != 2 || got[1] != "http://b.test" {
		t.Errorf("CORSAllowedOrigins = %v", got)
	}
	if cfg.ReadTimeout != 3*time.Second {
		t.Errorf("ReadTimeout = %v", cfg.ReadTimeout)
	}
	if cfg.MinSignConfidence != 0.8 {
		t.Errorf("MinSignConfidence = %v", cfg.MinSignConfidence)
	}
	if cfg.Meta.BaseURL != "https://example.test" {
		t.Errorf("BaseURL = %q", cfg.Meta.BaseURL)
	}
	if !cfg.Meta.Configured() {
		t.Error("Meta should be configured")
	}
}

func TestLoadLegacyAPIKeyName(t *testing.T) {
	clearEnv(t)
	t.Setenv("META_API_KEY", "legacy")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Meta.APIKey != "legacy" {
		t.Errorf("APIKey not loaded from META_API_KEY")
	}

	t.Setenv("MODEL_API_KEY", "preferred")
	cfg, _ = Load()
	if cfg.Meta.APIKey != "preferred" {
		t.Errorf("MODEL_API_KEY should take precedence")
	}
}

func TestLoadInvalidValues(t *testing.T) {
	for name, kv := range map[string][2]string{
		"duration":         {"HTTP_READ_TIMEOUT", "soon"},
		"confidence nan":   {"MIN_SIGN_CONFIDENCE", "high"},
		"confidence range": {"MIN_SIGN_CONFIDENCE", "1.5"},
	} {
		t.Run(name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv(kv[0], kv[1])
			if _, err := Load(); err == nil {
				t.Fatalf("expected error for %s=%s", kv[0], kv[1])
			}
		})
	}
}
