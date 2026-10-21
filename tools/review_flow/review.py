from __future__ import annotations

from dataclasses import dataclass
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import hashlib
import inspect
import json
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any

from tools.common.data_root_lock import DataRootLockTimeout, data_root_lock
from tools.common.object_store import ObjectRecord, build_object_index
from tools.common.yaml_io import save_yaml
from tools.review_flow.algorithms.sm2_v1 import (
    ALGORITHM_ID,
    ALGORITHM_VERSION,
    RATING_LABELS,
    apply_rating,
    normalize_reviewed_at,
    normalize_state,
)

SCHEMA_VERSION = "0.8-alpha"
REVIEWABLE_TYPES = {"fact", "skill", "claim"}
DEFAULT_QUEUE_LIMIT = 50
MAX_QUEUE_LIMIT = 500
GIT_FAILURE_MESSAGE = "Git operation failed."


class ReviewFlowError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class LoadedEvents:
    events: list[dict[str, Any]]
    event_hashes: dict[str, str]
    source_files: list[dict[str, Any]]


@dataclass
class _WriteTransaction:
    root: Path
    preimages: dict[Path, bytes | None]
    authority_paths: set[Path]
    appended_events: set[str]


_transactions: ContextVar[tuple[_WriteTransaction, ...]] = ContextVar("review_transactions", default=())


def _remember_write(path: Path, *, authority: bool = False) -> None:
    path = path.resolve()
    for transaction in _transactions.get():
        if path not in transaction.preimages:
            transaction.preimages[path] = path.read_bytes() if path.exists() else None
        if authority:
            transaction.authority_paths.add(path)


