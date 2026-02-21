# model-play — Architecture & Design

> Brainstormed 2026-02-20. Not yet built — this documents the concept, decisions, and MVP plan.

## The Idea

A universal, self-adapting AI playground where the UI dynamically constructs itself based on a JSON definition file. One playground for every AI model. Add any AI endpoint with a JSON definition file. The UI builds itself.

- Add any AI provider by dropping in an API key
- A JSON definition file describes everything about the endpoint — inputs, outputs, auth, interaction pattern
- The UI renders itself from that definition — text inputs for text models, image viewers for image models, audio players for TTS, polling for async jobs
- You can see the raw JSON request/response alongside the rendered output

## The Definition File

Each provider/endpoint gets a JSON file that is the **single source of truth** for how the UI renders and how the backend calls the API.

```
definitions/
  digitalocean/
    flux-schnell.json
    elevenlabs-tts.json
    stable-audio.json
  openai/
    chat-completions.json
```

One file per endpoint. Each file contains:

| Section | What it tells the **frontend** | What it tells the **backend** |
|---|---|---|
| `auth` | — | How to attach the API key (header, query param, etc.) |
| `request.params` | What form fields to render, what UI widget to use | What to put in the request body |
| `request.url/method` | — | Where and how to call the API |
| `body_template` | — | The fixed structure of the request body; params get injected via `body_path` |
| `interaction.pattern` | Show streaming view vs polling status vs static response | Whether to proxy SSE, poll, or do a single request |
| `response.outputs` | Which renderer to use (image viewer, audio player, etc.) | How to extract the result from the response JSON |
| `show_when` | Whether to show/hide a field | — |

One file, one consumer (the Flask app reads it to render the form AND to make the API call).

### Example: FLUX.1 Schnell (Image Generation)

```json
{
  "schema_version": 1,
  "id": "do-flux-schnell",
  "provider": "digitalocean",
  "name": "FLUX.1 Schnell (Image Generation)",
  "description": "Text-to-image generation via DigitalOcean GenAI",
  "auth": {
    "type": "header",
    "header": "Authorization",
    "prefix": "Bearer "
  },
  "request": {
    "method": "POST",
    "url": "https://inference.do-ai.run/v1/async-invoke",
    "content_type": "application/json",
    "body_template": {
      "model_id": "fal-ai/flux/schnell",
      "input": {}
    },
    "params": [
      {
        "name": "prompt",
        "type": "string",
        "ui": "textarea",
        "required": true,
        "body_path": "input.prompt",
        "placeholder": "A cat astronaut floating in space..."
      }
    ]
  },
  "interaction": {
    "pattern": "polling",
    "status_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}/status",
    "result_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}",
    "request_id_path": "$.request_id",
    "poll_interval_ms": 2000,
    "done_when": { "path": "$.status", "equals": "COMPLETED" },
    "failed_when": { "path": "$.status", "in": ["FAILED", "ERROR"] }
  },
  "response": {
    "outputs": [
      { "path": "$..url", "type": "image", "source": "url", "downloadable": true }
    ],
    "error": { "path": "$.error.message" }
  }
}
```

### Example: ElevenLabs TTS (Text to Speech)

```json
{
  "schema_version": 1,
  "id": "do-elevenlabs-tts",
  "provider": "digitalocean",
  "name": "ElevenLabs TTS (Text to Speech)",
  "auth": {
    "type": "header",
    "header": "Authorization",
    "prefix": "Bearer "
  },
  "request": {
    "method": "POST",
    "url": "https://inference.do-ai.run/v1/async-invoke",
    "content_type": "application/json",
    "body_template": {
      "model_id": "fal-ai/elevenlabs/tts/multilingual-v2",
      "input": {}
    },
    "params": [
      {
        "name": "text",
        "type": "string",
        "ui": "textarea",
        "required": true,
        "body_path": "input.text",
        "placeholder": "Hello, welcome to model-play..."
      },
      {
        "name": "voice",
        "type": "enum",
        "options": ["Rachel", "Aria", "Roger", "Sarah", "Laura", "Charlie", "George", "Callum", "River", "Liam", "Charlotte", "Alice", "Matilda", "Will", "Jessica", "Eric", "Chris", "Brian", "Daniel", "Lily", "Bill"],
        "default": "Rachel",
        "ui": "dropdown",
        "required": true,
        "body_path": "input.voice"
      },
      {
        "name": "language",
        "type": "enum",
        "options": ["en", "es", "fr", "de", "it", "pt", "pl", "hi", "ja", "zh"],
        "default": "en",
        "ui": "dropdown",
        "required": true,
        "body_path": "input.language"
      }
    ]
  },
  "interaction": {
    "pattern": "polling",
    "status_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}/status",
    "result_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}",
    "request_id_path": "$.request_id",
    "poll_interval_ms": 2000,
    "done_when": { "path": "$.status", "equals": "COMPLETED" },
    "failed_when": { "path": "$.status", "in": ["FAILED", "ERROR"] }
  },
  "response": {
    "outputs": [
      { "path": "$..url", "type": "audio", "source": "url", "downloadable": true }
    ],
    "error": { "path": "$.error.message" }
  }
}
```

