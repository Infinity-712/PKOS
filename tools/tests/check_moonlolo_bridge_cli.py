from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def _run(args: list[str], data_root: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if data_root is not None:
        env["PKOS_DATA_ROOT"] = str(data_root.resolve())
    return subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
    )


def _json_stdout(result: subprocess.CompletedProcess[str], command: str) -> dict:
    if result.returncode != 0:
        print(f"FAIL: command failed: {command}")
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(1)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        print(f"FAIL: stdout is not pure JSON for {command}: {exc}")
        print(result.stdout)
        raise SystemExit(1)


def _read_bytes(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-moonlolo-bridge-"))
    cli_data_root = Path(tempfile.mkdtemp(prefix="pkos-moonlolo-cli-root-"))

    core_inbox_before = _read_bytes(ROOT / "inbox" / "items.jsonl")
    core_state_before = _read_bytes(ROOT / "state" / "snapshots.jsonl")
    core_context_before = _read_bytes(ROOT / "runtime" / "agent_context.json")

    try:
        paths = _json_stdout(_run(["paths", "--json"], data_root), "paths --json")
        if paths.get("data_root_source") != "env":
            print("FAIL: paths --json did not report env data root")
            return 1
        if Path(paths["data_root"]).resolve() != data_root.resolve():
            print("FAIL: paths --json did not use PKOS_DATA_ROOT")
            return 1

        env = os.environ.copy()
        env["PKOS_DATA_ROOT"] = str(data_root.resolve())
        cli_result = subprocess.run(
            [sys.executable, "-B", "-m", "tools.pkos", "--data-root", str(cli_data_root), "paths", "--json"],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
        )
        cli_paths = _json_stdout(cli_result, "--data-root <path> paths --json")
        if cli_paths.get("data_root_source") != "cli":
            print("FAIL: --data-root did not report cli source")
            return 1
        if Path(cli_paths["data_root"]).resolve() != cli_data_root.resolve():
            print("FAIL: --data-root did not override PKOS_DATA_ROOT")
            return 1

        doctor = _json_stdout(_run(["doctor", "--json"], data_root), "doctor --json")
        if not isinstance(doctor.get("checks"), list):
            print("FAIL: doctor --json did not include checks")
            return 1

        inbox = _json_stdout(
            _run(["inbox-append", "--capture-type", "note", "--content", "bridge test", "--source", "moonlolo", "--json"], data_root),
            "inbox-append --json",
        )
        if inbox.get("ok") is not True or inbox.get("type") != "inbox_item" or inbox.get("path") != "inbox/items.jsonl":
            print("FAIL: inbox-append --json returned unexpected payload")
            return 1

        state = _json_stdout(
            _run(
                [
                    "state-append",
                    "--energy",
                    "low",
                    "--mood",
                    "anxious",
                    "--body",
                    "chest_tight",
                    "--source",
                    "moonlolo",
                    "--json",
                ],
                data_root,
            ),
            "state-append --json",
        )
        if state.get("ok") is not True or state.get("type") != "state_snapshot" or state.get("path") != "state/snapshots.jsonl":
            print("FAIL: state-append --json returned unexpected payload")
            return 1

        context = _json_stdout(_run(["export-agent-context", "--print"], data_root), "export-agent-context --print")
        if context.get("schema_version") != "0.5-alpha" or "current_state" not in context:
            print("FAIL: export-agent-context --print returned unexpected context")
            return 1

        expected_files = [
            data_root / "inbox" / "items.jsonl",
            data_root / "state" / "snapshots.jsonl",
            data_root / "runtime" / "agent_context.json",
        ]
        for path in expected_files:
            if not path.exists():
                print(f"FAIL: missing expected data-root file: {path}")
                return 1

        help_result = subprocess.run(
            [sys.executable, "-B", "-m", "tools.pkos", "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        if help_result.returncode != 0 or "publish-check" in help_result.stdout:
            print("FAIL: publish-check appears in CLI help or help failed")
            return 1

        if _read_bytes(ROOT / "inbox" / "items.jsonl") != core_inbox_before:
            print("FAIL: core inbox log changed")
            return 1
        if _read_bytes(ROOT / "state" / "snapshots.jsonl") != core_state_before:
            print("FAIL: core state log changed")
            return 1
        if _read_bytes(ROOT / "runtime" / "agent_context.json") != core_context_before:
            print("FAIL: core agent context changed")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)
        shutil.rmtree(cli_data_root, ignore_errors=True)

    print("PASS: Moonlolo bridge CLI JSON outputs verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
