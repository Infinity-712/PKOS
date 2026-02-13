"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
  python -m tools.pkos gen-queue [--objects objects --review review]
  python -m tools.pkos publish-check [--blog-dir blog/drafts --objects-dir objects]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.publish_gate.publish_check import run_publish_check
from tools.queue_gen.gen_queue import run_gen_queue
from tools.validators.validate import run_validation


def main() -> int:
    parser = argparse.ArgumentParser(prog="pkos", description="PKOS utility commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate PKOS objects")
    validate_parser.add_argument("--path", default="objects", help="Path to validate")

    queue_parser = subparsers.add_parser("gen-queue", help="Generate SRS queues")
    queue_parser.add_argument("--objects", default="objects", help="Objects root directory")
    queue_parser.add_argument("--review", default="review", help="Review output directory")

    publish_parser = subparsers.add_parser("publish-check", help="Check publish gate for blog posts")
    publish_parser.add_argument("--blog-dir", default="blog/drafts", help="Blog directory to check")
    publish_parser.add_argument("--objects-dir", default="objects", help="Objects directory")

    args = parser.parse_args()

    if args.command == "validate":
        return run_validation(Path(args.path))

    if args.command == "gen-queue":
        return run_gen_queue(Path(args.objects), Path(args.review))

    if args.command == "publish-check":
        return run_publish_check(Path(args.blog_dir), Path(args.objects_dir))

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