### Example: Stable Audio 2.5 (Text to Audio)

```json
{
  "schema_version": 1,
  "id": "do-stable-audio",
  "provider": "digitalocean",
  "name": "Stable Audio 2.5 (Text to Audio)",
  "auth": {
    "type": "header",
    "header": "Authorization",
    "prefix": "Bearer "
  },
  "request": {
    "method": "POST",
    "url": "https://inference.do-ai.run/v1/async-invoke",
    "content_type": "application/json",
    "body_template": {
      "model_id": "fal-ai/stable-audio-25/text-to-audio",
      "input": {}
    },
    "params": [
      {
        "name": "prompt",
        "type": "string",
        "ui": "textarea",
        "required": true,
        "body_path": "input.prompt",
        "placeholder": "Upbeat electronic music with synth leads..."
      }
    ]
  },
  "interaction": {
    "pattern": "polling",
    "status_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}/status",
    "result_url": "https://inference.do-ai.run/v1/async-invoke/{request_id}",
    "request_id_path": "$.request_id",
    "poll_interval_ms": 2000,
    "done_when": { "path": "$.status", "equals": "COMPLETED" },
    "failed_when": { "path": "$.status", "in": ["FAILED", "ERROR"] }
  },
  "response": {
    "outputs": [
      { "path": "$..url", "type": "audio", "source": "url", "downloadable": true }
    ],
    "error": { "path": "$.error.message" }
  }
}
```

### What changes between definitions

| | FLUX | ElevenLabs | Stable Audio |
|---|---|---|---|
| `model_id` | `fal-ai/flux/schnell` | `fal-ai/elevenlabs/tts/multilingual-v2` | `fal-ai/stable-audio-25/text-to-audio` |
| Input params | prompt | text + voice + language | prompt |
| Output type | `image` | `audio` | `audio` |

The interaction section is **identical** across all three. Same URLs, same polling pattern, same status checks.

---

## Schema Design Decisions

### Conditional params (`show_when`)

Some params only matter if another param is set (e.g., `image_url` only relevant if `model` supports vision).

**Decision: Simple `show_when` with three operators — `equals`, `in`, `not`.**

```json
{
  "name": "image_url",
  "type": "string",
  "ui": "file_upload",
  "show_when": { "param": "model", "in": ["gpt-4o", "gpt-4o-mini"] }
}
```

One param can depend on one other param. No nesting, no chaining. The frontend is a 10-line filter function, not a rule engine.

For complex APIs where params depend on params that depend on params, make separate endpoint definitions instead (e.g., "FLUX - Text to Image" and "FLUX - Image to Image" as two entries).

### Nested request bodies (`body_template` + `body_path`)

Params are a flat array in the definition, but APIs expect nested JSON bodies. Solved with:

- `body_template` — the fixed structure of the request body
- `body_path` on each param — where to inject the value

```json
"body_template": { "model_id": "fal-ai/flux/schnell", "input": {} },
"params": [{ "name": "prompt", "body_path": "input.prompt" }]
```

No `body_path` = top-level key.

### Advanced params (`group`)

Rarely-used params go into a collapsible section:

```json
{
  "name": "num_inference_steps",
  "type": "integer",
  "ui": "slider",
  "group": "advanced"
}
```

The server renders a main section and a collapsed "Advanced" section.

### Polling status detection (`done_when` / `failed_when`)

Different providers signal completion differently. The definition declares what to look for:

```json
"done_when": { "path": "$.status", "equals": "COMPLETED" },
"failed_when": { "path": "$.status", "in": ["FAILED", "ERROR"] }
```

---

## The Flow (Step by Step)

### 1. Open the app

You run `python app.py` and open `localhost:8080`. Flask reads every JSON file from the `definitions/` folder and renders the page with a dropdown listing all available definitions.

