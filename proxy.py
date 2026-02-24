import copy
import json
import re


def build_auth_headers(definition, api_key):
    """Build authentication headers from a definition's auth config."""
    headers = {}
    auth = definition.get("auth", {})
    if auth.get("type") == "header":
        prefix = auth.get("prefix", "")
        headers[auth["header"]] = f"{prefix}{api_key}"
    return headers


def build_curl_string(definition, params, api_key_placeholder="<API_KEY>"):
    """Build a curl command string from a definition and params.

    Uses build_request() internally but replaces the real API key with a
    placeholder so no secrets leak into the UI.
    """
    url, headers, body = build_request(definition, params, api_key="PLACEHOLDER")

    # Replace the placeholder API key in auth headers
    auth = definition.get("auth", {})
    if auth.get("type") == "header":
        header_name = auth["header"]
        prefix = auth.get("prefix", "")
        headers[header_name] = f"{prefix}{api_key_placeholder}"

    method = definition["request"].get("method", "POST").upper()
    parts = [f"curl -X {method} '{_escape_single_quotes(url)}'"]
    for key, value in headers.items():
        parts.append(f"  -H '{_escape_single_quotes(key)}: {_escape_single_quotes(value)}'")
    if body:
        parts.append(f"  -d '{_escape_single_quotes(json.dumps(body, indent=2))}'")
    return " \\\n".join(parts)


def _escape_single_quotes(s):
    """Escape single quotes for safe use inside single-quoted shell strings."""
    return str(s).replace("'", "'\\''")



def build_request(definition, params, api_key):
    """Build an HTTP request from a definition and user-supplied params.

    Returns (url, headers, body) ready to send via requests.
    """
    req = definition["request"]

    # Build headers
    headers = {"Content-Type": req.get("content_type", "application/json")}
    headers.update(build_auth_headers(definition, api_key))

    # Merge any static headers from the definition
    for k, v in req.get("headers", {}).items():
        headers[k] = v

    # Build body from template + params
    body = copy.deepcopy(req.get("body_template", {}))
    for param_def in req.get("params", []):
        name = param_def["name"]
        if name not in params:
            continue
        # url_path params are substituted into the URL, not the body
        if param_def.get("url_path"):
            continue
        value = params[name]
        # Coerce types
        try:
            if param_def.get("type") == "integer":
                value = int(value)
            elif param_def.get("type") == "float":
                value = float(value)
        except (ValueError, TypeError):
            raise ValueError(f"Parameter '{name}' expects {param_def.get('type')}, got '{value}'")

        body_path = param_def.get("body_path")
        if body_path == "_chat_message":
            # Special handling: wrap as OpenAI-style messages array
            body["messages"] = [{"role": "user", "content": value}]
        elif body_path:
            _set_nested(body, body_path, value)
        else:
            body[name] = value

    # System prompt injection
    system_prompt = params.get("_system_prompt", "")
    body.pop("_system_prompt", None)
    if "messages" in body and system_prompt:
        body["messages"].insert(0, {"role": "system", "content": system_prompt})

    # Substitute url_path params into the URL template (e.g. {model})
    url = req["url"]
    for param_def in req.get("params", []):
        if param_def.get("url_path"):
            name = param_def["name"]
            if name in params:
                url = url.replace(f"{{{name}}}", str(params[name]))
    return url, headers, body


def _validate_request_id(request_id):
    """Validate that request_id contains only safe characters."""
    if not re.match(r'^[a-zA-Z0-9_\-]+$', request_id):
        raise ValueError(f"Invalid request_id: {request_id}")


def build_status_url(definition, request_id):
    """Build the polling status URL by substituting {request_id}."""
    _validate_request_id(request_id)
    return definition["interaction"]["status_url"].replace("{request_id}", request_id)


def build_result_url(definition, request_id):
    """Build the result URL by substituting {request_id}."""
    _validate_request_id(request_id)
    return definition["interaction"]["result_url"].replace("{request_id}", request_id)


