"""Top-level PKOS command entry.

Usage:
  python -m tools.pkos validate [--path objects]
"""

from __future__ import annotations

import argparse

from tools.validators.validate import run_validation


def main() -> int:
    parser = argparse.ArgumentParser(prog="pkos", description="PKOS utility commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate PKOS objects")
    validate_parser.add_argument("--path", default="objects", help="Path to validate")

    args = parser.parse_args()

    if args.command == "validate":
        from pathlib import Path

        return run_validation(Path(args.path))

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
