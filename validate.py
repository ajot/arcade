#!/usr/bin/env python3
"""Validation harness for arcade definition files."""

import json
import os
import re
import sys

REQUIRED_TOP_LEVEL = [
    "schema_version", "id", "provider", "name", "auth",
    "request", "interaction", "response",
]
VALID_PARAM_TYPES = {"string", "integer", "float", "enum"}
VALID_UI_TYPES = {"textarea", "dropdown", "slider", "text"}
VALID_PATTERNS = {"polling", "streaming", "sync"}
VALID_OUTPUT_TYPES = {"text", "image", "audio", "video"}
VALID_OUTPUT_SOURCES = {"inline", "url", "base64"}


def validate_definition(path):
    """Validate a single definition file. Returns list of error strings."""
    errors = []

    try:
        with open(path) as f:
            defn = json.load(f)
    except json.JSONDecodeError as e:
        return [f"Invalid JSON: {e}"]
    except OSError as e:
        return [f"Cannot read file: {e}"]

    # --- Schema checks ---
    for field in REQUIRED_TOP_LEVEL:
        if field not in defn:
            errors.append(f"Missing required field: {field}")

    if defn.get("schema_version") != 1:
        errors.append("schema_version must be 1")

    did = defn.get("id", "")
    if did and not re.match(r"^[a-z0-9-]+$", did):
        errors.append(f"id '{did}' must be lowercase alphanumeric with hyphens")

    auth = defn.get("auth", {})
    if auth.get("type") != "header":
        errors.append("auth.type must be 'header'")
    if "header" not in auth:
        errors.append("auth.header is required")
    if "env_key" not in auth:
        errors.append("auth.env_key is required")
    validation_url = auth.get("validation_url", "")
    if validation_url and not validation_url.startswith("https://"):
        errors.append("auth.validation_url must start with https://")

    req = defn.get("request", {})
    if "method" not in req:
        errors.append("request.method is required")
    url = req.get("url", "")
    if not url.startswith("https://"):
        errors.append("request.url must start with https://")

    params = req.get("params", [])
    if not params:
        errors.append("request.params must have at least one entry")

    has_required = False
    for p in params:
        pname = p.get("name", "<unnamed>")
        if "name" not in p:
            errors.append("Param missing 'name'")
        if "type" not in p:
            errors.append(f"Param '{pname}' missing 'type'")
        elif p["type"] not in VALID_PARAM_TYPES:
            errors.append(f"Param '{pname}' type '{p['type']}' not in {VALID_PARAM_TYPES}")
        if "ui" not in p:
            errors.append(f"Param '{pname}' missing 'ui'")
        elif p["ui"] not in VALID_UI_TYPES:
            errors.append(f"Param '{pname}' ui '{p['ui']}' not in {VALID_UI_TYPES}")

        if p.get("type") == "enum" and "options" not in p:
            errors.append(f"Param '{pname}' is enum but has no options")
        if p.get("ui") == "slider" and p.get("type") not in ("integer", "float"):
            errors.append(f"Param '{pname}' uses slider but type is '{p.get('type')}' (must be integer or float)")

        if p.get("required"):
            has_required = True

    if not has_required:
        errors.append("At least one param must be required: true")

    # --- Interaction checks ---
    interaction = defn.get("interaction", {})
    pattern = interaction.get("pattern", "")
    if pattern not in VALID_PATTERNS:
        errors.append(f"interaction.pattern '{pattern}' not in {VALID_PATTERNS}")

    if pattern == "polling":
        for field in ["status_url", "result_url", "request_id_path", "poll_interval_ms", "done_when", "failed_when"]:
            if field not in interaction:
                errors.append(f"Polling pattern missing: {field}")
        status_url = interaction.get("status_url", "")
        result_url = interaction.get("result_url", "")
        if status_url and "{request_id}" not in status_url:
            errors.append("status_url must contain {request_id} placeholder")
        if result_url and "{request_id}" not in result_url:
            errors.append("result_url must contain {request_id} placeholder")

        done_when = interaction.get("done_when", {})
        if done_when:
            if "path" not in done_when:
                errors.append("done_when missing 'path'")
            if "equals" not in done_when and "in" not in done_when:
                errors.append("done_when must have 'equals' or 'in'")

        failed_when = interaction.get("failed_when", {})
        if failed_when:
            if "path" not in failed_when:
                errors.append("failed_when missing 'path'")
            if "equals" not in failed_when and "in" not in failed_when:
                errors.append("failed_when must have 'equals' or 'in'")

    if pattern == "streaming":
        if "stream_path" not in interaction:
            errors.append("Streaming pattern missing: stream_path")

    # --- Response checks ---
    response = defn.get("response", {})
    outputs = response.get("outputs", [])
    if not outputs:
        errors.append("response.outputs must have at least one entry")
    for out in outputs:
        if "path" not in out:
            errors.append("Output missing 'path'")
        if "type" not in out:
            errors.append("Output missing 'type'")
        elif out["type"] not in VALID_OUTPUT_TYPES:
            errors.append(f"Output type '{out['type']}' not in {VALID_OUTPUT_TYPES}")
        if "source" not in out:
            errors.append("Output missing 'source'")
        elif out["source"] not in VALID_OUTPUT_SOURCES:
            errors.append(f"Output source '{out['source']}' not in {VALID_OUTPUT_SOURCES}")

    if "error" not in response:
        errors.append("response.error is required")
    elif "path" not in response.get("error", {}):
        errors.append("response.error must have a 'path'")

    # --- Examples checks ---
    examples = defn.get("examples", [])
    if not examples:
        errors.append("examples array must have at least one entry")

    required_param_names = {p["name"] for p in params if p.get("required")}
    for i, ex in enumerate(examples):
        if "label" not in ex:
            errors.append(f"Example {i} missing 'label'")
        if "params" not in ex:
            errors.append(f"Example {i} missing 'params'")
        else:
            for rp in required_param_names:
                if rp not in ex["params"]:
                    errors.append(f"Example '{ex.get('label', i)}' missing required param '{rp}'")

    # --- Cross-reference: body_path checks ---
    body_template = req.get("body_template", {})
    for p in params:
        bp = p.get("body_path", "")
        if not bp or bp.startswith("_"):
            continue
        parts = bp.split(".")
        obj = body_template
        valid = True
        for part in parts[:-1]:
            if isinstance(obj, dict) and part in obj:
                obj = obj[part]
            elif isinstance(obj, list) and part.isdigit() and int(part) < len(obj):
                obj = obj[int(part)]
            else:
                valid = False
                break
        if not valid:
            errors.append(f"Param '{p.get('name')}' body_path '{bp}' references missing intermediate path in body_template")

    return errors


