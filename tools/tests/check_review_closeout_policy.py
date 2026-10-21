from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.review_flow import review
from tools.tests.check_review_srs_mvp import _write_object, _init_data_git


class ReviewCloseoutPolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="pkos-review-policy-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        _write_object(self.root, "fact", "fact.policy")
        self.paths = (self.root, self.root / "objects", self.root / "review",
                      self.root / "runtime/review/current.json", self.root / "runtime/review/queue.json")

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*")
                if p.is_file() and ".git" not in p.relative_to(self.root).parts}

    def head(self):
        return subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"])

    def rate(self, request, when="2026-09-20T00:00:00Z"):
        return review.run_rate(*self.paths, object_id="fact.policy", rating=4,
                               reviewed_at=when, actor="human", request_id=request)

    def assert_rejected_unchanged(self, operation, code, git=True):
        before = self.snapshot()
        head = self.head() if git else None
        with self.assertRaises(review.ReviewFlowError) as error:
            operation()
        self.assertEqual(code, error.exception.code)
        self.assertEqual(before, self.snapshot())
        if git:
            self.assertEqual(head, self.head())

    def test_backdated_rating_rejected_without_writes(self):
        _init_data_git(self.root)
        self.rate("accepted")
        self.assert_rejected_unchanged(lambda: self.rate("older", "2026-09-19T23:59:59Z"), "review_time_regression")

    def test_original_request_replays_after_later_rating(self):
        _init_data_git(self.root)
        first = self.rate("first")
        self.rate("later", "2026-09-21T00:00:00Z")
        before, head = self.snapshot(), self.head()
        replay = self.rate("first")
        self.assertEqual("replayed", replay["status"])
        self.assertEqual(first["event"], replay["event"])
        self.assertEqual(before, self.snapshot())
        self.assertEqual(head, self.head())

    def test_undo_keeps_target_chronological_slot(self):
        _init_data_git(self.root)
        first = self.rate("first")
        review.run_correct(*self.paths, target_event_id=first["event"]["id"], corrected_rating=None,
                           reason="undo", actor="human", request_id="undo", created_at="2026-09-21T00:00:00Z")
        self.assert_rejected_unchanged(lambda: self.rate("older", "2026-09-19T23:59:59Z"), "review_time_regression")
        self.assertEqual("written", self.rate("new", "2026-09-20T01:00:00Z")["status"])

    def test_equal_timezone_normalized_timestamp_keeps_line_order(self):
        _init_data_git(self.root)
        first = self.rate("first")
        second = self.rate("second", "2026-09-20T08:00:00+08:00")
        loaded = review.load_review_events(self.paths[2]).events
        self.assertEqual([first["event"]["id"], second["event"]["id"]], [event["id"] for event in loaded])
        self.assertEqual([1, 2], [event["_sourceLine"] for event in loaded])
        rebuilt = review.run_rebuild(*self.paths[1:], now="2026-09-22T00:00:00Z", write_object_projection=False)
        self.assertEqual(second["event"]["id"], rebuilt["items"][0]["lastReviewEventId"])
        self.assertEqual(2, rebuilt["items"][0]["repetitions"])

    def test_correction_and_replay_remain_target_based(self):
        _init_data_git(self.root)
        first = self.rate("first")
        kwargs = dict(target_event_id=first["event"]["id"], corrected_rating=2,
                      reason="wrong button", actor="human", request_id="correction", created_at="2026-09-19T00:00:00Z")
        correction = review.run_correct(*self.paths, **kwargs)
        self.assertEqual(first["event"]["id"], correction["event"]["targetEventId"])
        self.rate("later", "2026-09-21T00:00:00Z")
        before = self.snapshot()
        self.assertEqual("replayed", review.run_correct(*self.paths, **kwargs)["status"])
        self.assertEqual(before, self.snapshot())

    def test_non_git_rating_and_correction_refused_before_writes(self):
        for operation in (lambda: self.rate("no-git"),
                          lambda: review.run_correct(*self.paths, target_event_id="missing", corrected_rating=2,
                                                     reason="test", actor="human", request_id="no-git-correct"),
                          lambda: review.run_rate_batch(*self.paths, items=[{"objectId": "fact.policy", "rating": 4}],
                                                        reviewed_at="2026-09-20T00:00:00Z", actor="human", request_id="no-git-batch")):
            self.assert_rejected_unchanged(operation, "data_root_git_required", git=False)

    def test_parent_git_is_not_data_root_git(self):
        _init_data_git(self.root)
        child = self.root / "nested-vault"
        _write_object(child, "fact", "fact.policy")
        paths = (child, child / "objects", child / "review", child / "runtime/review/current.json", child / "runtime/review/queue.json")
        self.assert_rejected_unchanged(lambda: review.run_rate(*paths, object_id="fact.policy", rating=4,
                                                              reviewed_at="2026-09-20T00:00:00Z", actor="human", request_id="nested"),
                                       "data_root_git_required")

    def test_read_only_non_git_still_works_without_authority_changes(self):
        before = self.snapshot()
        self.assertTrue(review.run_get(self.paths[1], self.paths[2], "fact.policy", now=None)["ok"])
        self.assertEqual(0, review.run_history(self.paths[1], self.paths[2], "fact.policy")["count"])
        review.run_queue(*self.paths[1:], now="2026-09-20T00:00:00Z", limit=20)
        after = {path: data for path, data in self.snapshot().items() if not path.startswith("runtime")}
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