### 2. Pick a definition

You select "FLUX.1 Schnell" from the dropdown. The browser requests that page (or JS fetches the definition). Flask loads the definition JSON and renders the form server-side using Jinja:

```
params[0] → type: "string", ui: "textarea"  →  renders a <textarea>
```

It also reads `auth.type: "header"` and renders an API key input at the top.

Picking ElevenLabs instead renders three fields (textarea + two dropdowns). Different JSON file, different form. No code changed — just a different Jinja render pass.

### 3. Fill in the form, hit Generate

The form submits to Flask:

```
POST /api/generate
{
  "definition_id": "do-flux-schnell",
  "api_key": "dop_v1_abc123...",
  "params": {
    "prompt": "A cat astronaut floating in space"
  }
}
```

### 4. Flask builds the real API request

**Build the request body.** Start with `body_template`:

```json
{ "model_id": "fal-ai/flux/schnell", "input": {} }
```

Walk through each param and inject values at `body_path`:

```
param "prompt", body_path "input.prompt", value "A cat astronaut floating in space"
```

Result:

```json
{
  "model_id": "fal-ai/flux/schnell",
  "input": {
    "prompt": "A cat astronaut floating in space"
  }
}
```

**Build the headers:**

```
Authorization: Bearer dop_v1_abc123...
Content-Type: application/json
```

**Make the call:**

```
POST https://inference.do-ai.run/v1/async-invoke
```

**Get the response:**

```json
{ "request_id": "abc-123-def" }
```

Extract `request_id` using `interaction.request_id_path` (`$.request_id`) and return it to the browser.

### 5. Polling

JavaScript on the page sees `interaction.pattern: "polling"` in the definition data.

Every 2 seconds (`poll_interval_ms`), it calls:

```
GET /api/status?definition_id=do-flux-schnell&request_id=abc-123-def
```

Flask plugs `request_id` into the `status_url` template:

```
GET https://inference.do-ai.run/v1/async-invoke/abc-123-def/status
```

Checks `done_when`: is `$.status` equal to `"COMPLETED"`? If not, returns `{ "status": "pending" }`. The page shows a spinner, polls again.

### 6. Job completes

Status returns `{ "status": "COMPLETED" }`. Flask fetches the result using `result_url`:

```
GET https://inference.do-ai.run/v1/async-invoke/abc-123-def
```

Returns the full response (including the raw JSON for the toggle view).

### 7. JavaScript renders the result

Reads `response.outputs` from the definition:

```json
{ "path": "$..url", "type": "image", "source": "url", "downloadable": true }
```

Extracts the URL using the JSONPath, sees `type: "image"`, renders an `<img>` tag with a download button. Also populates the raw JSON viewer with the full request and response.

For Stable Audio, the same flow produces `type: "audio"` and renders an `<audio>` player instead.

### Flow diagram

```
User opens localhost:8080
        │
        ▼
Flask reads definitions/ folder, renders page with dropdown
        │
        ▼
User picks a definition
        │
        ▼
Flask loads definition JSON, renders form via Jinja
        │
        ▼
User fills in form, hits Generate
        │
        ▼
JS posts definition_id + params + key to Flask
        │
        ▼
Flask loads definition, builds request from body_template + params
        │
        ▼
Flask makes the API call
        │
        ├── interaction.pattern = "polling"?
        │       ▼
        │   Flask returns request_id
        │   JS polls /api/status until done_when
        │   Flask fetches result
        │
        ├── interaction.pattern = "streaming"? (post-MVP)
        │       ▼
        │   Flask proxies SSE to browser
        │   JS renders tokens as they arrive
        │
        └── interaction.pattern = "sync"? (post-MVP)
                ▼
            Flask returns response directly
        │
        ▼
JS reads response.outputs from definition
        │
        ├── type: "image"  → <img> + download
        ├── type: "audio"  → <audio> + download
        └── type: "text"   → rendered text
        │
        ▼
Raw JSON toggle shows full request + response
```

---

## Architecture

Single Flask app serves both the UI and proxies API calls. One process, one port.

