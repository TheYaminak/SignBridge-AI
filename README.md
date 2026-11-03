# SignBridge AI

**Every Gesture Deserves a Voice.**
Breaking communication barriers through computer vision and artificial intelligence.

SignBridge AI recognizes a **limited vocabulary** of signs through a webcam and turns recognized sequences into text and speech. It is a hackathon prototype for the Meta Global AI Developer Hackathon 2026. It does **not** translate unrestricted sign language and is not a replacement for a qualified interpreter.

## Status: Phase 1

| Area | State |
| --- | --- |
| Next.js UI: camera preview, device selection, translation panel, speech, backend status | ✅ Done |
| Go API: `/health`, `/api/v1/interpret` (validates input, returns **501**) | ✅ Done |
| Meta Model API client abstraction (no network calls) | ✅ Prepared |
| On-device sign recognition (MediaPipe) | ⏳ Phase 2 |
| Interpretation via Meta Model API | ⏳ Phase 3 |

The app never fabricates recognition results or translations. Until the recognizer exists, the translation panel stays empty and says so.

## Architecture

```
Browser (Next.js, frontend only)                Go API (all business logic)
┌──────────────────────────────────┐            ┌───────────────────────────────┐
│ Webcam ─► MediaPipe (Phase 2)    │  JSON      │ chi router ─► handler         │
│          └► RecognizedSign[] ────┼──────────► │   ─► service.Interpreter      │
│ Translation panel ◄──────────────┼─────────── │       ─► meta.Client ──► Meta │
│ SpeechSynthesis (local)          │            │          (API key stays here) │
└──────────────────────────────────┘            └───────────────────────────────┘
```

- **Video stays in the browser.** The backend only receives sign labels, confidences, and timestamps. Nothing is recorded or uploaded.
- **Next.js is frontend only.** No API routes or server actions contain business logic.
- **Secrets stay in Go.** `META_API_KEY` is read only by the backend.

```
signbridge-ai/
├── backend/                 Go API
│   ├── cmd/api/main.go      entry point: config, server, graceful shutdown
│   └── internal/
│       ├── config/          env and .env loading
│       ├── domain/          RecognizedSign, SignSequence, InterpretationRequest/Result
│       ├── handler/         chi routes, CORS, request logging, JSON helpers
│       ├── meta/            Meta Model API client interface + placeholder
│       └── service/         Interpreter (business logic)
├── frontend/                Next.js App Router + Tailwind + shadcn/ui
│   └── src/
│       ├── app/             layout and page
│       ├── components/      header, backend status, workspace panels, ui/
│       ├── hooks/           useCamera, useBackendHealth, useSpeechSynthesis
│       ├── lib/             typed API client, config, languages
│       └── types/           shared types (mirror backend/internal/domain)
├── package.json             root scripts to run both services
└── Makefile                 optional shortcuts
```

## Prerequisites

- **Go** 1.25+
- **Node.js** 20.9+ (22 LTS recommended) and npm

No Docker, database, or other services are required.

## Quick start

```bash
# 1. Install dependencies (root, frontend, Go modules)
npm run setup

# 2. Optional: create local env files from the examples
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 3. Start the API (http://localhost:8080) and the UI (http://localhost:3000) together
npm run dev
```

Open http://localhost:3000. The header badge should show **Backend online**. Click **Start camera** and allow access when the browser asks.

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

## Configuration

### Backend (`backend/.env` or real environment variables)

The backend loads `backend/.env` if it exists. Variables already set in the environment take precedence.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `APP_ENV` | `development` | Informational |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins |
| `HTTP_READ_TIMEOUT` / `HTTP_WRITE_TIMEOUT` / `HTTP_IDLE_TIMEOUT` | `10s` / `30s` / `60s` | Server timeouts |
| `HTTP_REQUEST_TIMEOUT` | `25s` | Per-request handler timeout |
| `HTTP_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown drain time |
| `META_API_KEY`, `META_MODEL`, `META_API_BASE_URL` | empty | Meta Model API settings (unused in Phase 1) |
| `META_API_TIMEOUT` | `20s` | Outbound client timeout |

Take the Meta values from official Meta documentation. The code does not assume any endpoint or model identifier.

### Frontend (`frontend/.env.local`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8080` | Go API base URL. Inlined at build time. |

Never put secrets in `NEXT_PUBLIC_*` variables. They ship to the browser.

## API

### `GET /health`

```json
{ "status": "ok", "service": "signbridge-api" }
```

### `POST /api/v1/interpret`

Request:

```json
{
  "signs": [{ "label": "HELP", "confidence": 0.94, "timestamp": 1730000000000 }],
  "language": "es"
}
```

Phase 1 responses:

| Status | When |
| --- | --- |
| `400 invalid_request` | Malformed JSON, unknown fields, empty `signs`, more than 64 signs, blank label, confidence outside [0, 1], non-positive timestamp, or missing `language` |
| `501 not_implemented` | Valid request. Interpretation is not built yet, so no text is generated. |

Every error uses the same shape:

```json
{ "error": { "code": "not_implemented", "message": "..." } }
```

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

## Privacy and accessibility

- Camera frames are processed only in the browser. Nothing is recorded or uploaded.
- The camera stops when you click **Stop camera** or leave the page.
- All controls are keyboard-accessible and labeled, with a skip link to the workspace.
- Camera, backend, and recognition status are announced through `aria-live` regions.

## Notes

- **`magic-string` override (frontend):** Tailwind CSS 4.3 loads the ESM-only `magic-string@1` through `require()`. Node versions older than 20.19 can't do that, and the production build fails. `frontend/package.json` pins `magic-string@0.30.21` (CJS-compatible, same API) for `@tailwindcss/node`. You can remove the override once everyone uses Node 22 LTS.
- **Camera access** requires `https://` or `http://localhost`.
