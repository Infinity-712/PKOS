from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.common.yaml_io import save_yaml
from tools.common.data_root_lock import data_root_lock
from tools.object_flow import service
from tools.tests.check_object_authority_mvp import (
    _create, _create_payload, _git_head, _git_status, _init_git, _run, _update,
)


class ObjectReviewSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="pkos-object-review-safety-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        _init_git(self.root)

    def git_commit_fixture(self) -> None:
        for args in (["add", "."], ["commit", "-m", "test fixture"]):
            subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)

    def call(self, args: list[str], *, error: str | None = None) -> dict:
        result = _run([*args, "--json"], self.root)
        self.assertEqual(result.returncode, 1 if error else 0, result.stdout + result.stderr)
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            self.fail(f"CLI did not return a structured result: {result.stderr}")
        if error:
            self.assertEqual(payload["error"]["code"], error)
        return payload

    def test_index_cannot_overwrite_neighbor_authority(self) -> None:
        created = _create(self.root, _create_payload("fact.first", "fact"), "first")
        _create(self.root, _create_payload("fact.neighbor", "fact"), "neighbor")
        victim = self.root / "objects/fact/fact_neighbor.yaml"
        original = victim.read_bytes()
        head = _git_head(self.root)
        self.call([
            "object-update", "--object-id", "fact.first", "--patch-json", '{"title":"Changed"}',
            "--base-revision", created["fileRevisionSha256"], "--request-id", "bad-output",
            "--actor", "human", "--confirmed", "--index-path", str(victim),
        ], error="unsafe_projection_path")
        self.assertEqual(victim.read_bytes(), original)
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(_git_status(self.root), "")

    def test_rebuild_rejects_external_output(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pkos-outside-") as outside:
            output = Path(outside) / "sentinel.json"
            output.write_text("preserve", encoding="utf-8")
            self.call(["object-rebuild", "--index-path", str(output)], error="unsafe_projection_path")
            self.assertEqual(output.read_text(encoding="utf-8"), "preserve")

    def test_projection_paths_cannot_alias(self) -> None:
        payload = _create_payload("fact.alias", "fact")
        self.call([
            "object-create", "--payload-json", json.dumps(payload), "--request-id", "alias",
            "--actor", "human", "--confirmed", "--queue-path", "runtime/review/current.json",
        ], error="unsafe_projection_path")
        self.assertEqual(_git_status(self.root), "")

    def test_create_does_not_rewrite_neighbor_srs(self) -> None:
        victim = self.root / "objects/fact/fact_neighbor.yaml"
        data = _create_payload("fact.neighbor", "fact")
        data.update(created_at="2026-07-20T00:00:00Z", updated_at="2026-07-20T00:00:00Z")
        self.assertEqual(save_yaml(victim, data), [])
        self.git_commit_fixture()
        original = victim.read_bytes()
        _create(self.root, _create_payload("fact.first", "fact"), "first")
        self.assertEqual(victim.read_bytes(), original)
        self.assertEqual(_git_status(self.root), "")

    def test_field_types_are_enforced_before_write(self) -> None:
        for index, (field, value) in enumerate((("tags", "not-a-list"), ("tags", [42]), ("content", {"nested": "text"}), ("title", 42))):
            with self.subTest(field=field, value=value):
                payload = _create_payload(f"creative.bad{index}", "creative")
                payload[field] = value
                head = _git_head(self.root)
                self.call([
                    "object-create", "--payload-json", json.dumps(payload), "--request-id", f"bad-type-{index}",
                    "--actor", "human", "--confirmed",
                ], error="schema_validation_failed")
                self.assertEqual(_git_head(self.root), head)
                self.assertEqual(_git_status(self.root), "")

    def test_update_enforces_submitted_field_types(self) -> None:
        created = _create(self.root, _create_payload("creative.edit", "creative"), "create")
        head = _git_head(self.root)
        self.call([
            "object-update", "--object-id", "creative.edit", "--patch-json", '{"tags":42}',
            "--base-revision", created["fileRevisionSha256"], "--request-id", "bad-update",
            "--actor", "human", "--confirmed",
        ], error="schema_validation_failed")
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(_git_status(self.root), "")

    def test_cannot_create_directly_trusted(self) -> None:
        payload = {**_create_payload("fact.trusted", "fact"), "status": "trusted"}
        self.call([
            "object-create", "--payload-json", json.dumps(payload), "--request-id", "trusted-create",
            "--actor", "human", "--confirmed",
        ], error="invalid_status_transition")
        self.assertEqual(_git_status(self.root), "")

    def test_trusted_requires_challenged_predecessor(self) -> None:
        for status in ("raw", "parsed"):
            with self.subTest(status=status):
                object_id = f"fact.from_{status}"
                payload = {**_create_payload(object_id, "fact"), "status": status}
                created = _create(self.root, payload, f"create-{status}")
                head = _git_head(self.root)
                self.call([
                    "object-update", "--object-id", object_id, "--patch-json", '{"status":"trusted"}',
                    "--base-revision", created["fileRevisionSha256"], "--request-id", f"trust-{status}",
                    "--actor", "human", "--confirmed",
                ], error="invalid_status_transition")
                self.assertEqual(_git_head(self.root), head)
                self.assertEqual(_git_status(self.root), "")

    def test_human_challenged_to_trusted_and_trusted_edit_remain_available(self) -> None:
        payload = {**_create_payload("fact.challenge", "fact"), "status": "challenged"}
        created = _create(self.root, payload, "create")
        trusted = _update(self.root, "fact.challenge", {"status": "trusted"}, created["fileRevisionSha256"], "trust")
        _update(self.root, "fact.challenge", {"title": "Human edit"}, trusted["fileRevisionSha256"], "edit")
        current = self.call(["object-get", "--object-id", "fact.challenge"])
        self.assertEqual(current["object"]["status"], "trusted")
        self.assertEqual(current["object"]["title"], "Human edit")

    def test_replay_preserves_original_revision_after_edit_and_delete(self) -> None:
        payload = _create_payload("fact.replay", "fact")
        created = _create(self.root, payload, "create")
        updated = _update(self.root, "fact.replay", {"title": "New title"}, created["fileRevisionSha256"], "update")
        replay = _create(self.root, payload, "create")
        self.assertEqual(replay["fileRevisionSha256"], created["fileRevisionSha256"])
        self.call([
            "object-delete", "--object-id", "fact.replay", "--typed-object-id", "fact.replay",
            "--base-revision", updated["fileRevisionSha256"], "--reason", "test cleanup",
            "--actor", "human", "--request-id", "delete", "--confirmed",
        ])
        head = _git_head(self.root)
        replay = _create(self.root, payload, "create")
        self.assertEqual(replay["status"], "replayed")
        self.assertEqual(replay["fileRevisionSha256"], created["fileRevisionSha256"])
        self.assertEqual(_git_head(self.root), head)
        self.assertFalse((self.root / "objects/fact/fact_replay.yaml").exists())

    def assert_corrupt_log_rejected(self, folder: str) -> None:
        log = self.root / "objects" / folder / "2026-07-20.jsonl"
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text('{"objectId":"fact.bad"', encoding="utf-8")
        self.git_commit_fixture()
        head = _git_head(self.root)
        self.call([
            "object-create", "--payload-json", json.dumps(_create_payload("fact.bad", "fact")),
            "--actor", "human", "--request-id", "bad-log", "--confirmed",
        ], error="object_log_invalid")
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(_git_status(self.root), "")

    def test_corrupt_action_log_fails_closed(self) -> None:
        self.assert_corrupt_log_rejected("actions")

    def test_corrupt_tombstone_log_fails_closed(self) -> None:
        self.assert_corrupt_log_rejected("deletions")

    def test_structurally_invalid_event_fails_closed(self) -> None:
        log = self.root / "objects/actions/2026-07-20.jsonl"
        log.parent.mkdir(parents=True)
        log.write_text('{"type":[],"objectId":"fact.bad","requestId":"bad","payloadSha256":"x"}\n', encoding="utf-8")
        self.git_commit_fixture()
        self.call([
            "object-create", "--payload-json", json.dumps(_create_payload("fact.bad", "fact")),
            "--actor", "human", "--request-id", "bad-log", "--confirmed",
        ], error="object_log_invalid")
        self.assertEqual(_git_status(self.root), "")

    def test_interrupted_uncommitted_request_is_not_successful_replay(self) -> None:
        payload = _create_payload("fact.interrupted", "fact")
        with patch.object(service, "_commit_exact", side_effect=SystemExit("simulated process interruption")):
            with self.assertRaises(SystemExit):
                service.run_create(
                    self.root, self.root / "objects", self.root / "review", ROOT / "tools/schema",
                    self.root / "runtime/objects/index.json", self.root / "runtime/review/current.json",
                    self.root / "runtime/review/queue.json", payload=payload, actor="human", request_id="interrupted", confirmed=True,
                )
        head = _git_head(self.root)
        log = next((self.root / "objects/actions").glob("*.jsonl"))
        log_bytes = log.read_bytes()
        self.call([
            "object-create", "--payload-json", json.dumps(payload), "--actor", "human",
            "--request-id", "interrupted", "--confirmed",
        ], error="object_transaction_incomplete")
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(log.read_bytes(), log_bytes)

    def test_object_commit_does_not_take_new_unrelated_staged_work(self) -> None:
        original_commit = service._commit_exact
        head = _git_head(self.root)
        unrelated = self.root / "human-work.txt"

        def stage_unrelated_then_commit(*args, **kwargs):
            unrelated.write_text("human staged content", encoding="utf-8")
            subprocess.run(["git", "-C", str(self.root), "add", "human-work.txt"], check=True, capture_output=True)
            return original_commit(*args, **kwargs)

        with patch.object(service, "_commit_exact", side_effect=stage_unrelated_then_commit):
            with self.assertRaises(service.ObjectFlowError) as caught:
                service.run_create(
                    self.root, self.root / "objects", self.root / "review", ROOT / "tools/schema",
                    self.root / "runtime/objects/index.json", self.root / "runtime/review/current.json",
                    self.root / "runtime/review/queue.json", payload=_create_payload("fact.staged", "fact"),
                    actor="human", request_id="staged", confirmed=True,
                )
        self.assertEqual(caught.exception.code, "data_root_dirty")
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "human staged content")
        self.assertEqual(_git_status(self.root), "A  human-work.txt\n")
        self.assertFalse((self.root / "objects/fact/fact_staged.yaml").exists())

    def test_commit_metadata_failure_does_not_undo_committed_object(self) -> None:
        original_run = subprocess.run

        def fail_metadata(command, *args, **kwargs):
            if command[-2:] == ["rev-parse", "HEAD"]:
                raise subprocess.CalledProcessError(1, command, stderr="simulated metadata failure")
            return original_run(command, *args, **kwargs)

        with patch.object(subprocess, "run", side_effect=fail_metadata):
            try:
                result = service.run_create(
                    self.root, self.root / "objects", self.root / "review", ROOT / "tools/schema",
                    self.root / "runtime/objects/index.json", self.root / "runtime/review/current.json",
                    self.root / "runtime/review/queue.json", payload=_create_payload("fact.metadata", "fact"),
                    actor="human", request_id="metadata", confirmed=True,
                )
            except service.ObjectFlowError as exc:
                self.fail(f"metadata failure after successful commit must not roll back authority: {exc.code}")
        self.assertTrue(result["gitCommitCreated"])
        self.assertTrue((self.root / "objects/fact/fact_metadata.yaml").exists())
        self.assertEqual(_git_status(self.root), "")

    def test_staging_between_scope_check_and_commit_stays_outside_commit(self) -> None:
        original_run = subprocess.run
        unrelated = self.root / "last-second.txt"

        def stage_before_commit(command, *args, **kwargs):
            if len(command) > 3 and command[3] == "commit":
                unrelated.write_text("unrelated staged work", encoding="utf-8")
                original_run(["git", "-C", str(self.root), "add", "last-second.txt"], check=True, capture_output=True)
            return original_run(command, *args, **kwargs)

        with patch.object(subprocess, "run", side_effect=stage_before_commit):
            result = service.run_create(
                self.root, self.root / "objects", self.root / "review", ROOT / "tools/schema",
                self.root / "runtime/objects/index.json", self.root / "runtime/review/current.json",
                self.root / "runtime/review/queue.json", payload=_create_payload("fact.scoped", "fact"),
                actor="human", request_id="scoped", confirmed=True,
            )
        self.assertTrue(result["gitCommitCreated"])
        self.assertEqual(_git_status(self.root), "A  last-second.txt\n")
        committed = original_run(["git", "-C", str(self.root), "ls-tree", "--name-only", "HEAD"],
                                 check=True, capture_output=True, text=True).stdout
        self.assertNotIn("last-second.txt", committed)

    def test_committed_action_missing_replay_fields_is_rejected(self) -> None:
        payload = _create_payload("fact.incomplete", "fact")
        _create(self.root, payload, "create")
        log = next((self.root / "objects/actions").glob("*.jsonl"))
        event = json.loads(log.read_text(encoding="utf-8").strip())
        del event["objectType"]
        log.write_text(json.dumps(event) + "\n", encoding="utf-8")
        self.git_commit_fixture()
        head = _git_head(self.root)
        self.call([
            "object-create", "--payload-json", json.dumps(payload), "--actor", "human",
            "--request-id", "create", "--confirmed",
        ], error="object_log_invalid")
        self.assertEqual(_git_head(self.root), head)
        self.assertEqual(_git_status(self.root), "")

    def test_update_waits_for_other_process_before_revision_check(self) -> None:
        self.assert_concurrent_write_waits("object-update")

    def test_delete_waits_for_other_process_before_preflight(self) -> None:
        self.assert_concurrent_write_waits("object-delete")

    def assert_concurrent_write_waits(self, command: str) -> None:
        created = _create(self.root, _create_payload("fact.concurrent", "fact"), "create")
        object_path = self.root / "objects/fact/fact_concurrent.yaml"
        original_bytes = object_path.read_bytes()
        env = {**os.environ, "PKOS_DATA_ROOT": str(self.root)}
        ready = self.root / "runtime" / "child-ready"
        child_code = (
            "import runpy,sys; from pathlib import Path; "
            "p=Path(sys.argv.pop(1)); p.parent.mkdir(parents=True,exist_ok=True); p.touch(); "
            "sys.argv[0]='tools.pkos'; runpy.run_module('tools.pkos',run_name='__main__')"
        )
        args = [command, "--object-id", "fact.concurrent", "--base-revision", created["fileRevisionSha256"],
                "--request-id", "concurrent-child", "--actor", "human", "--confirmed", "--json"]
        if command == "object-update":
            args += ["--patch-json", '{"title":"stale edit"}']
        else:
            args += ["--typed-object-id", "fact.concurrent", "--reason", "stale delete"]
        process = None
        try:
            with data_root_lock(self.root):
                process = subprocess.Popen([sys.executable, "-B", "-c", child_code, str(ready), *args],
                                           cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
                import time
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "child did not start")
                with self.assertRaises(subprocess.TimeoutExpired, msg="writer ignored the Data Root transaction lock"):
                    process.communicate(timeout=1)
                self.assertTrue(object_path.exists(), "delete ran before acquiring the transaction lock")
                self.assertEqual(object_path.read_bytes(), original_bytes, "update ran before acquiring the transaction lock")
                with patch.dict(os.environ, {"PKOS_DATA_ROOT": str(self.root)}):
                    service.run_update(
                        self.root, self.root / "objects", self.root / "review", ROOT / "tools/schema",
                        self.root / "runtime/objects/index.json", self.root / "runtime/review/current.json",
                        self.root / "runtime/review/queue.json", object_id="fact.concurrent", patch={"content": "new revision"},
                        base_revision=created["fileRevisionSha256"], actor="human", request_id="concurrent-parent", confirmed=True,
                    )
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 1, stdout + stderr)
            expected = "object_revision_conflict" if command == "object-update" else "deletion_blocked"
            self.assertEqual(json.loads(stdout)["error"]["code"], expected)
            current = self.call(["object-get", "--object-id", "fact.concurrent"])
            self.assertEqual(current["object"]["content"], "new revision")
            self.assertEqual(_git_status(self.root), "")
        finally:
            if process is not None:
                if process.poll() is None:
                    process.kill()
                process.communicate()


if __name__ == "__main__":
    unittest.main()