def check_done(definition, status_response):
    """Check if a polling response indicates completion or failure.

    Returns: "done", "failed", or "pending"
    """
    interaction = definition["interaction"]

    done_when = interaction.get("done_when", {})
    if done_when:
        val = extract_value(status_response, done_when["path"])
        if "equals" in done_when and val == done_when["equals"]:
            return "done"
        if "in" in done_when and val in done_when["in"]:
            return "done"

    failed_when = interaction.get("failed_when", {})
    if failed_when:
        val = extract_value(status_response, failed_when["path"])
        if "equals" in failed_when and val == failed_when["equals"]:
            return "failed"
        if "in" in failed_when and val in failed_when["in"]:
            return "failed"

    return "pending"


def extract_value(data, path):
    """Simple JSONPath extraction.

    Supports:
      $.foo.bar       - dot notation
      $..key          - recursive descent (returns first match)
      $.foo[*].bar    - array wildcard
    """
    if not path or not data:
        return None

    # Remove leading $
    path = path.lstrip("$")

    # Recursive descent: $..key
    if path.startswith(".."):
        key = path[2:].split(".")[0].split("[")[0]
        return _recursive_find(data, key)

    # Dot notation with optional array wildcards
    parts = _parse_path_parts(path)
    return _walk(data, parts)


def extract_error(definition, response_data):
    """Extract error message from a response using the definition's error path."""
    error_conf = definition.get("response", {}).get("error", {})
    if not error_conf:
        return None
    return extract_value(response_data, error_conf.get("path", ""))


def extract_outputs(definition, response_data):
    """Extract output values from a response using the definition's output paths.

    Returns a list of dicts: [{type, source, value, downloadable}, ...]
    """
    outputs = []
    for output_def in definition.get("response", {}).get("outputs", []):
        value = extract_value(response_data, output_def.get("path", ""))
        if value is not None:
            outputs.append({
                "type": output_def.get("type", "text"),
                "source": output_def.get("source", "url"),
                "value": value if isinstance(value, list) else [value],
                "downloadable": output_def.get("downloadable", False),
            })
    return outputs


# --- Internal helpers ---

def _set_nested(obj, path, value):
    """Set a value in a nested dict/list using dot-separated path.

    Numeric segments are treated as list indices (e.g. 'instances.0.prompt').
    """
    keys = path.split(".")
    for key in keys[:-1]:
        if key.isdigit():
            obj = obj[int(key)]
        else:
            if key not in obj:
                obj[key] = {}
            obj = obj[key]
    final = keys[-1]
    if final.isdigit():
        obj[int(final)] = value
    else:
        obj[final] = value


def _recursive_find(data, key):
    """Recursively search for a key in nested dicts/lists. Returns first match."""
    if isinstance(data, dict):
        if key in data:
            return data[key]
        for v in data.values():
            result = _recursive_find(v, key)
            if result is not None:
                return result
    elif isinstance(data, list):
        # Collect all matches from list items
        results = []
        for item in data:
            result = _recursive_find(item, key)
            if result is not None:
                if isinstance(result, list):
                    results.extend(result)
                else:
                    results.append(result)
        return results if results else None
    return None


def _parse_path_parts(path):
    """Parse a JSONPath into parts, handling dots and [*]."""
    parts = []
    for segment in path.strip(".").split("."):
        if not segment:
            continue
        # Handle foo[*] or foo[0]
        match = re.match(r"^(\w+)\[(\*|\d+)\]$", segment)
        if match:
            parts.append(match.group(1))
            parts.append(f"[{match.group(2)}]")
        else:
            parts.append(segment)
    return parts


def _walk(data, parts):
    """Walk a data structure following parsed path parts."""
    current = data
    for part in parts:
        if current is None:
            return None
        if part == "[*]":
            if isinstance(current, list):
                remaining = parts[parts.index(part) + 1:]
                return [_walk(item, remaining) for item in current if item is not None]
            return None
        elif part.startswith("[") and part.endswith("]"):
            idx = int(part[1:-1])
            if isinstance(current, list) and idx < len(current):
                current = current[idx]
            else:
                return None
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current
