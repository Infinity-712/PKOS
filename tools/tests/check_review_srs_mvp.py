from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any

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


def _json(result: subprocess.CompletedProcess[str], label: str) -> dict[str, Any]:
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


def _lines(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _log_files(root: Path) -> list[Path]:
    logs = root / "review" / "logs"
    return sorted(path for path in logs.glob("*.jsonl") if path.name != "inbox_review_actions.jsonl")


def _review_events(root: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for path in _log_files(root):
        events.extend(_lines(path))
    return events


def _write_object(
    data_root: Path,
    object_type: str,
    object_id: str,
    *,
    status: str = "trusted",
    title: str | None = None,
    content: str | None = None,
    interval_days: int = 2,
    ease: float = 2.5,
    due_at: str = "2026-01-01T00:00:00Z",
    last_reviewed_at: str = "",
) -> Path:
    path = data_root / "objects" / object_type / f"{object_id.replace('.', '_')}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                f"id: {object_id}",
                f"type: {object_type}",
                f"status: {status}",
                f'title: "{title or object_id}"',
                'summary: "review seed"',
                f'content: "{content or "review content"}"',
                'source:',
                '  - "seed"',
                'anchors:',
                '  - "anchor"',
                'created_at: "2026-01-01T00:00:00Z"',
                'updated_at: "2026-01-01T00:00:00Z"',
                "tags: []",
                "srs:",
                f'  due_at: "{due_at}"',
                f"  interval_days: {interval_days}",
                f"  ease: {ease}",
                f'  last_reviewed_at: "{last_reviewed_at}"',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def _sha256_text(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _assert_state(state: dict[str, Any], interval: int, ease: float, due_at: str, repetitions: int) -> None:
    if state.get("intervalDays") != interval:
        raise AssertionError(f"intervalDays expected {interval}, got {state.get('intervalDays')}")
    if state.get("easeFactor") != ease:
        raise AssertionError(f"easeFactor expected {ease}, got {state.get('easeFactor')}")
    if state.get("dueAt") != due_at:
        raise AssertionError(f"dueAt expected {due_at}, got {state.get('dueAt')}")
    if state.get("repetitions") != repetitions:
        raise AssertionError(f"repetitions expected {repetitions}, got {state.get('repetitions')}")


def _init_data_git(data_root: Path) -> None:
    subprocess.run(["git", "init"], cwd=data_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    subprocess.run(["git", "config", "user.email", "pkos-test@example.invalid"], cwd=data_root, check=True)
    subprocess.run(["git", "config", "user.name", "PKOS Test"], cwd=data_root, check=True)
    subprocess.run(["git", "config", "gc.auto", "0"], cwd=data_root, check=True)
    (data_root / ".gitignore").write_text("/runtime/\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=data_root, check=True)
    subprocess.run(["git", "commit", "-m", "seed"], cwd=data_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _git_head(path: Path) -> str:
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=path, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-review-srs-"))
    bad_root = Path(tempfile.mkdtemp(prefix="pkos-review-srs-bad-"))
    git_root = Path(tempfile.mkdtemp(prefix="pkos-review-srs-git-"))
    try:
        _write_object(data_root, "fact", "fact.review.alpha", title="中文复习事实", content="中文内容不会进入 Agent Context")
        _write_object(data_root, "skill", "skill.review.beta")
        _write_object(data_root, "claim", "claim.review.gamma")
        _write_object(data_root, "creative", "creative.review.nope", status="draft")
        for score in range(1, 6):
            _write_object(data_root, "fact", f"fact.rating.{score}")
        _write_object(data_root, "fact", "fact.batch.ok")
        _write_object(data_root, "fact", "fact.changed", content="first content")
        _write_object(data_root, "fact", "fact.correct")
        _write_object(data_root, "fact", "fact.legacy.row")
        _init_data_git(data_root)

        rebuild = _json(
            _run(["review-rebuild", "--now", "2026-07-20T00:00:00Z", "--json"], data_root),
            "initial review-rebuild",
        )
        if rebuild.get("ok") is not True or rebuild.get("count", 0) < 9:
            print("FAIL: initial rebuild did not include reviewable objects")
            return 1
        if any(item.get("objectId") == "creative.review.nope" for item in rebuild.get("items", [])):
            print("FAIL: creative object entered SRS current view")
            return 1
        if not (data_root / "runtime" / "review" / "current.json").exists():
            print("FAIL: review current projection was not written")
            return 1

        queue = _json(_run(["review-queue", "--now", "2026-07-20T00:00:00Z", "--limit", "20", "--json"], data_root), "review-queue")
        if queue.get("ok") is not True or queue.get("counts", {}).get("due", 0) < 9:
            print("FAIL: review queue did not report due items")
            return 1
        if not (data_root / "runtime" / "review" / "queue.json").exists():
            print("FAIL: review queue projection was not written")
            return 1
        first_due_ids = [item["objectId"] for item in queue["due"][:3]]
        if first_due_ids != sorted(first_due_ids):
            print("FAIL: equal-due queue ordering is not deterministic by object id")
            return 1
        if json.dumps(queue, ensure_ascii=False).find("中文内容不会进入") != -1:
            print("FAIL: queue leaked object content")
            return 1

        invalid_object = _run(
            [
                "review-rate",
                "--object-id",
                "fact.missing",
                "--rating",
                "3",
                "--reviewed-at",
                "2026-07-20T00:00:00Z",
                "--actor",
                "human",
                "--request-id",
                "missing-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(invalid_object, "object_not_found", "review-rate missing object")

        creative = _run(
            [
                "review-rate",
                "--object-id",
                "creative.review.nope",
                "--rating",
                "3",
                "--reviewed-at",
                "2026-07-20T00:00:00Z",
                "--actor",
                "human",
                "--request-id",
                "creative-1",
                "--json",
            ],
            data_root,
        )
        _expect_failure(creative, "object_not_reviewable", "review-rate creative object")

        expected_by_score = {
            1: (1, 2.25, "2026-07-21T00:00:00Z", 0),
            2: (2, 2.35, "2026-07-22T00:00:00Z", 1),
            3: (5, 2.48, "2026-07-25T00:00:00Z", 1),
            4: (5, 2.55, "2026-07-25T00:00:00Z", 1),
            5: (6, 2.58, "2026-07-26T00:00:00Z", 1),
        }
        event_ids: dict[int, str] = {}
        for score, expected in expected_by_score.items():
            payload = _json(
                _run(
                    [
                        "review-rate",
                        "--object-id",
                        f"fact.rating.{score}",
                        "--rating",
                        str(score),
                        "--reviewed-at",
                        "2026-07-20T00:00:00Z",
                        "--actor",
                        "human",
                        "--request-id",
                        f"rate-{score}",
                        "--json",
                    ],
                    data_root,
                ),
                f"review-rate score {score}",
            )
            event = payload.get("event", {})
            event_ids[score] = event.get("id")
            if event.get("algorithmId") != "sm2-subset" or event.get("algorithmVersion") != 1:
                print("FAIL: review event did not record algorithm identity")
                return 1
            _assert_state(event.get("resultingState", {}), *expected)
            if not event.get("objectContentSha256"):
                print("FAIL: review event omitted objectContentSha256")
                return 1

        log_before = [path.read_bytes() for path in _log_files(data_root)]
        replay = _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.rating.3",
                    "--rating",
                    "3",
                    "--reviewed-at",
                    "2026-07-20T00:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "rate-3",
                    "--json",
                ],
                data_root,
            ),
            "review-rate replay",
        )
        if replay.get("status") != "replayed" or [path.read_bytes() for path in _log_files(data_root)] != log_before:
            print("FAIL: requestId replay appended or rewrote review logs")
            return 1

        conflict = _run(
            [
                "review-rate",
                "--object-id",
                "fact.rating.3",
                "--rating",
                "2",
                "--reviewed-at",
                "2026-07-20T00:00:00Z",
                "--actor",
                "human",
                "--request-id",
                "rate-3",
                "--json",
            ],
            data_root,
        )
        _expect_failure(conflict, "idempotency_conflict", "review-rate requestId conflict")
        if [path.read_bytes() for path in _log_files(data_root)] != log_before:
            print("FAIL: idempotency conflict changed review logs")
            return 1

        batch = _json(
            _run(
                [
                    "review-rate-batch",
                    "--items-json",
                    json.dumps(
                        [
                            {"objectId": "fact.batch.ok", "rating": 4},
                            {"objectId": "fact.batch.missing", "rating": 5},
                        ],
                        ensure_ascii=False,
                    ),
                    "--reviewed-at",
                    "2026-07-20T01:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "batch-1",
                    "--json",
                ],
                data_root,
            ),
            "review-rate-batch partial",
        )
        if batch.get("ok") is not True or len(batch.get("items", [])) != 1 or len(batch.get("failures", [])) != 1:
            print("FAIL: batch did not return deterministic partial result")
            return 1
        batch_log_count = len(_review_events(data_root))
        batch_replay = _json(
            _run(
                [
                    "review-rate-batch",
                    "--items-json",
                    json.dumps(
                        [
                            {"objectId": "fact.batch.ok", "rating": 4},
                            {"objectId": "fact.batch.missing", "rating": 5},
                        ],
                        ensure_ascii=False,
                    ),
                    "--reviewed-at",
                    "2026-07-20T01:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "batch-1",
                    "--json",
                ],
                data_root,
            ),
            "review-rate-batch replay",
        )
        if batch_replay.get("status") != "replayed" or len(_review_events(data_root)) != batch_log_count:
            print("FAIL: batch replay appended duplicate successful item")
            return 1

        changed_rate = _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.changed",
                    "--rating",
                    "4",
                    "--reviewed-at",
                    "2026-07-20T02:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "changed-1",
                    "--json",
                ],
                data_root,
            ),
            "review-rate changed seed",
        )
        changed_event_hash = changed_rate["event"]["objectContentSha256"]
        _write_object(data_root, "fact", "fact.changed", content="second content after review")
        changed_rebuild = _json(
            _run(["review-rebuild", "--now", "2026-07-20T03:00:00Z", "--json"], data_root),
            "review-rebuild content changed",
        )
        changed_item = next(item for item in changed_rebuild["items"] if item["objectId"] == "fact.changed")
        if changed_item.get("objectContentSha256") == changed_event_hash or changed_item.get("contentChangedSinceLastReview") is not True:
            print("FAIL: content change after review was not marked")
            return 1

        correction_target = _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.correct",
                    "--rating",
                    "5",
                    "--reviewed-at",
                    "2026-07-20T04:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "correct-rate-1",
                    "--json",
                ],
                data_root,
            ),
            "review-rate correction target",
        )
        correction = _json(
            _run(
                [
                    "review-correct",
                    "--target-event-id",
                    correction_target["event"]["id"],
                    "--corrected-rating",
                    "2",
                    "--reason",
                    "clicked the wrong button",
                    "--actor",
                    "human",
                    "--request-id",
                    "correct-1",
                    "--json",
                ],
                data_root,
            ),
            "review-correct",
        )
        if correction.get("event", {}).get("type") != "review_correction":
            print("FAIL: correction did not append correction event")
            return 1
        correct_current = _json(_run(["review-get", "--object-id", "fact.correct", "--json"], data_root), "review-get after correction")
        _assert_state(correct_current["item"], 2, 2.35, "2026-07-22T04:00:00Z", 1)
        history = _json(_run(["review-history", "--object-id", "fact.correct", "--json"], data_root), "review-history")
        if not any(event.get("type") == "review_correction" for event in history.get("events", [])):
            print("FAIL: review history omitted correction event")
            return 1
        if json.dumps(history, ensure_ascii=False).find("clicked the wrong button") != -1:
            print("FAIL: history leaked full correction reason")
            return 1

        legacy_log_dir = data_root / "review" / "logs"
        legacy_log_dir.mkdir(parents=True, exist_ok=True)
        legacy_row = {"id": "fact.legacy.row", "score": 3, "ts": "2026-07-19T00:00:00Z", "source": "api/ratings:batch", "version": "v0.4"}
        with (legacy_log_dir / "2026-07-19.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(legacy_row, ensure_ascii=False) + "\n")
        subprocess.run(["git", "add", "--", "review/logs/2026-07-19.jsonl"], cwd=data_root, check=True)
        subprocess.run(["git", "commit", "-m", "seed legacy review fixture"], cwd=data_root,
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        legacy_view = _json(_run(["review-rebuild", "--now", "2026-07-20T00:00:00Z", "--json"], data_root), "legacy rebuild")
        legacy_item = next(item for item in legacy_view["items"] if item["objectId"] == "fact.legacy.row")
        if legacy_item.get("legacyWarning") != "legacy_unverified":
            print("FAIL: legacy v0.4 row was not marked legacy_unverified")
            return 1

        orphan_path = _write_object(data_root, "fact", "fact.orphan")
        orphan_rate = _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.orphan",
                    "--rating",
                    "3",
                    "--reviewed-at",
                    "2026-07-20T05:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "orphan-1",
                    "--json",
                ],
                data_root,
            ),
            "review-rate orphan target",
        )
        orphan_path.unlink()
        orphan_view = _json(_run(["review-rebuild", "--now", "2026-07-20T06:00:00Z", "--json"], data_root), "orphan rebuild")
        orphan_item = next(item for item in orphan_view["items"] if item["objectId"] == "fact.orphan")
        if orphan_item.get("orphaned") is not True or orphan_rate["event"]["id"] != orphan_item.get("lastReviewEventId"):
            print("FAIL: orphaned review event was not exposed in current view")
            return 1
        orphan_queue = _json(_run(["review-queue", "--now", "2026-07-20T06:00:00Z", "--json"], data_root), "orphan queue")
        if any(item.get("objectId") == "fact.orphan" for item in orphan_queue.get("due", [])):
            print("FAIL: orphaned object entered normal review queue")
            return 1

        before_context = _json(
            _run(["export-agent-context", "--print"], data_root),
            "export-agent-context bounded review summary",
        )
        serialized_context = json.dumps(before_context, ensure_ascii=False)
        if "review" not in serialized_context or "中文内容不会进入 Agent Context" in serialized_context:
            print("FAIL: agent context either lacks bounded review summary or leaked object content")
            return 1

        _write_object(bad_root, "fact", "fact.bad")
        bad_logs = bad_root / "review" / "logs"
        bad_logs.mkdir(parents=True, exist_ok=True)
        (bad_logs / "2026-07-20.jsonl").write_text('{"type": "review_rating"\n', encoding="utf-8")
        bad = _run(["review-rebuild", "--json"], bad_root)
        _expect_failure(bad, "malformed_review_log", "malformed review log")

        _write_object(git_root, "fact", "fact.git.boundary")
        _init_data_git(git_root)
        core_head_before = _git_head(ROOT)
        git_rate = _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.git.boundary",
                    "--rating",
                    "4",
                    "--reviewed-at",
                    "2026-07-20T07:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "git-boundary-1",
                    "--json",
                ],
                git_root,
            ),
            "review-rate data root git",
        )
        if git_rate.get("gitCommitCreated") is not True or not git_rate.get("commitHash"):
            print("FAIL: data root git commit was not created")
            return 1
        if any(path.startswith("runtime/") for path in git_rate.get("changedFiles", [])):
            print("FAIL: review authority commit included runtime caches")
            return 1
        if _git_head(ROOT) != core_head_before:
            print("FAIL: core repository HEAD changed during data root review write")
            return 1

        projection = (data_root / "objects" / "fact" / "fact_rating_4.yaml").read_text(encoding="utf-8")
        if "source_event_id" not in projection or "due_at: \"2026-07-25T00:00:00Z\"" not in projection:
            print("FAIL: object.srs compatibility projection was not updated from replay state")
            return 1

        source_files = "\n".join(path.read_text(encoding="utf-8", errors="ignore") for path in (ROOT / "tools" / "review_flow").rglob("*.py"))
        if "openai" in source_files.lower() or "deepseek" in source_files.lower():
            print("FAIL: Python review MVP appears to use LLM/provider code")
            return 1

        print("REVIEW_SRS_MVP_OK")
        return 0
    finally:
        shutil.rmtree(data_root, ignore_errors=True)
        shutil.rmtree(bad_root, ignore_errors=True)
        shutil.rmtree(git_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