def _replace_bytes(path: Path, content: bytes | None) -> None:
    if content is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _transactional(function):
    signature = inspect.signature(function)

    @wraps(function)
    def wrapped(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        parents = _transactions.get()
        root = bound.arguments.get("data_root")
        if root is None:
            root = parents[-1].root if parents else Path(bound.arguments["objects_dir"]).parent
        root = Path(root).resolve()
        try:
            with data_root_lock(root):
                if "current_path" in bound.arguments and "queue_path" in bound.arguments:
                    _validate_projection_paths(root, bound.arguments["current_path"], bound.arguments["queue_path"])
                transaction = _WriteTransaction(root, {}, set(), set())
                token = _transactions.set((*parents, transaction))
                try:
                    return function(*args, **kwargs)
                except BaseException as exc:
                    for path, content in reversed(list(transaction.preimages.items())):
                        _replace_bytes(path, content)
                    if isinstance(exc, (OSError, subprocess.SubprocessError)):
                        if function.__name__ == "commit_data_root" or isinstance(exc, subprocess.SubprocessError):
                            raise ReviewFlowError("git_commit_failed", GIT_FAILURE_MESSAGE) from None
                        raise ReviewFlowError("review_write_failed", "Review write failed.") from None
                    raise
                finally:
                    _transactions.reset(token)
        except DataRootLockTimeout as exc:
            raise ReviewFlowError("data_root_busy", str(exc)) from exc

    return wrapped


def _validate_projection_paths(root: Path, current_path: Path, queue_path: Path) -> None:
    allowed = root / "runtime" / "review"
    current = current_path.resolve()
    queue = queue_path.resolve()
    for path in (current, queue):
        if path.parent != allowed or path.suffix.lower() != ".json":
            raise ReviewFlowError("invalid_projection_path", "review projections must be JSON files directly under Data Root/runtime/review")
    if current == queue:
        raise ReviewFlowError("invalid_projection_path", "current and queue projection paths must be distinct")


@_transactional
def run_rebuild(
    objects_dir: Path,
    review_dir: Path,
    current_path: Path,
    queue_path: Path,
    *,
    now: str | None,
    write_object_projection: bool = True,
    projection_object_ids: set[str] | None = None,
    data_root: Path | None = None,
) -> dict[str, Any]:
    current = build_current_view(objects_dir, review_dir, now=now, write_object_projection=write_object_projection,
                                 projection_object_ids=projection_object_ids)
    write_json(current_path, current)
    queue = build_queue_view_from_current(current, evaluated_at=now)
    write_json(queue_path, queue)
    return {"ok": True, "status": "rebuilt", **current}


@_transactional
def run_queue(
    objects_dir: Path,
    review_dir: Path,
    current_path: Path,
    queue_path: Path,
    *,
    now: str | None,
    limit: int | None,
    data_root: Path | None = None,
) -> dict[str, Any]:
    current = build_current_view(objects_dir, review_dir, now=now, write_object_projection=False)
    write_json(current_path, current)
    queue = build_queue_view_from_current(current, evaluated_at=now, limit=limit)
    write_json(queue_path, queue)
    return queue


def run_get(objects_dir: Path, review_dir: Path, object_id: str, *, now: str | None) -> dict[str, Any]:
    current = build_current_view(objects_dir, review_dir, now=now, write_object_projection=False)
    item = _find_current_item(current, object_id)
    if not item:
        raise ReviewFlowError("review_item_not_found", f"review item not found: {object_id}")
    return {"ok": True, "item": item, "generated_at": current["generatedAt"]}


def run_history(objects_dir: Path, review_dir: Path, object_id: str) -> dict[str, Any]:
    records, _ = build_object_index(objects_dir)
    loaded = load_review_events(review_dir)
    history = []
    for event in loaded.events:
        if event.get("type") == "review_correction":
            target = _find_event_by_id(loaded.events, str(event.get("targetEventId") or ""))
            if target and target.get("objectId") == object_id:
                history.append(_sanitize_history_event(event))
            continue
        if event.get("objectId") == object_id or event.get("id") == object_id:
            history.append(_sanitize_history_event(event))
    return {
        "ok": True,
        "objectId": object_id,
        "objectExists": object_id in records,
        "events": history,
        "count": len(history),
    }


def run_status(objects_dir: Path, review_dir: Path, *, now: str | None) -> dict[str, Any]:
    current = build_current_view(objects_dir, review_dir, now=now, write_object_projection=False)
    queue = build_queue_view_from_current(current, evaluated_at=now)
    return {
        "ok": True,
        "generatedAt": current["generatedAt"],
        "evaluatedAt": queue["evaluatedAt"],
        "counts": queue["counts"],
        "source": queue["source"],
    }


@_transactional
def run_rate(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    current_path: Path,
    queue_path: Path,
    *,
    object_id: str,
    rating: int,
    reviewed_at: str,
    actor: str,
    request_id: str,
    commit: bool = True,
) -> dict[str, Any]:
    _require_data_git(data_root)
    reviewed_at = normalize_reviewed_at(reviewed_at)
    rating = _parse_rating(rating)
    request_id = _required_string(request_id, "request_id")
    actor = _required_string(actor, "actor")
    normalized_payload = _rating_payload(object_id, rating, reviewed_at, actor, request_id)
    payload_sha = stable_sha256(normalized_payload)

    loaded = load_review_events(review_dir)
    existing = _find_request(loaded.events, request_id)
    if existing:
        _assert_same_payload(existing, payload_sha)
        _assert_committed_replay(data_root, existing)
        return _replayed_result(existing)

    _assert_committed_logs(data_root, loaded)
    index, issues = build_object_index(objects_dir)
    if issues:
        raise ReviewFlowError("object_load_failed", "Object files could not be loaded.")
    record = index.get(object_id)
    if not record:
        raise ReviewFlowError("object_not_found", f"object not found: {object_id}")
    if record.object_type not in REVIEWABLE_TYPES:
        raise ReviewFlowError("object_not_reviewable", f"object type is not reviewable: {record.object_type}")

    current = build_current_view(objects_dir, review_dir, now=reviewed_at, write_object_projection=False)
    current_item = _find_current_item(current, object_id)
    previous = normalize_state(current_item if current_item else _state_from_object(record))
    ratings = [event for event in loaded.events if event.get("type") == "review_rating" and event.get("objectId") == object_id]
    # Corrections retain their target's chronological slot, including undo.
    latest_reviewed_at = ratings[-1]["reviewedAt"] if ratings else previous["lastReviewedAt"]
    if latest_reviewed_at and _parse_dt(reviewed_at) < _parse_dt(latest_reviewed_at):
        raise ReviewFlowError("review_time_regression", "new rating time must not precede the object's latest rating; use a correction for an existing event")
    resulting = apply_rating(previous, rating, reviewed_at)
    object_hash = object_content_hash(record)
    event = {
        "schemaVersion": SCHEMA_VERSION,
        "type": "review_rating",
        "id": _event_id("review", reviewed_at, payload_sha),
        "objectId": object_id,
        "objectType": record.object_type,
        "rating": rating,
        "ratingLabel": RATING_LABELS[rating],
        "reviewedAt": reviewed_at,
        "actor": actor,
        "requestId": request_id,
        "algorithmId": ALGORITHM_ID,
        "algorithmVersion": ALGORITHM_VERSION,
        "objectContentSha256": object_hash,
        "previousState": previous,
        "resultingState": resulting,
        "payloadSha256": payload_sha,
    }

    log_path = _append_event(review_dir, reviewed_at, event)
    current = build_current_view(objects_dir, review_dir, now=reviewed_at, write_object_projection=True,
                                 projection_object_ids={object_id})
    write_json(current_path, current)
    queue = build_queue_view_from_current(current, evaluated_at=reviewed_at)
    write_json(queue_path, queue)
    changed_paths = [log_path, current_path, queue_path, record.path]
    git_result = commit_data_root(data_root, changed_paths, f"review: rating {object_id} ({rating})") if commit else no_git_result("commit disabled")
    return {
        "ok": True,
        "status": "written",
        "event": event,
        "item": _find_current_item(current, object_id),
        **git_result,
    }


@_transactional
def run_rate_batch(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    current_path: Path,
    queue_path: Path,
    *,
    items: list[dict[str, Any]],
    reviewed_at: str,
    actor: str,
    request_id: str,
) -> dict[str, Any]:
    _require_data_git(data_root)
    if not isinstance(items, list):
        raise ReviewFlowError("invalid_items_json", "items must be a JSON array")
    request_id = _required_string(request_id, "request_id")
    reviewed_at = normalize_reviewed_at(reviewed_at)
    actor = _required_string(actor, "actor")
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    changed_paths: list[Path] = []
    loaded_before = _all_log_bytes(review_dir)

    for position, item in enumerate(items):
        if not isinstance(item, dict):
            failures.append({"objectId": "", "code": "invalid_batch_item", "message": f"items[{position}] must be an object", "requestId": ""})
            continue
        object_id = str(item.get("objectId", item.get("id", ""))).strip()
        item_request_id = _batch_item_request_id(request_id, object_id)
        try:
            result = run_rate(
                data_root,
                objects_dir,
                review_dir,
                current_path,
                queue_path,
                object_id=object_id,
                rating=_parse_rating(item.get("rating", item.get("score"))),
                reviewed_at=reviewed_at,
                actor=actor,
                request_id=item_request_id,
                commit=False,
            )
            event = result["event"]
            results.append({"objectId": object_id, "requestId": item_request_id, "status": result["status"], "eventId": event["id"]})
            changed_paths.extend(_paths_changed_since(review_dir, loaded_before))
            loaded_before = _all_log_bytes(review_dir)
        except ReviewFlowError as exc:
            if exc.code == "review_recovery_required":
                raise
            failures.append({"objectId": object_id, "code": exc.code, "message": exc.message, "requestId": item_request_id})

    wrote_any = any(item.get("status") == "written" for item in results)
    if wrote_any:
        git_result = commit_data_root(data_root, _unique_paths(changed_paths), f"review: ratings batch (n={len(results)})")
    else:
        git_result = no_git_result("no new successful review ratings")
    return {
        "ok": True,
        "status": "written" if wrote_any else ("replayed" if results else "failed"),
        "batchRequestId": request_id,
        "items": results,
        "failures": failures,
        **git_result,
    }


@_transactional
def run_correct(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    current_path: Path,
    queue_path: Path,
    *,
    target_event_id: str,
    corrected_rating: int | None,
    reason: str,
    actor: str,
    request_id: str,
    created_at: str | None = None,
) -> dict[str, Any]:
    _require_data_git(data_root)
    target_event_id = _required_string(target_event_id, "target_event_id")
    request_id = _required_string(request_id, "request_id")
    reason = _required_string(reason, "reason")
    actor = _required_string(actor, "actor")
    if corrected_rating is not None:
        corrected_rating = _parse_rating(corrected_rating)
    loaded = load_review_events(review_dir)
    normalized_payload = {
        "operation": "review-correct",
        "targetEventId": target_event_id,
        "correctedRating": corrected_rating,
        "actor": actor,
        "requestId": request_id,
        "reasonSha256": sha256(reason),
    }
    payload_sha = stable_sha256(normalized_payload)
    existing = _find_request(loaded.events, request_id)
    if existing:
        _assert_same_payload(existing, payload_sha)
        _assert_committed_replay(data_root, existing)
        return _replayed_result(existing)

    _assert_committed_logs(data_root, loaded)
    target = _find_event_by_id(loaded.events, target_event_id)
    if not target or target.get("type") != "review_rating":
        raise ReviewFlowError("target_event_not_found", f"review rating event not found: {target_event_id}")
    if not _is_latest_rating(loaded.events, target):
        raise ReviewFlowError("correction_target_not_latest", "MVP only allows correcting the latest effective rating")
    created_at = normalize_reviewed_at(created_at or _now_iso())

    event = {
        "schemaVersion": SCHEMA_VERSION,
        "type": "review_correction",
        "id": _event_id("review_correction", created_at, payload_sha),
        "targetEventId": target_event_id,
        "objectId": target.get("objectId"),
        "correctedRating": corrected_rating,
        "createdAt": created_at,
        "actor": actor,
        "requestId": request_id,
        "reasonChars": len(reason),
        "reasonSha256": sha256(reason),
        "payloadSha256": payload_sha,
    }
    if corrected_rating is not None:
        event["algorithmId"] = ALGORITHM_ID
        event["algorithmVersion"] = ALGORITHM_VERSION
        event["correctedResultingState"] = apply_rating(target.get("previousState"), corrected_rating, str(target.get("reviewedAt")))

    log_path = _append_event(review_dir, created_at, event)
    current = build_current_view(objects_dir, review_dir, now=created_at, write_object_projection=True,
                                 projection_object_ids={str(target.get("objectId") or "")})
    write_json(current_path, current)
    queue = build_queue_view_from_current(current, evaluated_at=created_at)
    write_json(queue_path, queue)
    index, _ = build_object_index(objects_dir)
    target_record = index.get(str(target.get("objectId") or ""))
    object_path = target_record.path if target_record else None
    changed = [path for path in [log_path, current_path, queue_path, object_path] if path is not None]
    git_result = commit_data_root(data_root, changed, f"review: correction {target_event_id}")
    return {
        "ok": True,
        "status": "written",
        "event": _sanitize_history_event(event),
        "item": _find_current_item(current, str(target.get("objectId") or "")),
        **git_result,
    }


@_transactional
def build_current_view(
    objects_dir: Path,
    review_dir: Path,
    *,
    now: str | None,
    write_object_projection: bool,
    projection_object_ids: set[str] | None = None,
) -> dict[str, Any]:
    generated_at = normalize_reviewed_at(now) if now else _now_iso()
    index, issues = build_object_index(objects_dir)
    if issues:
        raise ReviewFlowError("object_load_failed", "Object files could not be loaded.")
    loaded = load_review_events(review_dir)
    events_by_object: dict[str, list[dict[str, Any]]] = {}
    legacy_by_object: dict[str, list[dict[str, Any]]] = {}
    corrections_by_target = _latest_corrections_by_target(loaded.events)
    for event in loaded.events:
        if event.get("type") == "review_rating":
            events_by_object.setdefault(str(event.get("objectId") or ""), []).append(event)
        elif event.get("type") == "legacy_rating_row":
            legacy_by_object.setdefault(str(event.get("objectId") or event.get("id") or ""), []).append(event)

    items: list[dict[str, Any]] = []
    source_object_hashes: dict[str, str] = {}
    warnings: list[dict[str, Any]] = []

    for object_id, record in sorted(index.items()):
        if record.object_type not in REVIEWABLE_TYPES:
            continue
        object_hash = object_content_hash(record)
        source_object_hashes[object_id] = object_hash
        rating_events = events_by_object.get(object_id, [])
        legacy_warning = "legacy_unverified" if legacy_by_object.get(object_id) or not rating_events else None
        item = _current_item_from_record(record, object_hash, rating_events, corrections_by_target, legacy_warning)
        items.append(item)
        if legacy_warning:
            warnings.append({"code": "legacy_unverified", "objectId": object_id})
        if write_object_projection and (projection_object_ids is None or record.object_id in projection_object_ids):
            _write_object_srs_projection(record, item)

    for object_id, rating_events in sorted(events_by_object.items()):
        if object_id in index:
            continue
        item = _orphan_item(object_id, rating_events, corrections_by_target)
        items.append(item)
        warnings.append({"code": "orphan_review_event", "objectId": object_id})

    for object_id in sorted(legacy_by_object.keys()):
        if object_id in index or object_id in events_by_object:
            continue
        items.append(
            {
                "objectId": object_id,
                "objectType": "",
                "title": "",
                "status": "missing",
                **normalize_state(None),
                "contentChangedSinceLastReview": False,
                "legacyWarning": "legacy_unverified",
                "orphaned": True,
                "lastReviewEventId": None,
                "latestCorrectionEventId": None,
                "objectContentSha256": None,
            }
        )
        warnings.append({"code": "legacy_orphan_review_row", "objectId": object_id})

    items.sort(key=lambda item: (str(item.get("objectType") or ""), str(item.get("objectId") or "")))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "ok": True,
        "generatedAt": generated_at,
        "algorithmVersions": [{"algorithmId": ALGORITHM_ID, "algorithmVersion": ALGORITHM_VERSION}],
        "source": {
            "objectsDir": objects_dir.as_posix(),
            "reviewDir": review_dir.as_posix(),
            "objectHashes": source_object_hashes,
            "eventHashes": loaded.event_hashes,
            "sourceFiles": loaded.source_files,
        },
        "warnings": warnings,
        "items": items,
        "count": len(items),
    }


