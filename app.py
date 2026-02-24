import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

from proxy import (
    build_auth_headers,
    build_curl_string,
    build_request,
    build_result_url,
    build_status_url,
    check_done,
    extract_error,
    extract_outputs,
    extract_value,
)

load_dotenv()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# API key config from .env
# ---------------------------------------------------------------------------

API_KEYS = {}

# ---------------------------------------------------------------------------
# Definition loading
# ---------------------------------------------------------------------------

DEFINITIONS = {}
PROVIDER_DISPLAY_NAMES = {}


def load_definitions():
    """Walk the definitions/ folder, load all JSON files, and collect API keys."""
    defs_dir = os.path.join(os.path.dirname(__file__), "definitions")
    for root, _dirs, files in os.walk(defs_dir):
        for fname in files:
            if not fname.endswith(".json"):
                continue
            path = os.path.join(root, fname)
            try:
                with open(path) as f:
                    defn = json.load(f)
                DEFINITIONS[defn["id"]] = defn
            except (json.JSONDecodeError, KeyError, OSError) as e:
                print(f"WARNING: skipping {path}: {e}")
                continue

            # Collect provider display name from definition
            provider = defn.get("provider", "")
            if provider and provider not in PROVIDER_DISPLAY_NAMES:
                PROVIDER_DISPLAY_NAMES[provider] = defn.get(
                    "provider_display_name", provider.title()
                )

            # Load API key from auth.env_key (if not already loaded for this provider)
            env_key = defn.get("auth", {}).get("env_key", "")
            if provider and env_key and provider not in API_KEYS:
                val = os.getenv(env_key, "")
                if val:
                    API_KEYS[provider] = val


load_definitions()

# ---------------------------------------------------------------------------
# Routes — Pages
# ---------------------------------------------------------------------------


def provider_display_name(slug):
    """Return display name for a provider slug, falling back to title case."""
    return PROVIDER_DISPLAY_NAMES.get(slug, slug.title())


@app.route("/")
def index():
    """Render the main playground page."""
    definitions_list = []
    for d in DEFINITIONS.values():
        model_param = next(
            (p for p in d.get("request", {}).get("params", []) if p.get("name") == "model"),
            None,
        )
        model_count = len(model_param.get("options", [])) if model_param else 0
        definitions_list.append({
            "id": d["id"],
            "name": d["name"],
            "provider": d["provider"],
            "provider_display_name": provider_display_name(d["provider"]),
            "provider_url": d.get("provider_url", ""),
            "output_type": d.get("response", {}).get("outputs", [{}])[0].get("type", "text"),
            "model_count": model_count,
        })
    definitions_list.sort(key=lambda d: d["name"])
    return render_template(
        "index.html",
        definitions=definitions_list,
        api_keys=list(API_KEYS.keys()),
    )


# ---------------------------------------------------------------------------
# Routes — API
# ---------------------------------------------------------------------------


def get_api_key(definition_id):
    """Look up the API key for a definition's provider, server-side."""
    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return None, None
    return defn, API_KEYS.get(defn["provider"], "")


BOOKMARKS_FILE = os.path.join(os.path.dirname(__file__), "bookmarks.json")


@app.route("/api/bookmarks")
def get_bookmarks():
    """Return saved bookmarks."""
    if not os.path.exists(BOOKMARKS_FILE):
        return jsonify([])
    with open(BOOKMARKS_FILE) as f:
        return jsonify(json.load(f))


@app.route("/api/bookmarks", methods=["POST"])
def save_bookmarks():
    """Overwrite the full bookmarks array."""
    data = request.get_json()
    with open(BOOKMARKS_FILE, "w") as f:
        json.dump(data, f, indent=2)
    return jsonify({"ok": True})


@app.route("/api/preview", methods=["POST"])
def preview():
    """Return a curl command string for the given definition and params."""
    data = request.get_json()
    definition_id = data.get("definition_id")
    params = data.get("params", {})
    include_key = data.get("include_key", False)

    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    api_key = None
    if include_key:
        _, api_key = get_api_key(definition_id)

    try:
        curl = build_curl_string(defn, params, api_key=api_key or None)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({"curl": curl})


