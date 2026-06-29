from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def _run(args: list[str], data_root: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PKOS_DATA_ROOT"] = str(data_root.resolve())
    return subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
    )


def _read_bytes(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-data-root-support-"))
    private_out = ROOT / "tools" / "tests" / "tmp_data_root_private_site"
    if private_out.exists():
        shutil.rmtree(private_out)

    core_inbox_before = _read_bytes(ROOT / "inbox" / "items.jsonl")
    core_state_before = _read_bytes(ROOT / "state" / "snapshots.jsonl")
    core_daily_before = _read_bytes(ROOT / "review" / "daily_queue.md")
    core_weekly_before = _read_bytes(ROOT / "review" / "weekly_queue.md")
    core_digest_before = _read_bytes(ROOT / "digests" / "2026-W07.md")
    core_site_before = _read_bytes(ROOT / "site-private" / "_pkos" / "index.json")
    core_runtime_site_before = _read_bytes(ROOT / "runtime" / "site-private" / "_pkos" / "index.json")

    try:
        shutil.copytree(ROOT / "objects", data_root / "objects")
        trusted_fact = data_root / "objects" / "fact" / "trusted_reference_fact.yaml"
        trusted_fact.write_text(
            trusted_fact.read_text(encoding="utf-8").replace("Trusted reference fact", "Data Root Trusted Fact"),
            encoding="utf-8",
        )

        commands = [
            ["validate"],
            ["gen-queue"],
            ["gen-digest", "--week", "2026-W07"],
            ["inbox-append", "--capture-type", "note", "--content", "data root test"],
            ["state-append", "--energy", "low", "--mood", "calm", "--body", "normal"],
            ["gen-flow"],
            ["export-agent-context"],
            [
                "export-site-data",
                "--private-out",
                "tools/tests/tmp_data_root_private_site",
                "--runtime-out",
                "runtime/site-private/_pkos",
            ],
        ]
        for cmd in commands:
            result = _run(cmd, data_root)
            if result.returncode != 0:
                print(f"FAIL: command failed: {' '.join(cmd)}")
                print(result.stdout)
                print(result.stderr)
                return 1

        expected = [
            data_root / "review" / "daily_queue.md",
            data_root / "review" / "weekly_queue.md",
            data_root / "digests" / "2026-W07.md",
            data_root / "inbox" / "items.jsonl",
            data_root / "state" / "snapshots.jsonl",
            data_root / "runtime" / "flow" / "current_state.json",
            data_root / "runtime" / "flow" / "today_queue.json",
            data_root / "runtime" / "flow" / "review_queue.json",
            data_root / "runtime" / "flow" / "recovery_queue.json",
            data_root / "runtime" / "flow" / "writing_queue.json",
            data_root / "runtime" / "flow" / "flow_budget.json",
            data_root / "runtime" / "agent_context.json",
            data_root / "runtime" / "site-private" / "_pkos" / "index.json",
            private_out / "index.json",
        ]
        for path in expected:
            if not path.exists():
                print(f"FAIL: missing data-root output: {path}")
                return 1

        queue_text = (data_root / "review" / "daily_queue.md").read_text(encoding="utf-8")
        if data_root.as_posix() in queue_text or str(data_root) in queue_text:
            print("FAIL: data-root queue leaked an absolute vault path")
            return 1

        runtime_index = json.loads(
            (data_root / "runtime" / "site-private" / "_pkos" / "index.json").read_text(encoding="utf-8")
        )
        if not any(item.get("title") == "Data Root Trusted Fact" for item in runtime_index):
            print("FAIL: export-site-data did not read objects from data root")
            return 1
        if any(str(data_root) in str(item.get("path", "")) or data_root.as_posix() in str(item.get("path", "")) for item in runtime_index):
            print("FAIL: export-site-data leaked an absolute vault path")
            return 1

        current_state = json.loads((data_root / "runtime" / "flow" / "current_state.json").read_text(encoding="utf-8"))
        context = json.loads((data_root / "runtime" / "agent_context.json").read_text(encoding="utf-8"))
        if current_state["state"]["energy"] != "low" or context["current_state"]["mood"] != "calm":
            print("FAIL: generated context did not read state from data root")
            return 1

        if _read_bytes(ROOT / "inbox" / "items.jsonl") != core_inbox_before:
            print("FAIL: core inbox log changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "state" / "snapshots.jsonl") != core_state_before:
            print("FAIL: core state log changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "review" / "daily_queue.md") != core_daily_before:
            print("FAIL: core daily queue changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "review" / "weekly_queue.md") != core_weekly_before:
            print("FAIL: core weekly queue changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "digests" / "2026-W07.md") != core_digest_before:
            print("FAIL: core digest changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "site-private" / "_pkos" / "index.json") != core_site_before:
            print("FAIL: core private site export changed while PKOS_DATA_ROOT was set")
            return 1
        if _read_bytes(ROOT / "runtime" / "site-private" / "_pkos" / "index.json") != core_runtime_site_before:
            print("FAIL: core runtime site export changed while PKOS_DATA_ROOT was set")
            return 1

        help_result = subprocess.run(
            [sys.executable, "-B", "-m", "tools.pkos", "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        if help_result.returncode != 0:
            print("FAIL: tools.pkos --help failed")
            return 1
        if "publish-check" in help_result.stdout:
            print("FAIL: publish-check appears in CLI help")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)
        shutil.rmtree(private_out, ignore_errors=True)

    print("PASS: PKOS_DATA_ROOT directs authority, runtime, and operational data to data root")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