def build_queue_view_from_current(current: dict[str, Any], *, evaluated_at: str | None, limit: int | None = None) -> dict[str, Any]:
    evaluated = normalize_reviewed_at(evaluated_at) if evaluated_at else current["generatedAt"]
    evaluated_dt = _parse_dt(evaluated)
    due: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    counts = {
        "due": 0,
        "overdue": 0,
        "upcoming": 0,
        "legacyWarning": 0,
        "contentChanged": 0,
        "orphaned": 0,
    }
    for item in current.get("items", []):
        if item.get("orphaned"):
            counts["orphaned"] += 1
            continue
        if item.get("legacyWarning"):
            counts["legacyWarning"] += 1
        if item.get("contentChangedSinceLastReview"):
            counts["contentChanged"] += 1
        due_at = str(item.get("dueAt") or "1970-01-01T00:00:00Z")
        queue_item = _queue_item(item, evaluated_dt)
        if _parse_dt(due_at) <= evaluated_dt:
            due.append(queue_item)
        else:
            upcoming.append(queue_item)

    due.sort(key=lambda item: (-int(item["overdueDays"]), str(item["dueAt"]), str(item["objectType"]), str(item["objectId"])))
    upcoming.sort(key=lambda item: (str(item["dueAt"]), str(item["objectType"]), str(item["objectId"])))
    counts["due"] = len(due)
    counts["overdue"] = len([item for item in due if int(item["overdueDays"]) > 0])
    counts["upcoming"] = len(upcoming)
    clipped_limit = _normalize_limit(limit)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "ok": True,
        "generatedAt": current["generatedAt"],
        "evaluatedAt": evaluated,
        "due": due[:clipped_limit],
        "upcoming": upcoming[:clipped_limit],
        "counts": counts,
        "source": {
            "currentGeneratedAt": current["generatedAt"],
            "objectHashesSha256": stable_sha256(current.get("source", {}).get("objectHashes", {})),
            "eventHashesSha256": stable_sha256(current.get("source", {}).get("eventHashes", {})),
        },
    }


