// Package config loads runtime configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Defaults for the Meta Model API, from https://dev.meta.ai/docs.
const (
	DefaultMetaBaseURL = "https://api.meta.ai/v1"
	DefaultMetaModel   = "muse-spark-1.3"
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

	// MinSignConfidence is the lowest recognizer confidence accepted for
	// interpretation; signs below it are discarded and reported back.
	MinSignConfidence float64

	Meta MetaConfig
}

// MetaConfig holds settings for the Meta Model API client.
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

// IsProduction reports whether the server runs in production mode.
func (c Config) IsProduction() bool {
	return strings.EqualFold(c.Env, "production")
}

// Load reads configuration from the environment, applying defaults.
func Load() (Config, error) {
	cfg := Config{
		Port:               getEnv("PORT", "8080"),
		Env:                getEnv("APP_ENV", "development"),
		LogLevel:           getEnv("LOG_LEVEL", "info"),
		CORSAllowedOrigins: splitCSV(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
		Meta: MetaConfig{
			// MODEL_API_KEY is the name used by Meta's docs; META_API_KEY is
			// accepted for compatibility with earlier .env files.
			APIKey:  getEnv("MODEL_API_KEY", getEnv("META_API_KEY", "")),
			Model:   getEnv("META_MODEL", DefaultMetaModel),
			BaseURL: strings.TrimRight(getEnv("META_API_BASE_URL", DefaultMetaBaseURL), "/"),
		},
	}

	durations := []struct {
		key string
		def time.Duration
		dst *time.Duration
	}{
		{"HTTP_READ_TIMEOUT", 10 * time.Second, &cfg.ReadTimeout},
		{"HTTP_WRITE_TIMEOUT", 75 * time.Second, &cfg.WriteTimeout},
		{"HTTP_IDLE_TIMEOUT", 60 * time.Second, &cfg.IdleTimeout},
		{"HTTP_REQUEST_TIMEOUT", 60 * time.Second, &cfg.RequestTimeout},
		{"HTTP_SHUTDOWN_TIMEOUT", 10 * time.Second, &cfg.ShutdownTimeout},
		{"META_API_TIMEOUT", 45 * time.Second, &cfg.Meta.Timeout},
	}
	for _, d := range durations {
		v, err := getDuration(d.key, d.def)
		if err != nil {
			return Config{}, err
		}
		*d.dst = v
	}

	minConf, err := getFloat("MIN_SIGN_CONFIDENCE", 0.6)
	if err != nil {
		return Config{}, err
	}
	if minConf < 0 || minConf > 1 {
		return Config{}, fmt.Errorf("config: MIN_SIGN_CONFIDENCE must be between 0 and 1")
	}
	cfg.MinSignConfidence = minConf

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

func getFloat(key string, def float64) (float64, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, fmt.Errorf("config: %s: %w", key, err)
	}
	return f, nil
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
