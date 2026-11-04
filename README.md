# SignBridge AI

**Every Gesture Deserves a Voice.**
Breaking communication barriers through computer vision and artificial intelligence.

SignBridge AI recognizes a **limited vocabulary** of signs through a webcam and turns the recognized sequence into natural text and speech. It is a prototype for the Meta Global AI Developer Hackathon 2026. It does **not** translate unrestricted sign language and is not a replacement for a qualified interpreter.

## How Meta Muse Spark powers SignBridge AI

A sign recognizer outputs glosses: isolated labels such as `HELP` and `DOCTOR`, each with a confidence score. A string of labels isn't a sentence a hearing person can read naturally. **Muse Spark** (`muse-spark-1.3`, via the Meta Model API) bridges that gap.

- It turns an ordered sequence of recognized labels into a short, natural sentence in Spanish or English. For example, `HELP DOCTOR` becomes "Necesito ayuda, por favor llamen a un médico."
- It follows strict rules: preserve every label's meaning, never invent signs or facts, and flag ambiguous or low-confidence input with `needs_clarification` instead of guessing.
- It answers in a strict JSON schema (structured output). The Go backend validates every reply before the user sees it.
- The UI always shows the **raw recognized labels** and the **AI-generated interpretation** as separate things, so users can see exactly what the model added.

## Status: Phase 2

