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


def _write_task(data_root: Path) -> str:
    created = _json(
        _run(
            [
                "task-create",
                "--title",
                "Task linked from reminder",
                "--due-at",
                "2026-07-15T10:00:00Z",
                "--request-id",
                "task-for-reminder-1",
                "--json",
            ],
            data_root,
        ),
        "task-create for reminder",
    )
    return str(created["task"]["id"])


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-reminder-mvp-"))
    external_root = Path(tempfile.mkdtemp(prefix="pkos-reminder-external-"))
    try:
        items_path = data_root / "reminders" / "items.jsonl"
        actions_path = data_root / "reminders" / "actions.jsonl"
        current_path = data_root / "runtime" / "reminders" / "current.json"
        due_path = data_root / "runtime" / "reminders" / "due.json"
        tasks_items_path = data_root / "tasks" / "items.jsonl"
        tasks_actions_path = data_root / "tasks" / "actions.jsonl"

        empty = _json(_run(["reminder-list", "--json"], data_root), "empty reminder-list")
        if empty.get("count") != 0 or empty.get("reminders") != []:
            print("FAIL: empty reminder-list was not empty")
            return 1

        standalone = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    "Drink water",
                    "--description",
                    "Short local reminder",
                    "--remind-at",
                    "2026-07-15T18:30:00+08:00",
                    "--source",
                    "manual",
                    "--created-by",
                    "human",
                    "--request-id",
                    "reminder-create-1",
                    "--json",
                ],
                data_root,
            ),
            "standalone reminder-create",
        )
        reminder_id = standalone.get("reminder", {}).get("id")
        if not reminder_id or standalone.get("status") != "created":
            print("FAIL: reminder-create did not return created reminder")
            return 1
        if len(_read_lines(items_path)) != 1 or _read_lines(actions_path):
            print("FAIL: reminder-create did not append exactly one item and zero actions")
            return 1
        item_bytes = items_path.read_bytes()
        action_bytes = actions_path.read_bytes() if actions_path.exists() else b""
        if not current_path.exists() or not due_path.exists():
            print("FAIL: reminder-create did not rebuild current and due runtime views")
            return 1
        item = json.loads(_read_lines(items_path)[0])
        if item.get("remind_at") != "2026-07-15T10:30:00Z" or item.get("task_id") is not None:
            print("FAIL: reminder item did not normalize remind_at UTC or standalone task_id")
            return 1
        if any(key in item for key in ("recurring", "cron", "snooze")):
            print("FAIL: reminder item contains recurring fields")
            return 1

        replay = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    "Drink water",
                    "--description",
                    "Short local reminder",
                    "--remind-at",
                    "2026-07-15T18:30:00+08:00",
                    "--source",
                    "manual",
                    "--created-by",
                    "human",
                    "--request-id",
                    "reminder-create-1",
                    "--json",
                ],
                data_root,
            ),
            "reminder-create replay",
        )
        if replay.get("status") != "replayed" or len(_read_lines(items_path)) != 1:
            print("FAIL: duplicate reminder create requestId was not deterministic")
            return 1

        conflict = _run(
            [
                "reminder-create",
                "--title",
                "Different title",
                "--remind-at",
                "2026-07-15T18:30:00+08:00",
                "--request-id",
                "reminder-create-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(conflict, "idempotency_conflict", "reminder create conflict")
        if items_path.read_bytes() != item_bytes:
            print("FAIL: reminder idempotency conflict changed item log")
            return 1

        task_id = _write_task(data_root)
        task_items_bytes = tasks_items_path.read_bytes()
        task_actions_bytes = tasks_actions_path.read_bytes() if tasks_actions_path.exists() else b""
        invalid_task = _run(
            [
                "reminder-create",
                "--title",
                "Bad task reminder",
                "--remind-at",
                "2026-07-15T18:30:00+08:00",
                "--task-id",
                "task_missing",
                "--request-id",
                "reminder-invalid-task-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(invalid_task, "task_not_found", "invalid reminder taskId")
        task_linked = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    "Linked reminder",
                    "--remind-at",
                    "2026-07-15T19:00:00+08:00",
                    "--task-id",
                    task_id,
                    "--request-id",
                    "reminder-linked-1",
                    "--json",
                ],
                data_root,
            ),
            "task-linked reminder-create",
        )
        linked_id = str(task_linked["reminder"]["id"])
        second_linked = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    "Second linked reminder",
                    "--remind-at",
                    "2026-07-15T20:00:00+08:00",
                    "--task-id",
                    task_id,
                    "--request-id",
                    "reminder-linked-2",
                    "--json",
                ],
                data_root,
            ),
            "second task-linked reminder-create",
        )
        if second_linked["reminder"]["task_id"] != task_id:
            print("FAIL: multiple reminders per task did not preserve task reference")
            return 1
        if len(_read_lines(tasks_items_path)) != 1 or _read_lines(tasks_actions_path):
            print("FAIL: reminder creation mutated task authority")
            return 1

        listed = _json(_run(["reminder-list", "--status", "scheduled", "--json"], data_root), "reminder-list scheduled")
        if listed.get("count") != 3 or not any(item.get("id") == linked_id for item in listed.get("reminders", [])):
            print("FAIL: reminder-list did not show scheduled reminders")
            return 1
        got = _json(_run(["reminder-get", "--id", linked_id, "--json"], data_root), "reminder-get")
        if got.get("reminder", {}).get("id") != linked_id or got.get("reminder", {}).get("task_id") != task_id:
            print("FAIL: reminder-get did not return linked reminder")
            return 1

        not_due = _json(
            _run(["reminder-due", "--now", "2026-07-15T10:29:00Z", "--limit", "10", "--json"], data_root),
            "reminder-due before due",
        )
        if not_due.get("due") != []:
            print("FAIL: reminder became due too early")
            return 1
        due = _json(
            _run(["reminder-due", "--now", "2026-07-15T10:30:00Z", "--limit", "10", "--json"], data_root),
            "reminder-due at due",
        )
        if [item.get("id") for item in due.get("due", [])] != [reminder_id]:
            print("FAIL: reminder-due did not return deterministic due item")
            return 1

        acknowledged = _json(
            _run(
                [
                    "reminder-acknowledge",
                    "--id",
                    reminder_id,
                    "--reason",
                    "seen",
                    "--created-by",
                    "human",
                    "--request-id",
                    "reminder-ack-1",
                    "--json",
                ],
                data_root,
            ),
            "reminder-acknowledge",
        )
        if acknowledged.get("status") != "changed" or acknowledged.get("reminder", {}).get("status") != "acknowledged":
            print("FAIL: reminder acknowledge did not change status")
            return 1
        due_after_ack = _json(_run(["reminder-due", "--now", "2026-07-16T00:00:00Z", "--json"], data_root), "reminder-due after ack")
        if any(item.get("id") == reminder_id for item in due_after_ack.get("due", [])):
            print("FAIL: acknowledged reminder remained due")
            return 1

        cancelled = _json(
            _run(
                [
                    "reminder-cancel",
                    "--id",
                    linked_id,
                    "--reason",
                    "cancel manually",
                    "--request-id",
                    "reminder-cancel-1",
                    "--json",
                ],
                data_root,
            ),
            "reminder-cancel",
        )
        if cancelled.get("reminder", {}).get("status") != "cancelled":
            print("FAIL: reminder cancel did not change status")
            return 1

        rescheduled = _json(
            _run(
                [
                    "reminder-reschedule",
                    "--id",
                    linked_id,
                    "--remind-at",
                    "2026-07-15T21:00:00+08:00",
                    "--reason",
                    "move later",
                    "--request-id",
                    "reminder-reschedule-1",
                    "--json",
                ],
                data_root,
            ),
            "reminder-reschedule",
        )
        if rescheduled.get("reminder", {}).get("status") != "scheduled" or rescheduled.get("reminder", {}).get("remind_at") != "2026-07-15T13:00:00Z":
            print("FAIL: reminder reschedule did not return scheduled reminder with new UTC remind_at")
            return 1

        noop = _json(
            _run(
                [
                    "reminder-acknowledge",
                    "--id",
                    reminder_id,
                    "--reason",
                    "already seen",
                    "--request-id",
                    "reminder-ack-noop-1",
                    "--json",
                ],
                data_root,
            ),
            "reminder acknowledge no-op",
        )
        if noop.get("status") != "no_state_change":
            print("FAIL: duplicate same-status action was not no_state_change")
            return 1

        cross_conflict = _run(
            [
                "reminder-cancel",
                "--id",
                reminder_id,
                "--reason",
                "must not reuse create request id",
                "--request-id",
                "reminder-create-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(cross_conflict, "idempotency_conflict", "reminder requestId cross-operation conflict")

        rebuilt = _json(_run(["reminder-rebuild", "--now", "2026-07-15T13:00:00Z", "--json"], data_root), "reminder-rebuild")
        rebuilt_again = _json(_run(["reminder-rebuild", "--now", "2026-07-15T13:00:00Z", "--json"], data_root), "reminder-rebuild again")
        if rebuilt.get("source", {}).get("items_sha256") != rebuilt_again.get("source", {}).get("items_sha256"):
            print("FAIL: reminder rebuild source hash changed")
            return 1
        if json.dumps(rebuilt.get("reminders", []), ensure_ascii=False, sort_keys=True) != json.dumps(rebuilt_again.get("reminders", []), ensure_ascii=False, sort_keys=True):
            print("FAIL: reminder rebuild reminders were not deterministic")
            return 1

        before_items = items_path.read_bytes()
        before_actions = actions_path.read_bytes()
        _json(_run(["task-rebuild", "--json"], data_root), "task-rebuild after reminders")
        if items_path.read_bytes() != before_items or actions_path.read_bytes() != before_actions:
            print("FAIL: task rebuild changed reminder authority")
            return 1
        if tasks_items_path.read_bytes() != task_items_bytes:
            print("FAIL: reminder operations changed task items authority")
            return 1
        if (tasks_actions_path.read_bytes() if tasks_actions_path.exists() else b"") != task_actions_bytes:
            print("FAIL: reminder operations changed task actions authority")
            return 1

        before_malformed_items = items_path.read_bytes()
        items_path.write_text(items_path.read_text(encoding="utf-8") + "{bad json\n", encoding="utf-8")
        _expect_failure(_run(["reminder-list", "--json"], data_root), "malformed_reminder_item_log", "malformed reminder item log")
        items_path.write_bytes(before_malformed_items)

        before_malformed_actions = actions_path.read_bytes()
        actions_path.write_text(actions_path.read_text(encoding="utf-8") + "{bad json\n", encoding="utf-8")
        _expect_failure(_run(["reminder-list", "--json"], data_root), "malformed_reminder_action_log", "malformed reminder action log")
        actions_path.write_bytes(before_malformed_actions)

        unicode_title = "中文提醒读取验证"
        unicode_description = "验证 Reminder JSONL、Python stdout 和派生视图"
        unicode = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    unicode_title,
                    "--description",
                    unicode_description,
                    "--remind-at",
                    "2026-07-15T22:30:00+08:00",
                    "--request-id",
                    "reminder-unicode-1",
                    "--json",
                ],
                data_root,
            ),
            "unicode reminder-create",
        )
        unicode_id = unicode["reminder"]["id"]
        raw_stdout = _run_bytes_without_utf8_env(["reminder-list", "--json"], data_root)
        if raw_stdout.returncode != 0:
            print("FAIL: unicode reminder-list raw stdout command failed")
            print(raw_stdout.stderr.decode("utf-8", errors="replace"))
            return 1
        decoded = raw_stdout.stdout.decode("utf-8")
        if "\ufffd" in decoded or "锟" in decoded:
            print("FAIL: unicode reminder-list stdout contains mojibake")
            return 1
        decoded_payload = json.loads(decoded)
        decoded_item = next(item for item in decoded_payload["reminders"] if item["id"] == unicode_id)
        if decoded_item.get("title") != unicode_title or decoded_item.get("description") != unicode_description:
            print("FAIL: unicode reminder-list changed title or description")
            return 1

        external = _json(
            _run(
                [
                    "reminder-create",
                    "--title",
                    "External data root reminder",
                    "--remind-at",
                    "2026-07-15T10:00:00Z",
                    "--request-id",
                    "external-reminder-1",
                    "--json",
                ],
                external_root,
            ),
            "external root reminder-create",
        )
        if not external_root.joinpath("reminders", "items.jsonl").exists() or external["reminder"]["title"] != "External data root reminder":
            print("FAIL: external PKOS_DATA_ROOT did not isolate reminders")
            return 1
        root_list = _json(_run(["reminder-list", "--json"], data_root), "root reminder-list after external")
        if any(item.get("title") == "External data root reminder" for item in root_list.get("reminders", [])):
            print("FAIL: external reminder leaked into original data root")
            return 1

        if action_bytes != b"":
            print("FAIL: baseline action log bytes sanity check failed")
            return 1
        if not item_bytes:
            print("FAIL: baseline item log bytes sanity check failed")
            return 1

        (data_root / "objects").mkdir(parents=True, exist_ok=True)
        (data_root / "review").mkdir(parents=True, exist_ok=True)
        flow = _run(["gen-flow"], data_root)
        if flow.returncode != 0:
            print("FAIL: gen-flow failed after reminder creation")
            print(flow.stdout)
            print(flow.stderr)
            return 1
        reminder_summary_path = data_root / "runtime" / "flow" / "reminder_summary.json"
        if not reminder_summary_path.exists():
            print("FAIL: Flow Hub reminder summary was not generated")
            return 1
        summary = json.loads(reminder_summary_path.read_text(encoding="utf-8"))
        rendered_summary = json.dumps(summary, ensure_ascii=False)
        if summary.get("counts", {}).get("scheduled", 0) < 1 or summary.get("next_reminder_at") is None:
            print("FAIL: Flow Hub reminder summary did not include bounded counts")
            return 1
        if "Drink water" in rendered_summary or "Short local reminder" in rendered_summary or unicode_title in rendered_summary:
            print("FAIL: Flow Hub reminder summary leaked reminder content")
            return 1
    finally:
        shutil.rmtree(data_root, ignore_errors=True)
        shutil.rmtree(external_root, ignore_errors=True)

    print("REMINDER_AUTHORITY_MVP_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
