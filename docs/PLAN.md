# model-play MVP — Implementation Plan

> Created 2026-02-20. Tracks the build plan for the MVP.

## Context

Building the first working version of model-play: a universal AI playground where JSON definition files drive dynamic UI generation. The architecture and decisions are documented in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`. No code exists yet — greenfield project. Proven patterns from the [gradient-test-machine](https://github.com/ajot/gradient-test-machine) project will be reused where applicable.

**Goal:** Pick any of three endpoints from a dropdown, see a dynamically generated form, submit it, watch polling, see the rendered result (image or audio), and toggle raw JSON.

---

## Step 1: Create definition files + dependencies

Create the three JSON definition files and `requirements.txt`.

**Files:**
- `definitions/digitalocean/flux-schnell.json`
- `definitions/digitalocean/elevenlabs-tts.json`
- `definitions/digitalocean/stable-audio.json`
- `requirements.txt` — flask, requests, python-dotenv, gunicorn

Content for each definition is already specified in `docs/ARCHITECTURE.md`. Copy them verbatim.

**Verify:** JSON is valid, files load with `json.load()`.

---

## Step 2: Flask app with definition loading + page rendering

Create `app.py` with:
- Load all definitions from `definitions/` folder on startup (walk subdirs, read JSON files, store in a dict keyed by `id`)
- `GET /` — render `index.html` with the list of definitions passed to template
- `GET /api/definitions/<id>` — return full definition JSON (for JS to use during polling/rendering)

Create `templates/index.html` with:
- Definition picker dropdown (populated from Flask context)
- API key input field (password type)
- A `<div id="playground">` that will hold the dynamic form
- When dropdown changes, JS fetches the definition and the form section re-renders

**Jinja renders the initial page; JS handles switching definitions dynamically.**

For the dynamic form, JS reads the definition's `request.params` and builds HTML:
- `ui: "textarea"` → `<textarea>`
- `ui: "dropdown"` → `<select>` with `<option>` for each entry in `options`
- `ui: "slider"` → `<input type="range">`
- `ui: "text"` → `<input type="text">`

A "Generate" button at the bottom.

**Verify:** `python app.py` → open localhost:8080 → see dropdown with 3 options → selecting each renders different form fields.

---

## Step 3: Generic proxy — build + send API requests from definitions

Create `proxy.py` with:
- `build_request(definition, params, api_key)` → returns `(url, headers, body)`:
  - Deep-copy `body_template`
  - For each param with `body_path`, set the value at that dot-separated path in the body
  - For params without `body_path`, set at top-level key
  - Build headers from `auth` config (e.g., `Authorization: Bearer <key>`)
  - Add any `request.headers` from definition
  - Return the url, headers, and body

- `extract_value(data, jsonpath)` → simple JSONPath extraction:
  - Support `$.foo.bar` (dot notation)
  - Support `$..url` (recursive descent)
  - Support `$.foo[*].bar` (array wildcard)
  - Keep it minimal — only what the three definitions need

Add routes to `app.py`:
- `POST /api/generate` — receives `{definition_id, api_key, params}`, calls `build_request()`, makes the HTTP call via `requests`, returns response JSON
- `GET /api/status` — receives `definition_id, api_key, request_id` as query params, builds status URL from definition's `interaction.status_url` template, makes the call, evaluates `done_when`/`failed_when`, returns status
- `GET /api/result` — receives same params, fetches from `interaction.result_url`, returns full response

**Verify:** Use curl or the browser form to submit a FLUX prompt with a real API key → get back a `request_id`.

---

## Step 4: Polling + result rendering in JavaScript

In `static/app.js`:

**Polling loop:**
- After `/api/generate` returns a `request_id`, start polling
- Read `interaction.poll_interval_ms` from the definition
- Call `/api/status` every N ms
- Check response: if `done_when` matched → fetch `/api/result`; if `failed_when` matched → show error
- Show spinner/status indicator during polling

**Result rendering:**
- Read `response.outputs` from definition
- For each output, extract value from response using `path`
- Based on `type`:
  - `"image"` + `source: "url"` → render `<img src="...">` + download link
  - `"audio"` + `source: "url"` → render `<audio controls>` + download link
- If `downloadable: true`, add a download button

**Error rendering:**
- If the API returns an error, use `response.error.path` to extract the message
- Display it clearly in the result area

**Verify:** Full end-to-end test with FLUX → see generated image. Switch to ElevenLabs TTS → hear audio. Switch to Stable Audio → hear generated music.

---

## Step 5: Raw JSON toggle

Add to the result area:
- A "Show JSON" toggle button
- When toggled, show two collapsible sections:
  - **Request** — the actual HTTP request sent (method, url, headers with key masked, body)
  - **Response** — the full raw JSON response
- Use `<pre><code>` with JSON.stringify(data, null, 2)
- Style with monospace font, dark background

The request JSON is captured during the generate step and stored in JS state alongside the response.

**Verify:** Generate any result → toggle JSON → see formatted request and response.

---

## Step 6: Styling + log console

In `static/style.css` + Tailwind CDN in `index.html`:
- Dark theme (bg-gray-900)
- Two-column layout: left panel (form + results), right panel (log console)
- Log console shows timestamped entries: requests (blue), responses (green), errors (red), status (purple)
- Reuse the `log()` function pattern from gradient-test-machine
- Responsive: stacks on mobile

**Verify:** Looks clean, log console shows the polling flow clearly.

---

## Files to create (in order)

| File | Purpose |
|---|---|
| `requirements.txt` | Flask, requests, python-dotenv, gunicorn |
| `definitions/digitalocean/flux-schnell.json` | FLUX image gen definition |
| `definitions/digitalocean/elevenlabs-tts.json` | ElevenLabs TTS definition |
| `definitions/digitalocean/stable-audio.json` | Stable Audio definition |
| `app.py` | Flask app — routes, definition loading, serves templates |
| `proxy.py` | Generic request builder + JSONPath extraction |
| `templates/index.html` | Main page — Jinja template with Tailwind |
| `static/app.js` | Client-side: form rendering, polling, result display, JSON toggle |
| `static/style.css` | Minimal custom styles (log console colors, overrides) |

---

## Verification (end-to-end)

1. `pip install -r requirements.txt`
2. `python app.py`
3. Open `localhost:8080`
4. Enter a DigitalOcean API key
5. Select "FLUX.1 Schnell" → type a prompt → Generate → see polling in log → see generated image
6. Select "ElevenLabs TTS" → type text, pick voice + language → Generate → hear audio playback
7. Select "Stable Audio" → type prompt → Generate → hear generated audio
8. Toggle "Show JSON" on any result → see request + response
9. Verify error display: submit with empty API key → see error message
