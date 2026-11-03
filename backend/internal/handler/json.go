package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// maxBodyBytes caps request bodies; sign sequences are small.
const maxBodyBytes = 64 << 10

// ErrorBody is the JSON shape of every error response.
type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail describes an error in a machine- and human-readable way.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorBody{Error: ErrorDetail{Code: code, Message: message}})
}

// decodeJSON decodes a single JSON object from the request body, rejecting
// unknown fields, oversized bodies, and trailing data.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxErr):
			return fmt.Errorf("request body must not exceed %d bytes", maxBodyBytes)
		case errors.Is(err, io.EOF):
			return errors.New("request body must not be empty")
		default:
			return fmt.Errorf("malformed JSON: %w", err)
		}
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}
