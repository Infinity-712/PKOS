from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import wraps
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any

from tools.common.data_root_lock import DataRootLockTimeout, data_root_lock
from tools.common.object_store import ObjectRecord, build_object_index, load_object_records
from tools.common.schema import load_schema_registry, validate_object
from tools.common.yaml_io import DataIssue, save_yaml
from tools.object_flow.render import SECTION_FIELDS, render_object
from tools.review_flow.review import (
    ReviewFlowError,
    build_current_view,
    load_review_events,
    object_content_hash,
    run_rebuild as run_review_rebuild,
    stable_sha256,
)
from tools.pkos_paths import display_data_path, get_core_root

SCHEMA_VERSION = "0.8-beta"
OBJECT_TYPES = ("fact", "claim", "skill", "creative")
REVIEWABLE_TYPES = {"fact", "skill", "claim"}
IMMUTABLE_FIELDS = {"id", "type", "created_at", "srs"}
SERVER_FIELDS = {"updated_at", "fileRevisionSha256", "objectContentSha256"}
MIN_ID_CHARS = 3
MAX_ID_CHARS = 64
MAX_ACTOR_CHARS = 128
MAX_REASON_CHARS = 4000
OBJECT_ID_PATTERN_TEXT = r"^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$"
OBJECT_ID_PATTERN = re.compile(OBJECT_ID_PATTERN_TEXT)


class ObjectFlowError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class GitReady:
    root: Path
    fingerprint: str


def _with_object_lock(function):
    @wraps(function)
    def locked(data_root: Path, *args, **kwargs):
        try:
            with data_root_lock(data_root):
                return function(data_root, *args, **kwargs)
        except DataRootLockTimeout as exc:
            raise ObjectFlowError("data_root_busy", "Data Root is busy; retry this request") from exc

    return locked


def run_type_contracts(schema_dir: Path) -> dict[str, Any]:
    registry = _schema_registry(schema_dir)
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "types": [_type_contract(object_type, registry.by_type[object_type]) for object_type in OBJECT_TYPES],
    }


@_with_object_lock
def run_list(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    *,
    object_type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    _validate_optional_type(object_type)
    object_type = object_type or None
    query = (q or "").strip().lower()
    index_payload = _build_index_payload(objects_dir, review_dir)
    items = list(index_payload["items"])
    if object_type:
        items = [item for item in items if item["type"] == object_type]
    if status:
        items = [item for item in items if item["status"] == status]
    if query:
        items = [
            item
            for item in items
            if query in str(item.get("id", "")).lower()
            or query in str(item.get("title", "")).lower()
            or query in str(item.get("summary", "")).lower()
        ]
    clipped = _limit(limit)
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": index_payload["generatedAt"],
        "count": len(items[:clipped]),
        "totalCount": len(items),
        "filters": {"type": object_type, "status": status, "q": q or "", "limit": clipped},
        "items": items[:clipped],
        "source": index_payload["source"],
        "dataRootFingerprint": _data_root_fingerprint(data_root),
    }


@_with_object_lock
def run_get(data_root: Path, objects_dir: Path, review_dir: Path, schema_dir: Path, object_id: str) -> dict[str, Any]:
    record = _load_record(objects_dir, _normalize_object_id(object_id))
    file_revision = file_sha256(record.path)
    content_hash = object_content_hash(record)
    review_item = _review_item(objects_dir, review_dir, record.object_id)
    registry = _schema_registry(schema_dir)
    contract = _type_contract(record.object_type, registry.by_type[record.object_type])
    additional = sorted(key for key in record.data.keys() if key not in set(contract["editableFields"]) | set(contract["immutableFields"]) | SERVER_FIELDS)
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "object": record.data,
        "location": _safe_location(objects_dir, record.path),
        "fileRevisionSha256": file_revision,
        "objectContentSha256": content_hash,
        "srsEligible": record.object_type in REVIEWABLE_TYPES,
        "contentChangedSinceLastReview": bool((review_item or {}).get("contentChangedSinceLastReview")),
        "reviewSummary": _review_summary(review_item),
        "editableFields": contract["editableFields"],
        "immutableFields": contract["immutableFields"],
        "additionalFields": additional,
        "dataRootFingerprint": _data_root_fingerprint(data_root),
    }


@_with_object_lock
def run_render(data_root: Path, objects_dir: Path, review_dir: Path, object_id: str) -> dict[str, Any]:
    record = _load_record(objects_dir, _normalize_object_id(object_id))
    rendered = render_object(record.data, object_content_sha256=object_content_hash(record))
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "objectId": record.object_id,
        "objectType": record.object_type,
        "fileRevisionSha256": file_sha256(record.path),
        "dataRootFingerprint": _data_root_fingerprint(data_root),
        **rendered,
    }


@_with_object_lock
def run_rebuild(data_root: Path, objects_dir: Path, review_dir: Path, index_path: Path) -> dict[str, Any]:
    _validate_projection_paths(data_root, index_path)
    payload = _build_index_payload(objects_dir, review_dir)
    _write_json(index_path, payload)
    return {"ok": True, "status": "rebuilt", "dataRootFingerprint": _data_root_fingerprint(data_root), **payload}


