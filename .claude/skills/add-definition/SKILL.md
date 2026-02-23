---
name: add-definition
description: Generate a new arcade definition file for an AI provider endpoint
user-invocable: true
---

# Add Definition

Generate a new definition JSON file for an AI provider endpoint in this arcade playground.

## Steps

1. **Parse the request** — Identify the provider, endpoint type (chat, image, tts, audio, video, music), and any specific models or filters mentioned.

2. **Check for existing definitions** — Look in `definitions/<provider>/` to see if a definition already exists for this endpoint type. If it does, warn the user before overwriting.

3. **Study existing definitions for patterns** — Read 2-3 existing definition files from `definitions/` that match the same endpoint type the user wants. For example:
   - Chat → look at any `chat-completions.json`
   - Image → look at any `image-generation.json`
   - TTS → look at any `text-to-speech.json`
   - Video → look at any `video-generation.json`
   - Music → look at any `music-generation.json`
   - Audio → look at any `audio-generation.json`

   Use these as reference for the correct structure, interaction pattern, body_template, params, response outputs, and examples.

4. **Gather model information** — If the user wants to discover models from the provider's API:
   - OpenRouter: `curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models`
   - Together: `curl -s -H "Authorization: Bearer $TOGETHER_API_KEY" https://api.together.xyz/v1/models`
   - OpenAI: `curl -s -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models`
   - For other providers, ask the user for the model IDs or check the provider's documentation.

5. **Write the definition file** — Create `definitions/<provider>/<endpoint-type>.json` following the exact patterns from the reference definitions. Key rules:
   - `schema_version` must be `1`
   - `id` must be lowercase alphanumeric with hyphens (e.g., `myprovider-chat-completions`)
   - `auth.env_key` must declare the environment variable name (e.g., `MYPROVIDER_API_KEY`)
   - `auth.type` must be `"header"`
   - `auth.validation_url` should be a free GET endpoint that requires auth (typically `GET <base_url>/models`). Used to verify API keys without cost. Omit only if the provider has no free validation endpoint (e.g., Perplexity)
   - At least one param must have `"required": true`
   - `examples` array must have at least one entry with `label` and `params` covering all required fields
   - Every output needs `path`, `type`, and `source`
   - `response.error` must have a `path`

6. **Validate** — Run `python validate.py definitions/<provider>/<file>.json`. If validation fails, read the errors, fix the definition, and re-validate until it passes.

7. **Update .env.example** — Add the new env var if it's not already listed.

8. **Report** — Tell the user what was created, how many models were included, and remind them to add their API key to `.env`.

## Endpoint Type Reference

| Type | Interaction Pattern | Typical Output |
|------|-------------------|----------------|
| chat | streaming | text/inline |
| image | sync | image/url |
| tts | sync (binary_audio) | audio/url |
| audio | sync | audio/base64 |
| video | polling | video/url |
| music | polling | audio/url |
