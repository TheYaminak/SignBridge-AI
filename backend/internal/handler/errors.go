package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/signbridge-ai/backend/internal/domain"
	"github.com/signbridge-ai/backend/internal/meta"
	"github.com/signbridge-ai/backend/internal/service"
)

// writeServiceError maps service and provider errors to sanitized responses.
// Provider messages are logged server-side and never returned to clients.
func (h *handlers) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *meta.APIError

	switch {
	case errors.Is(err, domain.ErrInvalidRequest):
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	case errors.Is(err, service.ErrNoConfidentSigns):
		writeError(w, http.StatusUnprocessableEntity, "no_confident_signs", err.Error())
		return
	case errors.Is(err, meta.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, "ai_not_configured",
			"The AI provider is not configured on the server.")
		return
	case errors.Is(err, context.Canceled):
		// Client went away; nothing useful to send.
		return
	}

	// Everything below is a provider-side failure: log details, return a safe message.
	h.logger.ErrorContext(r.Context(), "ai provider request failed",
		"error", err, "request_id", middleware.GetReqID(r.Context()))

	switch {
	case errors.Is(err, context.DeadlineExceeded):
		writeError(w, http.StatusGatewayTimeout, "ai_timeout", "The AI provider did not respond in time.")
	case errors.As(err, &apiErr):
		h.writeProviderError(w, apiErr)
	case errors.Is(err, meta.ErrUnavailable):
		writeError(w, http.StatusBadGateway, "ai_unavailable", "The AI provider could not be reached.")
	case errors.Is(err, service.ErrModelRefused):
		writeError(w, http.StatusBadGateway, "ai_refused", "The AI model declined to produce an interpretation.")
	case errors.Is(err, service.ErrInvalidModelOutput), errors.Is(err, meta.ErrInvalidResponse):
		writeError(w, http.StatusBadGateway, "ai_invalid_output", "The AI model returned an unexpected response.")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}

func (h *handlers) writeProviderError(w http.ResponseWriter, e *meta.APIError) {
	switch {
	case e.StatusCode == http.StatusUnauthorized || e.StatusCode == http.StatusForbidden:
		writeError(w, http.StatusBadGateway, "ai_auth_failed",
			"The AI provider rejected the server's credentials. Check MODEL_API_KEY.")
	case e.StatusCode == http.StatusPaymentRequired:
		writeError(w, http.StatusBadGateway, "ai_billing",
			"The Meta account for MODEL_API_KEY has a billing issue. Set up billing in the Meta developer dashboard.")
	case e.StatusCode == http.StatusNotFound:
		writeError(w, http.StatusBadGateway, "ai_model_not_found",
			"The configured AI model or endpoint was not found. Check META_MODEL and META_API_BASE_URL.")
	case e.StatusCode == http.StatusTooManyRequests:
		if e.RetryAfter > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(int(e.RetryAfter.Seconds())))
		}
		writeError(w, http.StatusServiceUnavailable, "ai_rate_limited", "The AI provider is rate limiting requests. Try again shortly.")
	case e.StatusCode == http.StatusGatewayTimeout:
		writeError(w, http.StatusGatewayTimeout, "ai_timeout", "The AI provider did not respond in time.")
	case e.StatusCode >= 500:
		writeError(w, http.StatusBadGateway, "ai_unavailable", "The AI provider is temporarily unavailable.")
	default:
		writeError(w, http.StatusBadGateway, "ai_request_rejected", "The AI provider rejected the request.")
	}
}
