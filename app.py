import base64
import json
import os

import requests as http_requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

from proxy import (
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


def load_api_keys():
    """Load provider API keys from environment variables."""
    key_mappings = {
        "digitalocean": "DIGITALOCEAN_API_KEY",
        "openai": "OPENAI_API_KEY",
        "together": "TOGETHER_API_KEY",
        "groq": "GROQ_API_KEY",
        "fireworks": "FIREWORKS_API_KEY",
        "mistral": "MISTRAL_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "perplexity": "PERPLEXITY_API_KEY",
        "cerebras": "CEREBRAS_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "google": "GOOGLE_API_KEY",
        "sambanova": "SAMBANOVA_API_KEY",
        "deepinfra": "DEEPINFRA_API_KEY",
        "baseten": "BASETEN_API_KEY",
        "huggingface": "HUGGINGFACE_API_KEY",
    }
    for provider, env_var in key_mappings.items():
        val = os.getenv(env_var, "")
        if val:
            API_KEYS[provider] = val


load_api_keys()

# ---------------------------------------------------------------------------
# Definition loading
# ---------------------------------------------------------------------------

DEFINITIONS = {}


def load_definitions():
    """Walk the definitions/ folder and load all JSON files."""
    defs_dir = os.path.join(os.path.dirname(__file__), "definitions")
    for root, _dirs, files in os.walk(defs_dir):
        for fname in files:
            if not fname.endswith(".json"):
                continue
            path = os.path.join(root, fname)
            with open(path) as f:
                defn = json.load(f)
            DEFINITIONS[defn["id"]] = defn


load_definitions()

# ---------------------------------------------------------------------------
# Routes — Pages
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    """Render the main playground page."""
    definitions_list = [
        {
            "id": d["id"],
            "name": d["name"],
            "provider": d["provider"],
            "output_type": d.get("response", {}).get("outputs", [{}])[0].get("type", "text"),
        }
        for d in DEFINITIONS.values()
    ]
    definitions_list.sort(key=lambda d: d["name"])
    return render_template("index.html", definitions=definitions_list, api_keys=API_KEYS)


# ---------------------------------------------------------------------------
# Routes — API
# ---------------------------------------------------------------------------


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
    api_key = data.get("api_key", "")
    params = data.get("params", {})

    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    if not api_key:
        return jsonify({"error": "API key is required"}), 400

    url, headers, body = build_request(defn, params, api_key)

    # Capture the outbound request for the JSON toggle
    sent_request = {
        "method": defn["request"]["method"],
        "url": url,
        "headers": {k: ("***" if "authorization" in k.lower() else v) for k, v in headers.items()},
        "body": body,
    }

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
        return jsonify({"error": str(e), "sent_request": sent_request}), 502
    except ValueError:
        return jsonify({"error": "Non-JSON response from provider", "sent_request": sent_request}), 502

    # For polling patterns, extract the request_id
    interaction = defn.get("interaction", {})
    result = {"sent_request": sent_request, "response": resp_data, "status_code": resp.status_code}

    if interaction.get("pattern") == "polling" and resp.ok:
        rid_path = interaction.get("request_id_path", "$.request_id")
        request_id = extract_value(resp_data, rid_path)
        result["request_id"] = request_id

    # For sync responses, extract typed outputs (images, audio, etc.)
    if resp.ok and interaction.get("pattern") not in ("polling", "streaming"):
        outputs = extract_outputs(defn, resp_data)
        if outputs:
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
    api_key = data.get("api_key", "")
    params = data.get("params", {})

    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    if not api_key:
        return jsonify({"error": "API key is required"}), 400

    url, headers, body = build_request(defn, params, api_key)

    # Capture the outbound request for the JSON toggle
    sent_request = {
        "method": defn["request"]["method"],
        "url": url,
        "headers": {k: ("***" if "authorization" in k.lower() else v) for k, v in headers.items()},
        "body": body,
    }

    stream_path = defn.get("interaction", {}).get("stream_path", "")

    def generate():
        # Send the request info as the first event
        yield f"event: request_info\ndata: {json.dumps(sent_request)}\n\n"

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
                    except (json.JSONDecodeError, Exception):
                        pass

            yield f"event: done\ndata: {{}}\n\n"

        except http_requests.RequestException as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/api/status")
def check_status():
    """Check the status of an async job."""
    definition_id = request.args.get("definition_id")
    api_key = request.args.get("api_key", "")
    request_id = request.args.get("request_id", "")

    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    url = build_status_url(defn, request_id)
    headers = {}
    auth = defn.get("auth", {})
    if auth.get("type") == "header":
        prefix = auth.get("prefix", "")
        headers[auth["header"]] = f"{prefix}{api_key}"

    try:
        resp = http_requests.get(url, headers=headers, timeout=15)
        resp_data = resp.json()
    except (http_requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e), "poll_status": "error"}), 502

    poll_status = check_done(defn, resp_data)
    return jsonify({"poll_status": poll_status, "response": resp_data})


@app.route("/api/result")
def get_result():
    """Fetch the final result of a completed async job."""
    definition_id = request.args.get("definition_id")
    api_key = request.args.get("api_key", "")
    request_id = request.args.get("request_id", "")

    defn = DEFINITIONS.get(definition_id)
    if not defn:
        return jsonify({"error": f"Definition '{definition_id}' not found"}), 404

    url = build_result_url(defn, request_id)
    headers = {}
    auth = defn.get("auth", {})
    if auth.get("type") == "header":
        prefix = auth.get("prefix", "")
        headers[auth["header"]] = f"{prefix}{api_key}"

    try:
        resp = http_requests.get(url, headers=headers, timeout=30)
        resp_data = resp.json()
    except (http_requests.RequestException, ValueError) as e:
        return jsonify({"error": str(e)}), 502

    outputs = extract_outputs(defn, resp_data)
    return jsonify({"response": resp_data, "outputs": outputs})


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
