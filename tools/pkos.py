"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
  python -m tools.pkos gen-queue [--objects objects --review review]
  python -m tools.pkos gen-digest [--objects-dir objects --output-dir digests --week YYYY-Www]
  python -m tools.pkos export-site-data [--profile current|demo] [--objects-dir objects --review-dir review --digests-dir digests --private-out site-private/_pkos --runtime-out runtime/site-private/_pkos]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.digest.gen_digest import run_gen_digest
from tools.queue_gen.gen_queue import run_gen_queue
from tools.site_export.export_site_data import run_export_site_data
from tools.validators.validate import run_validation


def main() -> int:
    parser = argparse.ArgumentParser(prog="pkos", description="PKOS utility commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate PKOS objects")
    validate_parser.add_argument("--path", default="objects", help="Path to validate")

    queue_parser = subparsers.add_parser("gen-queue", help="Generate SRS queues")
    queue_parser.add_argument("--objects", default="objects", help="Objects root directory")
    queue_parser.add_argument("--review", default="review", help="Review output directory")

    digest_parser = subparsers.add_parser("gen-digest", help="Generate weekly digest")
    digest_parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    digest_parser.add_argument("--output-dir", default="digests", help="Digest output directory")
    digest_parser.add_argument("--week", default=None, help="ISO week: YYYY-Www")

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

    if args.command == "validate":
        return run_validation(Path(args.path))

    if args.command == "gen-queue":
        return run_gen_queue(Path(args.objects), Path(args.review))

    if args.command == "gen-digest":
        return run_gen_digest(Path(args.objects_dir), Path(args.output_dir), args.week)

    if args.command == "export-site-data":
        if args.profile == "demo":
            args.objects_dir = "demo/objects"
            args.review_dir = "demo/review"
            args.digests_dir = "demo/digests"
        return run_export_site_data(
            Path(args.objects_dir),
            Path(args.review_dir),
            Path(args.digests_dir),
            Path(args.private_out),
            Path(args.runtime_out),
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