@app.route("/api/definitions/<definition_id>")
def get_definition(definition_id):
    """Return the full definition JSON for client-side use."""
    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404
    return jsonify(defn)


@app.route("/api/generate", methods=["POST"])
def generate():
    """Submit a generation request to the provider API."""
    data = request.get_json()
    definition_id = data.get("definition_id")
    params = data.get("params", {})

    defn, api_key = get_api_key(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    if not api_key:
        return jsonify({"error": f"No API key configured for provider '{defn['provider']}'"}), 400

    try:
        url, headers, body = build_request(defn, params, api_key)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # When a streaming definition is called via /api/generate (sync mode),
    # override stream to false so the provider returns a complete response.
    if body and body.get("stream") is True:
        body["stream"] = False

    try:
        resp = http_requests.request(
            method=defn["request"]["method"],
            url=url,
            headers=headers,
            json=body,
            timeout=60,
        )

        # Handle binary audio responses (TTS endpoints return raw audio)
        content_type = resp.headers.get("Content-Type", "")
        if resp.ok and ("audio" in content_type or "octet-stream" in content_type):
            audio_b64 = base64.b64encode(resp.content).decode("utf-8")
            mime = content_type.split(";")[0].strip()
            data_url = f"data:{mime};base64,{audio_b64}"
            resp_data = {"audio_url": data_url}
        else:
            resp_data = resp.json()
    except http_requests.RequestException as e:
        app.logger.error("Generate request failed: %s", e)
        return jsonify({"error": "Upstream request failed"}), 502
    except ValueError:
        return jsonify({"error": "Non-JSON response from provider"}), 502

    # For polling patterns, extract the request_id
    interaction = defn.get("interaction", {})
    result = {"response": resp_data, "status_code": resp.status_code}

    if interaction.get("pattern") == "polling" and resp.ok:
        rid_path = interaction.get("request_id_path", "$.request_id")
        request_id = extract_value(resp_data, rid_path)
        result["request_id"] = request_id

    # For sync responses (including streaming defs called via /api/generate),
    # extract typed outputs (images, audio, etc.)
    if resp.ok and "request_id" not in result:
        outputs = extract_outputs(defn, resp_data)
        if outputs:
            # Convert base64 image/audio values to data URLs for client rendering
            for output_def, output in zip(defn.get("response", {}).get("outputs", []), outputs):
                if output_def.get("source") == "base64" and output["type"] in ("image", "audio"):
                    mime = output_def.get("mime_type", "image/png" if output["type"] == "image" else "audio/wav")
                    output["value"] = [
                        f"data:{mime};base64,{v}" if v and not v.startswith("data:") else v
                        for v in output["value"]
                    ]
            result["outputs"] = outputs

    # Check for provider errors
    if not resp.ok:
        error_msg = extract_error(defn, resp_data) or resp_data
        result["error"] = error_msg

    return jsonify(result), resp.status_code if resp.ok else 502


@app.route("/api/stream", methods=["POST"])
def stream():
    """Proxy a streaming SSE request to the provider and forward chunks."""
    data = request.get_json()
    definition_id = data.get("definition_id")
    params = data.get("params", {})

    defn, api_key = get_api_key(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    if not api_key:
        return jsonify({"error": f"No API key configured for provider '{defn['provider']}'"}), 400

    try:
        url, headers, body = build_request(defn, params, api_key)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    stream_path = defn.get("interaction", {}).get("stream_path", "")

    def generate():
        try:
            resp = http_requests.request(
                method=defn["request"]["method"],
                url=url,
                headers=headers,
                json=body,
                stream=True,
                timeout=60,
            )

            if not resp.ok:
                error_data = resp.text
                try:
                    error_json = resp.json()
                    error_msg = extract_error(defn, error_json) or error_data
                except ValueError:
                    error_msg = error_data
                yield f"event: error\ndata: {json.dumps({'error': str(error_msg)})}\n\n"
                return

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if line.startswith("data: "):
                    chunk_str = line[6:]
                    if chunk_str.strip() == "[DONE]":
                        yield f"event: done\ndata: {{}}\n\n"
                        return
                    try:
                        chunk = json.loads(chunk_str)
                        # Extract the token using stream_path
                        token = extract_value(chunk, stream_path) if stream_path else ""
                        if token:
                            yield f"data: {json.dumps({'token': token})}\n\n"
                    except (json.JSONDecodeError, KeyError, TypeError, IndexError):
                        pass

            yield f"event: done\ndata: {{}}\n\n"

        except http_requests.RequestException as e:
            app.logger.error("Stream request failed: %s", e)
            yield f"event: error\ndata: {json.dumps({'error': 'Upstream request failed'})}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/api/status")
def check_status():
    """Check the status of an async job."""
    definition_id = request.args.get("definition_id")
    request_id = request.args.get("request_id", "")

    defn, api_key = get_api_key(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    try:
        url = build_status_url(defn, request_id)
    except ValueError:
        return jsonify({"error": "Invalid request_id", "poll_status": "error"}), 400

    headers = build_auth_headers(defn, api_key)

    try:
        resp = http_requests.get(url, headers=headers, timeout=15)
        resp_data = resp.json()
    except (http_requests.RequestException, ValueError) as e:
        app.logger.error("Status check failed: %s", e)
        return jsonify({"error": "Upstream request failed", "poll_status": "error"}), 502

    poll_status = check_done(defn, resp_data)
    return jsonify({"poll_status": poll_status, "response": resp_data})


@app.route("/api/result")
def get_result():
    """Fetch the final result of a completed async job."""
    definition_id = request.args.get("definition_id")
    request_id = request.args.get("request_id", "")

    defn, api_key = get_api_key(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    try:
        url = build_result_url(defn, request_id)
    except ValueError:
        return jsonify({"error": "Invalid request_id"}), 400

    headers = build_auth_headers(defn, api_key)

    try:
        resp = http_requests.get(url, headers=headers, timeout=30)
        resp_data = resp.json()
    except (http_requests.RequestException, ValueError) as e:
        app.logger.error("Result fetch failed: %s", e)
        return jsonify({"error": "Upstream request failed"}), 502

    outputs = extract_outputs(defn, resp_data)
    return jsonify({"response": resp_data, "outputs": outputs})


# ---------------------------------------------------------------------------
# Routes — Key validation
# ---------------------------------------------------------------------------


def _validate_provider(provider, api_key, auth_info):
    """Validate a single provider's API key. Returns (provider, status)."""
    validation_url = auth_info.get("validation_url")
    if not validation_url:
        return provider, "unknown"
    headers = {
        auth_info.get("header", "Authorization"): auth_info.get("prefix", "Bearer ") + api_key
    }
    try:
        resp = http_requests.get(validation_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            return provider, "valid"
        elif resp.status_code in (401, 403):
            return provider, "invalid"
        else:
            return provider, "unknown"
    except http_requests.RequestException:
        return provider, "unknown"


@app.route("/api/validate-keys")
def validate_keys():
    """Validate all configured API keys by hitting each provider's validation_url."""
    # Collect unique providers that have keys and validation URLs
    to_validate = {}
    for defn in DEFINITIONS.values():
        provider = defn.get("provider", "")
        if provider in to_validate or provider not in API_KEYS:
            continue
        auth = defn.get("auth", {})
        if auth.get("validation_url"):
            to_validate[provider] = auth

    results = {}

    # Mark providers with no key
    all_providers = {d["provider"] for d in DEFINITIONS.values()}
    for p in all_providers:
        if p not in API_KEYS:
            results[p] = "no_key"

    # Validate in parallel
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(_validate_provider, provider, API_KEYS[provider], auth): provider
            for provider, auth in to_validate.items()
        }
        for future in as_completed(futures):
            provider, status = future.result()
            results[provider] = status

    # Providers with keys but no validation_url
    for p in API_KEYS:
        if p not in results:
            results[p] = "unknown"

    return jsonify(results)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
