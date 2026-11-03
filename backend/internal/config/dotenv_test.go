package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "# comment\nSB_TEST_A=one\nexport SB_TEST_B=\"two words\"\nSB_TEST_C=from-file\n\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SB_TEST_C", "from-env")
	// Ensure A and B are unset (t.Setenv registers cleanup).
	t.Setenv("SB_TEST_A", "")
	t.Setenv("SB_TEST_B", "")
	os.Unsetenv("SB_TEST_A")
	os.Unsetenv("SB_TEST_B")

	if err := LoadDotEnv(path); err != nil {
		t.Fatalf("LoadDotEnv: %v", err)
	}
	if got := os.Getenv("SB_TEST_A"); got != "one" {
		t.Errorf("A = %q", got)
	}
	if got := os.Getenv("SB_TEST_B"); got != "two words" {
		t.Errorf("B = %q", got)
	}
	if got := os.Getenv("SB_TEST_C"); got != "from-env" {
		t.Errorf("C = %q, existing env should win", got)
	}
}

func TestLoadDotEnvMissingFile(t *testing.T) {
	if err := LoadDotEnv(filepath.Join(t.TempDir(), "nope")); err != nil {
		t.Fatalf("missing file should be ignored, got %v", err)
	}
}

func TestLoadDotEnvMalformed(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("NOT_A_PAIR\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := LoadDotEnv(path); err == nil {
		t.Fatal("expected error for malformed line")
	}
}
