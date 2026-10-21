from __future__ import annotations

from datetime import datetime, timezone
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

from tools.tests.check_object_authority_mvp import (
    _create, _create_payload, _git_head, _git_status, _init_git, _run, _update,
)


class V08CloseoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="pkos-v08-closeout-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.assertNotEqual(self.root, ROOT)
        self.assertNotIn(ROOT, self.root.parents)
        # Preserve only process-launch essentials, not vault/model/Git overrides.
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
            "LANG", "LC_ALL", "SYSTEMDRIVE",
        }}
        env.update(
            PKOS_DATA_ROOT=str(self.root), PYTHONDONTWRITEBYTECODE="1",
            PYTHONIOENCODING="utf-8", HOME=str(self.root), USERPROFILE=str(self.root),
            XDG_CONFIG_HOME=str(self.root / "runtime/config"),
            APPDATA=str(self.root / "runtime/appdata"),
            LOCALAPPDATA=str(self.root / "runtime/localappdata"),
            GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
            GIT_TERMINAL_PROMPT="0",
        )
        self.environment = patch.dict(os.environ, env, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        _init_git(self.root)
        self.assertEqual(Path(self.git("rev-parse", "--show-toplevel").strip()).resolve(), self.root)
        self.assertEqual(_git_status(self.root), "")

    def git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.root), *args], check=True,
            capture_output=True, text=True, encoding="utf-8",
        ).stdout

    def authority(self) -> dict[str, bytes]:
        return {
            path.relative_to(self.root).as_posix(): path.read_bytes()
            for folder in ("objects", "review")
            for path in (self.root / folder).rglob("*") if path.is_file()
        }

    def snapshot(self) -> tuple:
        return (self.authority(), _git_head(self.root), _git_status(self.root),
                self.git("diff", "--cached", "--binary"))

    def call(self, *args: str, error: str | None = None) -> dict:
        result = _run([*args, "--json"], self.root)
        self.assertEqual(result.returncode, 1 if error else 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        if error:
            self.assertEqual(payload["error"]["code"], error)
        return payload

    def read(self, *args: str, error: str | None = None) -> dict:
        before = self.snapshot()
        result = self.call(*args, error=error)
        self.assertEqual(self.snapshot(), before, f"{args[0]} changed authority or Git state")
        return result

    def test_chinese_fact_lifecycle(self) -> None:
        object_id = "fact.v08.closeout"
        object_path = self.root / "objects/fact/fact_v08_closeout.yaml"
        body = "\u4e2d\u6587\u4e8b\u5b9e\uff1a\u591a\u884c\u6b63\u6587\n\n\u7b2c\u4e8c\u884c: YAML # \u4e0d\u662f\u6ce8\u91ca\n- \u4fdd\u7559\u6362\u884c\u4e0e\u6807\u70b9\n"
        title = "\u4e2d\u6587\u591a\u884c\u4e8b\u5b9e"
        payload = _create_payload(object_id, "fact", title=title, content=body)
        created = _create(self.root, payload, "v08-create")
        self.assertEqual(created["status"], "created")
        self.assertEqual(created["commitHash"], _git_head(self.root))
        self.assertEqual(_git_status(self.root), "")
        initial = self.read("object-get", "--object-id", object_id)
        self.assertEqual(initial["object"]["content"], body)
        self.assertEqual(initial["object"]["title"], title)
        rendered = self.read("object-render", "--object-id", object_id)
        self.assertEqual(rendered["body"], body)
        self.assertTrue(rendered["sections"])
        self.assertEqual(rendered["objectContentSha256"], initial["objectContentSha256"])
        self.assertEqual(self.read("object-list")["count"], 1)
        self.read("review-status")
        self.read("review-queue")

        # Use a fresh timestamp after creation, never a fixed/backdated fixture.
        reviewed_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
        rating = self.call(
            "review-rate", "--object-id", object_id, "--rating", "4",
            "--reviewed-at", reviewed_at, "--actor", "human", "--request-id", "v08-rate",
        )
        self.assertTrue(rating["gitCommitCreated"])
        self.assertEqual(rating["commitHash"], _git_head(self.root))
        self.assertEqual(_git_status(self.root), "", "rating must commit all authority writes")
        changed_paths = set(self.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines())
        log_paths = {path for path in self.authority() if path.startswith("review/logs/")}
        self.assertTrue(log_paths)
        self.assertEqual(changed_paths, {object_path.relative_to(self.root).as_posix(), *log_paths})
        self.assertEqual(rating["event"]["objectContentSha256"], rendered["objectContentSha256"])
        rated = self.read("object-get", "--object-id", object_id)
        srs = rated["object"]["srs"]
        self.assertNotEqual(srs, initial["object"]["srs"])
        current = self.read("review-get", "--object-id", object_id)["item"]
        self.assertFalse(current["contentChangedSinceLastReview"])
        history = self.read("review-history", "--object-id", object_id)
        self.assertEqual(history["count"], 1)
        log_bytes = {path: self.authority()[path] for path in log_paths}

        edited_body = body + "\n\u4fee\u8ba2\uff1a\u53ea\u6539\u6b63\u6587\uff0c\u4e0d\u91cd\u7f6e\u590d\u4e60\u3002\n"
        updated = _update(self.root, object_id, {"content": edited_body}, rated["fileRevisionSha256"], "v08-edit")
        self.assertEqual(updated["commitHash"], _git_head(self.root))
        self.assertEqual(_git_status(self.root), "")
        edited = self.read("object-get", "--object-id", object_id)
        self.assertEqual(edited["object"]["content"], edited_body)
        self.assertEqual(edited["object"]["srs"], srs)
        self.assertNotEqual(edited["objectContentSha256"], rendered["objectContentSha256"])
        self.assertEqual(self.read("object-render", "--object-id", object_id)["body"], edited_body)
        queue = self.read("review-queue")
        item = next(item for item in queue["due"] + queue["upcoming"] if item["objectId"] == object_id)
        self.assertTrue(item["contentChangedSinceLastReview"])
        edited_current = self.read("review-get", "--object-id", object_id)["item"]
        for field, value in rating["event"]["resultingState"].items():
            self.assertEqual(edited_current[field], value, f"edit reset SRS field {field}")
        self.assertEqual(self.read("review-history", "--object-id", object_id)["events"], history["events"])

        preflight = self.read("object-delete-preflight", "--object-id", object_id)
        self.assertTrue(preflight["canDelete"])
        self.assertEqual(preflight["blockers"], [])
        self.assertEqual(preflight["reviewEventCount"], 1)
        self.assertTrue(preflight["warnings"])
        deleted = self.call(
            "object-delete", "--object-id", object_id, "--typed-object-id", object_id,
            "--base-revision", edited["fileRevisionSha256"], "--reason", "closeout fixture cleanup",
            "--actor", "human", "--request-id", "v08-delete", "--confirmed",
        )
        self.assertEqual(deleted["status"], "deleted")
        self.assertEqual(deleted["commitHash"], _git_head(self.root))
        self.assertFalse(object_path.exists())
        self.assertEqual(_git_status(self.root), "")
        tombstones = [json.loads(line) for path in (self.root / "objects/deletions").glob("*.jsonl")
                      for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertEqual(len(tombstones), 1)
        self.assertEqual(tombstones[0]["objectId"], object_id)
        self.assertTrue(tombstones[0]["reasonSha256"])
        for field in ("title", "summary", "content", "source", "anchors"):
            self.assertNotIn(field, tombstones[0])
        self.assertEqual({path: self.authority()[path] for path in log_paths}, log_bytes)

        # Rebuild may refresh only disposable projections, never authority.
        for _ in range(2):
            self.read("object-rebuild")
            rebuilt = self.read("review-rebuild")
            orphan = next(item for item in rebuilt["items"] if item["objectId"] == object_id)
            self.assertTrue(orphan["orphaned"])
            self.assertEqual(orphan["lastReviewEventId"], rating["event"]["id"])
            self.assertEqual(self.read("object-list")["count"], 0)
            self.read("object-get", "--object-id", object_id, error="object_not_found")
            self.read("object-render", "--object-id", object_id, error="object_not_found")
            queue = self.read("review-queue")
            self.assertFalse(any(item["objectId"] == object_id for item in queue["due"] + queue["upcoming"]))
            retained = self.read("review-history", "--object-id", object_id)
            self.assertFalse(retained["objectExists"])
            self.assertEqual(retained["events"], history["events"])
            self.assertEqual({path: self.authority()[path] for path in log_paths}, log_bytes)
        self.assertEqual(_git_status(self.root), "")


if __name__ == "__main__":
    unittest.main()