@_with_object_lock
def run_create(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    schema_dir: Path,
    index_path: Path,
    current_path: Path,
    queue_path: Path,
    *,
    payload: dict[str, Any],
    actor: str,
    request_id: str,
    confirmed: bool,
) -> dict[str, Any]:
    _require_confirmation(confirmed)
    _validate_projection_paths(data_root, index_path, current_path, queue_path)
    actor = _required_string(actor, "actor", MAX_ACTOR_CHARS)
    request_id = _required_string(request_id, "requestId", 128)
    _reject_forbidden_client_fields(payload, {"created_at", "updated_at", "srs"})
    object_id = _normalize_object_id(payload.get("id"))
    object_type = _normalize_type(payload.get("type"))
    _assert_id_matches_type(object_id, object_type)
    normalized_payload = _mutation_payload("object-create", request_id, actor, {"object": payload})
    payload_sha = stable_sha256(normalized_payload)
    replay = _find_request(data_root, request_id)
    if replay:
        _assert_same_payload(replay, payload_sha)
        _assert_committed_request(data_root, replay)
        return _replay_payload(data_root, objects_dir, replay, "created")

    ready = _require_git_clean(data_root)
    _assert_not_tombstoned(data_root, object_id)
    index, issues = build_object_index(objects_dir)
    _raise_load_issues(issues)
    if object_id in index:
        raise ObjectFlowError("object_id_exists", f"object id already exists: {object_id}")
    target = _canonical_path(objects_dir, object_type, object_id)
    _assert_no_path_collision(objects_dir, target)

    registry = _schema_registry(schema_dir)
    data = _normalized_create_data(payload, object_type, registry.by_type[object_type])
    action_path = _action_log_path(data_root)
    preimages = _capture_preimages([target, action_path])
    try:
        _save_validated(target, data, registry)
        _rebuild_review_and_index(data_root, objects_dir, review_dir, current_path, queue_path, index_path, projection_object_id=object_id)
        record = _load_record(objects_dir, object_id)
        file_revision = file_sha256(record.path)
        content_hash = object_content_hash(record)
        event = _action_event(
            "object_created",
            object_id,
            object_type,
            actor,
            request_id,
            payload_sha,
            file_revision,
            content_hash,
        )
        event["location"] = _safe_location(objects_dir, record.path)
        _append_jsonl(action_path, event)
        commit = _commit_exact(ready.root, [record.path, action_path], f"object: create {object_id}")
    except ReviewFlowError as exc:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [target, action_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise ObjectFlowError(exc.code, exc.message) from exc
    except Exception:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [target, action_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise
    return {
        "ok": True,
        "status": "created",
        "objectId": object_id,
        "objectType": object_type,
        "fileRevisionSha256": file_revision,
        "objectContentSha256": content_hash,
        "location": _safe_location(objects_dir, record.path),
        "dataRootFingerprint": ready.fingerprint,
        **commit,
    }


@_with_object_lock
def run_update(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    schema_dir: Path,
    index_path: Path,
    current_path: Path,
    queue_path: Path,
    *,
    object_id: str,
    patch: dict[str, Any],
    base_revision: str,
    actor: str,
    request_id: str,
    confirmed: bool,
) -> dict[str, Any]:
    _require_confirmation(confirmed)
    _validate_projection_paths(data_root, index_path, current_path, queue_path)
    actor = _required_string(actor, "actor", MAX_ACTOR_CHARS)
    request_id = _required_string(request_id, "requestId", 128)
    object_id = _normalize_object_id(object_id)
    base_revision = _required_sha256(base_revision, "baseRevision")
    normalized_payload = _mutation_payload(
        "object-update",
        request_id,
        actor,
        {"objectId": object_id, "patch": patch, "baseRevision": base_revision},
    )
    payload_sha = stable_sha256(normalized_payload)
    replay = _find_request(data_root, request_id)
    if replay:
        _assert_same_payload(replay, payload_sha)
        _assert_committed_request(data_root, replay)
        return _replay_payload(data_root, objects_dir, replay, "updated")

    ready = _require_git_clean(data_root)
    record = _load_record(objects_dir, object_id)
    if file_sha256(record.path) != base_revision:
        raise ObjectFlowError("object_revision_conflict", "object changed outside this editor")
    registry = _schema_registry(schema_dir)
    contract = _type_contract(record.object_type, registry.by_type[record.object_type])
    editable = set(contract["editableFields"])
    _reject_patch_fields(patch, editable)
    _validate_field_values(patch, contract)
    if record.object_type in REVIEWABLE_TYPES and patch.get("status") == "trusted" and record.status not in {"challenged", "trusted"}:
        raise ObjectFlowError("invalid_status_transition", "trusted requires an existing challenged object and human confirmation")
    next_data = dict(record.data)
    for key, value in patch.items():
        next_data[key] = value
    next_data["updated_at"] = _now_iso()

    action_path = _action_log_path(data_root)
    preimages = _capture_preimages([record.path, action_path])
    try:
        _save_validated(record.path, next_data, registry)
        _rebuild_review_and_index(data_root, objects_dir, review_dir, current_path, queue_path, index_path, projection_object_id=object_id)
        updated_record = _load_record(objects_dir, object_id)
        file_revision = file_sha256(updated_record.path)
        content_hash = object_content_hash(updated_record)
        event = _action_event(
            "object_updated",
            object_id,
            updated_record.object_type,
            actor,
            request_id,
            payload_sha,
            file_revision,
            content_hash,
        )
        event["baseRevisionSha256"] = base_revision
        event["location"] = _safe_location(objects_dir, updated_record.path)
        _append_jsonl(action_path, event)
        commit = _commit_exact(ready.root, [updated_record.path, action_path], f"object: update {object_id}")
    except ReviewFlowError as exc:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [record.path, action_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise ObjectFlowError(exc.code, exc.message) from exc
    except Exception:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [record.path, action_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise
    return {
        "ok": True,
        "status": "updated",
        "objectId": object_id,
        "objectType": updated_record.object_type,
        "fileRevisionSha256": file_revision,
        "objectContentSha256": content_hash,
        "location": _safe_location(objects_dir, updated_record.path),
        "dataRootFingerprint": ready.fingerprint,
        **commit,
    }


@_with_object_lock
def run_delete_preflight(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    *,
    object_id: str,
    base_revision: str | None = None,
) -> dict[str, Any]:
    object_id = _normalize_object_id(object_id)
    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    tombstone_exists = _tombstone_exists(data_root, object_id)
    ready: GitReady | None = None
    try:
        ready = _git_ready(data_root)
        if _git_status(ready.root):
            blockers.append({"code": "data_root_dirty", "message": "Data Root Git worktree is not clean"})
    except ObjectFlowError as exc:
        blockers.append({"code": exc.code, "message": exc.message})

    record = _load_record_lenient(objects_dir, object_id)
    file_revision = file_sha256(record.path)
    if base_revision and base_revision != file_revision:
        blockers.append({"code": "object_revision_conflict", "message": "object changed outside this editor"})
    if tombstone_exists:
        blockers.append({"code": "object_id_tombstoned", "message": "object id already has a deletion tombstone"})

    parse_blockers = _object_parse_blockers(objects_dir, object_id)
    blockers.extend(parse_blockers)
    object_refs = _scan_object_references(objects_dir, object_id)
    publish_refs = _scan_legacy_publish_references(data_root, object_id)
    task_refs = _scan_jsonl_references(data_root / "tasks", object_id)
    reminder_refs = _scan_jsonl_references(data_root / "reminders", object_id)
    digest_refs = _scan_text_references(data_root / "digests", object_id)
    blockers.extend({"code": "object_reference", "message": ref["location"], "reference": ref} for ref in object_refs)
    blockers.extend({"code": "publish_reference", "message": ref["location"], "reference": ref} for ref in publish_refs)
    blockers.extend({"code": "task_reference", "message": ref["location"], "reference": ref} for ref in task_refs)
    blockers.extend({"code": "reminder_reference", "message": ref["location"], "reference": ref} for ref in reminder_refs)
    if digest_refs:
        warnings.extend({"code": "digest_reference", "message": ref["location"], "reference": ref} for ref in digest_refs)

    review_count = _review_event_count(review_dir, object_id)
    if review_count:
        warnings.append({"code": "review_history_retained", "message": "review history will be retained and become orphaned", "count": review_count})

    coverage.extend(
        [
            {"scanner": "objectReferences", "status": "complete", "notes": "YAML object fields are scanned for exact object id values/substrings."},
            {"scanner": "publishReferences", "status": "complete", "notes": "Retired legacy publish/blog directories are scanned if present under Data Root."},
            {"scanner": "taskReferences", "status": "complete", "notes": "Task JSONL authority is scanned for exact object id references."},
            {"scanner": "reminderReferences", "status": "complete", "notes": "Reminder JSONL authority is scanned for exact object id references."},
            {"scanner": "digestReferences", "status": "complete", "notes": "Digest text references are warnings because digests are derived/archive layers."},
            {"scanner": "reviewHistory", "status": "complete", "notes": "Review logs are counted and retained; they do not block delete."},
        ]
    )
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "objectId": object_id,
        "objectType": record.object_type,
        "fileRevisionSha256": file_revision,
        "objectContentSha256": object_content_hash(record),
        "reviewEventCount": review_count,
        "objectReferences": object_refs,
        "publishReferences": publish_refs,
        "taskReferences": task_refs,
        "reminderReferences": reminder_refs,
        "digestReferences": digest_refs,
        "tombstoneExists": tombstone_exists,
        "blockers": blockers,
        "warnings": warnings,
        "referenceCoverage": coverage,
        "canDelete": len(blockers) == 0,
        "dataRootFingerprint": ready.fingerprint if ready else _data_root_fingerprint(data_root),
    }


@_with_object_lock
def run_delete(
    data_root: Path,
    objects_dir: Path,
    review_dir: Path,
    index_path: Path,
    current_path: Path,
    queue_path: Path,
    *,
    object_id: str,
    typed_object_id: str,
    base_revision: str,
    reason: str,
    actor: str,
    request_id: str,
    confirmed: bool,
) -> dict[str, Any]:
    _require_confirmation(confirmed)
    _validate_projection_paths(data_root, index_path, current_path, queue_path)
    actor = _required_string(actor, "actor", MAX_ACTOR_CHARS)
    reason = _required_string(reason, "reason", MAX_REASON_CHARS, code="invalid_reason")
    request_id = _required_string(request_id, "requestId", 128)
    object_id = _normalize_object_id(object_id)
    typed_object_id = _normalize_object_id(typed_object_id)
    if object_id != typed_object_id:
        raise ObjectFlowError("typed_object_id_mismatch", "typedObjectId must match objectId")
    base_revision = _required_sha256(base_revision, "baseRevision")
    normalized_payload = _mutation_payload(
        "object-delete",
        request_id,
        actor,
        {"objectId": object_id, "typedObjectId": typed_object_id, "baseRevision": base_revision, "reasonSha256": sha256_text(reason)},
    )
    payload_sha = stable_sha256(normalized_payload)
    replay = _find_request(data_root, request_id)
    if replay:
        _assert_same_payload(replay, payload_sha)
        _assert_committed_request(data_root, replay)
        return {
            "ok": True,
            "status": "replayed",
            "objectId": object_id,
            "gitCommitCreated": False,
            "commitHash": None,
            "changedFiles": [],
            "dataRootFingerprint": _data_root_fingerprint(data_root),
        }

    preflight = run_delete_preflight(data_root, objects_dir, review_dir, object_id=object_id, base_revision=base_revision)
    if preflight["blockers"]:
        raise ObjectFlowError("deletion_blocked", "delete preflight has blockers")
    ready = _require_git_clean(data_root)
    record = _load_record(objects_dir, object_id)
    tombstone_path = _deletion_log_path(data_root)
    preimages = _capture_preimages([record.path, tombstone_path])
    object_file_sha = file_sha256(record.path)
    content_hash = object_content_hash(record)
    tombstone = {
        "schemaVersion": SCHEMA_VERSION,
        "type": "object_deleted",
        "id": _event_id("object_deleted", request_id, payload_sha),
        "objectId": object_id,
        "objectType": record.object_type,
        "objectFileSha256": object_file_sha,
        "objectContentSha256": content_hash,
        "deletedAt": _now_iso(),
        "actor": actor,
        "requestId": request_id,
        "reason": reason,
        "reasonSha256": sha256_text(reason),
        "payloadSha256": payload_sha,
    }
    try:
        record.path.unlink()
        _append_jsonl(tombstone_path, tombstone)
        _rebuild_review_and_index(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        commit = _commit_exact(ready.root, [record.path, tombstone_path], f"object: delete {object_id}")
    except ReviewFlowError as exc:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [record.path, tombstone_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise ObjectFlowError(exc.code, exc.message) from exc
    except Exception:
        _restore_preimages(preimages)
        _restore_git_index_best_effort(ready.root, [record.path, tombstone_path])
        _rebuild_runtime_best_effort(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
        raise
    return {
        "ok": True,
        "status": "deleted",
        "objectId": object_id,
        "objectType": record.object_type,
        "fileRevisionSha256": object_file_sha,
        "objectContentSha256": content_hash,
        "tombstonePath": display_data_path(tombstone_path),
        "dataRootFingerprint": ready.fingerprint,
        **commit,
    }


def _schema_registry(schema_dir: Path):
    registry, issues = load_schema_registry(schema_dir)
    if issues:
        _raise_load_issues(issues)
    if registry is None:
        raise ObjectFlowError("schema_load_failed", "object schema registry could not be loaded")
    missing = [object_type for object_type in OBJECT_TYPES if object_type not in registry.by_type]
    if missing:
        raise ObjectFlowError("schema_load_failed", f"schema missing types: {', '.join(missing)}")
    return registry


def _type_contract(object_type: str, schema: dict[str, Any]) -> dict[str, Any]:
    required = [str(item) for item in schema.get("required_fields", [])]
    status_enum = list((schema.get("enum_fields") or {}).get("status", []))
    editable = set(required) | set(str(item) for item in schema.get("optional_fields", []))
    editable.update({"status", "title", "summary", "content"})
    for rule in schema.get("field_rules", []) + schema.get("trusted_rules", []):
        field = rule.get("field")
        if isinstance(field, str):
            editable.add(field)
        for field in rule.get("fields", []) if isinstance(rule.get("fields"), list) else []:
            editable.add(str(field))
    editable.difference_update(IMMUTABLE_FIELDS)
    supported_sections = [field for field in SECTION_FIELDS if field in editable]
    return {
        "type": object_type,
        "editableFields": sorted(editable),
        "requiredFields": required,
        "statusEnum": status_enum,
        "fieldTypes": _field_types(required, editable),
        "srsEligible": object_type in REVIEWABLE_TYPES,
        "immutableFields": sorted(IMMUTABLE_FIELDS),
        "supportedSupplementarySections": supported_sections,
        "objectId": _object_id_contract(object_type),
    }


def _object_id_contract(object_type: str) -> dict[str, Any]:
    return {
        "minLength": MIN_ID_CHARS,
        "maxLength": MAX_ID_CHARS,
        "pattern": OBJECT_ID_PATTERN_TEXT,
        "humanReadablePattern": (
            "Allowed / 允许: 3-64 ASCII chars; lowercase letters and numbers; dot, hyphen, or underscore separators; "
            "must start with the selected type prefix, such as fact.example."
        ),
        "example": f"{object_type}.example",
        "prefixRequirement": "must_start_with_type_dot",
    }


def _field_types(required: list[str], editable: set[str]) -> dict[str, str]:
    arrays = {"source", "anchors", "tags", "verification_sources", "counter_examples", "easiest_mistakes", "practice_log", "counter_arguments", "invalidation_conditions", "failure_conditions", "evidence", "assumptions", "common_mistakes"}
    long_text = {"content", "definition", "explanation", "notes", "body", "text", "summary"}
    result: dict[str, str] = {}
    for field in sorted(set(required) | editable):
        result[field] = "string_list" if field in arrays else ("multiline_string" if field in long_text else "string")
    return result


def _normalized_create_data(payload: dict[str, Any], object_type: str, schema: dict[str, Any]) -> dict[str, Any]:
    contract = _type_contract(object_type, schema)
    allowed = set(contract["editableFields"]) | {"id", "type"}
    for key in payload:
        if key not in allowed:
            raise ObjectFlowError("invalid_object_field", f"field is not allowed for create: {key}")
    _validate_field_values(payload, contract)
    if object_type in REVIEWABLE_TYPES and payload.get("status") == "trusted":
        raise ObjectFlowError("invalid_status_transition", "new objects cannot start as trusted; use the human review lifecycle")
    now = _now_iso()
    data = dict(payload)
    data["id"] = _normalize_object_id(data.get("id"))
    data["type"] = object_type
    data["created_at"] = now
    data["updated_at"] = now
    return data


def _validate_field_values(payload: dict[str, Any], contract: dict[str, Any]) -> None:
    for field, value in payload.items():
        kind = contract["fieldTypes"].get(field)
        if kind == "string_list":
            valid = isinstance(value, list) and all(isinstance(item, str) for item in value)
        else:
            valid = isinstance(value, str)
        if not valid:
            raise ObjectFlowError("schema_validation_failed", f"{field} must have type {kind or 'string'}")


def _validate_projection_paths(data_root: Path, index_path: Path, current_path: Path | None = None, queue_path: Path | None = None) -> None:
    root = data_root.resolve()
    seen: set[Path] = set()
    for path, folder in ((index_path, "objects"), (current_path, "review"), (queue_path, "review")):
        if path is None:
            continue
        resolved = path.resolve()
        allowed = root / "runtime" / folder
        if not _is_relative_to(resolved, allowed) or resolved.suffix != ".json" or resolved in seen:
            raise ObjectFlowError("unsafe_projection_path", "projection outputs must be distinct JSON files inside their Data Root runtime directory")
        seen.add(resolved)


def _reject_forbidden_client_fields(payload: dict[str, Any], fields: set[str]) -> None:
    for key in fields:
        if key in payload:
            raise ObjectFlowError("immutable_field", f"field is server-managed or immutable: {key}")


def _reject_patch_fields(patch: dict[str, Any], editable: set[str]) -> None:
    for key in patch:
        if key in IMMUTABLE_FIELDS:
            raise ObjectFlowError("immutable_field", f"field is immutable: {key}")
        if key in SERVER_FIELDS:
            raise ObjectFlowError("immutable_field", f"field is server-managed: {key}")
        if key not in editable:
            raise ObjectFlowError("invalid_object_field", f"field is not editable: {key}")


def _save_validated(path: Path, data: dict[str, Any], registry: Any) -> None:
    object_type = str(data.get("type") or "")
    schema = registry.by_type.get(object_type)
    if not schema:
        raise ObjectFlowError("invalid_object_type", f"unsupported object type: {object_type}")
    validation_path = Path("objects") / object_type / path.name
    issues = validate_object(data, schema, {"path": validation_path.as_posix()})
    if issues:
        raise ObjectFlowError("schema_validation_failed", _format_issues(issues))
    write_issues = save_yaml(path, data)
    if write_issues:
        _raise_load_issues(write_issues, code="object_write_failed")


def _build_index_payload(objects_dir: Path, review_dir: Path) -> dict[str, Any]:
    records, issues = load_object_records(objects_dir)
    _raise_load_issues(issues)
    seen: set[str] = set()
    duplicate_issues: list[DataIssue] = []
    clean_records: list[ObjectRecord] = []
    for record in records:
        if record.object_id in seen:
            duplicate_issues.append(DataIssue(record.path, "id", f"duplicate object id: {record.object_id}"))
            continue
        seen.add(record.object_id)
        clean_records.append(record)
    _raise_load_issues(duplicate_issues)
    review_by_id = _review_items_by_id(objects_dir, review_dir)
    items = []
    source_hashes = {}
    for record in clean_records:
        file_revision = file_sha256(record.path)
        content_hash = object_content_hash(record)
        source_hashes[_safe_location(objects_dir, record.path)] = file_revision
        review_item = review_by_id.get(record.object_id)
        items.append(
            {
                "id": record.object_id,
                "type": record.object_type,
                "status": record.status,
                "title": str(record.data.get("title") or record.object_id),
                "summary": str(record.data.get("summary") or ""),
                "updatedAt": str(record.data.get("updated_at") or ""),
                "fileRevisionSha256": file_revision,
                "objectContentSha256": content_hash,
                "srsEligible": record.object_type in REVIEWABLE_TYPES,
                "contentChangedSinceLastReview": bool((review_item or {}).get("contentChangedSinceLastReview")),
                "location": _safe_location(objects_dir, record.path),
            }
        )
    items.sort(key=lambda item: (str(item.get("updatedAt") or ""), str(item.get("type") or ""), str(item.get("id") or "")), reverse=True)
    # Reverse above also reverses type/id; restore deterministic secondary ordering for equal updatedAt.
    items = sorted(items, key=lambda item: (-_timestamp_sort_key(str(item.get("updatedAt") or "")), str(item.get("type") or ""), str(item.get("id") or "")))
    generated_at = _now_iso()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "source": {
            "objectsDir": objects_dir.as_posix(),
            "objectCount": len(items),
            "sourceHashes": source_hashes,
            "sourceHashesSha256": stable_sha256(source_hashes),
        },
        "items": items,
        "count": len(items),
    }


def _review_items_by_id(objects_dir: Path, review_dir: Path) -> dict[str, dict[str, Any]]:
    try:
        current = build_current_view(objects_dir, review_dir, now=None, write_object_projection=False)
    except ReviewFlowError:
        return {}
    return {str(item.get("objectId") or ""): item for item in current.get("items", []) if isinstance(item, dict)}


def _review_item(objects_dir: Path, review_dir: Path, object_id: str) -> dict[str, Any] | None:
    return _review_items_by_id(objects_dir, review_dir).get(object_id)


def _review_summary(item: dict[str, Any] | None) -> dict[str, Any] | None:
    if not item:
        return None
    return {
        "dueAt": item.get("dueAt"),
        "lastReviewedAt": item.get("lastReviewedAt"),
        "intervalDays": item.get("intervalDays"),
        "easeFactor": item.get("easeFactor"),
        "repetitions": item.get("repetitions"),
        "contentChangedSinceLastReview": item.get("contentChangedSinceLastReview"),
        "legacyWarning": item.get("legacyWarning"),
        "orphaned": item.get("orphaned"),
    }


def _rebuild_review_and_index(data_root: Path, objects_dir: Path, review_dir: Path, current_path: Path, queue_path: Path, index_path: Path, *, projection_object_id: str | None = None) -> None:
    run_review_rebuild(
        objects_dir, review_dir, current_path, queue_path, now=None, data_root=data_root,
        write_object_projection=projection_object_id is not None,
        projection_object_ids={projection_object_id} if projection_object_id else set(),
    )
    payload = _build_index_payload(objects_dir, review_dir)
    _write_json(index_path, payload)


def _rebuild_runtime_best_effort(data_root: Path, objects_dir: Path, review_dir: Path, current_path: Path, queue_path: Path, index_path: Path) -> None:
    try:
        _rebuild_review_and_index(data_root, objects_dir, review_dir, current_path, queue_path, index_path)
    except Exception:
        return


def _load_record(objects_dir: Path, object_id: str) -> ObjectRecord:
    index, issues = build_object_index(objects_dir)
    _raise_load_issues(issues)
    record = index.get(object_id)
    if not record:
        raise ObjectFlowError("object_not_found", f"object not found: {object_id}")
    _normalize_type(record.object_type)
    return record


def _load_record_lenient(objects_dir: Path, object_id: str) -> ObjectRecord:
    records, issues = load_object_records(objects_dir)
    for record in records:
        if record.object_id == object_id:
            _normalize_type(record.object_type)
            return record
    _raise_load_issues(issues)
    raise ObjectFlowError("object_not_found", f"object not found: {object_id}")


def _raise_load_issues(issues: list[DataIssue], *, code: str = "object_load_failed") -> None:
    if issues:
        raise ObjectFlowError(code, _format_issues(issues))


def _format_issues(issues: list[DataIssue]) -> str:
    return "; ".join(f"{_safe_issue_path(issue.path)} :: {issue.field_path} :: {issue.message}" for issue in issues)


def _safe_issue_path(path: Path) -> str:
    parts = path.parts
    for marker in ("objects", "review", "digests", "tasks", "reminders", "runtime"):
        if marker in parts:
            return Path(*parts[parts.index(marker) :]).as_posix()
    if path.is_absolute():
        return path.name or "<path>"
    return path.as_posix()


def _canonical_path(objects_dir: Path, object_type: str, object_id: str) -> Path:
    _assert_id_matches_type(object_id, object_type)
    filename = object_id.replace(".", "_") + ".yaml"
    path = (objects_dir / object_type / filename).resolve()
    objects_root = objects_dir.resolve()
    if not _is_relative_to(path, objects_root):
        raise ObjectFlowError("invalid_object_id", "object id maps outside objects directory")
    return path


def _safe_location(objects_dir: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(objects_dir.resolve()).as_posix()
    except ValueError:
        raise ObjectFlowError("unsafe_object_location", "object file is outside objects directory") from None


def _assert_no_path_collision(objects_dir: Path, target: Path) -> None:
    target_key = str(target.resolve()).lower()
    for path in objects_dir.rglob("*.y*ml") if objects_dir.exists() else []:
        if str(path.resolve()).lower() == target_key:
            raise ObjectFlowError("object_path_collision", "object path collides with an existing file")


def _normalize_object_id(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) < MIN_ID_CHARS or len(text) > MAX_ID_CHARS:
        raise ObjectFlowError("invalid_object_id", "object id length is invalid")
    if text != text.lower():
        raise ObjectFlowError("invalid_object_id", "object id must be lowercase")
    if text.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", text) or "\\\\" in text:
        raise ObjectFlowError("invalid_object_id", "object id must not be a path")
    if "/" in text or "\\" in text or ".." in text or ":" in text:
        raise ObjectFlowError("invalid_object_id", "object id contains unsafe path characters")
    if not OBJECT_ID_PATTERN.match(text):
        raise ObjectFlowError("invalid_object_id", "object id format is invalid")
    return text


def _normalize_type(value: Any) -> str:
    text = str(value or "").strip()
    if text not in OBJECT_TYPES:
        raise ObjectFlowError("invalid_object_type", f"unsupported object type: {text}")
    return text


def _validate_optional_type(value: str | None) -> None:
    if value is not None:
        _normalize_type(value)


def _assert_id_matches_type(object_id: str, object_type: str) -> None:
    if not object_id.startswith(f"{object_type}."):
        raise ObjectFlowError("object_id_type_mismatch", "object id must start with '<type>.'")


def _require_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise ObjectFlowError("confirmation_required", "object mutation requires explicit human confirmation")


def _required_string(value: Any, field: str, max_chars: int, *, code: str = "invalid_input") -> str:
    text = str(value or "").strip()
    if not text:
        raise ObjectFlowError(code, f"{field} must not be empty")
    if len(text) > max_chars:
        raise ObjectFlowError(code, f"{field} must be at most {max_chars} characters")
    return text


def _required_sha256(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"[0-9a-f]{64}", text):
        raise ObjectFlowError("invalid_revision", f"{field} must be a SHA-256 hex string")
    return text


def _require_git_clean(data_root: Path) -> GitReady:
    ready = _git_ready(data_root)
    status = _git_status(ready.root)
    if status:
        raise ObjectFlowError("data_root_dirty", "Data Root Git worktree must be clean before object mutation")
    return ready


def _git_ready(data_root: Path) -> GitReady:
    data_root = data_root.resolve()
    try:
        result = subprocess.run(
            ["git", "-C", str(data_root), "rev-parse", "--show-toplevel"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception as exc:
        raise ObjectFlowError("data_root_not_git", "Data Root must be a Git repository") from exc
    git_root = Path(result.stdout.strip()).resolve()
    if git_root != data_root:
        raise ObjectFlowError("data_root_git_root_mismatch", "Data Root must be the Git repository root")
    return GitReady(root=git_root, fingerprint=_data_root_fingerprint(data_root))


def _git_status(git_root: Path) -> str:
    return subprocess.run(["git", "-C", str(git_root), "status", "--porcelain"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout


def _commit_exact(git_root: Path, changed_paths: list[Path], message: str) -> dict[str, Any]:
    rels: list[str] = []
    for path in _unique_paths(changed_paths):
        resolved = path.resolve()
        if not _is_relative_to(resolved, git_root.resolve()):
            raise ObjectFlowError("git_path_outside_data_root", "changed path is outside Data Root")
        rels.append(resolved.relative_to(git_root.resolve()).as_posix())
    if not rels:
        raise ObjectFlowError("git_no_changed_files", "no object authority files to commit")
    try:
        subprocess.run(["git", "-C", str(git_root), "add", "-A", "--", *rels], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        diff = subprocess.run(["git", "-C", str(git_root), "diff", "--cached", "--quiet"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if diff.returncode == 0:
            raise ObjectFlowError("git_no_staged_changes", "no staged object authority changes")
        if diff.returncode != 1:
            raise ObjectFlowError("git_commit_failed", "cannot inspect staged object changes")
        changed = subprocess.run(
            ["git", "-C", str(git_root), "diff", "--cached", "--name-only", "-z"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
        ).stdout.rstrip("\0").split("\0")
        if set(changed) - set(rels):
            raise ObjectFlowError("data_root_dirty", "Git index contains unrelated staged changes")
        subprocess.run(["git", "-C", str(git_root), "commit", "--only", "-m", message, "--", *rels], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except ObjectFlowError:
        raise
    except subprocess.CalledProcessError as exc:
        raise ObjectFlowError("git_commit_failed", "Git could not commit the object transaction") from exc
    # The commit is already accepted; metadata failure must not restore old authority bytes.
    warnings = []
    try:
        commit_hash = subprocess.run(["git", "-C", str(git_root), "rev-parse", "HEAD"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        commit_hash = None
        warnings.append({"code": "git_commit_hash_unavailable", "message": "commit succeeded but HEAD lookup failed"})
    return {"gitCommitCreated": True, "commitHash": commit_hash, "changedFiles": changed, "warnings": warnings}


def _capture_preimages(paths: list[Path]) -> dict[Path, bytes | None]:
    preimages: dict[Path, bytes | None] = {}
    for path in _unique_paths(paths):
        preimages[path] = path.read_bytes() if path.exists() else None
    return preimages


def _restore_preimages(preimages: dict[Path, bytes | None]) -> None:
    for path, content in preimages.items():
        if content is None:
            if path.exists():
                path.unlink()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)


def _restore_git_index_best_effort(git_root: Path, changed_paths: list[Path]) -> None:
    rels: list[str] = []
    root = git_root.resolve()
    for path in _unique_paths(changed_paths):
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if _is_relative_to(resolved, root):
            rels.append(resolved.relative_to(root).as_posix())
    if rels:
        subprocess.run(["git", "-C", str(git_root), "reset", "-q", "--", *rels], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)


def _action_log_path(data_root: Path) -> Path:
    return data_root / "objects" / "actions" / f"{_now_iso()[:10]}.jsonl"


def _deletion_log_path(data_root: Path) -> Path:
    return data_root / "objects" / "deletions" / f"{_now_iso()[:10]}.jsonl"


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _find_request(data_root: Path, request_id: str) -> dict[str, Any] | None:
    rows = _read_object_log(data_root, "actions") + _read_object_log(data_root, "deletions")
    return next((row for row in rows if row["requestId"] == request_id), None)


def _read_object_log(data_root: Path, folder_name: str) -> list[dict[str, Any]]:
    folder = data_root / "objects" / folder_name
    allowed_types = {"object_deleted"} if folder_name == "deletions" else {"object_created", "object_updated"}
    timestamp_key = "deletedAt" if folder_name == "deletions" else "createdAt"
    revision_key = "objectFileSha256" if folder_name == "deletions" else "fileRevisionSha256"
    required_strings = ("id", "objectId", "requestId", "payloadSha256", timestamp_key, revision_key, "objectContentSha256")
    result: list[dict[str, Any]] = []
    for path in sorted(folder.glob("*.jsonl")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError) as exc:
            raise ObjectFlowError("object_log_invalid", "object authority log could not be read") from exc
        for line_no, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                row = None
            if (
                not isinstance(row, dict)
                or not isinstance(row.get("type"), str)
                or row.get("type") not in allowed_types
                or row.get("objectType") not in OBJECT_TYPES
                or any(not isinstance(row.get(key), str) or not row[key] for key in required_strings)
            ):
                raise ObjectFlowError("object_log_invalid", f"invalid objects/{folder_name} log row at line {line_no}")
            result.append(row)
    return result


def _assert_same_payload(existing: dict[str, Any], payload_sha: str) -> None:
    if existing.get("payloadSha256") != payload_sha:
        raise ObjectFlowError("idempotency_conflict", "requestId was already used with a different object payload")


def _assert_committed_request(data_root: Path, event: dict[str, Any]) -> None:
    ready = _git_ready(data_root)
    deleted = event["type"] == "object_deleted"
    timestamp = event.get("deletedAt" if deleted else "createdAt")
    if not isinstance(timestamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", timestamp[:10]):
        raise ObjectFlowError("object_log_invalid", "object authority event has no valid timestamp")
    folder = "deletions" if deleted else "actions"
    log_path = f"objects/{folder}/{timestamp[:10]}.jsonl"
    result = subprocess.run(
        ["git", "-C", str(ready.root), "show", f"HEAD:{log_path}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
    )
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            try:
                if json.loads(line) == event:
                    return
            except json.JSONDecodeError:
                continue
    raise ObjectFlowError("object_transaction_incomplete", "request has an uncommitted authority event; inspect and recover the Data Root before retrying")


def _replay_payload(data_root: Path, objects_dir: Path, event: dict[str, Any], status: str) -> dict[str, Any]:
    object_id = event["objectId"]
    location = event.get("location")
    if not location:
        location = _safe_location(objects_dir, _canonical_path(objects_dir, event["objectType"], object_id))
    return {
        "ok": True,
        "status": "replayed",
        "originalStatus": status,
        "objectId": object_id,
        "objectType": event["objectType"],
        "fileRevisionSha256": event["fileRevisionSha256"],
        "objectContentSha256": event["objectContentSha256"],
        "location": location,
        "gitCommitCreated": False,
        "commitHash": None,
        "changedFiles": [],
        "dataRootFingerprint": _data_root_fingerprint(data_root),
    }


def _action_event(
    event_type: str,
    object_id: str,
    object_type: str,
    actor: str,
    request_id: str,
    payload_sha: str,
    file_revision: str,
    content_hash: str,
) -> dict[str, Any]:
    now = _now_iso()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "type": event_type,
        "id": _event_id(event_type, request_id, payload_sha),
        "objectId": object_id,
        "objectType": object_type,
        "createdAt": now,
        "actor": actor,
        "requestId": request_id,
        "payloadSha256": payload_sha,
        "fileRevisionSha256": file_revision,
        "objectContentSha256": content_hash,
    }


def _mutation_payload(operation: str, request_id: str, actor: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"operation": operation, "requestId": request_id, "actor": actor, "payload": payload}


def _tombstone_exists(data_root: Path, object_id: str) -> bool:
    return any(row.get("type") == "object_deleted" and row.get("objectId") == object_id for row in _iter_tombstones(data_root))


def _assert_not_tombstoned(data_root: Path, object_id: str) -> None:
    if _tombstone_exists(data_root, object_id):
        raise ObjectFlowError("object_id_tombstoned", f"object id is tombstoned: {object_id}")


def _iter_tombstones(data_root: Path):
    yield from _read_object_log(data_root, "deletions")


def _object_parse_blockers(objects_dir: Path, object_id: str) -> list[dict[str, Any]]:
    _, issues = load_object_records(objects_dir)
    result = []
    for issue in issues:
        if object_id.replace(".", "_") not in issue.path.name:
            result.append({"code": "scanner_parse_error", "message": issue.format()})
    return result


def _scan_object_references(objects_dir: Path, object_id: str) -> list[dict[str, Any]]:
    records, issues = load_object_records(objects_dir)
    refs = []
    for record in records:
        if record.object_id == object_id:
            continue
        paths = _find_value_references(record.data, object_id)
        for field_path in paths:
            refs.append({"objectId": record.object_id, "objectType": record.object_type, "field": field_path, "location": _safe_location(objects_dir, record.path)})
    return refs


def _scan_legacy_publish_references(data_root: Path, object_id: str) -> list[dict[str, Any]]:
    refs = []
    for folder_name in ("site-public", "blog", "blog_package", "public"):
        folder = data_root / folder_name
        if not folder.exists():
            continue
        refs.extend(_scan_text_references(folder, object_id))
    return refs


def _scan_jsonl_references(folder: Path, object_id: str) -> list[dict[str, Any]]:
    refs = []
    if not folder.exists():
        return refs
    for path in sorted(folder.glob("*.jsonl")):
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                refs.append({"location": path.as_posix(), "line": line_no, "field": "$", "parseError": True})
                continue
            if _find_value_references(row, object_id):
                refs.append({"location": path.as_posix(), "line": line_no})
    return refs


def _scan_text_references(folder: Path, object_id: str) -> list[dict[str, Any]]:
    refs = []
    if not folder.exists():
        return refs
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if object_id in text:
            refs.append({"location": path.as_posix()})
    return refs


def _find_value_references(value: Any, object_id: str, path: str = "$") -> list[str]:
    if isinstance(value, str):
        return [path] if object_id in value else []
    if isinstance(value, list):
        result: list[str] = []
        for index, child in enumerate(value):
            result.extend(_find_value_references(child, object_id, f"{path}[{index}]"))
        return result
    if isinstance(value, dict):
        result: list[str] = []
        for key, child in value.items():
            result.extend(_find_value_references(child, object_id, f"{path}.{key}"))
        return result
    return []


def _review_event_count(review_dir: Path, object_id: str) -> int:
    try:
        loaded = load_review_events(review_dir)
    except ReviewFlowError:
        return 0
    return sum(1 for event in loaded.events if event.get("objectId") == object_id or event.get("id") == object_id)


def _timestamp_sort_key(value: str) -> float:
    try:
        text = value[:-1] + "+00:00" if value.endswith("Z") else value
        return datetime.fromisoformat(text).timestamp()
    except Exception:
        return 0.0


def _limit(value: int | None) -> int:
    if value is None:
        return 100
    return max(1, min(int(value), 500))


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _event_id(prefix: str, request_id: str, payload_sha: str) -> str:
    return f"{prefix}_{sha256_text(request_id)[:12]}_{payload_sha[:12]}"


def _data_root_fingerprint(data_root: Path) -> str:
    return sha256_text(data_root.resolve().as_posix())[:16]


def file_sha256(path: Path) -> str:
    if not path.exists():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