| Area | State |
| --- | --- |
| Next.js UI: camera preview, device selection, translation panel, speech, backend status | ✅ Done |
| Go API: health, Meta status, Meta connection test, sign interpretation | ✅ Done |
| Meta Model API client (Chat Completions, Muse Spark, structured output) | ✅ Done |
| Developer tools: Meta AI Connection panel and Manual AI Integration Test | ✅ Done |
| Live Muse Spark request verified | ⚠️ Blocked by Meta account billing (see [Verification status](#verification-status)) |
| On-device sign recognition (MediaPipe) | ⏳ Phase 3 |

The app never fabricates recognition results or translations. Until the recognizer exists, the camera workspace shows no signs. The only way to send signs to the model is the clearly labeled **Manual AI Integration Test**.

## Architecture

```
Browser (Next.js, frontend only)                 Go API (all business logic)                Meta Model API
┌──────────────────────────────────┐             ┌──────────────────────────────────┐        ┌──────────────────┐
│ Webcam ─► recognizer (Phase 3)   │  labels +   │ handler: validate JSON           │        │ POST /v1/chat/   │
│   └► RecognizedSign[] ───────────┼─confidence─►│ service: normalize labels,       │ HTTPS  │   completions    │
│ Manual AI Integration Test ──────┼────────────►│   apply threshold, build prompt ─┼───────►│ muse-spark-1.3   │
│                                  │             │ meta client: Bearer MODEL_API_KEY│        │ (json_schema     │
│ Translation panel ◄──────────────┼─────────────┤ service: validate model JSON  ◄─┼────────┤  structured out) │
│ SpeechSynthesis (local)          │  structured │ handler: sanitized errors        │        └──────────────────┘
└──────────────────────────────────┘   result    └──────────────────────────────────┘
```

- **Video stays in the browser.** The backend only receives sign labels, confidences, and timestamps. Nothing is recorded or uploaded.
- **Next.js is frontend only.** There are no API routes or server actions. The browser calls the Go API.
- **Secrets stay in Go.** `MODEL_API_KEY` is read only by the backend and never logged, returned, or sent to the browser.

```
signbridge-ai/
├── backend/                     Go API
│   ├── cmd/api/main.go          entry point: config, wiring, graceful shutdown, healthcheck
│   └── internal/
│       ├── config/              env and .env loading
│       ├── domain/              sign types, validation, label normalization, thresholds
│       ├── handler/             chi routes, CORS, logging, error mapping
│       ├── meta/                Meta Model API Chat Completions client (net/http)
│       └── service/             interpreter, prompt, output contract, connection tester
├── frontend/                    Next.js App Router + Tailwind + shadcn/ui
│   └── src/
│       ├── app/                 layout and page
│       ├── components/          header, workspace panels, dev/ (developer tools), ui/
│       ├── hooks/               useCamera, useBackendHealth, useSpeechSynthesis
│       ├── lib/                 typed API client, config, languages, formatting
│       └── types/               shared types (mirror backend/internal/domain)
├── docker-compose.yml
├── .env.example                 single env file template for everything
├── package.json                 root scripts to run both services
└── Makefile                     optional shortcuts
```

## Prerequisites

- **Go** 1.25+
- **Node.js** 20.9+ (22 LTS recommended) and npm
- A **Meta Model API key** with billing set up ([dev.meta.ai](https://dev.meta.ai/docs))

No database or other services are required. Docker is optional.

## Quick start

```bash
# 1. Install dependencies (root, frontend, Go modules)
npm run setup

# 2. Create the env file and set MODEL_API_KEY
cp .env.example .env

# 3. Start the API (http://localhost:8080) and the UI (http://localhost:3000) together
npm run dev
```

Open http://localhost:3000. The header badge should show **Backend online**. Scroll to **Developer tools** to test the Meta connection.

### Run services separately

```bash
# Backend
cd backend
go run ./cmd/api

# Frontend (in another terminal)
cd frontend
npm run dev
```

With `make`: `make setup`, `make dev`, `make backend`, `make frontend`.

### With Docker

```bash
cp .env.example .env          # then set MODEL_API_KEY
docker compose up --build     # UI: http://localhost:3000  API: http://localhost:8080
```

- The backend runs as a static Go binary in a distroless image. The frontend runs as a Next.js standalone server on Node 22. The frontend waits for the backend health check before starting.
- Only the backend container receives the Meta variables.
- After changing the Meta values in `.env`, restart with `docker compose up -d backend`. No rebuild is needed.
- `NEXT_PUBLIC_*` values are baked into the frontend image. Rebuild with `docker compose up --build` after changing them.

## Configuration

All configuration lives in **one root `.env`** (copy it from `.env.example`). Docker Compose reads it. `go run` reads `backend/.env` first (optional, for overrides) and then the root `.env`. Real environment variables always win.

### Meta Model API

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_API_KEY` | empty | Meta Model API key (`LLM_<id>_<secret>`). Server-side only. `META_API_KEY` is accepted as a fallback name. |
| `META_MODEL` | `muse-spark-1.3` | Model ID |
| `META_API_BASE_URL` | `https://api.meta.ai/v1` | API base URL |
| `META_API_TIMEOUT` | `45s` | Outbound HTTP timeout. Muse Spark always reasons, so allow headroom. |

### Backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `APP_ENV` | `development` | `production` disables `POST /api/v1/meta/test` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins |
| `MIN_SIGN_CONFIDENCE` | `0.6` | Signs below this confidence are discarded before interpretation |
| `HTTP_READ_TIMEOUT` / `HTTP_WRITE_TIMEOUT` / `HTTP_IDLE_TIMEOUT` | `10s` / `75s` / `60s` | Server timeouts |
| `HTTP_REQUEST_TIMEOUT` | `60s` | Per-request handler timeout |
| `HTTP_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown drain time |

### Frontend

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8080` | Go API URL as seen by the **browser** |
| `NEXT_PUBLIC_ENABLE_DEV_TOOLS` | `false` (`true` in compose) | Show developer tools in production builds. Always on in `npm run dev`. |

Never put secrets in `NEXT_PUBLIC_*` variables. They ship to the browser.

## Meta Model API integration

The Go client in [`backend/internal/meta`](backend/internal/meta/client.go) follows Meta's Chat Completions docs (`https://dev.meta.ai/docs/protocols/chat-completions`):

- `POST {META_API_BASE_URL}/chat/completions` with `Authorization: Bearer $MODEL_API_KEY`. Uses the standard library `net/http` with a timeout and request-context cancellation.
- Instructions use the `developer` role, which Meta recommends over `system`.
- `max_completion_tokens` sets the output budget. Muse Spark always reasons, and reasoning tokens count against this budget. `reasoning_effort: "low"` keeps latency down.
- Interpretation uses `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`.
- Token usage (`prompt_tokens`, `completion_tokens`, `total_tokens`, and `reasoning_tokens` when present) is parsed and returned.
- Provider errors are parsed from Meta's `{"error":{"message","type","param","code"}}` envelope, including `Retry-After`. They're logged without the key and mapped to sanitized client errors.
- The HTTP transport is injectable (`HTTPDoer`). Tests run against `httptest` servers.

### How interpretation works

1. **Validate:** 1 to 64 signs, confidence in [0, 1], positive timestamps, language `es` or `en`, optional `source` of `camera` or `manual`.
2. **Normalize labels:** trim, upper-case, and join words with `_` (`" thank you "` becomes `THANK_YOU`). Labels may contain only letters and digits, max 32 characters. This also keeps free text and prompt injection out of the model input.
3. **Apply the threshold:** signs below `MIN_SIGN_CONFIDENCE` are discarded and returned in `discarded_signs` with a reason. If none remain, the API returns 422 and doesn't call Meta.
4. **Prompt Muse Spark:** a `developer` message with the rules, plus the accepted labels as JSON data.
5. **Validate the reply:** strict JSON (no unknown or missing fields), non-empty text of at most 600 characters, confidence in [0, 1]. Refusals, content filtering, and truncated output are rejected.
6. **Respond:** the raw labels (`recognized_signs`) and the AI output (`interpretation`, `generated_by: "ai"`) are kept separate.

## API

### `GET /health`

```json
{ "status": "ok", "service": "signbridge-api" }
```

### `GET /api/v1/meta/status`

Configuration only. It **never** calls Meta and uses no tokens. `configured: true` means settings are present, not that the key works.

```bash
curl http://localhost:8080/api/v1/meta/status
```

```json
{ "configured": true, "model": "muse-spark-1.3" }
```

### `POST /api/v1/meta/test` (development only)

Sends a **real** request to Muse Spark with the prompt `Reply with the single word READY.` This route doesn't exist when `APP_ENV=production` (returns 404).

```bash
curl -X POST http://localhost:8080/api/v1/meta/test
```

Response shape (values illustrative):

```json
{
  "success": true,
  "provider": "meta",
  "model": "muse-spark-1.3",
  "response": "READY",
  "latency_ms": 1180,
  "usage": { "prompt_tokens": 14, "completion_tokens": 40, "total_tokens": 54, "reasoning_tokens": 38 }
}
```

### `POST /api/v1/interpret`

```bash
curl -X POST http://localhost:8080/api/v1/interpret \
  -H "Content-Type: application/json" \
  -d '{
    "signs": [
      { "label": "HELP",   "confidence": 0.94, "timestamp": 1730000000000 },
      { "label": "DOCTOR", "confidence": 0.91, "timestamp": 1730000000500 },
      { "label": "WATER",  "confidence": 0.32, "timestamp": 1730000001000 }
    ],
    "language": "es",
    "source": "manual"
  }'
```

Response shape (values illustrative):

```json
{
  "source": "manual",
  "recognized_signs": [
    { "label": "HELP", "confidence": 0.94, "timestamp": 1730000000000 },
    { "label": "DOCTOR", "confidence": 0.91, "timestamp": 1730000000500 }
  ],
  "discarded_signs": [
    { "label": "WATER", "confidence": 0.32, "timestamp": 1730000001000, "reason": "confidence 0.32 is below the 0.60 threshold" }
  ],
  "min_confidence": 0.6,
  "interpretation": {
    "text": "Necesito ayuda, por favor llamen a un médico.",
    "language": "es",
    "confidence": 0.82,
    "needs_clarification": false,
    "generated_by": "ai"
  },
  "provider": "meta",
  "model": "muse-spark-1.3",
  "latency_ms": 2140,
  "usage": { "prompt_tokens": 412, "completion_tokens": 96, "total_tokens": 508, "reasoning_tokens": 61 }
}
```

### Error handling

Every error has the shape `{ "error": { "code": "...", "message": "..." } }`. Provider messages, the key, and raw provider error details are **never** returned. They're logged server-side with a request ID.

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Bad JSON, unknown fields, empty/oversized sequence, invalid label, confidence or timestamp, unsupported language |
| 422 | `no_confident_signs` | Every sign is below `MIN_SIGN_CONFIDENCE`. Meta is not called. |
| 503 | `ai_not_configured` | `MODEL_API_KEY` (or model/base URL) missing |
| 502 | `ai_auth_failed` | Meta returned 401/403. Check `MODEL_API_KEY`. |
| 502 | `ai_billing` | Meta returned 402. Set up billing for the key's team. |
| 502 | `ai_model_not_found` | Meta returned 404. Check `META_MODEL` and `META_API_BASE_URL`. |
| 503 | `ai_rate_limited` | Meta returned 429. `Retry-After` is forwarded. |
| 502 | `ai_unavailable` | Meta 5xx or network failure |
| 504 | `ai_timeout` | Meta or the outbound request timed out |
| 502 | `ai_refused` | The model refused or the output was filtered |
| 502 | `ai_invalid_output` | The model reply broke the JSON contract |

## Testing the Meta connection

1. Set `MODEL_API_KEY` in the root `.env` and start the backend (`npm run dev` or `go run ./cmd/api`). The startup log shows `"meta_configured": true`. The key itself is never logged.
2. Open http://localhost:3000, scroll to **Developer tools**, and look at the **Meta AI Connection** panel. It shows configuration status and the active model.
3. Click **Test connection**. It makes one real Muse Spark request through Go and shows the reply, provider latency, round-trip time, and token usage, or a sanitized error.
4. In **Manual AI Integration Test**, type labels and confidences (for example `HELP` 0.94 and `DOCTOR` 0.91), choose a language, and click **Interpret with Muse Spark**. The result shows the labels sent, any discarded labels, and the AI interpretation, each clearly labeled.

The same checks work with `curl`; see [API](#api).

## Verification status

The client, endpoints, and UI are implemented and covered by automated tests. **A successful live Muse Spark response has not been verified yet.**

The live test reached Meta and wasn't rejected as unauthorized (no 401), but Meta returned **HTTP 402 `billing_error` / `billing_not_configured`**: the team that owns the key needs to resolve billing on the [Meta developer dashboard](https://dev.meta.ai/). After billing is set up, run **Test connection** again. No code changes are expected.

## Testing and checks

```bash
# Backend
cd backend
gofmt -l .          # prints nothing when formatted
go vet ./...
go test ./...

# Frontend
cd frontend
npm run lint
npm run typecheck
npm run build

# Everything at once (from the repo root)
npm run check
```

Backend tests cover input validation, label normalization, confidence thresholds, Meta request serialization, response parsing, provider errors, a missing API key, timeouts, error sanitization, and the HTTP endpoints. They use `httptest` and injected fakes, with no real network calls.

## Privacy and security

- Camera frames are processed only in the browser. Nothing is recorded or uploaded.
- Only sign labels, confidence scores, and timestamps are sent to the backend. Only the normalized labels and confidences reach Meta.
- `MODEL_API_KEY` is used only by the Go backend. It's never logged, returned by any endpoint, or included in the frontend bundle.
- Error responses are sanitized. Provider error text stays in server logs.
- The connection test endpoint is disabled in production.
- Label normalization limits model input to word characters, which reduces prompt-injection risk.

## Current limitations

- **No camera recognition yet.** MediaPipe-based recognition of a small sign vocabulary is planned for Phase 3. Until then, signs can only be entered manually in the developer tools, and that input is always labeled as manual.
- The interpretation is an AI approximation built from isolated glosses. It can't capture grammar, facial expressions, or other parts of signed languages that a gloss list doesn't carry.
- Output languages: Spanish and English.
- The model's `confidence` is self-reported and isn't a calibrated probability.

## Accessibility

- All controls are keyboard-accessible and labeled, with a skip link to the workspace.
- Camera, backend, recognition, and test status are announced through `aria-live` regions.

## Notes

- **`magic-string` override (frontend):** Tailwind CSS 4.3 loads the ESM-only `magic-string@1` through `require()`. Node versions older than 20.19 can't do that, and the production build fails. `frontend/package.json` pins `magic-string@0.30.21` (CJS-compatible, same API) for `@tailwindcss/node`. You can remove the override once everyone uses Node 22 LTS.
- **Camera access** requires `https://` or `http://localhost`.