def load_review_events(review_dir: Path) -> LoadedEvents:
    logs_dir = review_dir / "logs"
    events: list[dict[str, Any]] = []
    event_hashes: dict[str, str] = {}
    source_files: list[dict[str, Any]] = []
    if not logs_dir.exists():
        return LoadedEvents(events, event_hashes, source_files)
    for path in sorted(logs_dir.glob("*.jsonl")):
        if path.name == "inbox_review_actions.jsonl":
            continue
        file_hash = file_sha256(path)
        source_files.append({"path": path.as_posix(), "sha256": file_hash})
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                raise ReviewFlowError("malformed_review_log", f"review/logs/{path.name}:{line_no}: invalid JSON") from None
            if not isinstance(row, dict):
                raise ReviewFlowError("malformed_review_log", f"review/logs/{path.name}:{line_no}: row must be an object")
            event = _normalize_event_row(row)
            event["_sourcePath"] = path.as_posix()
            event["_sourceLine"] = line_no
            event_hashes[str(event.get("id") or f"{path.name}:{line_no}")] = stable_sha256(row)
            events.append(event)
    return LoadedEvents(events, event_hashes, source_files)


def object_content_hash(record: ObjectRecord) -> str:
    data = {key: value for key, value in record.data.items() if key != "srs"}
    return stable_sha256(data)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    _remember_write(path)
    _replace_bytes(path, (json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))