def find_all_definitions(defs_dir):
    """Find all JSON definition files under defs_dir."""
    paths = []
    for root, _dirs, files in os.walk(defs_dir):
        for fname in sorted(files):
            if fname.endswith(".json"):
                paths.append(os.path.join(root, fname))
    paths.sort()
    return paths


def main():
    if len(sys.argv) > 1:
        paths = [sys.argv[1]]
    else:
        defs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "definitions")
        paths = find_all_definitions(defs_dir)

    if not paths:
        print("No definition files found.")
        sys.exit(1)

    total = 0
    passed = 0
    all_ids = {}
    all_errors = []

    for path in paths:
        rel = os.path.relpath(path)
        print(f"Validating {rel}")
        errors = validate_definition(path)

        # Collect ids for cross-definition duplicate check
        try:
            with open(path) as f:
                defn = json.load(f)
            did = defn.get("id", "")
            if did:
                if did in all_ids:
                    errors.append(f"Duplicate id '{did}' (also in {os.path.relpath(all_ids[did])})")
                else:
                    all_ids[did] = path
        except (json.JSONDecodeError, OSError):
            pass

        total += 1
        if errors:
            for e in errors:
                print(f"  \u2717 {e}")
            print(f"  {len(errors)} error(s) found.\n")
            all_errors.extend(errors)
        else:
            print("  \u2713 Schema valid")
            print("  \u2713 Interaction valid")
            print("  \u2713 Response valid")
            print("  \u2713 Examples valid")
            print()
            passed += 1

    print(f"{passed}/{total} definitions valid.")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
