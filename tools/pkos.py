"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
  python -m tools.pkos gen-queue [--objects objects --review review]
  python -m tools.pkos gen-digest [--objects-dir objects --output-dir digests --week YYYY-Www]
  python -m tools.pkos gen-flow [--objects-dir objects --review-dir review --state-dir state --runtime-flow-dir runtime/flow]
  python -m tools.pkos export-agent-context [--objects-dir objects --review-dir review --digests-dir digests --state-dir state --runtime-flow-dir runtime/flow --output runtime/agent_context.json]
  python -m tools.pkos inbox-append --capture-type note --content "..."
  python -m tools.pkos state-append --energy low --mood anxious --body chest_tight
  python -m tools.pkos paths [--json]
  python -m tools.pkos doctor [--json]
  python -m tools.pkos export-site-data [--profile current|demo] [--objects-dir objects --review-dir review --digests-dir digests --private-out site-private/_pkos --runtime-out runtime/site-private/_pkos]
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from tools.digest.gen_digest import run_gen_digest
from tools.flow_hub.append_logs import (
    BODY_VALUES,
    CAPTURE_TYPES,
    CONTEXT_VALUES,
    ENERGY_VALUES,
    INBOX_SOURCES,
    INBOX_STATUSES,
    MODE_VALUES,
    MOOD_VALUES,
    RISK_VALUES,
    STATE_SOURCES,
    append_inbox_item,
    append_state_snapshot,
    build_inbox_item,
    build_state_snapshot,
    parse_metadata,
    parse_tags,
    run_inbox_append,
    run_state_append,
)
from tools.flow_hub.flow import build_agent_context, run_export_agent_context, run_gen_flow, write_json
from tools.pkos_paths import (
    display_data_path,
    get_core_root,
    get_data_root,
    get_data_root_source,
    resolve_core_path,
    resolve_data_path,
)
from tools.queue_gen.gen_queue import run_gen_queue
from tools.site_export.export_site_data import run_export_site_data
from tools.validators.validate import run_validation

SCHEMA_VERSION = "0.5-alpha"
COMMAND_NAMES = {
    "validate",
    "gen-queue",
    "gen-digest",
    "gen-flow",
    "export-agent-context",
    "inbox-append",
    "state-append",
    "paths",
    "doctor",
    "serve",
    "export-site-data",
}


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def _paths_payload(data_root_source: str) -> dict:
    core_root = get_core_root()
    data_root = get_data_root()
    return {
        "schema_version": SCHEMA_VERSION,
        "core_root": core_root.as_posix(),
        "data_root": data_root.as_posix(),
        "data_root_source": data_root_source,
        "paths": {
            "objects": resolve_data_path("objects").as_posix(),
            "review": resolve_data_path("review").as_posix(),
            "digests": resolve_data_path("digests").as_posix(),
            "inbox": resolve_data_path("inbox").as_posix(),
            "state": resolve_data_path("state").as_posix(),
            "runtime": resolve_data_path("runtime").as_posix(),
            "agent_context": resolve_data_path("runtime", "agent_context.json").as_posix(),
        },
    }


def _print_paths_text(payload: dict) -> None:
    print(f"core_root: {payload['core_root']}")
    print(f"data_root: {payload['data_root']}")
    print(f"data_root_source: {payload['data_root_source']}")
    paths = payload["paths"]
    print(f"objects_path: {paths['objects']}")
    print(f"review_path: {paths['review']}")
    print(f"digests_path: {paths['digests']}")
    print(f"inbox_path: {paths['inbox']}")
    print(f"state_path: {paths['state']}")
    print(f"runtime_path: {paths['runtime']}")
    print(f"agent_context_path: {paths['agent_context']}")


def _check(checks: list[dict], name: str, ok: bool, severity: str, message: str) -> None:
    checks.append({"name": name, "ok": ok, "severity": severity, "message": message})


def _dir_createable(path: Path) -> bool:
    if path.exists():
        return path.is_dir()
    parent = path.parent
    return parent.exists() and parent.is_dir()


