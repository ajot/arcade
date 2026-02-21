import copy
import re


def build_request(definition, params, api_key):
    """Build an HTTP request from a definition and user-supplied params.

    Returns (url, headers, body) ready to send via requests.
    """
    req = definition["request"]

    # Build headers
    headers = {"Content-Type": req.get("content_type", "application/json")}
    auth = definition.get("auth", {})
    if auth.get("type") == "header":
        prefix = auth.get("prefix", "")
        headers[auth["header"]] = f"{prefix}{api_key}"

    # Merge any static headers from the definition
    for k, v in req.get("headers", {}).items():
        headers[k] = v

    # Build body from template + params
    body = copy.deepcopy(req.get("body_template", {}))
    for param_def in req.get("params", []):
        name = param_def["name"]
        if name not in params:
            continue
        value = params[name]
        # Coerce types
        if param_def.get("type") == "integer":
            value = int(value)
        elif param_def.get("type") == "float":
            value = float(value)

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

    url = req["url"]
    return url, headers, body


def build_status_url(definition, request_id):
    """Build the polling status URL by substituting {request_id}."""
    return definition["interaction"]["status_url"].replace("{request_id}", request_id)


def build_result_url(definition, request_id):
    """Build the result URL by substituting {request_id}."""
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
    """Set a value in a nested dict using dot-separated path."""
    keys = path.split(".")
    for key in keys[:-1]:
        if key not in obj:
            obj[key] = {}
        obj = obj[key]
    obj[keys[-1]] = value


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
