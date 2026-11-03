// Package config loads runtime configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Config holds all runtime settings for the API server.
type Config struct {
	Port               string
	Env                string
	LogLevel           string
	CORSAllowedOrigins []string

	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration

	Meta MetaConfig
}

// MetaConfig holds settings for the Meta Model API client.
// Values are intentionally left empty by default: endpoints and model
// identifiers must be taken from official Meta documentation.
type MetaConfig struct {
	APIKey  string
	Model   string
	BaseURL string
	Timeout time.Duration
}

// Configured reports whether all fields needed to call the API are present.
func (m MetaConfig) Configured() bool {
	return m.APIKey != "" && m.Model != "" && m.BaseURL != ""
}

// Load reads configuration from the environment, applying defaults.
func Load() (Config, error) {
	cfg := Config{
		Port:               getEnv("PORT", "8080"),
		Env:                getEnv("APP_ENV", "development"),
		LogLevel:           getEnv("LOG_LEVEL", "info"),
		CORSAllowedOrigins: splitCSV(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
		Meta: MetaConfig{
			APIKey:  os.Getenv("META_API_KEY"),
			Model:   os.Getenv("META_MODEL"),
			BaseURL: strings.TrimRight(os.Getenv("META_API_BASE_URL"), "/"),
		},
	}

	durations := []struct {
		key string
		def time.Duration
		dst *time.Duration
	}{
		{"HTTP_READ_TIMEOUT", 10 * time.Second, &cfg.ReadTimeout},
		{"HTTP_WRITE_TIMEOUT", 30 * time.Second, &cfg.WriteTimeout},
		{"HTTP_IDLE_TIMEOUT", 60 * time.Second, &cfg.IdleTimeout},
		{"HTTP_REQUEST_TIMEOUT", 25 * time.Second, &cfg.RequestTimeout},
		{"HTTP_SHUTDOWN_TIMEOUT", 10 * time.Second, &cfg.ShutdownTimeout},
		{"META_API_TIMEOUT", 20 * time.Second, &cfg.Meta.Timeout},
	}
	for _, d := range durations {
		v, err := getDuration(d.key, d.def)
		if err != nil {
			return Config{}, err
		}
		*d.dst = v
	}

	return cfg, nil
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func getDuration(key string, def time.Duration) (time.Duration, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return def, nil
	}
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("config: %s: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("config: %s must be positive", key)
	}
	return d, nil
}

func splitCSV(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
