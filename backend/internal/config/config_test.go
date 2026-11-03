package config

import (
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	for _, k := range []string{"PORT", "CORS_ALLOWED_ORIGINS", "HTTP_READ_TIMEOUT", "META_API_KEY", "META_MODEL", "META_API_BASE_URL"} {
		t.Setenv(k, "")
	}

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
	if cfg.Meta.Configured() {
		t.Error("Meta should not be configured by default")
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test ,")
	t.Setenv("HTTP_READ_TIMEOUT", "3s")
	t.Setenv("META_API_KEY", "k")
	t.Setenv("META_MODEL", "m")
	t.Setenv("META_API_BASE_URL", "https://example.test/")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("Port = %q", cfg.Port)
	}
	if got := cfg.CORSAllowedOrigins; len(got) != 2 || got[1] != "http://b.test" {
		t.Errorf("CORSAllowedOrigins = %v", got)
	}
	if cfg.ReadTimeout != 3*time.Second {
		t.Errorf("ReadTimeout = %v", cfg.ReadTimeout)
	}
	if cfg.Meta.BaseURL != "https://example.test" {
		t.Errorf("BaseURL = %q", cfg.Meta.BaseURL)
	}
	if !cfg.Meta.Configured() {
		t.Error("Meta should be configured")
	}
}

func TestLoadInvalidDuration(t *testing.T) {
	t.Setenv("HTTP_READ_TIMEOUT", "soon")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for invalid duration")
	}
}
