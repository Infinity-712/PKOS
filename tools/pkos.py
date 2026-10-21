"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
  python -m tools.pkos gen-queue [--objects objects --review review]
  python -m tools.pkos gen-digest [--objects-dir objects --output-dir digests --week YYYY-Www]
  python -m tools.pkos gen-flow [--objects-dir objects --review-dir review --state-dir state --tasks-dir tasks --runtime-flow-dir runtime/flow]
  python -m tools.pkos export-agent-context [--profile default|moonlolo] [--objects-dir objects --review-dir review --digests-dir digests --state-dir state --runtime-flow-dir runtime/flow --output runtime/agent_context.json]
  python -m tools.pkos inbox-append --capture-type note --content "..."
  python -m tools.pkos inbox-review list [--json]
  python -m tools.pkos inbox-review mark --id <inbox_id> --status archived --reason "reviewed"
  python -m tools.pkos review-queue [--json]
  python -m tools.pkos review-rate --object-id <id> --rating 4 --reviewed-at <iso> --actor human --request-id <id> --json
  python -m tools.pkos state-list [--json]
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
import sys

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
from tools.flow_hub.flow import (
    build_agent_context,
    build_moonlolo_agent_context,
    run_export_agent_context,
    run_export_moonlolo_agent_context,
    run_gen_flow,
    write_json,
)
from tools.flow_hub.state_list import StateListError, build_state_list_view
from tools.inbox_review.review import (
    ALLOWED_STATUSES as INBOX_REVIEW_STATUSES,
    content_excerpt,
    run_list as run_inbox_review_list,
    run_mark as run_inbox_review_mark,
)
from tools.object_flow import (
    ObjectFlowError,
    run_create as run_object_create,
    run_delete as run_object_delete,
    run_delete_preflight as run_object_delete_preflight,
    run_get as run_object_get,
    run_list as run_object_list,
    run_rebuild as run_object_rebuild,
    run_render as run_object_render,
    run_type_contracts as run_object_type_contracts,
    run_update as run_object_update,
)
from tools.reminder_flow.reminders import (
    STATUSES as REMINDER_STATUSES,
    ReminderFlowError,
    normalize_remind_at,
    rebuild_current_view as rebuild_reminder_current_view,
    rebuild_due_view as rebuild_reminder_due_view,
    run_action as run_reminder_action,
    run_create as run_reminder_create,
    run_get as run_reminder_get,
    run_list as run_reminder_list,
)
from tools.review_flow.review import (
    ReviewFlowError,
    run_correct as run_review_correct,
    run_get as run_review_get,
    run_history as run_review_history,
    run_queue as run_review_queue,
    run_rate as run_review_rate,
    run_rate_batch as run_review_rate_batch,
    run_rebuild as run_review_rebuild,
    run_status as run_review_status,
)
from tools.task_flow.tasks import (
    PRIORITIES as TASK_PRIORITIES,
    STATUSES as TASK_STATUSES,
    TaskFlowError,
    normalize_due_at,
    parse_tags as parse_task_tags,
    rebuild_current_view as rebuild_task_current_view,
    run_create as run_task_create,
    run_list as run_task_list,
    run_transition as run_task_transition,
)
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
    "inbox-review",
    "review-list",
    "review-get",
    "review-rate",
    "review-rate-batch",
    "review-history",
    "review-rebuild",
    "review-queue",
    "review-correct",
    "review-status",
    "object-types",
    "object-list",
    "object-get",
    "object-render",
    "object-create",
    "object-update",
    "object-delete-preflight",
    "object-delete",
    "object-rebuild",
    "task-create",
    "task-list",
    "task-transition",
    "task-rebuild",
    "reminder-create",
    "reminder-list",
    "reminder-get",
    "reminder-acknowledge",
    "reminder-cancel",
    "reminder-reschedule",
    "reminder-rebuild",
    "reminder-due",
    "state-list",
    "state-append",
    "paths",
    "doctor",
    "serve",
    "export-site-data",
}


def _configure_stdio_for_cli() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


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


def _print_inbox_review_list(view: dict) -> None:
    print(f"generated_at: {view['generated_at']}")
    print(f"count: {view['count']}")
    if not view["items"]:
        print("_No inbox items._")
        return
    print("id | status | source | capture_type | created_at | content")
    print("---|---|---|---|---|---")
    for item in view["items"]:
        print(
            " | ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("effective_status") or ""),
                    str(item.get("source") or ""),
                    str(item.get("capture_type") or ""),
                    str(item.get("created_at") or ""),
                    content_excerpt(str(item.get("content") or "")),
                ]
            )
        )