@_transactional
def commit_data_root(data_root: Path, changed_paths: list[Path], message: str) -> dict[str, Any]:
    git_root = _require_data_git(data_root)
    data_root = data_root.resolve()
    git_root = git_root.resolve()
    transactions = _transactions.get()
    # Runtime caches never belong in an authority commit, including when ignored.
    if len(transactions) > 1:
        paths = sorted(set().union(*(transaction.authority_paths for transaction in transactions)), key=str)
    else:
        paths = [path for path in changed_paths if not _is_relative_to(path.resolve(), data_root / "runtime")]
    rels: list[str] = []
    for path in _unique_paths(paths):
        resolved = path.resolve()
        if not _is_relative_to(resolved, git_root):
            raise ReviewFlowError("git_path_outside_data_root", "changed authority path is outside Data Root")
        if resolved.exists():
            rels.append(resolved.relative_to(git_root).as_posix())
    if not rels:
        return no_git_result("no changed paths to commit")
    diff = _git(git_root, "diff", "--cached", "--quiet", check=False)
    if diff.returncode == 1:
        raise ReviewFlowError("data_root_staged_changes", "Data Root has pre-existing staged changes")
    if diff.returncode != 0:
        raise ReviewFlowError("git_commit_failed", GIT_FAILURE_MESSAGE)
    index_path = Path(_git(git_root, "rev-parse", "--git-path", "index").stdout.strip())
    if not index_path.is_absolute():
        index_path = git_root / index_path
    _remember_write(index_path)
    try:
        _git(git_root, "add", "--", *rels)
        diff = _git(git_root, "diff", "--cached", "--quiet", check=False)
        if diff.returncode not in (0, 1):
            raise ReviewFlowError("git_commit_failed", GIT_FAILURE_MESSAGE)
        staged = _git(git_root, "diff", "--cached", "--name-only", "-z").stdout.split("\0")
        staged = [path for path in staged if path]
        if set(staged) - set(rels):
            raise ReviewFlowError("data_root_staged_changes", "Git index contains unrelated staged changes")
        if diff.returncode != 0:
            _git(git_root, "commit", "--only", "-m", message, "--", *rels)
    except (OSError, subprocess.SubprocessError):
        raise ReviewFlowError("git_commit_failed", GIT_FAILURE_MESSAGE) from None
    if diff.returncode == 0:
        return no_git_result("no staged review changes")
    # A metadata lookup failure must not roll back an already accepted commit.
    warnings = []
    try:
        commit_hash = _git(git_root, "rev-parse", "HEAD").stdout.strip()
    except (OSError, subprocess.SubprocessError, ReviewFlowError):
        commit_hash = None
        warnings.append({"code": "git_commit_hash_unavailable", "message": "commit succeeded but HEAD lookup failed"})
    return {
        "gitCommitCreated": True,
        "commitHash": commit_hash,
        "changedFiles": staged,
        "warnings": warnings,
    }


