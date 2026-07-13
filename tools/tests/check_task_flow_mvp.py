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
        encoding="utf-8",
        capture_output=True,
    )


def _run_bytes_without_utf8_env(args: list[str], data_root: Path) -> subprocess.CompletedProcess[bytes]:
    env = os.environ.copy()
    env["PKOS_DATA_ROOT"] = str(data_root.resolve())
    env.pop("PYTHONUTF8", None)
    env.pop("PYTHONIOENCODING", None)
    return subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", *args],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
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


def _expect_failure(result: subprocess.CompletedProcess[str], code: str, label: str) -> None:
    if result.returncode == 0:
        print(f"FAIL: {label} unexpectedly succeeded")
        print(result.stdout)
        raise SystemExit(1)
    payload = json.loads(result.stdout)
    actual = payload.get("error", {}).get("code")
    if actual != code:
        print(f"FAIL: {label} expected {code}, got {actual}")
        print(result.stdout)
        raise SystemExit(1)


def _read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _write_minimal_objects(data_root: Path) -> None:
    (data_root / "objects").mkdir(parents=True, exist_ok=True)
    (data_root / "review").mkdir(parents=True, exist_ok=True)


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-task-flow-"))
    try:
        items_path = data_root / "tasks" / "items.jsonl"
        actions_path = data_root / "tasks" / "actions.jsonl"
        current_path = data_root / "runtime" / "tasks" / "current.json"

        empty = _json(_run(["task-list", "--json"], data_root), "empty task-list")
        if empty.get("count") != 0 or empty.get("items") != []:
            print("FAIL: empty task-list was not empty")
            return 1

        created = _json(
            _run(
                [
                    "task-create",
                    "--title",
                    "Write task contract",
                    "--description",
                    "Sensitive task description should stay out of audit",
                    "--source",
                    "web",
                    "--tags",
                    "alpha,project",
                    "--priority",
                    "high",
                    "--due-at",
                    "2026-07-12T03:04:05+00:00",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-create-1",
                    "--json",
                ],
                data_root,
            ),
            "task-create",
        )
        task_id = created.get("task", {}).get("id")
        if not task_id or created.get("status") != "created":
            print("FAIL: task-create did not return created task")
            return 1
        if len(_read_lines(items_path)) != 1 or _read_lines(actions_path):
            print("FAIL: task-create did not append exactly one item and zero actions")
            return 1
        item_bytes = items_path.read_bytes()
        action_bytes = actions_path.read_bytes() if actions_path.exists() else b""
        if not current_path.exists():
            print("FAIL: task-create did not rebuild runtime current view")
            return 1
        item = json.loads(_read_lines(items_path)[0])
        if item.get("due_at") != "2026-07-12T03:04:05Z":
            print("FAIL: task due_at was not normalized to UTC Z")
            return 1

        replay = _json(
            _run(
                [
                    "task-create",
                    "--title",
                    "Write task contract",
                    "--description",
                    "Sensitive task description should stay out of audit",
                    "--source",
                    "web",
                    "--tags",
                    "alpha,project",
                    "--priority",
                    "high",
                    "--due-at",
                    "2026-07-12T03:04:05+00:00",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-create-1",
                    "--json",
                ],
                data_root,
            ),
            "task-create replay",
        )
        if replay.get("status") != "replayed" or len(_read_lines(items_path)) != 1:
            print("FAIL: duplicate requestId replay was not deterministic")
            return 1

        conflict = _run(
            [
                "task-create",
                "--title",
                "Different title",
                "--created-by",
                "human",
                "--request-id",
                "task-create-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(conflict, "idempotency_conflict", "task-create conflict")
        if items_path.read_bytes() != item_bytes:
            print("FAIL: idempotency conflict changed task items log")
            return 1

        cross_operation_conflict = _run(
            [
                "task-transition",
                "--task-id",
                task_id,
                "--target-status",
                "in_progress",
                "--reason",
                "must not reuse create request id",
                "--request-id",
                "task-create-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(cross_operation_conflict, "idempotency_conflict", "task requestId cross-operation conflict")
        if _read_lines(actions_path):
            print("FAIL: cross-operation requestId conflict appended an action")
            return 1

        moved = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "in_progress",
                    "--reason",
                    "starting now",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-1",
                    "--json",
                ],
                data_root,
            ),
            "task-transition",
        )
        if moved.get("status") != "changed" or moved.get("task", {}).get("status") != "in_progress":
            print("FAIL: task-transition did not move to in_progress")
            return 1
        if len(_read_lines(actions_path)) != 1:
            print("FAIL: task-transition did not append one action")
            return 1

        invalid = _run(
            [
                "task-transition",
                "--task-id",
                task_id,
                "--target-status",
                "open",
                "--reason",
                "invalid backwards from in_progress is allowed later but same test uses unknown",
                "--created-by",
                "human",
                "--request-id",
                "task-transition-invalid-1",
                "--json",
            ],
            data_root,
        )
        # in_progress -> open is valid; use an invalid status through argparse-free JSON path is unavailable.
        if invalid.returncode != 0:
            print("FAIL: valid reopen-to-open from in_progress unexpectedly failed")
            return 1
        reopened = json.loads(invalid.stdout)
        if reopened.get("task", {}).get("status") != "open":
            print("FAIL: in_progress -> open did not work")
            return 1

        noop = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "open",
                    "--reason",
                    "already open",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-noop-1",
                    "--json",
                ],
                data_root,
            ),
            "task-transition no-op",
        )
        if noop.get("status") != "no_state_change" or len(_read_lines(actions_path)) != 2:
            print("FAIL: same-state transition appended an action or returned wrong status")
            return 1

        done = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "done",
                    "--reason",
                    "completed manually",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-done-1",
                    "--json",
                ],
                data_root,
            ),
            "task done",
        )
        if done.get("task", {}).get("status") != "done":
            print("FAIL: task did not move to done")
            return 1

        reopened_done = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "open",
                    "--reason",
                    "reopen after completion",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-reopen-1",
                    "--json",
                ],
                data_root,
            ),
            "reopen done",
        )
        if reopened_done.get("task", {}).get("status") != "open":
            print("FAIL: done task did not reopen")
            return 1

        cancelled = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "cancelled",
                    "--reason",
                    "cancel manually",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-cancel-1",
                    "--json",
                ],
                data_root,
            ),
            "cancel task",
        )
        if cancelled.get("task", {}).get("status") != "cancelled":
            print("FAIL: task did not cancel")
            return 1

        reopened_cancelled = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    task_id,
                    "--target-status",
                    "open",
                    "--reason",
                    "restore cancelled task",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-transition-reopen-cancelled-1",
                    "--json",
                ],
                data_root,
            ),
            "reopen cancelled",
        )
        if reopened_cancelled.get("task", {}).get("status") != "open":
            print("FAIL: cancelled task did not reopen")
            return 1

        note_command = _run(
            [
                "task-note",
                "--task-id",
                task_id,
                "--note",
                "Sensitive note body",
                "--created-by",
                "human",
                "--request-id",
                "task-note-removed-1",
                "--json",
            ],
            data_root,
        )
        if note_command.returncode == 0:
            print("FAIL: task-note command still exists")
            return 1
        note_action_count = len(_read_lines(actions_path))
        legacy_note = {
            "schema_version": "0.7-alpha",
            "type": "task_action",
            "id": "task_action_legacy_note_1",
            "task_id": task_id,
            "action_type": "note_added",
            "note": "legacy note body must be tolerated",
            "created_at": "2026-07-13T00:00:00Z",
            "created_by": "human",
            "request_id": "task-note-legacy-1",
            "payload_sha256": "legacy-note-payload",
        }
        actions_path.write_text(
            actions_path.read_text(encoding="utf-8") + json.dumps(legacy_note, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        legacy_rebuilt = _json(_run(["task-rebuild", "--json"], data_root), "legacy note rebuild")
        if legacy_rebuilt.get("items", [])[0].get("notes_count") != 1:
            print("FAIL: legacy note_added action was not tolerated by rebuild")
            return 1
        note_action_count = len(_read_lines(actions_path))

        note_transition_conflict = _run(
            [
                "task-transition",
                "--task-id",
                task_id,
                "--target-status",
                "done",
                "--reason",
                "must not reuse note request id",
                "--request-id",
                "task-note-legacy-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(note_transition_conflict, "idempotency_conflict", "task note requestId conflict")
        if len(_read_lines(actions_path)) != note_action_count:
            print("FAIL: note requestId conflict changed task actions log")
            return 1

        filtered = _json(_run(["task-list", "--status", "open", "--priority", "high", "--tag", "alpha", "--json"], data_root), "task-list filters")
        if filtered.get("count") != 1 or filtered["items"][0]["id"] != task_id:
            print("FAIL: task-list filters did not find task")
            return 1

        rebuilt = _json(_run(["task-rebuild", "--json"], data_root), "task-rebuild")
        rebuilt_again = _json(_run(["task-rebuild", "--json"], data_root), "task-rebuild again")
        if rebuilt.get("source", {}).get("items_sha256") != rebuilt_again.get("source", {}).get("items_sha256"):
            print("FAIL: task-rebuild was not deterministic")
            return 1
        current = json.loads(current_path.read_text(encoding="utf-8"))
        if current.get("items", [])[0].get("notes_count") != 1:
            print("FAIL: current view did not reflect note count")
            return 1

        unicode_title = "完成 PKOS v0.7 人工验收"
        unicode_description = "验证任务 authority、状态转换、幂等和确定性重建"
        unicode_reason = "开始人工验收"
        unicode_created = _json(
            _run(
                [
                    "task-create",
                    "--title",
                    unicode_title,
                    "--description",
                    unicode_description,
                    "--source",
                    "web",
                    "--priority",
                    "normal",
                    "--due-at",
                    "2026-07-15T10:00:00.000Z",
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-unicode-create-1",
                    "--json",
                ],
                data_root,
            ),
            "unicode task-create",
        )
        unicode_task_id = unicode_created.get("task", {}).get("id")
        unicode_transition = _json(
            _run(
                [
                    "task-transition",
                    "--task-id",
                    unicode_task_id,
                    "--target-status",
                    "in_progress",
                    "--reason",
                    unicode_reason,
                    "--created-by",
                    "human",
                    "--request-id",
                    "task-unicode-transition-1",
                    "--json",
                ],
                data_root,
            ),
            "unicode task-transition",
        )
        authority_text = items_path.read_text(encoding="utf-8") + actions_path.read_text(encoding="utf-8") + current_path.read_text(encoding="utf-8")
        if unicode_transition.get("task", {}).get("title") != unicode_title:
            print("FAIL: unicode API payload changed task title")
            return 1
        if unicode_title not in authority_text or unicode_description not in authority_text or unicode_reason not in authority_text:
            print("FAIL: unicode authority roundtrip text missing")
            return 1
        if "锟" in authority_text or "\ufffd" in authority_text:
            print("FAIL: unicode authority roundtrip contains mojibake")
            return 1
        unicode_item = next(item for item in json.loads(current_path.read_text(encoding="utf-8"))["items"] if item["id"] == unicode_task_id)
        if unicode_item.get("due_at") != "2026-07-15T10:00:00Z":
            print("FAIL: unicode task due_at was not stored as UTC Z")
            return 1

        raw_stdout = _run_bytes_without_utf8_env(["task-list", "--json"], data_root)
        if raw_stdout.returncode != 0:
            print("FAIL: unicode task-list raw stdout command failed")
            print(raw_stdout.stderr.decode("utf-8", errors="replace"))
            return 1
        try:
            decoded_stdout = raw_stdout.stdout.decode("utf-8")
        except UnicodeDecodeError as exc:
            print(f"FAIL: unicode task-list stdout was not UTF-8: {exc}")
            return 1
        if "\ufffd" in decoded_stdout or "锟" in decoded_stdout:
            print("FAIL: unicode task-list stdout contains replacement mojibake")
            return 1
        decoded_payload = json.loads(decoded_stdout)
        decoded_item = next(item for item in decoded_payload["items"] if item["id"] == unicode_task_id)
        if decoded_item.get("title") != unicode_title or decoded_item.get("description") != unicode_description:
            print("FAIL: unicode task-list stdout changed task title or description")
            return 1
        if decoded_item.get("latest_reason") != unicode_reason:
            print("FAIL: unicode task-list stdout changed latest transition reason")
            return 1

        before_malformed_items = items_path.read_bytes()
        items_path.write_text(items_path.read_text(encoding="utf-8") + "{bad json\n", encoding="utf-8")
        malformed_items = _run(["task-list", "--json"], data_root)
        _expect_failure(malformed_items, "malformed_item_log", "malformed item log")
        items_path.write_bytes(before_malformed_items)

        before_malformed_actions = actions_path.read_bytes()
        actions_path.write_text(actions_path.read_text(encoding="utf-8") + "{bad json\n", encoding="utf-8")
        malformed_actions = _run(["task-list", "--json"], data_root)
        _expect_failure(malformed_actions, "malformed_action_log", "malformed action log")
        actions_path.write_bytes(before_malformed_actions)

        if not item_bytes or action_bytes != b"":
            print("FAIL: baseline log bytes sanity check failed")
            return 1
        if "objects" in "".join(_read_lines(items_path)) or "trusted" in "".join(_read_lines(actions_path)):
            print("FAIL: task flow mutated trusted/object authority")
            return 1
        if (data_root / "reminders").exists() or (data_root / "runtime" / "reminders").exists():
            print("FAIL: task flow created reminder data")
            return 1

        _write_minimal_objects(data_root)
        flow = _run(["gen-flow"], data_root)
        if flow.returncode != 0:
            print("FAIL: gen-flow failed after task creation")
            print(flow.stdout)
            print(flow.stderr)
            return 1
        task_summary_path = data_root / "runtime" / "flow" / "task_summary.json"
        if not task_summary_path.exists():
            print("FAIL: Flow Hub task summary was not generated")
            return 1
        summary = json.loads(task_summary_path.read_text(encoding="utf-8"))
        if summary.get("counts", {}).get("open") != 1 or "Write task contract" in json.dumps(summary):
            print("FAIL: Flow Hub task summary was not bounded")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)

    print("TASK_FLOW_MVP_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