def _doctor_payload(data_root_source: str) -> dict:
    checks: list[dict] = []
    core_root = get_core_root()
    data_root = get_data_root()

    core_has_tools = (core_root / "tools").is_dir()
    core_has_readme = (core_root / "README.md").is_file()
    _check(
        checks,
        "core_root_has_tools",
        core_has_tools,
        "info" if core_has_tools else "error",
        "core root contains tools/",
    )
    _check(
        checks,
        "core_root_has_readme",
        core_has_readme,
        "info" if core_has_readme else "error",
        "core root contains README.md",
    )
    _check(
        checks,
        "data_root_exists",
        data_root.exists(),
        "info" if data_root.exists() else "warning",
        "data root exists" if data_root.exists() else "data root does not exist yet",
    )

    for name, part in [
        ("inbox_createable", "inbox"),
        ("state_createable", "state"),
        ("runtime_createable", "runtime"),
        ("runtime_flow_createable", "runtime/flow"),
    ]:
        target = resolve_data_path(part)
        _check(
            checks,
            name,
            _dir_createable(target),
            "info" if _dir_createable(target) else "warning",
            f"{part} can be used or created",
        )

    _check(
        checks,
        "objects_exists",
        resolve_data_path("objects").is_dir(),
        "info" if resolve_data_path("objects").is_dir() else "warning",
        "objects/ exists in data root",
    )
    _check(
        checks,
        "review_exists",
        resolve_data_path("review").is_dir(),
        "info" if resolve_data_path("review").is_dir() else "warning",
        "review/ exists in data root",
    )

    gitignore_path = core_root / ".gitignore"
    gitignore_text = gitignore_path.read_text(encoding="utf-8") if gitignore_path.exists() else ""
    required_ignore_rules = [
        "/runtime/agent_context.json",
        "/runtime/flow/*.json",
        "/inbox/*.jsonl",
        "/state/*.jsonl",
    ]
    ignore_ok = all(rule in gitignore_text for rule in required_ignore_rules)
    _check(
        checks,
        "gitignore_runtime_logs",
        ignore_ok,
        "info" if ignore_ok else "warning",
        "runtime, inbox, and state derived files are ignored",
    )

    publish_absent = "publish-check" not in COMMAND_NAMES
    _check(
        checks,
        "publish_check_absent",
        publish_absent,
        "info" if publish_absent else "error",
        "publish-check is absent from CLI command registry",
    )

    external = data_root.resolve() != core_root.resolve()
    _check(
        checks,
        "external_vault_mode",
        True,
        "info",
        "external vault mode" if external else "data root is the core root",
    )

    ok = not any((not item["ok"]) and item["severity"] == "error" for item in checks)
    return {
        "schema_version": SCHEMA_VERSION,
        "ok": ok,
        "core_root": core_root.as_posix(),
        "data_root": data_root.as_posix(),
        "data_root_source": data_root_source,
        "checks": checks,
    }


def _print_doctor_text(payload: dict) -> None:
    print(f"ok: {str(payload['ok']).lower()}")
    print(f"core_root: {payload['core_root']}")
    print(f"data_root: {payload['data_root']}")
    print(f"data_root_source: {payload['data_root_source']}")
    for item in payload["checks"]:
        status = "ok" if item["ok"] else "not_ok"
        print(f"{status} [{item['severity']}] {item['name']}: {item['message']}")