def _git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["git", "-C", str(root), *args], check=check, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, encoding="utf-8")
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise ReviewFlowError("git_commit_failed", GIT_FAILURE_MESSAGE) from None


def no_git_result(message: str) -> dict[str, Any]:
    return {
        "gitCommitCreated": False,
        "commitHash": None,
        "changedFiles": [],
        "warnings": [{"code": "git_commit_not_created", "message": message}],
    }


def stable_sha256(value: Any) -> str:
    return sha256(json.dumps(_sort_value(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _normalize_event_row(row: dict[str, Any]) -> dict[str, Any]:
    row_type = row.get("type")
    if row_type == "review_rating" or row_type == "review_correction":
        return dict(row)
    if "score" in row and ("id" in row or "object_id" in row):
        legacy = dict(row)
        legacy["type"] = "legacy_rating_row"
        legacy["objectId"] = str(row.get("object_id", row.get("id")) or "")
        legacy["rating"] = row.get("score")
        legacy["reviewedAt"] = row.get("ts", row.get("reviewed_at", ""))
        legacy["legacyWarning"] = "legacy_unverified"
        return legacy
    return dict(row)


def _current_item_from_record(
    record: ObjectRecord,
    object_hash: str,
    rating_events: list[dict[str, Any]],
    corrections_by_target: dict[str, dict[str, Any]],
    legacy_warning: str | None,
) -> dict[str, Any]:
    state = _state_from_object(record)
    last_event_id = None
    last_event_hash = None
    latest_correction_id = None
    for event in rating_events:
        event_id = str(event.get("id") or "")
        correction = corrections_by_target.get(event_id)
        if correction:
            latest_correction_id = str(correction.get("id") or "")
            if correction.get("correctedRating") is None:
                state = normalize_state(event.get("previousState"))
            else:
                corrected_state = correction.get("correctedResultingState")
                state = normalize_state(corrected_state if isinstance(corrected_state, dict) else apply_rating(event.get("previousState"), int(correction["correctedRating"]), str(event["reviewedAt"])))
            last_event_id = event_id
            last_event_hash = str(event.get("objectContentSha256") or "")
            continue
        state = normalize_state(event.get("resultingState"))
        last_event_id = event_id
        last_event_hash = str(event.get("objectContentSha256") or "")
    changed = bool(last_event_hash and last_event_hash != object_hash)
    return {
        "objectId": record.object_id,
        "objectType": record.object_type,
        "title": str(record.data.get("title") or record.object_id),
        "status": record.status,
        **state,
        "contentChangedSinceLastReview": changed,
        "legacyWarning": legacy_warning,
        "orphaned": False,
        "lastReviewEventId": last_event_id,
        "latestCorrectionEventId": latest_correction_id,
        "objectContentSha256": object_hash,
    }


def _orphan_item(object_id: str, rating_events: list[dict[str, Any]], corrections_by_target: dict[str, dict[str, Any]]) -> dict[str, Any]:
    state = normalize_state(None)
    last_event_id = None
    latest_correction_id = None
    for event in rating_events:
        event_id = str(event.get("id") or "")
        correction = corrections_by_target.get(event_id)
        if correction:
            latest_correction_id = str(correction.get("id") or "")
            if correction.get("correctedRating") is None:
                state = normalize_state(event.get("previousState"))
            else:
                state = normalize_state(correction.get("correctedResultingState"))
            last_event_id = event_id
        else:
            state = normalize_state(event.get("resultingState"))
            last_event_id = event_id
    return {
        "objectId": object_id,
        "objectType": str(rating_events[-1].get("objectType") or "") if rating_events else "",
        "title": "",
        "status": "missing",
        **state,
        "contentChangedSinceLastReview": False,
        "legacyWarning": None,
        "orphaned": True,
        "lastReviewEventId": last_event_id,
        "latestCorrectionEventId": latest_correction_id,
        "objectContentSha256": None,
    }


def _state_from_object(record: ObjectRecord) -> dict[str, Any]:
    srs = record.data.get("srs")
    return normalize_state(srs if isinstance(srs, dict) else None)


def _write_object_srs_projection(record: ObjectRecord, item: dict[str, Any]) -> None:
    projection = {
        "due_at": item["dueAt"],
        "interval_days": item["intervalDays"],
        "ease": item["easeFactor"],
        "last_reviewed_at": item["lastReviewedAt"],
        "repetitions": item["repetitions"],
        "algorithm_id": ALGORITHM_ID,
        "algorithm_version": ALGORITHM_VERSION,
        "source_event_id": item.get("lastReviewEventId"),
        "projection_schema_version": SCHEMA_VERSION,
    }
    if record.data.get("srs") == projection:
        return
    _remember_write(record.path, authority=True)
    record.data["srs"] = projection
    issues = save_yaml(record.path, record.data)
    if issues:
        raise ReviewFlowError("object_projection_write_failed", "Object SRS projection could not be written.")


def _queue_item(item: dict[str, Any], evaluated_dt: datetime) -> dict[str, Any]:
    due_dt = _parse_dt(str(item.get("dueAt") or "1970-01-01T00:00:00Z"))
    overdue_days = max(0, int((evaluated_dt - due_dt).total_seconds() // 86400))
    return {
        "objectId": item["objectId"],
        "objectType": item["objectType"],
        "title": item["title"],
        "status": item["status"],
        "dueAt": item["dueAt"],
        "lastReviewedAt": item["lastReviewedAt"],
        "repetitions": item["repetitions"],
        "intervalDays": item["intervalDays"],
        "easeFactor": item["easeFactor"],
        "contentChangedSinceLastReview": item["contentChangedSinceLastReview"],
        "legacyWarning": item["legacyWarning"],
        "overdueDays": overdue_days,
    }


def _append_event(review_dir: Path, timestamp: str, event: dict[str, Any]) -> Path:
    date = normalize_reviewed_at(timestamp)[:10]
    path = review_dir / "logs" / f"{date}.jsonl"
    _remember_write(path, authority=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    for transaction in _transactions.get():
        transaction.appended_events.add(stable_sha256(event))
    return path


def _rating_payload(object_id: str, rating: int, reviewed_at: str, actor: str, request_id: str) -> dict[str, Any]:
    return {
        "operation": "review-rate",
        "objectId": object_id,
        "rating": rating,
        "reviewedAt": reviewed_at,
        "actor": actor,
        "requestId": request_id,
        "algorithmId": ALGORITHM_ID,
        "algorithmVersion": ALGORITHM_VERSION,
    }


def _batch_item_request_id(batch_request_id: str, object_id: str) -> str:
    return "batch-item-" + sha256(f"{batch_request_id}:{object_id}")[:32]


def _find_request(events: list[dict[str, Any]], request_id: str) -> dict[str, Any] | None:
    for event in events:
        if event.get("requestId") == request_id:
            return event
    return None


def _find_event_by_id(events: list[dict[str, Any]], event_id: str) -> dict[str, Any] | None:
    for event in events:
        if event.get("id") == event_id:
            return event
    return None


def _find_current_item(current: dict[str, Any], object_id: str) -> dict[str, Any] | None:
    for item in current.get("items", []):
        if item.get("objectId") == object_id:
            return item
    return None


def _latest_corrections_by_target(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    corrections: dict[str, dict[str, Any]] = {}
    for event in events:
        if event.get("type") == "review_correction":
            corrections[str(event.get("targetEventId") or "")] = event
    return corrections


def _is_latest_rating(events: list[dict[str, Any]], target: dict[str, Any]) -> bool:
    object_id = target.get("objectId")
    ratings = [event for event in events if event.get("type") == "review_rating" and event.get("objectId") == object_id]
    return bool(ratings) and ratings[-1].get("id") == target.get("id")


def _assert_same_payload(existing: dict[str, Any], payload_sha: str) -> None:
    if existing.get("payloadSha256") != payload_sha:
        raise ReviewFlowError("idempotency_conflict", "requestId was already used with a different review payload")


def _assert_committed_replay(data_root: Path, event: dict[str, Any]) -> None:
    authority = {key: value for key, value in event.items() if key not in {"_sourcePath", "_sourceLine"}}
    event_hash = stable_sha256(authority)
    if any(event_hash in transaction.appended_events for transaction in _transactions.get()):
        return
    git_root = _git_root(data_root)
    if git_root is None:
        return
    message = "review event is not confirmed in Data Root HEAD; explicit recovery is required before retry"
    if git_root.resolve() != data_root.resolve():
        raise ReviewFlowError("review_recovery_required", message)
    source = Path(str(event.get("_sourcePath") or "")).resolve()
    if not _is_relative_to(source, git_root.resolve()):
        raise ReviewFlowError("review_recovery_required", message)
    relative = source.relative_to(git_root.resolve()).as_posix()
    try:
        committed = _git(git_root, "show", f"HEAD:{relative}")
        for line in committed.stdout.splitlines():
            if line.strip() and stable_sha256(json.loads(line)) == event_hash:
                return
    except (OSError, subprocess.SubprocessError, ValueError, ReviewFlowError):
        pass
    raise ReviewFlowError("review_recovery_required", message)


def _assert_committed_logs(data_root: Path, loaded: LoadedEvents) -> None:
    in_flight = set().union(*(transaction.authority_paths for transaction in _transactions.get()))
    paths = [Path(source["path"]).resolve() for source in loaded.source_files]
    paths = [path for path in paths if path not in in_flight]
    if not paths:
        return
    git_root = _git_root(data_root)
    if git_root is None:
        return
    root = data_root.resolve()
    message = "review logs contain uncommitted changes; explicit recovery is required before writing"
    if git_root.resolve() != root or any(not _is_relative_to(path, root) for path in paths):
        raise ReviewFlowError("review_recovery_required", message)
    rels = [path.relative_to(root).as_posix() for path in paths]
    try:
        _git(root, "ls-files", "--error-unmatch", "--", *rels)
        result = _git(root, "diff", "--quiet", "HEAD", "--", *rels, check=False)
        if result.returncode == 0:
            return
    except (OSError, subprocess.SubprocessError, ReviewFlowError):
        pass
    raise ReviewFlowError("review_recovery_required", message)


def _replayed_result(existing: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "status": "replayed",
        "event": _sanitize_history_event(existing),
        **no_git_result("idempotent replay did not create a new commit"),
    }


def _sanitize_history_event(event: dict[str, Any]) -> dict[str, Any]:
    hidden = {"_sourcePath", "_sourceLine", "reason"}
    return {key: value for key, value in event.items() if key not in hidden}


def _parse_rating(value: Any) -> int:
    if type(value) is not int or value not in RATING_LABELS:
        raise ReviewFlowError("invalid_rating", "rating must be an integer from 1 to 5")
    return value


def _required_string(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ReviewFlowError("invalid_input", f"{field} must not be empty")
    return text


def _normalize_limit(value: int | None) -> int:
    if value is None:
        return DEFAULT_QUEUE_LIMIT
    return max(1, min(int(value), MAX_QUEUE_LIMIT))


def _parse_dt(value: str) -> datetime:
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _event_id(prefix: str, timestamp: str, payload_sha: str) -> str:
    compact = normalize_reviewed_at(timestamp).replace("-", "").replace(":", "").replace("T", "_").replace("Z", "")
    return f"{prefix}_{compact}_{payload_sha[:12]}"


def _all_log_bytes(review_dir: Path) -> dict[Path, bytes]:
    logs_dir = review_dir / "logs"
    if not logs_dir.exists():
        return {}
    return {path: path.read_bytes() for path in sorted(logs_dir.glob("*.jsonl")) if path.name != "inbox_review_actions.jsonl"}


def _paths_changed_since(review_dir: Path, before: dict[Path, bytes]) -> list[Path]:
    changed: list[Path] = []
    after = _all_log_bytes(review_dir)
    for path, data in after.items():
        if before.get(path) != data:
            changed.append(path)
    return changed


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path.resolve())
        if key in seen:
            continue
        seen.add(key)
        result.append(path)
    return result


def _require_data_git(data_root: Path) -> Path:
    root = _git_root(data_root)
    if root is None or root.resolve() != data_root.resolve():
        raise ReviewFlowError("data_root_git_required", "Review writes require a Git working tree rooted exactly at PKOS_DATA_ROOT")
    return root.resolve()


def _git_root(data_root: Path) -> Path | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(data_root), "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
    except Exception:
        return None
    return Path(result.stdout.strip())


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _sort_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_value(value[key]) for key in sorted(value)}
    return value
