from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SECRET_MARKER = "SECRET_SHOULD_NOT_APPEAR"
RAW_MARKER = "RAW_INBOX_FULLTEXT_SHOULD_NOT_APPEAR"


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )


def run_pkos(data_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PKOS_DATA_ROOT"] = str(data_root)
    return subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", "--data-root", str(data_root), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def parse_stdout_json(result: subprocess.CompletedProcess[str]) -> dict:
    assert result.returncode == 0, result.stderr or result.stdout
    return json.loads(result.stdout)


def make_inbox_rows() -> list[dict]:
    long_content = (
        "This is a long inbox capture used to verify that the Moonlolo context "
        "exports only a bounded excerpt and never the full raw inbox text. "
        + "extra content " * 80
        + RAW_MARKER
    )
    rows = [
        {
            "schema_version": "0.5-alpha",
            "type": "inbox_item",
            "id": "inbox.profile.unprocessed.1",
            "created_at": "2026-07-02T08:00:00Z",
            "capture_type": "note",
            "content": long_content,
            "source": "moonlolo",
            "status": "unprocessed",
            "tags": ["context-test"],
            "metadata": {},
        },
        {
            "schema_version": "0.5-alpha",
            "type": "inbox_item",
            "id": "inbox.profile.archived",
            "created_at": "2026-07-02T08:01:00Z",
            "capture_type": "idea",
            "content": "reviewed archive fixture",
            "source": "manual",
            "status": "unprocessed",
            "tags": [],
            "metadata": {},
        },
        {
            "schema_version": "0.5-alpha",
            "type": "inbox_item",
            "id": "inbox.profile.converted",
            "created_at": "2026-07-02T08:02:00Z",
            "capture_type": "task",
            "content": "reviewed convert fixture",
            "source": "manual",
            "status": "unprocessed",
            "tags": [],
            "metadata": {},
        },
    ]
    for idx in range(2, 8):
        rows.append(
            {
                "schema_version": "0.5-alpha",
                "type": "inbox_item",
                "id": f"inbox.profile.unprocessed.{idx}",
                "created_at": f"2026-07-02T08:1{idx}:00Z",
                "capture_type": "note",
                "content": f"sample unprocessed item {idx}",
                "source": "manual",
                "status": "unprocessed",
                "tags": [],
                "metadata": {},
            }
        )
    return rows


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="pkos-moonlolo-context-"))
    try:
        write_jsonl(
            tmp / "state" / "snapshots.jsonl",
            [
                {
                    "schema_version": "0.5-alpha",
                    "type": "state_snapshot",
                    "id": "state.profile.1",
                    "created_at": "2026-07-02T08:30:00Z",
                    "energy": "low",
                    "mood": "calm",
                    "body": "tired",
                    "context": "home",
                    "mode": "recovery",
                    "risk": {
                        "short_video": "low",
                        "rumination": "low",
                        "overload": "medium",
                    },
                    "source": "manual",
                    "note": "profile test state",
                }
            ],
        )
        write_jsonl(tmp / "inbox" / "items.jsonl", make_inbox_rows())
        write_jsonl(
            tmp / "review" / "logs" / "inbox_review_actions.jsonl",
            [
                {
                    "schema_version": "0.5-alpha",
                    "type": "inbox_review_action",
                    "id": "inbox_review_profile_archived",
                    "created_at": "2026-07-02T09:00:00Z",
                    "inbox_id": "inbox.profile.archived",
                    "action": "mark_status",
                    "status": "archived",
                    "reason": "fixture archived",
                    "source": "manual",
                },
                {
                    "schema_version": "0.5-alpha",
                    "type": "inbox_review_action",
                    "id": "inbox_review_profile_converted",
                    "created_at": "2026-07-02T09:05:00Z",
                    "inbox_id": "inbox.profile.converted",
                    "action": "mark_status",
                    "status": "converted",
                    "reason": "fixture converted",
                    "source": "manual",
                },
            ],
        )
        (tmp / "secret.txt").write_text(SECRET_MARKER, encoding="utf-8")

        result = run_pkos(tmp, "export-agent-context", "--profile", "moonlolo", "--print")
        payload = parse_stdout_json(result)
        rendered = json.dumps(payload, ensure_ascii=False, sort_keys=True)

        assert payload["schema_version"] == "0.5-beta"
        assert payload["profile"] == "moonlolo"
        assert "generated_at" in payload
        assert "learning_flow" not in payload
        assert SECRET_MARKER not in rendered
        assert RAW_MARKER not in rendered

        state = payload["current_state"]
        assert state["energy"] == "low"
        assert state["body"] == "tired"
        assert state["tone_hint"] == "soft_low_pressure"

        gate = payload["weekly_review_gate"]
        assert gate["cadence"] == "weekly"
        assert gate["unprocessed_inbox_count"] == 7
        assert gate["review_required_before_weekly_summary"] is True
        assert len(gate["sample_items"]) <= 5
        assert gate["archived_this_week"] >= 1
        assert gate["converted_this_week"] >= 1
        for item in gate["sample_items"]:
            assert set(item) == {"id", "created_at", "source", "capture_type", "content_excerpt"}
            assert len(item["content_excerpt"]) <= 120

        task_flow = payload["task_flow_stub"]
        assert task_flow["enabled"] is False
        assert task_flow["reason"] == "task_system_not_implemented"
        assert task_flow["active_task"] is None
        assert task_flow["next_action"] is None

        write_policy = payload["write_policy"]
        assert write_policy["allowed_writes"] == ["inbox_append", "state_append"]
        for forbidden in [
            "trusted",
            "objects",
            "tasks",
            "task_auto_creation",
            "weekly_summary_without_review",
            "raw_vault_mutation",
            "secret_reading",
        ]:
            assert forbidden in write_policy["forbidden_writes"]
        assert "not source of truth" in write_policy["authority"]
        assert payload["token_budget"]["raw_inbox_fulltext_included"] is False
        assert payload["token_budget"]["learning_flow_included"] is False
        assert (tmp / "runtime" / "agent_context.json").is_file()

        legacy_result = run_pkos(tmp, "export-agent-context", "--print")
        legacy = parse_stdout_json(legacy_result)
        assert legacy["schema_version"] == "0.5-alpha"
        assert legacy.get("profile") != "moonlolo"

        print("ok: moonlolo agent context profile")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
