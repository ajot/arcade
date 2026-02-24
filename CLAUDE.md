# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the app (serves at http://localhost:8080)
python app.py

# Validate all definition files (schema, interaction, response, examples, cross-references)
python validate.py

# Validate a single definition
python validate.py definitions/openai/chat-completions.json

# Install dependencies
pip install -r requirements.txt
```

## Architecture

This is **arcade**, a definition-driven AI playground. The entire UI and backend behavior is controlled by JSON definition files — no code changes needed to add a new provider.

### Core Flow

```
definitions/*.json → app.py (loads all at startup)
                   → proxy.py (builds HTTP requests from definitions)
                   → app.js (renders forms, dispatches interactions, renders outputs)
```

1. **Startup**: `app.py:load_definitions()` walks `definitions/` and loads every JSON file into a `DEFINITIONS` dict keyed by `id`
2. **Selection**: Client fetches definition via `/api/definitions/<id>`, dynamically builds form from `request.params`
3. **Generation**: Client posts to `/api/generate` or `/api/stream`. `proxy.py:build_request()` merges user params into `body_template` at each param's `body_path`, attaches auth headers
4. **Response**: Output extracted via JSONPath (`proxy.py:extract_value`) using paths from `response.outputs`

### Three Interaction Patterns

Each definition declares one pattern in `interaction.pattern`:

- **streaming** — Flask proxies SSE via `/api/stream`. Client reads tokens using `stream_path` JSONPath. Metrics: TTFT, tokens/sec
- **polling** — `/api/generate` returns `request_id`. Client polls `/api/status` until `done_when` condition matches, then fetches `/api/result`
- **sync** — `/api/generate` returns complete response immediately. Outputs extracted inline

### Slot-Based State (app.js)

Three slots: `play`, `left`, `right`. Each holds `{ definition, polling, lastSentRequest, lastResponse, abortController }`.

- **Play mode**: Uses `slots.play`, 720px column, single endpoint
- **Compare mode**: Uses `slots.left` + `slots.right`, 1100px column, parallel execution via `Promise.allSettled`

### Definition Schema

Required top-level fields: `schema_version`, `id`, `provider`, `name`, `auth`, `request`, `interaction`, `response`

Key conventions:
- `id` must be lowercase alphanumeric with hyphens (e.g., `deepseek-chat-completions`)
- `auth.env_key` declares the environment variable name for the API key (e.g., `"OPENAI_API_KEY"`) — app.py reads this dynamically
- `auth.validation_url` (optional) is a free GET endpoint requiring auth, used to verify API keys (e.g., `"https://api.openai.com/v1/models"`). Omit only if provider has no free validation endpoint
- `body_path: "_chat_message"` is a special sentinel — proxy.py wraps the value as OpenAI-style `messages` array and enables system prompt injection
- `group: "advanced"` on a param puts it in a collapsible section
- `examples` array is required — each entry needs `label` and `params` covering all required fields
- Param types: `string`, `integer`, `float`, `enum`. UI types: `textarea`, `dropdown`, `slider`, `text`
- Output types: `text`, `image`, `audio`, `video`. Sources: `inline`, `url`, `base64`

### JSONPath (proxy.py)

Custom lightweight implementation supporting: `$.foo.bar` (dot), `$..key` (recursive descent), `$.foo[*].bar` (array wildcard), `$[0]` (index). Used for stream_path, request_id_path, done_when/failed_when paths, and output extraction.

### Adding a New Provider

1. Create `definitions/<provider>/<endpoint>.json` following the schema
2. Include `auth.env_key` with the env var name (e.g., `"env_key": "NEWPROVIDER_API_KEY"`) — app.py reads keys dynamically from definitions, no code changes needed
3. Add the env var to `.env.example`
4. Run `python validate.py` to verify the definition

### Key Files

- `app.py` — Flask routes: `/`, `/api/definitions/<id>`, `/api/generate`, `/api/stream`, `/api/status`, `/api/result`, `/api/bookmarks`, `/api/preview`, `/api/validate-keys`
- `proxy.py` — `build_request()`, `build_curl_string()`, `extract_value()`, `extract_outputs()`, `check_done()`
- `static/app.js` — All client logic: form rendering, streaming/polling dispatch, compare mode, bookmarks, command palette
- `templates/index.html` — Single-page Jinja2 template with Tailwind CSS
- `validate.py` — Definition schema validator (run before committing new definitions)
- `bookmarks.json` — Server-side bookmark persistence (gitignored)
