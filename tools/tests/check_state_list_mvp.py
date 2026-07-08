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


def _json(result: subprocess.CompletedProcess[str], label: str) -> dict:
    if result.returncode != 0:
        print(f"FAIL: {label} failed")
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(1)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        print(f"FAIL: {label} did not emit JSON: {exc}")
        print(result.stdout)
        raise SystemExit(1)


def _write_jsonl(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in items),
        encoding="utf-8",
    )


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-state-list-"))
    try:
        empty = _json(_run(["state-list", "--json"], data_root), "empty state-list")
        if empty.get("current") is not None or empty.get("items") != [] or empty.get("count") != 0:
            print("FAIL: empty state-list did not return current=null and empty items")
            return 1

        state_path = data_root / "state" / "snapshots.jsonl"
        items = [
            {
                "schema_version": "0.5-alpha",
                "id": "state.old",
                "type": "state_snapshot",
                "source": "manual",
                "energy": "low",
                "mood": "anxious",
                "body": "tired",
                "context": "dorm",
                "mode": "recovery",
                "risk": {"short_video": "medium", "rumination": "high", "overload": "medium"},
                "note": "old state note",
                "created_at": "2026-07-01T08:00:00Z",
            },
            {
                "schema_version": "0.5-alpha",
                "id": "state.middle",
                "type": "state_snapshot",
                "source": "web",
                "energy": "medium",
                "mood": "calm",
                "body": "normal",
                "context": "library",
                "mode": "study",
                "risk": {"short_video": "low", "rumination": "low", "overload": "low"},
                "note": "middle state note",
                "created_at": "2026-07-01T09:00:00Z",
            },
            {
                "schema_version": "0.5-alpha",
                "id": "state.latest",
                "type": "state_snapshot",
                "source": "web",
                "energy": "high",
                "mood": "excited",
                "body": "normal",
                "context": "home",
                "mode": "writing",
                "risk": {"short_video": "unknown", "rumination": "low", "overload": "medium"},
                "note": "latest state note",
                "created_at": "2026-07-01T10:00:00Z",
            },
        ]
        _write_jsonl(state_path, items)
        before = state_path.read_bytes()

        listed = _json(_run(["state-list", "--json"], data_root), "state-list --json")
        if listed.get("current", {}).get("id") != "state.latest":
            print("FAIL: current is not latest overall state")
            return 1
        if [item["id"] for item in listed.get("items", [])] != ["state.latest", "state.middle", "state.old"]:
            print("FAIL: items are not sorted newest first")
            return 1

        filtered = _json(_run(["state-list", "--json", "--energy", "low"], data_root), "state-list --energy")
        if filtered.get("current", {}).get("id") != "state.latest":
            print("FAIL: filtered current changed away from latest overall state")
            return 1
        if [item["id"] for item in filtered.get("items", [])] != ["state.old"]:
            print("FAIL: energy filter did not select expected item")
            return 1

        mode_filtered = _json(_run(["state-list", "--json", "--mood", "calm", "--mode", "study"], data_root), "state-list mood/mode")
        if [item["id"] for item in mode_filtered.get("items", [])] != ["state.middle"]:
            print("FAIL: mood/mode filter did not select expected item")
            return 1

        limited = _json(_run(["state-list", "--json", "--limit", "2"], data_root), "state-list limit")
        if [item["id"] for item in limited.get("items", [])] != ["state.latest", "state.middle"]:
            print("FAIL: limit did not apply after newest-first sort")
            return 1

        invalid = _run(["state-list", "--json", "--energy", "not_real"], data_root)
        if invalid.returncode == 0:
            print("FAIL: invalid enum unexpectedly succeeded")
            return 1
        invalid_payload = json.loads(invalid.stdout)
        if invalid_payload.get("error", {}).get("code") != "INVALID_STATE_LIST":
            print("FAIL: invalid enum did not return structured error")
            return 1

        if state_path.read_bytes() != before:
            print("FAIL: state-list modified authority state log")
            return 1

        state_path.write_text(json.dumps(items[0], ensure_ascii=False, sort_keys=True) + "\n{bad json\n", encoding="utf-8")
        malformed = _run(["state-list", "--json"], data_root)
        if malformed.returncode == 0:
            print("FAIL: malformed JSONL unexpectedly succeeded")
            return 1
        malformed_payload = json.loads(malformed.stdout)
        if "line 2" not in malformed_payload.get("error", {}).get("message", ""):
            print("FAIL: malformed JSONL error did not include line number")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)

    print("PASS: State List MVP verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