def main() -> int:
    _configure_stdio_for_cli()
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
    flow_parser.add_argument("--tasks-dir", default="tasks", help="Formal tasks authority directory")
    flow_parser.add_argument("--reminders-dir", default="reminders", help="Reminder authority directory")
    flow_parser.add_argument("--runtime-flow-dir", default="runtime/flow", help="Flow runtime output directory")

    context_parser = subparsers.add_parser("export-agent-context", help="Export bounded Moonlolo Agent Context Pack")
    context_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    context_parser.add_argument("--review-dir", default="review", help="Review directory")
    context_parser.add_argument("--digests-dir", default="digests", help="Digests directory")
    context_parser.add_argument("--state-dir", default="state", help="State snapshots directory")
    context_parser.add_argument("--runtime-flow-dir", default="runtime/flow", help="Flow runtime input directory")
    context_parser.add_argument("--output", default="runtime/agent_context.json", help="Agent context output path")
    context_parser.add_argument(
        "--profile",
        choices=["default", "moonlolo"],
        default="default",
        help="Context profile to export",
    )
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

    inbox_review_parser = subparsers.add_parser("inbox-review", help="Review append-only Inbox captures")
    inbox_review_subparsers = inbox_review_parser.add_subparsers(dest="inbox_review_command", required=True)
    inbox_review_list = inbox_review_subparsers.add_parser("list", help="List inbox items with effective review status")
    inbox_review_list.add_argument("--status", choices=sorted(INBOX_REVIEW_STATUSES), default=None)
    inbox_review_list.add_argument("--source", default=None)
    inbox_review_list.add_argument("--tag", default=None)
    inbox_review_list.add_argument("--limit", type=int, default=None)
    inbox_review_list.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")
    inbox_review_list.add_argument("--inbox-path", default="inbox/items.jsonl")
    inbox_review_list.add_argument("--actions-path", default="review/logs/inbox_review_actions.jsonl")
    inbox_review_list.add_argument("--runtime-path", default="runtime/inbox_review/current.json")

    inbox_review_mark = inbox_review_subparsers.add_parser("mark", help="Append an inbox review status action")
    inbox_review_mark.add_argument("--id", required=True, dest="inbox_id")
    inbox_review_mark.add_argument("--status", required=True, choices=sorted(INBOX_REVIEW_STATUSES))
    inbox_review_mark.add_argument("--reason", required=True)
    inbox_review_mark.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")
    inbox_review_mark.add_argument("--inbox-path", default="inbox/items.jsonl")
    inbox_review_mark.add_argument("--actions-path", default="review/logs/inbox_review_actions.jsonl")
    inbox_review_mark.add_argument("--runtime-path", default="runtime/inbox_review/current.json")

    review_common_paths = {
        "--objects-dir": {"default": "objects", "help": "Objects authority directory"},
        "--review-dir": {"default": "review", "help": "Review authority directory"},
        "--current-path": {"default": "runtime/review/current.json", "help": "Review current projection path"},
        "--queue-path": {"default": "runtime/review/queue.json", "help": "Review queue projection path"},
    }

    review_rebuild = subparsers.add_parser("review-rebuild", help="Rebuild Review/SRS runtime projections")
    review_rebuild.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_rebuild.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_rebuild.add_argument("--current-path", **review_common_paths["--current-path"])
    review_rebuild.add_argument("--queue-path", **review_common_paths["--queue-path"])
    review_rebuild.add_argument("--now", default=None)
    review_rebuild.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    for command_name, help_text in [
        ("review-queue", "List due/upcoming Review/SRS queue"),
        ("review-list", "Alias for Review/SRS queue listing"),
    ]:
        review_queue = subparsers.add_parser(command_name, help=help_text)
        review_queue.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
        review_queue.add_argument("--review-dir", **review_common_paths["--review-dir"])
        review_queue.add_argument("--current-path", **review_common_paths["--current-path"])
        review_queue.add_argument("--queue-path", **review_common_paths["--queue-path"])
        review_queue.add_argument("--now", default=None)
        review_queue.add_argument("--limit", type=int, default=None)
        review_queue.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_get = subparsers.add_parser("review-get", help="Get one Review/SRS current item")
    review_get.add_argument("--object-id", required=True)
    review_get.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_get.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_get.add_argument("--now", default=None)
    review_get.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_history = subparsers.add_parser("review-history", help="Show one object's review history")
    review_history.add_argument("--object-id", required=True)
    review_history.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_history.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_history.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_status = subparsers.add_parser("review-status", help="Show bounded Review/SRS status counts")
    review_status.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_status.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_status.add_argument("--now", default=None)
    review_status.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_rate = subparsers.add_parser("review-rate", help="Append one Review/SRS rating event")
    review_rate.add_argument("--object-id", required=True)
    review_rate.add_argument("--rating", required=True, type=int)
    review_rate.add_argument("--reviewed-at", required=True)
    review_rate.add_argument("--actor", required=True)
    review_rate.add_argument("--request-id", required=True)
    review_rate.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_rate.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_rate.add_argument("--current-path", **review_common_paths["--current-path"])
    review_rate.add_argument("--queue-path", **review_common_paths["--queue-path"])
    review_rate.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_rate_batch = subparsers.add_parser("review-rate-batch", help="Append deterministic partial Review/SRS rating batch")
    review_rate_batch.add_argument("--items-json", required=True, help="JSON array of {objectId,rating} items")
    review_rate_batch.add_argument("--reviewed-at", required=True)
    review_rate_batch.add_argument("--actor", required=True)
    review_rate_batch.add_argument("--request-id", required=True)
    review_rate_batch.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_rate_batch.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_rate_batch.add_argument("--current-path", **review_common_paths["--current-path"])
    review_rate_batch.add_argument("--queue-path", **review_common_paths["--queue-path"])
    review_rate_batch.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    review_correct = subparsers.add_parser("review-correct", help="Append a Review/SRS correction event")
    review_correct.add_argument("--target-event-id", required=True)
    review_correct.add_argument("--corrected-rating", type=int, default=None)
    review_correct.add_argument("--reason", required=True)
    review_correct.add_argument("--actor", required=True)
    review_correct.add_argument("--request-id", required=True)
    review_correct.add_argument("--created-at", default=None)
    review_correct.add_argument("--objects-dir", **review_common_paths["--objects-dir"])
    review_correct.add_argument("--review-dir", **review_common_paths["--review-dir"])
    review_correct.add_argument("--current-path", **review_common_paths["--current-path"])
    review_correct.add_argument("--queue-path", **review_common_paths["--queue-path"])
    review_correct.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_common_paths = {
        "--objects-dir": {"default": "objects", "help": "Objects authority directory"},
        "--review-dir": {"default": "review", "help": "Review authority directory"},
        "--schema-dir": {"default": "tools/schema", "help": "Core object schema directory"},
        "--index-path": {"default": "runtime/objects/index.json", "help": "Object runtime index projection path"},
        "--current-path": {"default": "runtime/review/current.json", "help": "Review current projection path"},
        "--queue-path": {"default": "runtime/review/queue.json", "help": "Review queue projection path"},
    }

    object_types = subparsers.add_parser("object-types", help="Show supported object form contracts")
    object_types.add_argument("--schema-dir", **object_common_paths["--schema-dir"])
    object_types.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_list = subparsers.add_parser("object-list", help="List PKOS authority objects")
    object_list.add_argument("--type", default=None, dest="object_type")
    object_list.add_argument("--status", default=None)
    object_list.add_argument("--q", default=None)
    object_list.add_argument("--limit", type=int, default=None)
    object_list.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_list.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_list.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_get = subparsers.add_parser("object-get", help="Get one PKOS authority object")
    object_get.add_argument("--object-id", required=True)
    object_get.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_get.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_get.add_argument("--schema-dir", **object_common_paths["--schema-dir"])
    object_get.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_render = subparsers.add_parser("object-render", help="Render one PKOS object body and sections")
    object_render.add_argument("--object-id", required=True)
    object_render.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_render.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_render.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_create = subparsers.add_parser("object-create", help="Create one PKOS authority object with Git commit")
    object_create.add_argument("--payload-json", required=True)
    object_create.add_argument("--actor", required=True)
    object_create.add_argument("--request-id", required=True)
    object_create.add_argument("--confirmed", action="store_true")
    object_create.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_create.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_create.add_argument("--schema-dir", **object_common_paths["--schema-dir"])
    object_create.add_argument("--index-path", **object_common_paths["--index-path"])
    object_create.add_argument("--current-path", **object_common_paths["--current-path"])
    object_create.add_argument("--queue-path", **object_common_paths["--queue-path"])
    object_create.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_update = subparsers.add_parser("object-update", help="Update editable PKOS object fields with baseRevision")
    object_update.add_argument("--object-id", required=True)
    object_update.add_argument("--patch-json", required=True)
    object_update.add_argument("--base-revision", required=True)
    object_update.add_argument("--actor", required=True)
    object_update.add_argument("--request-id", required=True)
    object_update.add_argument("--confirmed", action="store_true")
    object_update.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_update.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_update.add_argument("--schema-dir", **object_common_paths["--schema-dir"])
    object_update.add_argument("--index-path", **object_common_paths["--index-path"])
    object_update.add_argument("--current-path", **object_common_paths["--current-path"])
    object_update.add_argument("--queue-path", **object_common_paths["--queue-path"])
    object_update.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_delete_preflight = subparsers.add_parser("object-delete-preflight", help="Scan object references before hard delete")
    object_delete_preflight.add_argument("--object-id", required=True)
    object_delete_preflight.add_argument("--base-revision", default=None)
    object_delete_preflight.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_delete_preflight.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_delete_preflight.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_delete = subparsers.add_parser("object-delete", help="Hard delete one PKOS object with tombstone and Git commit")
    object_delete.add_argument("--object-id", required=True)
    object_delete.add_argument("--typed-object-id", required=True)
    object_delete.add_argument("--base-revision", required=True)
    object_delete.add_argument("--reason", required=True)
    object_delete.add_argument("--actor", required=True)
    object_delete.add_argument("--request-id", required=True)
    object_delete.add_argument("--confirmed", action="store_true")
    object_delete.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_delete.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_delete.add_argument("--index-path", **object_common_paths["--index-path"])
    object_delete.add_argument("--current-path", **object_common_paths["--current-path"])
    object_delete.add_argument("--queue-path", **object_common_paths["--queue-path"])
    object_delete.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    object_rebuild = subparsers.add_parser("object-rebuild", help="Rebuild object runtime index projection")
    object_rebuild.add_argument("--objects-dir", **object_common_paths["--objects-dir"])
    object_rebuild.add_argument("--review-dir", **object_common_paths["--review-dir"])
    object_rebuild.add_argument("--index-path", **object_common_paths["--index-path"])
    object_rebuild.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    task_create = subparsers.add_parser("task-create", help="Append a formal Task creation record")
    task_create.add_argument("--title", required=True)
    task_create.add_argument("--description", default=None)
    task_create.add_argument("--source", default="manual")
    task_create.add_argument("--tags", default="")
    task_create.add_argument("--priority", default="normal", choices=sorted(TASK_PRIORITIES))
    task_create.add_argument("--due-at", default=None)
    task_create.add_argument("--created-by", default="human")
    task_create.add_argument("--request-id", default=None)
    task_create.add_argument("--items-path", default="tasks/items.jsonl")
    task_create.add_argument("--actions-path", default="tasks/actions.jsonl")
    task_create.add_argument("--runtime-path", default="runtime/tasks/current.json")
    task_create.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    task_list = subparsers.add_parser("task-list", help="List formal Tasks from the rebuilt current view")
    task_list.add_argument("--status", choices=sorted(TASK_STATUSES), default=None)
    task_list.add_argument("--priority", choices=sorted(TASK_PRIORITIES), default=None)
    task_list.add_argument("--tag", default=None)
    task_list.add_argument("--limit", type=int, default=None)
    task_list.add_argument("--items-path", default="tasks/items.jsonl")
    task_list.add_argument("--actions-path", default="tasks/actions.jsonl")
    task_list.add_argument("--runtime-path", default="runtime/tasks/current.json")
    task_list.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    task_transition = subparsers.add_parser("task-transition", help="Append a formal Task status transition")
    task_transition.add_argument("--task-id", required=True)
    task_transition.add_argument("--target-status", required=True, choices=sorted(TASK_STATUSES))
    task_transition.add_argument("--reason", required=True)
    task_transition.add_argument("--created-by", default="human")
    task_transition.add_argument("--request-id", default=None)
    task_transition.add_argument("--items-path", default="tasks/items.jsonl")
    task_transition.add_argument("--actions-path", default="tasks/actions.jsonl")
    task_transition.add_argument("--runtime-path", default="runtime/tasks/current.json")
    task_transition.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    task_rebuild = subparsers.add_parser("task-rebuild", help="Rebuild formal Task runtime current view")
    task_rebuild.add_argument("--items-path", default="tasks/items.jsonl")
    task_rebuild.add_argument("--actions-path", default="tasks/actions.jsonl")
    task_rebuild.add_argument("--runtime-path", default="runtime/tasks/current.json")
    task_rebuild.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_create = subparsers.add_parser("reminder-create", help="Append a one-shot Reminder creation record")
    reminder_create.add_argument("--title", required=True)
    reminder_create.add_argument("--description", default=None)
    reminder_create.add_argument("--remind-at", required=True)
    reminder_create.add_argument("--task-id", default=None)
    reminder_create.add_argument("--source", default="manual")
    reminder_create.add_argument("--created-by", default="human")
    reminder_create.add_argument("--request-id", default=None)
    reminder_create.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_create.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_create.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_create.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_create.add_argument("--task-items-path", default="tasks/items.jsonl")
    reminder_create.add_argument("--task-actions-path", default="tasks/actions.jsonl")
    reminder_create.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_list = subparsers.add_parser("reminder-list", help="List reminders from the rebuilt current view")
    reminder_list.add_argument("--status", choices=sorted(REMINDER_STATUSES), default=None)
    reminder_list.add_argument("--task-id", default=None)
    reminder_list.add_argument("--limit", type=int, default=None)
    reminder_list.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_list.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_list.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_list.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_list.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_get = subparsers.add_parser("reminder-get", help="Get one reminder from the rebuilt current view")
    reminder_get.add_argument("--id", required=True, dest="reminder_id")
    reminder_get.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_get.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_get.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_get.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_get.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_ack = subparsers.add_parser("reminder-acknowledge", help="Append a Reminder acknowledged action")
    reminder_ack.add_argument("--id", required=True, dest="reminder_id")
    reminder_ack.add_argument("--reason", required=True)
    reminder_ack.add_argument("--created-by", default="human")
    reminder_ack.add_argument("--request-id", default=None)
    reminder_ack.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_ack.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_ack.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_ack.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_ack.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_cancel = subparsers.add_parser("reminder-cancel", help="Append a Reminder cancelled action")
    reminder_cancel.add_argument("--id", required=True, dest="reminder_id")
    reminder_cancel.add_argument("--reason", required=True)
    reminder_cancel.add_argument("--created-by", default="human")
    reminder_cancel.add_argument("--request-id", default=None)
    reminder_cancel.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_cancel.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_cancel.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_cancel.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_cancel.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_reschedule = subparsers.add_parser("reminder-reschedule", help="Append a Reminder rescheduled action")
    reminder_reschedule.add_argument("--id", required=True, dest="reminder_id")
    reminder_reschedule.add_argument("--remind-at", required=True)
    reminder_reschedule.add_argument("--reason", required=True)
    reminder_reschedule.add_argument("--created-by", default="human")
    reminder_reschedule.add_argument("--request-id", default=None)
    reminder_reschedule.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_reschedule.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_reschedule.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_reschedule.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_reschedule.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_rebuild = subparsers.add_parser("reminder-rebuild", help="Rebuild Reminder runtime views")
    reminder_rebuild.add_argument("--now", default=None)
    reminder_rebuild.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_rebuild.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_rebuild.add_argument("--current-path", default="runtime/reminders/current.json")
    reminder_rebuild.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_rebuild.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    reminder_due = subparsers.add_parser("reminder-due", help="List due reminders without mutating authority")
    reminder_due.add_argument("--now", default=None)
    reminder_due.add_argument("--limit", type=int, default=100)
    reminder_due.add_argument("--items-path", default="reminders/items.jsonl")
    reminder_due.add_argument("--actions-path", default="reminders/actions.jsonl")
    reminder_due.add_argument("--due-path", default="runtime/reminders/due.json")
    reminder_due.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

    state_list_parser = subparsers.add_parser("state-list", help="List append-only Current State snapshots")
    state_list_parser.add_argument("--limit", type=int, default=None)
    state_list_parser.add_argument("--energy", default=None)
    state_list_parser.add_argument("--mood", default=None)
    state_list_parser.add_argument("--mode", default=None)
    state_list_parser.add_argument("--state-path", default="state/snapshots.jsonl")
    state_list_parser.add_argument("--json", action="store_true", dest="json_output", help="Print machine-readable JSON")

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

    serve_parser = subparsers.add_parser("serve", help="Run legacy local backend API [legacy read-only]")
    serve_parser.add_argument("--port", type=int, default=8787, help="Legacy read-only server port (localhost only)")

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
            resolve_data_path(args.tasks_dir),
            resolve_data_path(args.reminders_dir),
        )

    if args.command == "export-agent-context":
        if args.profile == "moonlolo":
            inbox_path = resolve_data_path("inbox", "items.jsonl")
            inbox_review_actions_path = resolve_data_path(args.review_dir, "logs", "inbox_review_actions.jsonl")
            if args.print_json:
                context = build_moonlolo_agent_context(
                    resolve_data_path(args.state_dir),
                    inbox_path,
                    inbox_review_actions_path,
                )
                write_json(resolve_data_path(args.output), context)
                _print_json(context)
                return 0
            return run_export_moonlolo_agent_context(
                resolve_data_path(args.state_dir),
                inbox_path,
                inbox_review_actions_path,
                resolve_data_path(args.output),
            )

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

    if args.command == "inbox-review":
        inbox_path = resolve_data_path(args.inbox_path)
        actions_path = resolve_data_path(args.actions_path)
        runtime_path = resolve_data_path(args.runtime_path)
        if args.inbox_review_command == "list":
            try:
                view = run_inbox_review_list(
                    inbox_path,
                    actions_path,
                    runtime_path,
                    args.status,
                    args.source,
                    args.tag,
                    args.limit,
                )
            except ValueError as exc:
                if args.json_output:
                    _print_json(_json_error("INVALID_INBOX_REVIEW_LIST", str(exc)))
                    return 2
                print(f"ERROR: {exc}")
                return 2
            if args.json_output:
                _print_json(view)
            else:
                _print_inbox_review_list(view)
            return 0

        if args.inbox_review_command == "mark":
            try:
                payload = run_inbox_review_mark(
                    inbox_path,
                    actions_path,
                    runtime_path,
                    args.inbox_id,
                    args.status,
                    args.reason,
                )
            except KeyError as exc:
                message = str(exc).strip("'")
                if args.json_output:
                    _print_json(_json_error("INBOX_ID_NOT_FOUND", message))
                    return 1
                print(f"ERROR: {message}")
                return 1
            except ValueError as exc:
                if args.json_output:
                    _print_json(_json_error("INVALID_INBOX_REVIEW_ACTION", str(exc)))
                    return 2
                print(f"ERROR: {exc}")
                return 2
            if args.json_output:
                _print_json(payload)
            else:
                item = payload.get("item") or {}
                print(f"marked: {args.inbox_id} -> {args.status}")
                print(f"action: {payload['action']['id']}")
                print(f"runtime: {display_data_path(runtime_path)}")
                if item:
                    print(f"effective_status: {item.get('effective_status')}")
            return 0

    if args.command in {
        "object-types",
        "object-list",
        "object-get",
        "object-render",
        "object-create",
        "object-update",
        "object-delete-preflight",
        "object-delete",
        "object-rebuild",
    }:
        try:
            objects_dir = resolve_data_path(args.objects_dir) if hasattr(args, "objects_dir") else resolve_data_path("objects")
            review_dir = resolve_data_path(args.review_dir) if hasattr(args, "review_dir") else resolve_data_path("review")
            schema_dir = resolve_core_path(args.schema_dir) if hasattr(args, "schema_dir") else resolve_core_path("tools/schema")
            index_path = resolve_data_path(args.index_path) if hasattr(args, "index_path") else resolve_data_path("runtime/objects/index.json")
            current_path = resolve_data_path(args.current_path) if hasattr(args, "current_path") else resolve_data_path("runtime/review/current.json")
            queue_path = resolve_data_path(args.queue_path) if hasattr(args, "queue_path") else resolve_data_path("runtime/review/queue.json")

            if args.command == "object-types":
                payload = run_object_type_contracts(schema_dir)
            elif args.command == "object-list":
                payload = run_object_list(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    object_type=args.object_type,
                    status=args.status,
                    q=args.q,
                    limit=args.limit,
                )
            elif args.command == "object-get":
                payload = run_object_get(get_data_root(), objects_dir, review_dir, schema_dir, args.object_id)
            elif args.command == "object-render":
                payload = run_object_render(get_data_root(), objects_dir, review_dir, args.object_id)
            elif args.command == "object-rebuild":
                payload = run_object_rebuild(get_data_root(), objects_dir, review_dir, index_path)
            elif args.command == "object-create":
                try:
                    object_payload = json.loads(args.payload_json)
                except json.JSONDecodeError as exc:
                    raise ObjectFlowError("invalid_json", f"payload-json must be valid JSON: {exc.msg}") from exc
                if not isinstance(object_payload, dict):
                    raise ObjectFlowError("invalid_json", "payload-json must be a JSON object")
                payload = run_object_create(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    schema_dir,
                    index_path,
                    current_path,
                    queue_path,
                    payload=object_payload,
                    actor=args.actor,
                    request_id=args.request_id,
                    confirmed=args.confirmed,
                )
            elif args.command == "object-update":
                try:
                    patch_payload = json.loads(args.patch_json)
                except json.JSONDecodeError as exc:
                    raise ObjectFlowError("invalid_json", f"patch-json must be valid JSON: {exc.msg}") from exc
                if not isinstance(patch_payload, dict):
                    raise ObjectFlowError("invalid_json", "patch-json must be a JSON object")
                payload = run_object_update(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    schema_dir,
                    index_path,
                    current_path,
                    queue_path,
                    object_id=args.object_id,
                    patch=patch_payload,
                    base_revision=args.base_revision,
                    actor=args.actor,
                    request_id=args.request_id,
                    confirmed=args.confirmed,
                )
            elif args.command == "object-delete-preflight":
                payload = run_object_delete_preflight(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    object_id=args.object_id,
                    base_revision=args.base_revision,
                )
            else:
                payload = run_object_delete(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    index_path,
                    current_path,
                    queue_path,
                    object_id=args.object_id,
                    typed_object_id=args.typed_object_id,
                    base_revision=args.base_revision,
                    reason=args.reason,
                    actor=args.actor,
                    request_id=args.request_id,
                    confirmed=args.confirmed,
                )
        except ObjectFlowError as exc:
            if args.json_output:
                _print_json(_json_error(exc.code, exc.message))
                return 1
            print(f"ERROR [{exc.code}]: {exc.message}")
            return 1

        if args.json_output:
            _print_json(payload)
        elif args.command == "object-list":
            print(f"count: {payload['count']}")
            for item in payload["items"]:
                print(f"{item['id']} | {item['type']} | {item['status']} | {item['title']}")
        elif args.command == "object-types":
            for item in payload["types"]:
                print(f"{item['type']}: {', '.join(item['statusEnum'])}")
        elif args.command == "object-render":
            print(payload.get("body", ""))
        else:
            print(f"{payload.get('status', 'ok')}: {payload.get('objectId', '')}")
        return 0

    if args.command in {
        "review-rebuild",
        "review-queue",
        "review-list",
        "review-get",
        "review-rate",
        "review-rate-batch",
        "review-history",
        "review-correct",
        "review-status",
    }:
        objects_dir = resolve_data_path(args.objects_dir)
        review_dir = resolve_data_path(args.review_dir)
        current_path = resolve_data_path(args.current_path) if hasattr(args, "current_path") else resolve_data_path("runtime/review/current.json")
        queue_path = resolve_data_path(args.queue_path) if hasattr(args, "queue_path") else resolve_data_path("runtime/review/queue.json")
        try:
            if args.command == "review-rebuild":
                payload = run_review_rebuild(objects_dir, review_dir, current_path, queue_path, now=args.now, data_root=get_data_root())
            elif args.command in {"review-queue", "review-list"}:
                payload = run_review_queue(objects_dir, review_dir, current_path, queue_path, now=args.now, limit=args.limit, data_root=get_data_root())
            elif args.command == "review-get":
                payload = run_review_get(objects_dir, review_dir, args.object_id, now=args.now)
            elif args.command == "review-history":
                payload = run_review_history(objects_dir, review_dir, args.object_id)
            elif args.command == "review-status":
                payload = run_review_status(objects_dir, review_dir, now=args.now)
            elif args.command == "review-rate":
                payload = run_review_rate(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    current_path,
                    queue_path,
                    object_id=args.object_id,
                    rating=args.rating,
                    reviewed_at=args.reviewed_at,
                    actor=args.actor,
                    request_id=args.request_id,
                )
            elif args.command == "review-rate-batch":
                try:
                    items = json.loads(args.items_json)
                except json.JSONDecodeError as exc:
                    raise ReviewFlowError("invalid_items_json", f"items-json must be valid JSON: {exc.msg}") from exc
                if not isinstance(items, list):
                    raise ReviewFlowError("invalid_items_json", "items-json must be a JSON array")
                payload = run_review_rate_batch(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    current_path,
                    queue_path,
                    items=items,
                    reviewed_at=args.reviewed_at,
                    actor=args.actor,
                    request_id=args.request_id,
                )
            else:
                payload = run_review_correct(
                    get_data_root(),
                    objects_dir,
                    review_dir,
                    current_path,
                    queue_path,
                    target_event_id=args.target_event_id,
                    corrected_rating=args.corrected_rating,
                    reason=args.reason,
                    actor=args.actor,
                    request_id=args.request_id,
                    created_at=args.created_at,
                )
        except ReviewFlowError as exc:
            if args.json_output:
                _print_json(_json_error(exc.code, exc.message))
                return 1
            print(f"ERROR [{exc.code}]: {exc.message}")
            return 1

        if args.json_output:
            _print_json(payload)
        elif args.command in {"review-queue", "review-list"}:
            print(f"evaluated_at: {payload['evaluatedAt']}")
            print(f"due: {payload['counts']['due']}")
            for item in payload["due"]:
                print(f"{item['objectId']} | {item['objectType']} | {item['dueAt']} | {item['title']}")
        elif args.command == "review-history":
            print(f"count: {payload['count']}")
            for event in payload["events"]:
                print(f"{event.get('id')} | {event.get('type')} | {event.get('rating', event.get('correctedRating', ''))}")
        elif args.command == "review-get":
            item = payload["item"]
            print(f"{item['objectId']} | {item['objectType']} | due {item['dueAt']}")
        elif args.command == "review-status":
            print(f"due: {payload['counts']['due']}")
            print(f"overdue: {payload['counts']['overdue']}")
            print(f"upcoming: {payload['counts']['upcoming']}")
        else:
            event = payload.get("event") or {}
            print(f"{payload.get('status')}: {event.get('id')}")
        return 0

    if args.command in {"task-create", "task-list", "task-transition", "task-rebuild"}:
        items_path = resolve_data_path(args.items_path)
        actions_path = resolve_data_path(args.actions_path)
        runtime_path = resolve_data_path(args.runtime_path)
        try:
            if args.command == "task-create":
                payload = run_task_create(
                    items_path,
                    actions_path,
                    runtime_path,
                    args.title,
                    args.description,
                    args.source,
                    parse_task_tags(args.tags),
                    args.priority,
                    normalize_due_at(args.due_at),
                    args.created_by,
                    args.request_id,
                )
            elif args.command == "task-list":
                payload = run_task_list(
                    items_path,
                    actions_path,
                    runtime_path,
                    args.status,
                    args.priority,
                    args.tag,
                    args.limit,
                )
            elif args.command == "task-transition":
                payload = run_task_transition(
                    items_path,
                    actions_path,
                    runtime_path,
                    args.task_id,
                    args.target_status,
                    args.reason,
                    args.created_by,
                    args.request_id,
                )
            else:
                payload = rebuild_task_current_view(items_path, actions_path, runtime_path)
                payload = {"ok": True, "status": "rebuilt", **payload}
        except TaskFlowError as exc:
            if args.json_output:
                _print_json(_json_error(exc.code, exc.message))
                return 1
            print(f"ERROR [{exc.code}]: {exc.message}")
            return 1

        if args.json_output:
            _print_json(payload)
        elif args.command == "task-list":
            print(f"count: {payload['count']}")
            for item in payload["items"]:
                print(f"{item['id']} | {item['status']} | {item['priority']} | {item['title']}")
        elif args.command == "task-rebuild":
            print(f"rebuilt: {display_data_path(runtime_path)}")
            print(f"count: {payload['count']}")
        else:
            task = payload.get("task") or {}
            print(f"{payload.get('status')}: {task.get('id')}")
        return 0

    if args.command in {
        "reminder-create",
        "reminder-list",
        "reminder-get",
        "reminder-acknowledge",
        "reminder-cancel",
        "reminder-reschedule",
        "reminder-rebuild",
        "reminder-due",
    }:
        items_path = resolve_data_path(args.items_path)
        actions_path = resolve_data_path(args.actions_path)
        due_path = resolve_data_path(args.due_path)
        current_path = resolve_data_path(args.current_path) if hasattr(args, "current_path") else resolve_data_path("runtime/reminders/current.json")
        try:
            if args.command == "reminder-create":
                payload = run_reminder_create(
                    items_path,
                    actions_path,
                    current_path,
                    due_path,
                    resolve_data_path(args.task_items_path),
                    resolve_data_path(args.task_actions_path),
                    args.title,
                    args.description,
                    normalize_remind_at(args.remind_at),
                    args.task_id,
                    args.source,
                    args.created_by,
                    args.request_id,
                )
            elif args.command == "reminder-list":
                payload = run_reminder_list(
                    items_path,
                    actions_path,
                    current_path,
                    due_path,
                    args.status,
                    args.task_id,
                    args.limit,
                )
            elif args.command == "reminder-get":
                payload = run_reminder_get(items_path, actions_path, current_path, due_path, args.reminder_id)
            elif args.command == "reminder-acknowledge":
                payload = run_reminder_action(
                    items_path,
                    actions_path,
                    current_path,
                    due_path,
                    args.reminder_id,
                    "acknowledged",
                    args.reason,
                    args.created_by,
                    args.request_id,
                )
            elif args.command == "reminder-cancel":
                payload = run_reminder_action(
                    items_path,
                    actions_path,
                    current_path,
                    due_path,
                    args.reminder_id,
                    "cancelled",
                    args.reason,
                    args.created_by,
                    args.request_id,
                )
            elif args.command == "reminder-reschedule":
                payload = run_reminder_action(
                    items_path,
                    actions_path,
                    current_path,
                    due_path,
                    args.reminder_id,
                    "rescheduled",
                    args.reason,
                    args.created_by,
                    args.request_id,
                    normalize_remind_at(args.remind_at),
                )
            elif args.command == "reminder-rebuild":
                current = rebuild_reminder_current_view(items_path, actions_path, current_path)
                due = rebuild_reminder_due_view(items_path, actions_path, due_path, normalize_remind_at(args.now) if args.now else None)
                payload = {"ok": True, "status": "rebuilt", **current, "due": due}
            else:
                payload = rebuild_reminder_due_view(items_path, actions_path, due_path, normalize_remind_at(args.now) if args.now else None, args.limit)
        except ReminderFlowError as exc:
            if args.json_output:
                _print_json(_json_error(exc.code, exc.message))
                return 1
            print(f"ERROR [{exc.code}]: {exc.message}")
            return 1

        if args.json_output:
            _print_json(payload)
        elif args.command in {"reminder-list", "reminder-rebuild"}:
            print(f"count: {payload.get('count', len(payload.get('reminders', [])))}")
            for item in payload.get("reminders", []):
                print(f"{item['id']} | {item['status']} | {item['remind_at']} | {item['title']}")
        elif args.command == "reminder-due":
            print(f"due: {len(payload.get('due', []))}")
            for item in payload.get("due", []):
                print(f"{item['id']} | {item['remind_at']} | {item['title']}")
        else:
            reminder = payload.get("reminder") or {}
            print(f"{payload.get('status', 'ok')}: {reminder.get('id')}")
        return 0

    if args.command == "state-list":
        try:
            view = build_state_list_view(
                resolve_data_path(args.state_path),
                energy=args.energy,
                mood=args.mood,
                mode=args.mode,
                limit=args.limit,
            )
        except StateListError as exc:
            if args.json_output:
                _print_json(_json_error("INVALID_STATE_LIST", str(exc)))
                return 2
            print(f"ERROR: {exc}")
            return 2
        if args.json_output:
            _print_json(view)
        else:
            print(f"count: {view['count']}")
            if view["current"]:
                print(f"current: {view['current']['created_at']} {view['current']['energy']} {view['current']['mood']}")
            for item in view["items"]:
                print(f"{item['created_at']} | {item['energy']} | {item['mood']} | {item['mode']}")
        return 0

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