```
┌──────────────────────────────────────────────┐
│            Flask App (localhost:8080)         │
│                                              │
│  ┌──────────────┐  ┌─────────────────────┐   │
│  │ Definition    │  │ Jinja Templates     │   │
│  │ Loader        │  │ (renders forms      │   │
│  │ (reads JSON   │  │  from definitions)  │   │
│  │  files)       │  │                     │   │
│  └──────────────┘  └─────────────────────┘   │
│                                              │
│  ┌──────────────┐  ┌─────────────────────┐   │
│  │ Proxy Layer   │  │ Polling Handler     │   │
│  │ (builds +     │  │ (status checks,     │   │
│  │  sends API    │  │  result fetching)   │   │
│  │  requests)    │  │                     │   │
│  └──────────────┘  └─────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ Static files (CSS + JS)              │    │
│  │ JS handles: polling loop, output     │    │
│  │ rendering (img/audio), JSON toggle   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App | Python + Flask | Serves UI, proxies API calls, handles polling — one process |
| Templates | Jinja2 | Server-renders forms from definition params |
| Interactivity | Vanilla JS | Polling loop, output rendering (image/audio), JSON toggle |
| Storage | Flat JSON files | Definitions on disk. API keys entered per-session, not persisted (MVP) |
| Definitions | JSON files in `definitions/` folder | The whole point |

**Note:** Flask is synchronous. This is fine for the polling-only MVP. Before adding streaming/SSE support, evaluate switching to FastAPI (async-native, SSE built-in).

## File Structure

```
model-play/
  definitions/
    digitalocean/
      flux-schnell.json
      elevenlabs-tts.json
      stable-audio.json
  app.py                ← Flask app (routes, definition loading, proxy)
  proxy.py              ← builds + sends API calls from definitions
  templates/
    index.html          ← main page (definition picker + playground)
  static/
    style.css
    app.js              ← polling, output rendering, JSON toggle
```

---

## MVP Scope

### In scope

- Three definitions: FLUX.1 Schnell, ElevenLabs TTS, Stable Audio 2.5
- All three use DigitalOcean async-invoke (one API key tests everything)
- Server-rendered dynamic forms from definition params (Jinja)
- Polling interaction pattern with status display (JS)
- Two output renderers: image, audio (JS)
- Raw JSON request/response toggle on every result
- Basic error display using `response.error` path from definition
- API key entered per-session (not persisted)

### Explicitly out of scope

- No streaming/SSE support (add later with an OpenAI definition)
- No `show_when` conditional params
- No `group: "advanced"` collapsible sections
- No "AI generates a definition from docs" flow
- No saved views or generation history
- No definition editor in the UI
- No community/marketplace
- No file upload (multipart) support
- No configurable base URLs
- No user accounts or auth

### Done when

1. Pick "FLUX" from a dropdown, type a prompt, hit generate, see an image appear after polling
2. Pick "ElevenLabs TTS", type text, pick a voice, hit generate, hear audio play back
3. Pick "Stable Audio", type a prompt, hit generate, hear generated audio play back
4. Toggle raw JSON on any result to see the full request and response

Three different forms, two different output renderers, raw JSON on everything, one unified experience.

---

## Open Source Potential

The definition file format creates a network effect:

- Ship the tool with curated definitions
- Community contributes more definitions via PRs (low barrier — it's just a JSON file)
- The library of definitions grows without anyone writing UI code

Key principles for open source:
- **API keys stay local.** Keys are entered per-session and only sent to the provider via the local proxy. Never persisted, never transmitted to any third party.
- **Runs locally.** Not a SaaS. No hosted version storing everyone's keys.
- **Definition quality control.** JSON Schema for the definition format + validation/test harness for contributed definitions.

---

## Known Gaps to Address Post-MVP

1. **Streaming/SSE** — needed for text model endpoints (OpenAI, Anthropic). Will likely require switching from Flask to FastAPI. This is the most important post-MVP addition — validates that the architecture works beyond polling.
2. **Configurable base URLs** — needed for DigitalOcean (per-cluster URLs), Azure OpenAI, self-hosted models. Add a `config` section to definitions for one-time setup values.
3. **File uploads / multipart** — needed for image-to-image, audio transcription.
4. **Custom headers** — some providers need extra headers beyond auth (e.g., Anthropic's `anthropic-version`). Support `request.headers` for static headers.
5. **Query params / path params** — some APIs need params in the URL, not the body. Add `location` field to params (`body`, `query`, `path`).
6. **Additional auth types** — query param auth, Basic auth. Extend `auth.type` beyond just `header`.
7. **`show_when` conditional params** — deferred from MVP but designed. Simple `equals`/`in`/`not` operators.
8. **Generation history** — save request/response pairs to SQLite for comparison. Key differentiator from Postman.
9. **Chat interface** — the `"type": "chat"` param hides a lot (message arrays, roles, system prompts). Should be a hardcoded first-class component, not schema-described.
