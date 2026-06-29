"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
  python -m tools.pkos gen-queue [--objects objects --review review]
  python -m tools.pkos gen-digest [--objects-dir objects --output-dir digests --week YYYY-Www]
  python -m tools.pkos gen-flow [--objects-dir objects --review-dir review --state-dir state --runtime-flow-dir runtime/flow]
  python -m tools.pkos export-agent-context [--objects-dir objects --review-dir review --digests-dir digests --state-dir state --runtime-flow-dir runtime/flow --output runtime/agent_context.json]
  python -m tools.pkos inbox-append --capture-type note --content "..."
  python -m tools.pkos state-append --energy low --mood anxious --body chest_tight
  python -m tools.pkos export-site-data [--profile current|demo] [--objects-dir objects --review-dir review --digests-dir digests --private-out site-private/_pkos --runtime-out runtime/site-private/_pkos]
"""

from __future__ import annotations

import argparse
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
    parse_metadata,
    parse_tags,
    run_inbox_append,
    run_state_append,
)
from tools.flow_hub.flow import run_export_agent_context, run_gen_flow
from tools.pkos_paths import resolve_core_path, resolve_data_path
from tools.queue_gen.gen_queue import run_gen_queue
from tools.site_export.export_site_data import run_export_site_data
from tools.validators.validate import run_validation


def main() -> int:
    parser = argparse.ArgumentParser(prog="pkos", description="PKOS utility commands")
    parser.add_argument("--data-root", default=None, help="Override PKOS_DATA_ROOT for this command")
    subparsers = parser.add_subparsers(dest="command", required=True)

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

    inbox_parser = subparsers.add_parser("inbox-append", help="Append an Inbox item")
    inbox_parser.add_argument("--capture-type", required=True, choices=sorted(CAPTURE_TYPES))
    inbox_parser.add_argument("--content", required=True)
    inbox_parser.add_argument("--source", default="manual", choices=sorted(INBOX_SOURCES))
    inbox_parser.add_argument("--status", default="unprocessed", choices=sorted(INBOX_STATUSES))
    inbox_parser.add_argument("--tags", default="")
    inbox_parser.add_argument("--metadata-json", default=None)
    inbox_parser.add_argument("--inbox-path", default="inbox/items.jsonl")

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

    if args.data_root:
        import os
        os.environ["PKOS_DATA_ROOT"] = str(Path(args.data_root))

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
            print(f"ERROR: {exc}")
            return 2
        try:
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
            print(f"ERROR: {exc}")
            return 2

    if args.command == "state-append":
        try:
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
