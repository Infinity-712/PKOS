from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.review_flow import review
from tools.common.yaml_io import DataIssue
from tools.tests.check_review_srs_mvp import _write_object


class ReviewTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pkos-review-transaction-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.object_path = _write_object(self.root, "fact", "fact.test")
        self.paths = (self.root, self.root / "objects", self.root / "review",
                      self.root / "runtime/review/current.json", self.root / "runtime/review/queue.json")
        self.init_git()

    def git(self, *args, check=True):
        return subprocess.run(["git", "-C", str(self.root), *args], check=check,
                              capture_output=True, text=True, encoding="utf-8")

    def init_git(self, ignored_runtime=True):
        if ignored_runtime:
            (self.root / ".gitignore").write_text("/runtime/\n", encoding="utf-8")
        else:
            (self.root / ".gitignore").unlink(missing_ok=True)
        self.git("init")
        self.git("config", "user.name", "PKOS Test")
        self.git("config", "user.email", "pkos-test@example.invalid")
        self.git("config", "gc.auto", "0")
        self.git("add", ".")
        self.git("commit", "--allow-empty", "-m", "seed")

    def rate(self, request="r1", when="2026-07-20T00:00:00Z"):
        return review.run_rate(*self.paths, object_id="fact.test", rating=4,
                               reviewed_at=when, actor="human", request_id=request)

    def events(self):
        return review.load_review_events(self.root / "review").events

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file() and ".git" not in path.relative_to(self.root).parts}

    def test_queue_does_not_rewrite_objects(self):
        before = self.object_path.read_bytes()
        review.run_queue(*self.paths[1:], now="2026-07-20T00:00:00Z", limit=None)
        self.assertEqual(before, self.object_path.read_bytes())

    def test_malformed_log_error_uses_relative_location_only(self):
        log = self.root / "review/logs/2026-07-20.jsonl"
        log.parent.mkdir(parents=True)
        log.write_text('{"PRIVATE_LOG_SENTINEL":\n', encoding="utf-8")
        with self.assertRaises(review.ReviewFlowError) as raised:
            review.run_rebuild(*self.paths[1:], now="2026-07-20T00:00:00Z")
        self.assertEqual("malformed_review_log", raised.exception.code)
        self.assertIn("review/logs/2026-07-20.jsonl:1", raised.exception.message)
        self.assertNotIn(self.root.as_posix(), raised.exception.message)
        self.assertNotIn(str(self.root), raised.exception.message)
        self.assertNotIn("PRIVATE_LOG_SENTINEL", raised.exception.message)

    def test_object_projection_error_does_not_leak_issue_details(self):
        before = self.snapshot()
        issue = DataIssue(self.object_path, "$", f"PRIVATE_WRITE_SENTINEL {self.root}")
        with patch.object(review, "save_yaml", return_value=[issue]):
            with self.assertRaises(review.ReviewFlowError) as raised:
                self.rate()
        self.assertEqual("object_projection_write_failed", raised.exception.code)
        self.assertEqual("Object SRS projection could not be written.", raised.exception.message)
        self.assertEqual(before, self.snapshot())

    def test_object_load_error_does_not_leak_issue_details(self):
        issue = DataIssue(self.object_path, "$", f"PRIVATE_LOAD_SENTINEL {self.root}")
        operations = (self.rate, lambda: review.run_get(self.paths[1], self.paths[2], "fact.test", now=None))
        for operation in operations:
            with self.subTest(operation=operation):
                with patch.object(review, "build_object_index", return_value=({}, [issue])):
                    with self.assertRaises(review.ReviewFlowError) as raised:
                        operation()
                self.assertEqual("object_load_failed", raised.exception.code)
                self.assertEqual("Object files could not be loaded.", raised.exception.message)

    def test_rating_only_projects_its_target(self):
        other = _write_object(self.root, "fact", "fact.other")
        before = other.read_bytes()
        self.rate()
        self.assertEqual(before, other.read_bytes())

    def test_correction_only_projects_its_target(self):
        event = self.rate()["event"]
        other = _write_object(self.root, "fact", "fact.other")
        before = other.read_bytes()
        review.run_correct(*self.paths, target_event_id=event["id"], corrected_rating=2,
                           reason="wrong button", actor="human", request_id="scoped-correction",
                           created_at="2026-07-20T01:00:00Z")
        self.assertEqual(before, other.read_bytes())

    def test_selective_rebuild_preserves_other_objects_and_keeps_full_view(self):
        other = _write_object(self.root, "fact", "fact.other")
        before = other.read_bytes()
        try:
            result = review.run_rebuild(*self.paths[1:], now="2026-07-20T00:00:00Z",
                                        projection_object_ids={"fact.test"})
        except TypeError as exc:
            self.fail(f"selective projection must be supported: {exc}")
        self.assertEqual(before, other.read_bytes())
        self.assertIn("source_event_id", self.object_path.read_text(encoding="utf-8"))
        self.assertEqual({"fact.test", "fact.other"}, {item["objectId"] for item in result["items"]})
        before_all = {path: path.read_bytes() for path in (self.object_path, other)}
        review.run_rebuild(*self.paths[1:], now="2026-07-20T00:00:00Z", projection_object_ids=set())
        self.assertEqual(before_all, {path: path.read_bytes() for path in before_all})
        review.run_rebuild(*self.paths[1:], now="2026-07-20T00:00:00Z")
        self.assertIn("source_event_id", other.read_text(encoding="utf-8"))

    def test_selective_projection_still_honors_write_disabled(self):
        before = self.object_path.read_bytes()
        try:
            review.build_current_view(self.paths[1], self.paths[2], now="2026-07-20T00:00:00Z",
                                      write_object_projection=False, projection_object_ids={"fact.test"})
        except TypeError as exc:
            self.fail(f"selective projection must be supported: {exc}")
        self.assertEqual(before, self.object_path.read_bytes())

    def test_mixed_batch_captures_only_successful_projection_targets(self):
        other = _write_object(self.root, "fact", "fact.other")
        untouched = _write_object(self.root, "fact", "fact.untouched")
        before = untouched.read_bytes()
        self.init_git()
        result = review.run_rate_batch(*self.paths,
                                       items=[{"objectId": "fact.test", "rating": 4}, None,
                                              {"objectId": "fact.other", "rating": 3},
                                              {"objectId": "fact.test", "rating": 4}],
                                       reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="mixed-scoped")
        self.assertEqual(["written", "written", "replayed"], [item["status"] for item in result["items"]])
        self.assertEqual(1, len(result["failures"]))
        self.assertEqual(2, len(self.events()))
        self.assertEqual(before, untouched.read_bytes())
        changed = set(result["changedFiles"])
        self.assertIn(self.object_path.relative_to(self.root).as_posix(), changed)
        self.assertIn(other.relative_to(self.root).as_posix(), changed)
        self.assertNotIn(untouched.relative_to(self.root).as_posix(), changed)
        self.assertEqual("", self.git("status", "--porcelain").stdout)

    def test_ignored_runtime_not_staged(self):
        self.init_git()
        try:
            result = self.rate()
        except Exception as exc:
            self.fail(f"review must commit authority without staging ignored caches: {exc}")
        self.assertTrue(result["gitCommitCreated"])
        self.assertFalse(any(path.startswith("runtime/") for path in result["changedFiles"]))
        self.assertEqual("", self.git("status", "--porcelain").stdout)

    def test_unrelated_staged_changes_rejected_unchanged(self):
        self.init_git(ignored_runtime=False)
        (self.root / "unrelated.txt").write_text("human staged work", encoding="utf-8")
        self.git("add", "unrelated.txt")
        head = self.git("rev-parse", "HEAD").stdout
        index = (self.root / ".git/index").read_bytes()
        before = self.snapshot()
        with self.assertRaises(review.ReviewFlowError):
            self.rate()
        self.assertEqual(head, self.git("rev-parse", "HEAD").stdout)
        self.assertEqual(index, (self.root / ".git/index").read_bytes())
        self.assertEqual(before, self.snapshot())

    def test_file_staged_after_guard_is_excluded_and_left_staged(self):
        self.init_git()
        unrelated = self.root / "unrelated.txt"
        unrelated.write_text("human staged work", encoding="utf-8")
        real_git = review._git
        staged_late = False
        def stage_before_commit(root, *args, **kwargs):
            nonlocal staged_late
            if args and args[0] == "commit":
                self.git("add", "--", "unrelated.txt")
                staged_late = True
            return real_git(root, *args, **kwargs)
        with patch.object(review, "_git", side_effect=stage_before_commit):
            result = self.rate()
        self.assertTrue(staged_late)
        self.assertTrue(result["gitCommitCreated"])
        committed = self.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").stdout.splitlines()
        self.assertNotIn("unrelated.txt", committed)
        self.assertNotIn("unrelated.txt", result["changedFiles"])
        self.assertEqual(["unrelated.txt"], self.git("diff", "--cached", "--name-only").stdout.splitlines())
        self.assertEqual("human staged work", self.git("show", ":unrelated.txt").stdout)
        self.assertEqual("human staged work", unrelated.read_text(encoding="utf-8"))

    def test_commit_hook_failure_rolls_back_then_retry_succeeds(self):
        self.init_git(ignored_runtime=False)
        self.rate("accepted")
        before = self.snapshot()
        index = (self.root / ".git/index").read_bytes()
        head = self.git("rev-parse", "HEAD").stdout
        hook = self.root / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\nprintf 'PRIVATE_HOOK_OUTPUT\\n' >&2\nexit 1\n", encoding="utf-8")
        hook.chmod(0o755)
        try:
            self.rate("retry", "2026-07-20T01:00:00Z")
        except Exception as exc:
            self.assertIsInstance(exc, review.ReviewFlowError)
            self.assertEqual("git_commit_failed", exc.code)
            self.assertEqual("Git operation failed.", exc.message)
        else:
            self.fail("failing commit hook must reject the transaction")
        self.assertEqual(before, self.snapshot())
        self.assertEqual(index, (self.root / ".git/index").read_bytes())
        self.assertEqual(head, self.git("rev-parse", "HEAD").stdout)
        hook.unlink()
        result = self.rate("retry", "2026-07-20T01:00:00Z")
        self.assertEqual("written", result["status"])
        self.assertEqual(2, len(self.events()))

    def test_git_failure_messages_do_not_expose_paths_or_output(self):
        self.init_git()
        real_run = subprocess.run
        private = f"PRIVATE_GIT_OUTPUT {self.root} private object content"
        for failure in ("diff_before", "diff_after", "index", "add", "launch", "decode"):
            with self.subTest(failure=failure):
                before = self.snapshot()
                diff_calls = 0
                def fail_git(command, *args, **kwargs):
                    nonlocal diff_calls
                    git_args = command[3:]
                    if git_args[:3] == ["diff", "--cached", "--quiet"]:
                        diff_calls += 1
                        if (failure == "diff_before" and diff_calls == 1) or (failure == "diff_after" and diff_calls == 2):
                            return subprocess.CompletedProcess(command, 128, "", private)
                    if failure == "index" and git_args == ["rev-parse", "--git-path", "index"]:
                        raise subprocess.CalledProcessError(128, command, stderr=private)
                    if git_args and git_args[0] == "add":
                        if failure == "add":
                            raise subprocess.CalledProcessError(128, command, stderr=private)
                        if failure == "launch":
                            raise OSError(private)
                        if failure == "decode":
                            raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, private)
                    return real_run(command, *args, **kwargs)
                with patch.object(review.subprocess, "run", side_effect=fail_git):
                    with self.assertRaises(review.ReviewFlowError) as raised:
                        self.rate()
                self.assertEqual("git_commit_failed", raised.exception.code)
                self.assertEqual("Git operation failed.", raised.exception.message)
                self.assertEqual(before, self.snapshot())

    def test_post_commit_metadata_failure_does_not_roll_back(self):
        self.init_git()
        real_run = subprocess.run
        def fail_head(command, *args, **kwargs):
            if command[3:] == ["rev-parse", "HEAD"]:
                raise subprocess.CalledProcessError(128, command, stderr="PRIVATE_HEAD_OUTPUT")
            return real_run(command, *args, **kwargs)
        with patch.object(review.subprocess, "run", side_effect=fail_head):
            result = self.rate()
        self.assertTrue(result["gitCommitCreated"])
        self.assertIsNone(result["commitHash"])
        self.assertEqual("git_commit_hash_unavailable", result["warnings"][0]["code"])
        self.assertNotIn("PRIVATE_HEAD_OUTPUT", json.dumps(result))
        self.assertEqual(1, len(self.events()))
        self.assertEqual("", self.git("status", "--porcelain").stdout)
        self.assertIn("review: rating", self.git("log", "-1", "--format=%s").stdout)

    def test_projection_failure_restores_accepted_log_and_all_objects(self):
        self.rate("accepted")
        _write_object(self.root, "fact", "fact.other")
        before = self.snapshot()
        original = review.write_json
        def fail_queue(path, payload):
            if path == self.paths[4]:
                raise OSError("injected projection failure")
            original(path, payload)
        with patch.object(review, "write_json", side_effect=fail_queue):
            try:
                self.rate("retry", "2026-07-21T00:00:00Z")
            except Exception as exc:
                self.assertIsInstance(exc, review.ReviewFlowError)
            else:
                self.fail("projection failure must reject the transaction")
        self.assertEqual(before, self.snapshot())
        self.assertEqual("written", self.rate("retry", "2026-07-21T00:00:00Z")["status"])
        self.assertEqual(2, len(self.events()))

    def test_correction_replays_after_new_rating(self):
        event = self.rate()["event"]
        kwargs = dict(target_event_id=event["id"], corrected_rating=2, reason="wrong button",
                      actor="human", request_id="c1", created_at="2026-07-20T01:00:00Z")
        review.run_correct(*self.paths, **kwargs)
        self.rate("r2", "2026-07-21T00:00:00Z")
        before = self.snapshot()
        try:
            replay = review.run_correct(*self.paths, **kwargs)
        except review.ReviewFlowError as exc:
            self.fail(f"accepted correction must remain replayable: {exc.code}")
        self.assertEqual("replayed", replay["status"])
        self.assertEqual(before, self.snapshot())

    def test_malformed_batch_is_structured_partial_success(self):
        self.init_git(ignored_runtime=False)
        try:
            result = review.run_rate_batch(*self.paths, items=[{"objectId": "fact.test", "rating": 4}, None],
                                           reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="b1")
        except Exception as exc:
            self.fail(f"invalid batch entry must not strand a partial write: {exc}")
        self.assertEqual(1, len(result["items"]))
        self.assertEqual(1, len(result["failures"]))
        self.assertTrue(result["gitCommitCreated"])
        before = self.snapshot()
        review.run_rate_batch(*self.paths, items=[{"objectId": "fact.test", "rating": 4}, None],
                              reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="b1")
        self.assertEqual(before, self.snapshot())

    def test_batch_ratings_reject_coercion_without_writes(self):
        for position, rating in enumerate((True, False, 3.9, 3.0, "3", "3.9", None, 0, 6)):
            with self.subTest(rating=rating, kind=type(rating).__name__):
                before = self.snapshot()
                result = review.run_rate_batch(*self.paths, items=[{"objectId": "fact.test", "rating": rating}],
                                               reviewed_at="2026-07-20T00:00:00Z", actor="human",
                                               request_id=f"invalid-rating-{position}")
                self.assertEqual("failed", result["status"])
                self.assertEqual([], result["items"])
                self.assertEqual("invalid_rating", result["failures"][0]["code"])
                self.assertEqual(before, self.snapshot())
        for rating in range(1, 6):
            self.assertEqual(rating, review._parse_rating(rating))

    def test_concurrent_ratings_and_duplicate_requests(self):
        self.init_git()
        worker = """
import sys,time
from pathlib import Path
from tools.review_flow import review as r
root=Path(sys.argv[1]); original=r.load_review_events
def slow_load(path):
    result=original(path); time.sleep(.12); return result
r.load_review_events=slow_load
r.run_rate(root,root/'objects',root/'review',root/'runtime/review/current.json',root/'runtime/review/queue.json',object_id='fact.test',rating=4,reviewed_at='2026-07-20T00:00:00Z',actor='human',request_id=sys.argv[2])
"""
        for requests in (("a", "b"), ("c", "c")):
            children = [subprocess.Popen([sys.executable, "-B", "-c", worker, str(self.root), request],
                                        cwd=ROOT, env=dict(os.environ, PKOS_DATA_ROOT=str(self.root)),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                        for request in requests]
            try:
                results = []
                for child in children:
                    out, err = child.communicate(timeout=30)
                    results.append((child.returncode, out + err))
                for code, output in results:
                    self.assertEqual(0, code, output)
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                        child.communicate()
        self.assertEqual(3, len(self.events()))
        item = review.run_get(self.paths[1], self.paths[2], "fact.test", now=None)["item"]
        self.assertEqual(3, item["repetitions"])
        self.assertEqual("", self.git("status", "--porcelain").stdout)

    def test_projection_destinations_rejected_before_append(self):
        before = self.snapshot()
        invalid_destinations = (
            (self.object_path, self.paths[4]),
            (self.root / "review/logs/2026-07-20.jsonl", self.paths[4]),
            (self.root / "runtime/review/../escaped-review.json", self.paths[4]),
            (self.paths[3], self.paths[3]),
        )
        for current, queue in invalid_destinations:
            with self.subTest(current=current, queue=queue):
                with self.assertRaises(review.ReviewFlowError):
                    review.run_rate(*self.paths[:3], current, queue, object_id="fact.test", rating=4,
                                    reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="bad-path")
                self.assertEqual(before, self.snapshot())

    def test_batch_failed_item_rolls_back_only_its_own_event(self):
        _write_object(self.root, "fact", "fact.other")
        self.init_git()
        original = review.write_json
        def fail_second_queue(path, payload):
            if path == self.paths[4]:
                items = payload["due"] + payload["upcoming"]
                if any(item["objectId"] == "fact.other" and item["repetitions"] > 0 for item in items):
                    raise OSError("second item projection failure")
            original(path, payload)
        with patch.object(review, "write_json", side_effect=fail_second_queue):
            result = review.run_rate_batch(*self.paths,
                                          items=[{"objectId": "fact.test", "rating": 4}, {"objectId": "fact.other", "rating": 4}],
                                          reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="batch-failure")
        self.assertEqual(1, len(result["items"]))
        self.assertEqual(1, len(result["failures"]))
        self.assertTrue(result["gitCommitCreated"])
        self.assertEqual(["fact.test"], [event["objectId"] for event in self.events()])
        self.assertEqual("", self.git("status", "--porcelain").stdout)
        current = json.loads(self.paths[3].read_text(encoding="utf-8"))
        other = next(item for item in current["items"] if item["objectId"] == "fact.other")
        self.assertEqual(0, other["repetitions"])

    def test_correction_failure_preserves_target_and_retry(self):
        event = self.rate()["event"]
        before = self.snapshot()
        kwargs = dict(target_event_id=event["id"], corrected_rating=2, reason="wrong button",
                      actor="human", request_id="correction-failure", created_at="2026-07-20T01:00:00Z")
        with patch.object(review, "write_json", side_effect=OSError("correction projection failure")):
            with self.assertRaises(review.ReviewFlowError):
                review.run_correct(*self.paths, **kwargs)
        self.assertEqual(before, self.snapshot())
        self.assertEqual("written", review.run_correct(*self.paths, **kwargs)["status"])
        self.assertEqual(2, len(self.events()))

    def test_uncommitted_rating_replay_requires_recovery(self):
        self.init_git()
        review.run_rate(*self.paths, object_id="fact.test", rating=4,
                        reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="r1", commit=False)
        before = self.snapshot()
        with self.assertRaises(review.ReviewFlowError) as raised:
            self.rate()
        self.assertEqual("review_recovery_required", raised.exception.code)
        self.assertEqual(before, self.snapshot())

    def test_uncommitted_correction_replay_requires_recovery(self):
        self.init_git()
        event = self.rate()["event"]
        kwargs = dict(target_event_id=event["id"], corrected_rating=2, reason="wrong button",
                      actor="human", request_id="c1", created_at="2026-07-20T01:00:00Z")
        with patch.object(review, "commit_data_root", return_value=review.no_git_result("simulated interrupted commit")):
            review.run_correct(*self.paths, **kwargs)
        before = self.snapshot()
        with self.assertRaises(review.ReviewFlowError) as raised:
            review.run_correct(*self.paths, **kwargs)
        self.assertEqual("review_recovery_required", raised.exception.code)
        self.assertEqual(before, self.snapshot())

    def test_batch_uncommitted_replay_fails_closed(self):
        self.init_git()
        kwargs = dict(items=[{"objectId": "fact.test", "rating": 4}],
                      reviewed_at="2026-07-20T00:00:00Z", actor="human", request_id="b1")
        with patch.object(review, "commit_data_root", return_value=review.no_git_result("simulated interrupted commit")):
            review.run_rate_batch(*self.paths, **kwargs)
        before = self.snapshot()
        with self.assertRaises(review.ReviewFlowError) as raised:
            review.run_rate_batch(*self.paths, **kwargs)
        self.assertEqual("review_recovery_required", raised.exception.code)
        self.assertEqual(before, self.snapshot())

    def test_process_exit_after_append_requires_explicit_recovery(self):
        self.init_git()
        self.rate("accepted")
        head = self.git("rev-parse", "HEAD").stdout
        worker = """
import os,sys
from pathlib import Path
from tools.review_flow import review as r
root=Path(sys.argv[1]); original=r._append_event
def exit_after_append(*args,**kwargs):
    original(*args,**kwargs); os._exit(91)
r._append_event=exit_after_append
r.run_rate(root,root/'objects',root/'review',root/'runtime/review/current.json',root/'runtime/review/queue.json',object_id='fact.test',rating=4,reviewed_at='2026-07-20T00:00:00Z',actor='human',request_id='interrupted')
"""
        result = subprocess.run([sys.executable, "-B", "-c", worker, str(self.root)], cwd=ROOT,
                                env=dict(os.environ, PKOS_DATA_ROOT=str(self.root)), capture_output=True, timeout=15)
        self.assertEqual(91, result.returncode)
        before = self.snapshot()
        for request in ("interrupted", "new-request"):
            with self.subTest(request=request):
                with self.assertRaises(review.ReviewFlowError) as raised:
                    self.rate(request)
                self.assertEqual("review_recovery_required", raised.exception.code)
                self.assertEqual(before, self.snapshot())
        self.assertEqual(head, self.git("rev-parse", "HEAD").stdout)

    def test_rebuild_failure_restores_all_projections(self):
        _write_object(self.root, "fact", "fact.other")
        before = self.snapshot()
        with patch.object(review, "write_json", side_effect=OSError("rebuild projection failure")):
            with self.assertRaises(review.ReviewFlowError):
                review.run_rebuild(*self.paths[1:], now="2026-07-20T00:00:00Z")
        self.assertEqual(before, self.snapshot())

    def test_lock_timeout_releases_local_mutex(self):
        module = importlib.import_module("tools.common.data_root_lock")
        worker = """
import sys
from pathlib import Path
from tools.common.data_root_lock import data_root_lock,DataRootLockTimeout
try:
    with data_root_lock(Path(sys.argv[1]),timeout=.1):
        raise AssertionError('unexpectedly acquired')
except DataRootLockTimeout:
    print('timed-out',flush=True)
sys.stdin.readline()
with data_root_lock(Path(sys.argv[1]),timeout=2):
    print('acquired',flush=True)
"""
        with module.data_root_lock(self.root):
            child = subprocess.Popen([sys.executable, "-B", "-c", worker, str(self.root)], cwd=ROOT,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual("timed-out", child.stdout.readline().strip())
            except BaseException:
                child.kill()
                child.communicate()
                raise
        try:
            out, err = child.communicate("go\n", timeout=10)
            self.assertEqual(0, child.returncode, err)
            self.assertEqual("acquired", out.strip())
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()

    def test_shared_lock_is_reentrant_and_excludes_child_process(self):
        try:
            module = importlib.import_module("tools.common.data_root_lock")
        except ImportError:
            self.fail("shared Data Root lock module is required")
        worker = """
import sys
from pathlib import Path
from tools.common.data_root_lock import data_root_lock
print('ready',flush=True)
with data_root_lock(Path(sys.argv[1])):
    print('acquired',flush=True)
"""
        @module.with_data_root_lock
        def nested(data_root):
            with module.data_root_lock(data_root):
                return True
        with module.data_root_lock(self.root):
            self.assertTrue(nested(data_root=self.root))
            child = subprocess.Popen([sys.executable, "-B", "-c", worker, str(self.root)], cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual("ready", child.stdout.readline().strip())
                time.sleep(.2)
                self.assertIsNone(child.poll(), "child acquired a lock held by parent")
            except BaseException:
                child.kill()
                child.communicate()
                raise
        try:
            out, err = child.communicate(timeout=10)
            self.assertEqual(0, child.returncode, err)
            self.assertEqual("acquired", out.strip())
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()


if __name__ == "__main__":
    unittest.main()
