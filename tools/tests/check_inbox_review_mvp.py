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
    data_root = Path(tempfile.mkdtemp(prefix="pkos-inbox-review-"))
    try:
        inbox_path = data_root / "inbox" / "items.jsonl"
        items = [
            {
                "schema_version": "0.5-alpha",
                "id": "inbox.test.1",
                "type": "inbox_item",
                "capture_type": "note",
                "content": "first review item",
                "source": "moonlolo",
                "status": "unprocessed",
                "tags": ["test", "alpha"],
                "metadata": {},
                "created_at": "2026-07-01T00:00:00Z",
            },
            {
                "schema_version": "0.5-alpha",
                "id": "inbox.test.2",
                "type": "inbox_item",
                "capture_type": "thought",
                "content": "second review item",
                "source": "manual",
                "status": "unprocessed",
                "tags": ["beta"],
                "metadata": {},
                "created_at": "2026-07-01T00:01:00Z",
            },
        ]
        _write_jsonl(inbox_path, items)
        inbox_before = inbox_path.read_bytes()

        listed = _json(_run(["inbox-review", "list", "--json"], data_root), "list --json")
        if listed.get("count") != 2:
            print("FAIL: list did not return both inbox items")
            return 1
        first = next((item for item in listed["items"] if item["id"] == "inbox.test.1"), None)
        if not first or first.get("effective_status") != "unprocessed":
            print("FAIL: list did not show unprocessed item")
            return 1

        source_filtered = _json(_run(["inbox-review", "list", "--source", "moonlolo", "--json"], data_root), "list --source")
        if source_filtered.get("count") != 1 or source_filtered["items"][0]["id"] != "inbox.test.1":
            print("FAIL: source filter failed")
            return 1

        tag_filtered = _json(_run(["inbox-review", "list", "--tag", "test", "--json"], data_root), "list --tag")
        if tag_filtered.get("count") != 1 or tag_filtered["items"][0]["id"] != "inbox.test.1":
            print("FAIL: tag filter failed")
            return 1

        mark = _json(
            _run(
                [
                    "inbox-review",
                    "mark",
                    "--id",
                    "inbox.test.1",
                    "--status",
                    "archived",
                    "--reason",
                    "reviewed",
                    "--json",
                ],
                data_root,
            ),
            "mark archived --json",
        )
        if mark.get("ok") is not True or mark.get("item", {}).get("effective_status") != "archived":
            print("FAIL: mark did not return archived effective item")
            return 1
        if inbox_path.read_bytes() != inbox_before:
            print("FAIL: inbox/items.jsonl changed after mark")
            return 1

        actions_path = data_root / "review" / "logs" / "inbox_review_actions.jsonl"
        if not actions_path.exists():
            print("FAIL: review action log was not created")
            return 1
        actions = [json.loads(line) for line in actions_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if len(actions) != 1 or actions[0].get("inbox_id") != "inbox.test.1" or actions[0].get("status") != "archived":
            print("FAIL: review action log did not contain expected event")
            return 1

        runtime_path = data_root / "runtime" / "inbox_review" / "current.json"
        if not runtime_path.exists():
            print("FAIL: runtime inbox review view was not generated")
            return 1

        archived = _json(_run(["inbox-review", "list", "--status", "archived", "--json"], data_root), "list archived")
        if archived.get("count") != 1 or archived["items"][0]["id"] != "inbox.test.1":
            print("FAIL: archived filter did not show marked item")
            return 1

        unknown = _run(
            ["inbox-review", "mark", "--id", "inbox.missing", "--status", "archived", "--reason", "reviewed", "--json"],
            data_root,
        )
        if unknown.returncode == 0:
            print("FAIL: unknown inbox id unexpectedly succeeded")
            return 1

        invalid = _run(
            ["inbox-review", "mark", "--id", "inbox.test.1", "--status", "unknown", "--reason", "bad"],
            data_root,
        )
        if invalid.returncode == 0:
            print("FAIL: invalid status unexpectedly succeeded")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)

    print("PASS: Inbox Review MVP verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
