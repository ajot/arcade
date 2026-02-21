# arcade - Decisions

> Log the decisions you make as you build.
> Created 2026-02-20 with [mint-cli](https://github.com/ajotwani/mint-cli)

---

### 001 — JSON definition files as the core abstraction
**Date:** 2026-02-20
**Decision:** Each AI endpoint is described by a single JSON definition file that drives both the UI rendering and the backend API call.
**Why:** Makes the system deterministic, debuggable, versionable, and shareable. The AI introspection idea (having an LLM figure out APIs at runtime) was considered but rejected as a runtime dependency — too non-deterministic. Instead, AI can be a one-time authoring tool to help *write* definitions, but the system runs off the saved JSON files.
**Alternatives considered:** OpenAPI specs (too API-focused, no UI hints), pre-built provider adapters (doesn't scale), runtime AI introspection (unreliable).

---

### 002 — Simple `show_when` for conditional params
**Date:** 2026-02-20
**Decision:** Conditional param visibility uses three operators: `equals`, `in`, `not`. One param can depend on one other param. No nesting, no chaining.
**Why:** Covers 90% of real cases. A full rule engine or JSONLogic DSL would be harder to author, harder for AI to generate, and harder to debug. For APIs complex enough to need chained conditionals, split them into separate endpoint definitions instead.
**Alternatives considered:** Show everything (too cluttered), full dependency graph / JSON Schema `if/then` (over-engineered), JSONLogic subset (too complex for definition authors).

---

### 003 — `body_template` + `body_path` for nested request bodies
**Date:** 2026-02-20
**Decision:** The definition includes a `body_template` (the fixed structure of the request body) and each param has a `body_path` (where to inject the value). No `body_path` = top-level key.
**Why:** Keeps params as a flat list in the definition (easy to render as a form) while supporting arbitrarily nested API bodies. Avoids requiring definition authors to think about JSON nesting.

---

### 004 — Backend proxy (Flask serves everything)
**Date:** 2026-02-20
**Decision:** Flask serves the frontend HTML/JS/CSS *and* proxies all API calls. One process, one port.
**Why:** Most AI providers don't set CORS headers for browser requests. A frontend-only app would break for any provider that blocks CORS — which is most of them (OpenAI, Anthropic, DigitalOcean, etc.). Since we need a backend proxy anyway, having Flask serve the frontend too eliminates the two-process dev setup. Run `python app.py`, open `localhost:8080`, done.
**Alternatives considered:**
- Frontend-only (no backend) — blocked by CORS on most providers. Would limit the tool to whichever providers happen to allow browser requests. Opposite of "universal."
- Separate React SPA + Flask API — two processes to run, CORS config between them, more moving parts. The dynamic form rendering doesn't need React; server-rendered templates with a sprinkle of JS work fine.
- Full-stack TypeScript (Node/Fastify) — valid but doesn't match existing skill set (Python preference).

---

### 005 — Server-rendered forms with Jinja, JS for interactivity
**Date:** 2026-02-20
**Decision:** Flask + Jinja templates render the forms server-side from definition files. JavaScript handles polling, output rendering, and interactive bits (collapsing sections, JSON toggle).
**Why:** The "dynamic UI" is really just "render different form fields based on a config." That doesn't require a React SPA with a build step. The server already has the definition file — let it render the HTML. JS handles the parts that genuinely need client-side interactivity (polling status, displaying images/audio, streaming text).
**Alternatives considered:** React SPA — more complex, slower to build, requires separate build tooling. The definition files work identically regardless of whether the server or client reads them.

---

### 006 — MVP includes raw JSON toggle and error handling
**Date:** 2026-02-20
**Decision:** Raw JSON request/response viewer and basic error parsing are in MVP scope, not deferred.
**Why:** Counselors review (4-agent architecture review) unanimously flagged these as essential. Raw JSON is in the original vision (WHY.md) and is the clearest differentiator from a generic form builder. Error handling without a `response.error` section means the UI can't distinguish a successful response from a failed one.

---

### 007 — Add `response.error` and `source` field to schema from day one
**Date:** 2026-02-20
**Decision:** The definition schema includes:
- `response.error` with a JSONPath for extracting error messages
- `source` field on outputs (`url`, `base64`, `binary`) to handle different response formats
- `schema_version` field for future migration

**Why:** Without `response.error`, the UI can't parse API errors. Without `source`, the system only handles URL-based outputs — breaks for OpenAI (base64 images), binary audio responses, etc. Adding these now prevents a schema redesign post-MVP.

---

### 008 — Consider FastAPI for streaming, start with Flask for MVP
**Date:** 2026-02-20
**Decision:** Build MVP with Flask. Plan to evaluate FastAPI before adding streaming/SSE support.
**Why:** Flask is familiar and sufficient for the polling-only MVP. But Flask is synchronous by default — proxying SSE streams and managing concurrent polling loops will require async support. FastAPI is async-native and handles SSE natively. Worth switching before the streaming phase rather than bolting async onto Flask.

---

### 009 — Rename to "arcade"
**Date:** 2026-02-20
**Decision:** Rename the project from "model-play" to "arcade."
**Why:** One word, memorable, captures the core experience — each definition is a different machine in the arcade, you insert your token (API key), and play. Evokes playful experimentation with many options. Philosophically aligned: the product is a collection of self-contained experiences (definitions) under one roof.

---

### 010 — Definition authoring: copy-paste over CLI tooling
**Date:** 2026-02-20
**Decision:** No CLI generator tool. Create definitions by hand — copy the closest existing definition and modify it. Contributors can use any AI chat to help adapt definitions for new providers.
**Why:** Counselors review (4 agents, unanimous) concluded the bottleneck is *knowing what to put in each field*, not *producing JSON*. Definitions are 50-80 lines of JSON. For OpenAI-compatible providers, only 3 fields change (URL, models, name) — a 2-minute copy-paste job. Building a 300-line CLI to save 2 minutes per provider is over-engineering. The definition format is simple enough that copy-paste + AI assistance in any chat window IS the workflow. A dedicated generator tool may never be needed.
**Alternatives considered:** OpenAPI parser (misses 70% of fields), AI-powered CLI generator (`arcade define` — considered and rejected as premature; the format is too small to justify dedicated tooling), hybrid parser+AI (two systems to maintain for no real gain).

---
