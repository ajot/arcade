# arcade

A definition-driven AI playground. Test any AI API by dropping in a JSON definition file — no UI code changes needed.

## What it does

Arcade dynamically builds its UI from JSON definition files. Each definition describes an AI endpoint — its auth, parameters, request format, interaction pattern, and output type. Add a new provider by adding a JSON file to the `definitions/` folder; the playground renders the right form, calls the API through a local proxy, and displays the result with the appropriate renderer.

## Features

- **Play mode** — pick any definition, fill in the form, hit Generate
- **Compare mode** — run two definitions side-by-side against the same prompt
- **Streaming, polling, and sync** — three interaction patterns, chosen per-definition
- **Output renderers** — text (with streaming tokens), images, audio, and video
- **System prompt** — inject a system message on any chat-completions endpoint
- **Latency metrics** — time-to-first-token and total duration on every request
- **Log drawer** — expandable panel showing the raw HTTP request/response
- **JSON inspector** — full request and response payloads with redacted auth headers
- **Example prompts** — one-click examples defined per endpoint
- **Advanced params** — collapsible section for sliders (temperature, max tokens, etc.)

## Providers

| Provider | Definitions | Types |
|---|---|---|
| Baseten | 1 | chat |
| Cerebras | 1 | chat |
| DeepInfra | 1 | chat |
| DeepSeek | 1 | chat |
| DigitalOcean | 4 | chat, image, TTS, music |
| Fireworks | 1 | chat |
| Google | 1 | chat |
| Groq | 1 | chat |
| Hugging Face | 1 | chat |
| Mistral | 1 | chat |
| OpenAI | 1 | chat |
| OpenRouter | 3 | chat, image, audio |
| Perplexity | 1 | chat |
| SambaNova | 1 | chat |
| Together | 4 | chat, image, TTS, video |

**15 providers, 23 definitions.**

## Quick start

```bash
git clone https://github.com/ajotwani/model-play.git
cd model-play
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your API keys
python app.py
```

Open [http://localhost:8080](http://localhost:8080).

You only need keys for the providers you want to test. Keys are stored locally in `.env`, sent only to the provider's API through the local proxy, and never persisted or transmitted elsewhere.

## Adding a provider

Create a JSON file in `definitions/<provider>/`. The definition has four sections:

| Section | Purpose |
|---|---|
| `auth` | How to attach the API key (header name, prefix) |
| `request` | URL, method, body template, and parameter definitions |
| `interaction` | Pattern (`streaming`, `polling`, or `sync`) and related config |
| `response` | Output extraction paths and types (`text`, `image`, `audio`, `video`) |

Minimal example — a streaming chat endpoint:

```json
{
  "schema_version": 1,
  "id": "myprovider-chat",
  "provider": "myprovider",
  "name": "MyProvider Chat",
  "auth": {
    "type": "header",
    "header": "Authorization",
    "prefix": "Bearer "
  },
  "request": {
    "method": "POST",
    "url": "https://api.myprovider.com/v1/chat/completions",
    "body_template": { "stream": true },
    "params": [
      {
        "name": "model",
        "type": "enum",
        "options": ["model-a", "model-b"],
        "default": "model-a",
        "ui": "dropdown",
        "required": true
      },
      {
        "name": "prompt",
        "type": "string",
        "ui": "textarea",
        "required": true,
        "body_path": "_chat_message"
      }
    ]
  },
  "interaction": {
    "pattern": "streaming",
    "stream_format": "sse",
    "stream_path": "$.choices[0].delta.content"
  },
  "response": {
    "outputs": [
      { "path": "$.choices[0].message.content", "type": "text" }
    ],
    "error": { "path": "$.error.message" }
  }
}
```

Add the corresponding `MYPROVIDER_API_KEY=` to `.env.example` and the key mapping in `app.py`'s `load_api_keys()`.

## Project structure

```
model-play/
├── app.py                  # Flask app — routes, definition loading, API proxy
├── proxy.py                # Builds HTTP requests from definitions, extracts responses
├── requirements.txt        # flask, requests, python-dotenv, gunicorn
├── .env.example            # API key template (15 providers)
├── definitions/            # One JSON file per endpoint
│   ├── digitalocean/
│   ├── openai/
│   ├── together/
│   ├── groq/
│   ├── ...
│   └── huggingface/
├── templates/
│   └── index.html          # Main page (Jinja2)
├── static/
│   ├── app.js              # Client — polling, streaming, rendering, compare mode
│   └── style.css           # Arcade theme
└── docs/
    └── ARCHITECTURE.md     # Design decisions and schema reference
```

## How it works

1. On startup, Flask walks `definitions/` and loads every JSON file into memory.
2. The page renders a dropdown of all definitions. Picking one fetches its JSON and dynamically builds the form (textareas, dropdowns, sliders) from `request.params`.
3. On Generate, the client posts the definition ID, params, and API key to the Flask proxy. The proxy merges params into `body_template`, attaches auth headers, and forwards the request to the provider.
4. Based on `interaction.pattern`, the response flows back as streamed SSE tokens, polled status checks, or a single JSON payload. The client reads `response.outputs` to pick the right renderer — text, image, audio, or video.
