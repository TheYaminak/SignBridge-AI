# SignBridge AI

**Every Gesture Deserves a Voice.**
Breaking communication barriers through computer vision and artificial intelligence.

SignBridge AI is an **experimental, limited-vocabulary** recognizer for a few high-utility expressions in **Dominican Sign Language (LSRD)**. It works in the browser with a webcam and turns a recognized expression into short, natural Spanish or English text and speech. It is a prototype for the Meta Global AI Developer Hackathon 2026. It does **not** translate unrestricted sign language and is **not a replacement for a qualified sign language interpreter**.

## How it works: five separate parts

| | Component | What it does | Where |
| --- | --- | --- | --- |
| **A** | **MediaPipe landmark detection** | Finds up to 2 hands and 21 3-D landmarks per hand in each webcam frame. It also reports MediaPipe's 7 generic gestures (👍 ✋ …). It knows nothing about LSRD. | Browser (`lib/vision/`) |
| **B** | **Our custom-trained sign classifier** | A k-nearest-neighbor classifier over normalized landmark *sequences*, trained on recordings **you** make on `/training`. It predicts one of our intents or `UNKNOWN`. | Browser (`lib/signs/`) |
| **C** | **Go backend orchestration** | Validates the predicted intent, attaches its LSRD verification status, calls Muse Spark, validates the reply, and falls back to a clearly labeled local phrase if Meta is unavailable. | Go (`backend/`) |
| **D** | **Meta Muse Spark** (`muse-spark-1.3`) | Turns the predicted intent into a short, accessible message in Spanish and English, phrased tentatively when uncertain. | Meta Model API, called only by Go |
| **E** | **Browser SpeechSynthesis** | Speaks the message automatically in the selected language: an es-DO voice when installed (falling back to another Spanish voice), or en-US. | Browser |

**Muse Spark was not fine-tuned and does no sign recognition.** It never sees video or landmarks, only the predicted intent label, its canonical phrase, and the confidence. Recognition is done entirely by part B, which runs in your browser.

## Status: Phase 5