def _json_error(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


def _append_json_payload(item: dict, path: Path) -> dict:
    return {
        "ok": True,
        "type": item["type"],
        "id": item["id"],
        "path": display_data_path(path),
        "data_root": get_data_root().as_posix(),
        "created_at": item["created_at"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(prog="pkos", description="PKOS utility commands")
    parser.add_argument("--data-root", default=None, help="Override PKOS_DATA_ROOT for this command")
    subparsers = parser.add_subparsers(dest="command", required=True)

    paths_parser = subparsers.add_parser("paths", help="Show PKOS core/data paths")
    paths_parser.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    doctor_parser = subparsers.add_parser("doctor", help="Check PKOS core/data path readiness")
    doctor_parser.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    validate_parser = subparsers.add_parser("validate", help="Validate PKOS objects")
    validate_parser.add_argument("--path", default="objects", help="Path to validate")
    validate_parser.add_argument("--schema-dir", default="tools/schema", help="Schema directory")

    queue_parser = subparsers.add_parser("gen-queue", help="Generate SRS queues")
    queue_parser.add_argument("--objects", default="objects", help="Objects root directory")
    queue_parser.add_argument("--review", default="review", help="Review output directory")

    digest_parser = subparsers.add_parser("gen-digest", help="Generate weekly digest")
    digest_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    digest_parser.add_argument("--output-dir", default="digests", help="Digest output directory")
    digest_parser.add_argument("--week", default=None, help="ISO week: YYYY-Www")

    flow_parser = subparsers.add_parser("gen-flow", help="Generate Flow Hub runtime JSON")
    flow_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    flow_parser.add_argument("--review-dir", default="review", help="Review directory")
    flow_parser.add_argument("--state-dir", default="state", help="State snapshots directory")
    flow_parser.add_argument("--runtime-flow-dir", default="runtime/flow", help="Flow runtime output directory")

    context_parser = subparsers.add_parser("export-agent-context", help="Export bounded Moonlolo Agent Context Pack")
    context_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    context_parser.add_argument("--review-dir", default="review", help="Review directory")
    context_parser.add_argument("--digests-dir", default="digests", help="Digests directory")
    context_parser.add_argument("--state-dir", default="state", help="State snapshots directory")
    context_parser.add_argument("--runtime-flow-dir", default="runtime/flow", help="Flow runtime input directory")
    context_parser.add_argument("--output", default="runtime/agent_context.json", help="Agent context output path")
    context_parser.add_argument(
        "--print",
        "--stdout",
        action="store_true",
        dest="print_json",
        help="Also print the bounded context JSON to stdout without human-readable text",
    )

    inbox_parser = subparsers.add_parser("inbox-append", help="Append an Inbox item")
    inbox_parser.add_argument("--capture-type", required=True, choices=sorted(CAPTURE_TYPES))
    inbox_parser.add_argument("--content", required=True)
    inbox_parser.add_argument("--source", default="manual", choices=sorted(INBOX_SOURCES))
    inbox_parser.add_argument("--status", default="unprocessed", choices=sorted(INBOX_STATUSES))
    inbox_parser.add_argument("--tags", default="")
    inbox_parser.add_argument("--metadata-json", default=None)
    inbox_parser.add_argument("--inbox-path", default="inbox/items.jsonl")
    inbox_parser.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    state_parser = subparsers.add_parser("state-append", help="Append a Current State snapshot")
    state_parser.add_argument("--energy", required=True, choices=sorted(ENERGY_VALUES))
    state_parser.add_argument("--mood", required=True, choices=sorted(MOOD_VALUES))
    state_parser.add_argument("--body", required=True, choices=sorted(BODY_VALUES))
    state_parser.add_argument("--context", default="unknown", choices=sorted(CONTEXT_VALUES))
    state_parser.add_argument("--mode", default="unknown", choices=sorted(MODE_VALUES))
    state_parser.add_argument("--risk-short-video", default="unknown", choices=sorted(RISK_VALUES))
    state_parser.add_argument("--risk-rumination", default="unknown", choices=sorted(RISK_VALUES))
    state_parser.add_argument("--risk-overload", default="unknown", choices=sorted(RISK_VALUES))
    state_parser.add_argument("--source", default="manual", choices=sorted(STATE_SOURCES))
    state_parser.add_argument("--note", default=None)
    state_parser.add_argument("--state-path", default="state/snapshots.jsonl")
    state_parser.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    serve_parser = subparsers.add_parser("serve", help="Run local backend API")
    serve_parser.add_argument("--port", type=int, default=8787, help="Server port (localhost only)")

    export_parser = subparsers.add_parser("export-site-data", help="Export static-site data")
    export_parser.add_argument(
        "--profile",
        choices=["current", "demo"],
        default="current",
        help="Export current authority files or the bundled demo dataset",
    )
    export_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    export_parser.add_argument("--review-dir", default="review", help="Review directory")
    export_parser.add_argument("--digests-dir", default="digests", help="Digests directory")
    export_parser.add_argument("--private-out", default="site-private/_pkos", help="Private site data output")
    export_parser.add_argument("--runtime-out", default="runtime/site-private/_pkos", help="Runtime private site data output")

    args = parser.parse_args()

    data_root_source = get_data_root_source(args.data_root)

    if args.data_root:
        os.environ["PKOS_DATA_ROOT"] = str(Path(args.data_root))

    if args.command == "paths":
        payload = _paths_payload(data_root_source)
        if args.json_output:
            _print_json(payload)
        else:
            _print_paths_text(payload)
        return 0

    if args.command == "doctor":
        payload = _doctor_payload(data_root_source)
        if args.json_output:
            _print_json(payload)
        else:
            _print_doctor_text(payload)
        return 0 if payload["ok"] else 1

    if args.command == "validate":
        return run_validation(resolve_data_path(args.path), resolve_core_path(args.schema_dir))

    if args.command == "gen-queue":
        return run_gen_queue(resolve_data_path(args.objects), resolve_data_path(args.review))

    if args.command == "gen-digest":
        return run_gen_digest(resolve_data_path(args.objects_dir), resolve_data_path(args.output_dir), args.week)

    if args.command == "gen-flow":
        return run_gen_flow(
            resolve_data_path(args.objects_dir),
            resolve_data_path(args.review_dir),
            resolve_data_path(args.state_dir),
            resolve_data_path(args.runtime_flow_dir),
        )

    if args.command == "export-agent-context":
        if args.print_json:
            context = build_agent_context(
                resolve_data_path(args.objects_dir),
                resolve_data_path(args.review_dir),
                resolve_data_path(args.digests_dir),
                resolve_data_path(args.state_dir),
                resolve_data_path(args.runtime_flow_dir),
            )
            write_json(resolve_data_path(args.output), context)
            _print_json(context)
            return 0
        return run_export_agent_context(
            resolve_data_path(args.objects_dir),
            resolve_data_path(args.review_dir),
            resolve_data_path(args.digests_dir),
            resolve_data_path(args.state_dir),
            resolve_data_path(args.runtime_flow_dir),
            resolve_data_path(args.output),
        )

    if args.command == "inbox-append":
        try:
            metadata = parse_metadata(args.metadata_json)
        except ValueError as exc:
            if args.json_output:
                _print_json(_json_error("INVALID_METADATA_JSON", str(exc)))
                return 2
            print(f"ERROR: {exc}")
            return 2
        try:
            if args.json_output:
                inbox_path = resolve_data_path(args.inbox_path)
                item = build_inbox_item(
                    args.capture_type,
                    args.content,
                    args.source,
                    args.status,
                    parse_tags(args.tags),
                    metadata,
                )
                append_inbox_item(inbox_path, item)
                _print_json(_append_json_payload(item, inbox_path))
                return 0
            return run_inbox_append(
                resolve_data_path(args.inbox_path),
                args.capture_type,
                args.content,
                args.source,
                args.status,
                parse_tags(args.tags),
                metadata,
            )
        except ValueError as exc:
            if args.json_output:
                _print_json(_json_error("INVALID_INBOX_ITEM", str(exc)))
                return 2
            print(f"ERROR: {exc}")
            return 2

    if args.command == "state-append":
        try:
            if args.json_output:
                state_path = resolve_data_path(args.state_path)
                item = build_state_snapshot(
                    args.energy,
                    args.mood,
                    args.body,
                    args.context,
                    args.mode,
                    args.risk_short_video,
                    args.risk_rumination,
                    args.risk_overload,
                    args.source,
                    args.note,
                )
                append_state_snapshot(state_path, item)
                _print_json(_append_json_payload(item, state_path))
                return 0
            return run_state_append(
                resolve_data_path(args.state_path),
                args.energy,
                args.mood,
                args.body,
                args.context,
                args.mode,
                args.risk_short_video,
                args.risk_rumination,
                args.risk_overload,
                args.source,
                args.note,
            )
        except ValueError as exc:
            if args.json_output:
                _print_json(_json_error("INVALID_STATE_SNAPSHOT", str(exc)))
                return 2
            print(f"ERROR: {exc}")
            return 2

    if args.command == "export-site-data":
        if args.profile == "demo":
            args.objects_dir = "demo/objects"
            args.review_dir = "demo/review"
            args.digests_dir = "demo/digests"
        return run_export_site_data(
            resolve_data_path(args.objects_dir) if args.profile != "demo" else resolve_core_path(args.objects_dir),
            resolve_data_path(args.review_dir) if args.profile != "demo" else resolve_core_path(args.review_dir),
            resolve_data_path(args.digests_dir) if args.profile != "demo" else resolve_core_path(args.digests_dir),
            resolve_core_path(args.private_out),
            resolve_data_path(args.runtime_out),
        )

    if args.command == "serve":
        from tools.server.main import main as run_server_main
        import sys
        sys.argv = ["pkos-serve", "--port", str(args.port)]
        return run_server_main()

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