| Area | State |
| --- | --- |
| Webcam, MediaPipe hand tracking, skeleton overlay, generic gestures | ✅ Done (Phase 3) |
| Go ↔ frontend JSON contract: shared fixtures, regression tests, outdated-backend detection | ✅ Fixed and re-verified (`custom_sign_sequence`) |
| `/training`: complete-expression capture, configurable length (2–5 s), countdown, counts, delete, export/import | ✅ Done |
| Phrase-level temporal classifier: training, held-out evaluation, confusion matrix, model save/load | ✅ Done |
| Real-time recognition: rolling window, rejection, stabilization, rest-based reset | ✅ Done |
| Recognition state machine with **automatic speech** (Auto speak, Mute, Replay, last spoken, audio errors) | ✅ Done |
| Go `/api/v1/intents/interpret` → Muse Spark, validated JSON, labeled local fallback | ✅ Done, live verified |
| Vocabulary registry (`vocabulary.json`) driving labels, training targets, and verification | ✅ Done |
| A trained model for real LSRD signs | ⏳ **Not included.** It needs your recordings (see [Training workflow](#training-workflow)). |

### Supported expressions (checked against the LSRD dictionary)

| Intent | Spanish / English | LSRD status | Dictionary entries |
| --- | --- | --- | --- |
| `HELLO` | Hola / Hello | ✅ **Single verified sign** | [HOLA](https://diccionariolsrd.cc/diccionario/hola/) |
| `THANK_YOU` | Gracias / Thank you | ✅ **Single verified sign** | [GRACIAS](https://diccionariolsrd.cc/diccionario/gracias/) |
| `NEED_HELP` | Necesito ayuda / I need help | ⚠️ **Experimental intent**: both words are documented, but the **LSRD sign order is not verified** | [NECESITAR](https://diccionariolsrd.cc/diccionario/necesitar/), [AYUDA](https://diccionariolsrd.cc/diccionario/ayuda/), [AYUDAR](https://diccionariolsrd.cc/diccionario/ayudar/) |
| `NEED_DOCTOR` | Necesito un médico / I need a doctor | ⚠️ **Experimental intent**: both words are documented, but the **LSRD sign order is not verified** | [NECESITAR](https://diccionariolsrd.cc/diccionario/necesitar/), [DOCTOR](https://diccionariolsrd.cc/diccionario/doctor/), [MÉDICO](https://diccionariolsrd.cc/diccionario/medicoca/) |
| `WHERE_BATHROOM` | ¿Dónde está el baño? / Where is the bathroom? | ❌ **Unsupported** | No "Baño" or "Dónde" entry (only Bañar, Bañarse, Bañera, [Inodoro](https://diccionariolsrd.cc/diccionario/inodoro/)), so recording is disabled |
| `UNKNOWN` | (rejection class) | n/a | Rest, transitions, incomplete sequences, unrelated movement, generic gestures |

How this was checked (2026-11-03/04):

- The official address `https://diccionariolsrd.conadis.gob.do/` redirects (HTTP 301) to `https://diccionariolsrd.cc/` ([digital dictionary](https://diccionariolsrd.cc/diccionario-digital/)). That site is the dictionary built by CONADIS, MINERD, and ANSORDO (© Consejo Nacional de Discapacidad). We read its alphabetical and category index (1,466 entries) as text.
- **No phrase entries exist** for any of the requested expressions; only individual words are documented. We did **not** assume that Spanish word order is LSRD grammar. The working sequences for `NEED_HELP` (NECESITAR + AYUDA) and `NEED_DOCTOR` (NECESITAR + DOCTOR) are marked `sequence_verified: false` and shown in the UI as **experimental communication intents**. A Deaf LSRD signer or interpreter should confirm them before they are treated as LSRD.
- `NEED_HELP` is **not** mapped to the single sign AYUDA. The intent is trained only on full recordings of the whole expression.
- **Sign videos were not analyzed.** Entries are video only, and the page bodies weren't readable as text. We didn't download, inspect, or process any video. So hand configuration, palm orientation, start and end positions, movement direction, repetitions, location, and facial expression are **not documented here**. The registry records `requires_motion` / `requires_non_manual` as `unknown` unless known by construction (two-sign phrases are temporal).
- **No reference-video training pipeline was built.** The site shows a copy-protection notice ("¡¡El contenido está protegido!!") and states no machine-learning license, so its videos are not used. Training uses only your own webcam recordings. A local, explicitly authorized video could later be processed through the same MediaPipe pipeline; that remains future work.
- No dictionary media was downloaded, scraped, or redistributed. Only links are included.
- The index search was manual. "Not found" means not present in the index we could read.

The generic-gesture mode from Phase 3 still exists but is kept strictly separate. `Thumb_Up` is described as a thumbs-up gesture and is never mapped to an LSRD phrase.

## Architecture

```
Browser (Next.js, frontend only)                 Go API (all business logic)                Meta Model API
┌──────────────────────────────────┐             ┌──────────────────────────────────┐        ┌──────────────────┐
│ Webcam ─► MediaPipe ─► gestures  │  labels +   │ handler: validate JSON           │        │ POST /v1/chat/   │
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
│       ├── domain/              vocabulary.json registry (embedded), sign types, validation
│       ├── handler/             chi routes, CORS, logging, error mapping
│       ├── meta/                Meta Model API Chat Completions client (net/http)
│       └── service/             interpreter, prompt, output contract, connection tester
├── frontend/                    Next.js App Router + Tailwind + shadcn/ui
│   ├── public/models/           gesture_recognizer.task (official MediaPipe model)
│   ├── scripts/                 copy-mediapipe-wasm.mjs (runs before dev/build)
│   └── src/
│       ├── app/                 layout and page
│       ├── components/          header, workspace panels, dev/ (developer tools), ui/
│       ├── hooks/               useCamera, useHandTracking, useBackendHealth, useSpeechSynthesis
│       ├── lib/vision/          hand tracker, gesture classifier, stabilizer, drawing (+ tests)
│       ├── lib/signs/           landmark dataset, features, k-NN, evaluation, real-time (+ tests)
│       ├── app/training/        /training data collection page (dev only)
│       ├── lib/                 typed API client, config, languages, formatting
│       └── types/               shared types (mirror backend/internal/domain)
├── docker-compose.yml
├── contracts/fixtures/          shared request fixtures (Go + TS contract tests)
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
| `NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE` | `0.8` | Per-frame MediaPipe confidence a gesture needs before it counts |

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

## Computer vision (MediaPipe)

Hand tracking runs **entirely in the browser** with [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) Gesture Recognizer in `VIDEO` mode, on the existing camera stream. No second camera is opened, and no frames leave the device.

- **Model and runtime are self-hosted.** `public/models/gesture_recognizer.task` is the official model from Google's MediaPipe model storage. The WASM runtime is copied from `node_modules` into `public/mediapipe/wasm` by `scripts/copy-mediapipe-wasm.mjs`, which runs automatically before `npm run dev` and `npm run build`, including inside Docker. Nothing loads from a CDN at runtime.
- **GPU first, CPU fallback.** If the GPU delegate can't initialize, or fails on its first frames, the tracker restarts on CPU. The camera overlay shows which delegate is active and the FPS.
- **Skeleton overlay.** A canvas sized to the video's native resolution uses the same `object-cover` and mirror transform as the preview, so landmarks line up with the mirrored selfie view without coordinate math. Use **Hide skeleton** to toggle it.
- **Performance.** Per-frame data stays in refs. React state updates at most every 100 ms and only when visible values change. MediaPipe resources are released when the camera stops or the page unmounts.

### Pipeline stages (extension point for custom signs)

| Stage | Code | Output |
| --- | --- | --- |
| 1. Landmark extraction | `lib/vision/hand-tracker.ts` | `FrameObservation`: up to 2 hands × 21 landmarks, handedness, MediaPipe gesture |
| 2. Classification | `lib/vision/classifier.ts` (`FrameClassifier` interface) | `Classification` per frame |
| 3. Temporal processing | `lib/vision/stabilizer.ts` | `StableRecognition` events |
| 4. Interpretation | Go `POST /api/v1/interpret` → Muse Spark | Structured description |

To add a custom sign-language classifier, implement `FrameClassifier` with `kind: "sign"`. It can buffer `frame.hands[i].landmarks` over time and run its own model. Then pass it to `useHandTracking`, and send `recognition_type: "sign"`. Nothing else changes.

### Stabilization

Raw per-frame predictions flicker, so a gesture is added to the sequence only when all of these hold:

- **Confidence threshold:** per-frame confidence ≥ `NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE` (default **0.8**). Lower-confidence frames count as "no gesture".
- **Temporal smoothing:** the label wins at least 70% of the last 10 frames.
- **Duplicate suppression:** a held gesture is added once. The same gesture can be added again after the hand relaxes or leaves the frame.
- **Cooldown:** at most one new gesture per 1.2 s.
- **Reset:** after 8 consecutive frames without hands.

Gestures are **only sent to the Go API when the user clicks "Interpret recognized gestures"**. Detections never reach Meta automatically.

### Gestures vs. signs vs. AI text

- Camera gestures are sent with `recognition_type: "gesture"`. The backend accepts only the 7 MediaPipe labels for this type and uses a prompt that tells Muse Spark these are generic gestures, not sign language. It must describe them, never translate them.
- Manual test input and future custom classifiers use `recognition_type: "sign"`, which means sign-language glosses.
- The UI always shows the raw recognized sequence separately from the **AI-generated description**.

## Custom sign recognition

### Dataset collection (`/training`, development only)

1. Open `http://localhost:3000/training` and start the camera.
2. Pick an intent. The page shows its Spanish label, LSRD status, dictionary links, and recording instructions. `WHERE_BATHROOM` can't be recorded.
3. Choose a **recording length** (2, 3, 4, or 5 s; default 3 s; use 4–5 s for two-sign phrases) and click **Record**. After a 3-2-1 countdown, the page captures the **complete expression** as MediaPipe landmarks and stops automatically. Keep one length per dataset: the model's real-time window is set to the median sample length, and the page warns if lengths are mixed.
4. Takes where hands are visible in less than 50% of frames are rejected, except for `UNKNOWN`.
5. Repeat. The page shows per-class counts against the recommended **20–30**, and you can delete bad takes.
6. Click **New session** (or reload) partway through each class, so validation can hold out whole sessions.
7. Use **Export** and **Import** for JSON datasets. Imports are validated and de-duplicated.

Samples are stored **only in this browser** (IndexedDB) until you export them. No video or images are stored. Dataset format:

```json
{
  "format": "signbridge-landmarks", "version": 1, "exported_at": "…",
  "samples": [{
    "sample_id": "uuid", "label": "NEED_HELP", "source": "local_webcam",
    "reference_urls": ["https://diccionariolsrd.cc/diccionario/necesitar/", "…"],
    "session_id": "uuid", "signer_id": "signer-1", "recorded_at": "…", "duration_ms": 2980,
    "frames": [{ "timestamp_ms": 0, "left_hand": [x0, y0, z0, …, x20, y20, z20], "right_hand": null }]
  }]
}
```

- Each hand is 63 numbers: MediaPipe normalized coordinates of the unmirrored frame, rounded to 4 decimals. A missing hand is `null`.
- Hands are slotted by MediaPipe handedness (the signer's left or right).
- Raw landmarks are stored, not features, so datasets stay reusable if preprocessing changes.
- Exported datasets (`signbridge-dataset-*.json`, `frontend/data/`) are git-ignored by default.

### Preprocessing (identical for training and inference)

`lib/signs/features.ts` is used by the `/training` page, the CLI trainer, and real-time recognition:

1. **Temporal sampling:** resample the 3 s sequence to 16 evenly spaced frames by timestamp, using the nearest frame so missing hands stay missing.
2. **Per hand:**
   - a presence flag;
   - 21 landmarks **relative to the wrist** and **divided by the wrist→middle-knuckle distance** (position and scale normalization);
   - the wrist's image position, so location still counts.
3. **Movement:** wrist displacement between consecutive sampled frames, for each hand.
4. **Result:** a 2,176-value vector, standardized with the training mean and standard deviation that the model stores.

### Classifier: k-nearest neighbors with rejection

`lib/signs/knn.ts`. We chose k-NN because it works with 20–30 examples per class, trains instantly and deterministically in the browser, needs no new runtime (no TensorFlow, no Python), and its distances give a natural "this is unlike anything I learned" signal.

- **Prediction:**
  - Distance-weighted vote among the k = 5 nearest training sequences.
  - Confidence = vote share of the winning label.
- **Rejection to `UNKNOWN`:** any of the following.
  - The winner is `UNKNOWN`.
  - Confidence is below 0.6.
  - Fewer than 30% of frames contain a hand.
  - The nearest example is farther than a radius calibrated leave-one-out on the training data: max(1.5 × 95th-percentile nearest same-class distance, 0.5 × median nearest other-class distance).
- **Two-sign phrases:** `NEED_HELP` and `NEED_DOCTOR` are recognized as a whole 3 s temporal pattern, never as a single static pose.
- **No hand-coded rules:** there are no gesture-to-phrase mappings anywhere. All decisions come from your labeled recordings.

### Training and evaluation

Clicking **Train and evaluate** on `/training`, or running the CLI, does the following:

1. Validates the dataset and drops malformed samples with reasons.
2. **Splits per class.** If a class was recorded in 2+ sessions, whole sessions of that class are held out. Otherwise it falls back to a stratified random split and **says so**. The seed is fixed (42).
3. Trains on the training split and evaluates **only on held-out samples**: accuracy, per-class precision, recall and F1, and a confusion matrix.
4. Warns when the validation set is too small, when a class has fewer than 20 samples, when there's a single session, and when there's a **single signer** (no cross-signer generalization).
5. Retrains the final model on **all** samples. The report says so.
6. **Use this model** saves it in this browser. **Download model** saves `sign-classifier.json`. Put it in `frontend/public/models/` to bundle it with the app, including Docker.

The main page loads the model trained in this browser first, then the bundled file. If neither exists, it shows **"No trained custom model"** and recognizes nothing.

### Real-time recognition

`lib/signs/realtime.ts`:

This uses Option A, **phrase-level** recognition: the model is trained on recordings of complete expressions, so a multi-sign phrase is recognized as one temporal pattern, never from a single sign or pose.

- **Rolling window:** keeps the last *window* of landmarks (the model's median sample length, e.g. 3 s) and classifies every 150 ms once the window is at least 80% full. Recordings of different lengths are time-normalized to 16 frames.
- **Stabilization:** an intent is recognized after 3 consecutive identical accepted predictions.
- **Boundaries and reset:** an expression ends when it is confirmed. The window is then cleared, and the same intent isn't emitted again until `UNKNOWN` or "no hands" is seen (hands at rest or out of view). There's a 1.5 s cooldown between recognitions.

### Automatic multilingual speech

`lib/signs/pipeline.ts` implements the recognition state machine:

```
IDLE (camera off)
RECOGNIZING ─stable intent─▶ CONFIRMED ─auto speak or "Interpret"─▶ INTERPRETING ─Go → Muse Spark─▶ SPEAKING ─end─▶ COOLDOWN (1.5 s) ─▶ RECOGNIZING
```

- **Auto speak (on by default):** a confirmed intent goes to Go → Muse Spark automatically, and the returned text in the selected language is spoken. HELLO says "Hola" in Spanish and "Hello" in English.
- **No repeats:** new recognitions are accepted **only in RECOGNIZING**. A held sign, or a sign made while interpreting, speaking, or cooling down, never triggers another Meta request or overlapping speech, and the same expression needs a rest or reset before it can be spoken again.
- **Voices:** for Spanish, es-DO first, then es-US, es-419, es-MX, es-ES, or any other Spanish voice; for English, en-US first, then any English voice. The voice used is shown while speaking.
- **Controls:**
  - **Auto speak** on/off (off means interpret manually and play with Replay);
  - **Mute**, which silences automatic speech and stops current audio;
  - **Replay**, which repeats the last result in the selected language;
  - **Clear**;
  - **Last spoken**, which shows the expression, language, source, and time.
- **Stopping and errors:** stopping the camera or pressing Clear cancels speech, any pending Go/Meta request, and the cooldown. Browser audio errors (for example, autoplay blocked) are shown in the panel; click Replay to retry.
- **Generic gesture mode** keeps its explicit "Interpret" button and never triggers LSRD phrases.

### Training workflow

```bash
# 1. Start everything (local dev or Docker, see below), then open:
#    http://localhost:3000/training
# 2. Record 20-30 takes of HELLO, THANK_YOU, NEED_HELP, NEED_DOCTOR, and UNKNOWN
#    (split each class across 2+ sessions). Export a backup.
# 3. Train in the browser: "Train and evaluate" -> read the report -> "Use this model".
#    Or train offline with the same code:
cd frontend
npm run train -- ../signbridge-dataset-2026-11-04.json --out public/models/sign-classifier.json
# 4. Test on http://localhost:3000 -> "Custom signs (LSRD)" -> Start camera -> sign -> "Interpret recognized intent" -> Speak.
```

Offline training in Docker (one-off container, no permanent service, Node only):

```bash
# from the repo root; put your export in frontend/data/ first (git-ignored).
# The repo root is mounted so the trainer can read backend/internal/domain/vocabulary.json.
docker run --rm -v "$PWD:/repo" -v signbridge-train-modules:/repo/frontend/node_modules -w /repo/frontend node:22-alpine \
  sh -c "npm ci --no-audit --no-fund && npm run train -- data/signbridge-dataset.json --out public/models/sign-classifier.json"
docker compose up --build -d frontend   # bundle the new model
```

A trained model stores standardized landmark vectors from your recordings. Commit `public/models/sign-classifier.json` only if you're comfortable publishing that data.

## Extending the vocabulary (after the hackathon)

The MVP's five intents are data, not code. One declarative registry drives the whole app: [`backend/internal/domain/vocabulary.json`](backend/internal/domain/vocabulary.json). It is embedded in the Go binary, validated at startup, and served at `GET /api/v1/intents`.

| Field | Meaning |
| --- | --- |
| `id` | Unique label, `^[A-Z][A-Z0-9_]{0,31}$`. `UNKNOWN` is reserved. |
| `kind` | `phrase_intent` (a complete expression, used by all current entries) or `sign` (reserved for single signs) |
| `text_es`, `text_en` | Display labels and the canonical phrase given to Muse Spark |
| `status`, `references` | LSRD verification (`verified_sign`, `word_references`, `unavailable`) and dictionary URLs |
| `supported` | Only supported entries can be recognized or interpreted. Requires at least one reference. |
| `training_target` | Shown as recordable on `/training`. Requires `supported` and a `recognizer`. |
| `training_status` | Bundled state: `not_trained`, `trained`, `validated`, or `not_trainable`. All entries are `not_trained` today. |
| `recognizer` | Classifier family expected to predict it (`knn-sequence-v1`) |
| `components`, `sign_count` | Dictionary glosses a phrase intent is made of |
| `requires_motion`, `requires_non_manual` | `yes`, `no`, or `unknown`. Unverified properties stay `unknown`; the dictionary is video-only. |

What reads the registry, and what doesn't:

- **Frontend:** `/training` takes its recordable labels from it, as does the CLI trainer (`--vocabulary`) and dataset import validation.
- **Recognition filter:** the live recognizer only accepts labels that are `supported` in the registry. The panel lists any model labels it ignores, and nothing is recognized while the registry is unavailable.
- **Backend:** validates `/intents/interpret` against it. Go knows nothing about the classifier; it receives an intent ID, a confidence, and an opaque `model_id`.
- **Independent of the registry:** models declare their own `labels`, `target` (`phrase_intent`), and `recognizer`. Model loading (`useSignModel`) is separate from the translation UI, and the camera, MediaPipe, and Meta code never change when the vocabulary does.

**To add an expression later:**

1. Verify it in the LSRD dictionary by hand. Don't scrape, and don't add entries without a reference.
2. Add a registry entry with `supported: true`, `training_target: true`, references, and `unknown` for anything not verified.
3. Record samples on `/training`, train, and **check the held-out report**.
4. Only after validation, bundle the model and set `training_status` to `trained` or `validated`.

**To add a different model type,** for example a sign-level classifier or one that uses Pose or Face landmarks:

1. Implement the `FrameClassifier`/`predict` interface in `lib/signs` or `lib/vision`.
2. Emit labels that exist in the registry.
3. Give the model a new `recognizer` ID and point the relevant entries at it.

**Future work (deliberately not built now):**

- Single-sign entries (`kind: "sign"`) and a composer that maps recognized sign sequences to phrase intents.
- Pose and Face landmarks for non-manual markers.
- Multiple models loaded per recognizer.
- A large-vocabulary training pipeline.

None of these is needed for the five-intent MVP.

## API

### `GET /health`

```json
{ "status": "ok", "service": "signbridge-api", "api_version": 3 }
```

`api_version` increases whenever the request contract changes. If the backend is older than the frontend expects, the header shows **"Backend outdated: restart it"**.

### Shared API contract

`contracts/fixtures/*.request.json` hold the exact request bodies the frontend sends:

- **Frontend side:** `frontend/src/lib/api-requests.test.ts` checks that the request builders (`lib/api-requests.ts`) produce exactly these fixtures.
- **Backend side:** `backend/internal/handler/contract_test.go` replays them through the real router and requires `200`.
- **Strictness:** unknown fields are still rejected (`DisallowUnknownFields`), and that is tested too.

The earlier `malformed JSON: json: unknown field "recognition_type"` error came from a `go run` backend process started before Phase 3. The code agreed; the running process was outdated. `api_version` now makes that visible.

### `GET /api/v1/intents`

The intent catalog: texts, LSRD status, references, and notes. `/training` and the main page read it from here, so Go is the single source of truth.

### `POST /api/v1/intents/interpret`

```bash
curl -X POST http://localhost:8080/api/v1/intents/interpret -H "Content-Type: application/json" \
  -d '{"recognition_type":"custom_sign_sequence","intent":"NEED_HELP","confidence":0.93,"language":"es","raw_labels":["NEED_HELP"],"source":"camera","model_id":"knn-v1-202611040153"}'
```

```json
{
  "intent": "NEED_HELP", "raw_labels": ["NEED_HELP"], "confidence": 0.93, "language": "es",
  "text_es": "Necesito ayuda", "text_en": "I need help", "uncertain": false,
  "source": "meta", "model": "muse-spark-1.3", "provider": "meta", "latency_ms": 2644,
  "verification": { "status": "word_references", "sequence_verified": false, "references": [{ "gloss": "NECESITAR", "url": "…" }] },
  "experimental": true,
  "prediction_note": "Prediction from an experimental classifier trained on a small set of recordings. Not a verified sign-language translation."
}
```

- **Validation:**
  - `recognition_type` must be `custom_sign_sequence` (the phrase-level classifier). The Phase 4 value `custom_sign` is still accepted.
  - `intent` must be in the catalog. `UNKNOWN` returns **422 `unknown_intent`**, and `WHERE_BATHROOM` returns **422 `intent_unavailable`**.
  - `confidence` must be in [0, 1], and `language` must be `es` or `en`.
  - `raw_labels` must have 1–8 entries and include the intent. Unknown fields are rejected.
- **Muse Spark rules:**
  - Preserve the intent and stay close to the canonical phrase.
  - Add no medical, safety, or other details.
  - Never claim to have seen video.
  - Phrase tentatively when `uncertain`.
- **Confidence below `INTENT_MIN_CONFIDENCE`** (0.75) always sets `uncertain: true`. The model can add caution but never remove it. Live example at 0.55: "Posiblemente: Necesito un médico".
- **Output validation:** strict JSON with only `text_es`, `text_en`, and `uncertain`; both texts non-empty and at most 200 characters.
- **Local fallback:** if Meta is unconfigured, unreachable, times out, refuses, or returns invalid output, the response uses the catalog phrase with `"source": "local_fallback"` and a `fallback_reason`. The UI labels it "Local fallback phrase · not generated by Meta". It is never presented as a Muse Spark answer.

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

Optional `recognition_type`: `"sign"` (default) or `"gesture"`. For camera gestures, send the MediaPipe labels with `"source": "camera", "recognition_type": "gesture"`:

```bash
curl -X POST http://localhost:8080/api/v1/interpret \
  -H "Content-Type: application/json" \
  -d '{"signs":[{"label":"Thumb_Up","confidence":0.92,"timestamp":1730000000000}],
       "language":"en","source":"camera","recognition_type":"gesture"}'
```

Response shape for the sign example above (values illustrative):

```json
{
  "source": "manual",
  "recognition_type": "sign",
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
| 422 | `unknown_intent` | `UNKNOWN` was sent to `/intents/interpret`. It is never translated. |
| 422 | `intent_unavailable` | The intent has no verified dictionary reference (`WHERE_BATHROOM`) |
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

### Phase 5 (complete expressions + automatic speech): what was actually tested

- **Automated:**
  - Go: `go test ./...` covers `custom_sign_sequence` and the legacy `custom_sign`, experimental vs. verified intents, registry invariants (only dictionary-documented expressions can be `sequence_verified`), and the shared contract fixture.
  - Frontend: 53 unit tests cover the state machine transitions (no recognition outside RECOGNIZING, no second interpretation or overlapping speech, reset), voice selection (es-DO → other Spanish; en-US), and the median-length window with its mixed-length warning.
- **Mechanical end-to-end run in real Chrome, production build:** this tests the software path, **not LSRD recognition**.
  - Setup: real MediaPipe landmarks from Google sample photos, recorded under **stand-in labels**, then trained and activated.
  - With **Auto speak on**, with no click, the state went Recognizing → Interpreting → Speaking.
  - Go `custom_sign_sequence` → Muse Spark returned "Hola / Hello" (4.6 s). **Last spoken: "Hola" (HELLO, Español, Muse Spark)**, with no speech error.
  - While the same sign stayed in view, **exactly 1** interpretation request was sent.
  - After switching to English, **Replay** set Last spoken to **"Hello"**.
  - The SpeechSynthesis calls completed without errors, but audio can't be heard in a headless browser. **Listen on a real machine** to confirm the voice.
  - The stand-in data was deleted.
- **Docker:** `docker compose build` succeeded for both images.
- **Real LSRD evaluation results: none yet.** These require your own recordings on `/training`.

### Phase 4 (custom signs): what was actually tested

- **Automated:**
  - Go: `go test ./...` covers intent validation, UNKNOWN and unavailable rejection, low-confidence → uncertain, Meta response validation, every fallback path, shared contract fixtures, and the unknown-field regression.
  - Frontend: 39 unit tests cover features, k-NN, rejection, empty frames, the session split, the confusion matrix, dataset validation and import, the real-time stabilizer, and the contract builders.
  - The test landmark sequences are generated in code and used only to test the algorithms.
- **Mechanical end-to-end run in real Chrome, production build:** this tests the software path, **not sign recognition**.
  - Setup: a fake camera streamed Google's MediaPipe sample photos, and real MediaPipe landmarks were recorded through `/training` under **stand-in labels**: 6 takes each of thumbs-up as "HELLO", victory as "THANK_YOU", and fist as "UNKNOWN".
  - Capture, export, re-import (de-duplicated), training, and evaluation all worked. The model was activated, and the live window moved from "No hands" to "Unlike any trained example" to "Accepted HELLO", then emitted one stable intent.
  - Go `/intents/interpret` → Muse Spark returned "Hola / Hello" (3.8 s, source `meta`), and the Speak button was enabled.
  - That stand-in data was deleted. It is not a model of LSRD signs.
- **Docker Compose:** both images built and both containers were healthy.
  - `/api/v1/intents` matches the table above.
  - A live `/intents/interpret` returned "Necesito ayuda / I need help" from `muse-spark-1.3`.
  - Confidence 0.55 returned "Posiblemente: Necesito un médico" with `uncertain: true`.
  - `UNKNOWN` returned 422.
- **Evaluation results for real LSRD signs: none yet.** No real LSRD recordings exist in this repository. Accuracy for HELLO, THANK_YOU, NEED_HELP, and NEED_DOCTOR will come from the `/training` report after you record your samples. Report those numbers, not the stand-in run.

### Earlier phases

- **Meta Model API:** a live `POST /api/v1/meta/test` returned `READY` from `muse-spark-1.3` (about 1.7 s, token usage reported).
- **Full pipeline in a real browser:** headless Chrome with a fake camera streaming Google's official MediaPipe sample photos ran the production build. Results:
  - MediaPipe loaded on the GPU delegate (about 76 fps) and the skeleton aligned with the mirrored preview.
  - "Victory" and "Thumb up" were recognized, the sequence went through Go to Muse Spark, and Muse Spark returned a gesture description in Spanish. The Speak button was enabled.
  - The static stock photos score 0.70–0.77, so that run used `NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE=0.6`. At the default 0.8 they were correctly held back.
- **Not verified by us:** a live webcam with real hands. Try it with your camera. If clear gestures stay under 80%, lower `NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE` (for example to `0.7`) and rebuild.

## Testing and checks

```bash
# Backend
cd backend
gofmt -l .          # prints nothing when formatted
go vet ./...
go test ./...

# Frontend
cd frontend
npm test            # vision + sign classifier + API contract unit tests
npm run train -- <dataset.json>   # offline training with the same code as /training
npm run lint
npm run typecheck
npm run build

# Everything at once (from the repo root)
npm run check
```

### Docker test run

```bash
# From the repo root. Stop any local `npm run dev` first (ports 3000/8080).
docker compose up --build                # build and start both services

# In another terminal:
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/meta/status
curl -X POST http://localhost:8080/api/v1/meta/test
curl -I http://localhost:3000/models/gesture_recognizer.task          # 200
curl -I http://localhost:3000/mediapipe/wasm/vision_wasm_internal.wasm # 200, application/wasm

# Then open http://localhost:3000, start the camera, and show 👍 or ✋.

docker compose logs -f backend           # watch API and Meta calls
docker compose down                      # stop
```

To change the gesture threshold in Docker, set `NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE` in `.env` and run `docker compose up --build frontend`.

Backend tests cover input validation, label normalization, confidence thresholds, Meta request serialization, response parsing, provider errors, a missing API key, timeouts, error sanitization, and the HTTP endpoints. They use `httptest` and injected fakes, with no real network calls.

## Privacy and security

- Camera frames and hand landmarks are processed only in the browser (MediaPipe and the custom classifier run locally). No video is ever recorded, stored, or uploaded.
- Training samples contain only landmark coordinates, timestamps, labels, and metadata. They stay in the browser's IndexedDB until **you** export them, and exports are git-ignored by default.
- Only a predicted intent or labels, a confidence, and limited metadata (model ID, language) are sent to the backend, and only when the user clicks **Interpret**. Meta never receives video, images, or landmarks.
- `MODEL_API_KEY` is used only by the Go backend. It's never logged, returned by any endpoint, or included in the frontend bundle.
- Error responses are sanitized. Provider error text stays in server logs.
- The connection test endpoint is disabled in production.
- Label normalization limits model input to word characters, which reduces prompt-injection risk.

## Current limitations

- **Tiny vocabulary:** 4 trainable intents plus `UNKNOWN`. `WHERE_BATHROOM` is unavailable because no dictionary entry was found.
- **Proposed phrases:** `NEED_HELP` and `NEED_DOCTOR` combine two documented words. The dictionary doesn't document them as phrases.
- **Hands only:**
  - MediaPipe Pose and Face Landmarker are **not** used, so facial expressions (non-manual markers), body contact, and location relative to the face are not modeled. Only image position is used.
  - Signs that differ only in those features cannot be told apart.
- **Signer dependence:** a model trained by one person is not expected to work for other people. There's no cross-signer evaluation.
- **Small data:** 20–30 takes per class give a demo-grade model. Accuracy depends heavily on consistent framing and lighting.
- **Fixed duration:** recognition uses a fixed 3 s window. Very slow or fast signing, or two signs spread over more than 3 s, may not match.
- **Confidence values:**
  - Classifier confidence is a k-NN vote share, not a calibrated probability.
  - Muse Spark's role is wording only; it does not verify the sign.
- **Generic gesture mode:** this still recognizes MediaPipe's 7 gestures, which are not sign-language words.

## Hackathon demonstration workflow

**Before the demo,** record about 25 takes per class across 2+ sessions on `/training`, then train and click **Use this model**. Alternatively, download the model into `frontend/public/models/sign-classifier.json` and rebuild Docker.

1. Run `docker compose up --build` (or `npm run dev`) and open http://localhost:3000. The header should say **Backend online**.
2. Choose **Custom signs (LSRD)**. The panel should say **Custom model loaded**.
3. Click **Start camera**. The skeleton overlay appears.
4. Check that **Auto speak on** and **Sound on** are set, and choose **Español** or **English**.
5. Perform **HELLO** (or another trained expression), then lower your hands.
6. Watch the state bar go **Recognizing → Confirmed → Interpreting → Speaking**. The **Recognized intent** card shows `HELLO`, the confidence, "LSRD sign verified", and the dictionary link.
7. You hear **"Hola"** (or **"Hello"**). The text appears with the **Muse Spark · muse-spark-1.3** badge, and **Last spoken** updates. A fallback would be labeled.
8. Switch the language and press **Replay** to hear the other language.
9. Show the honesty points:
   - perform a random movement: UNKNOWN, nothing is spoken;
   - hold a sign: it is spoken only once;
   - point out the "Experimental intent" badge on NEED_HELP and NEED_DOCTOR, and the limitations notice;
   - switch to **Generic gestures** to show that 👍 is described as a gesture, not a sign.

## Accessibility

- All controls are keyboard-accessible and labeled, with a skip link to the workspace.
- Camera, backend, recognition, and test status are announced through `aria-live` regions.

## Notes

- **`magic-string` override (frontend):** Tailwind CSS 4.3 loads the ESM-only `magic-string@1` through `require()`. Node versions older than 20.19 can't do that, and the production build fails. `frontend/package.json` pins `magic-string@0.30.21` (CJS-compatible, same API) for `@tailwindcss/node`. You can remove the override once everyone uses Node 22 LTS.
- **Camera access** requires `https://` or `http://localhost`.
