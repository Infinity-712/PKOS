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
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"FAIL: {label} failure was not JSON")
        print(result.stdout)
        raise SystemExit(1)
    actual = payload.get("error", {}).get("code")
    if actual != code:
        print(f"FAIL: {label} expected {code}, got {actual}")
        print(result.stdout)
        raise SystemExit(1)


def _init_git(data_root: Path) -> None:
    subprocess.run(["git", "init"], cwd=data_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    subprocess.run(["git", "config", "user.email", "pkos-test@example.invalid"], cwd=data_root, check=True)
    subprocess.run(["git", "config", "user.name", "PKOS Test"], cwd=data_root, check=True)
    (data_root / ".gitignore").write_text("/runtime/\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=data_root, check=True)
    subprocess.run(["git", "commit", "-m", "seed"], cwd=data_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _git_head(path: Path) -> str:
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=path, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def _git_status(path: Path) -> str:
    return subprocess.run(["git", "status", "--short"], cwd=path, check=True, text=True, stdout=subprocess.PIPE).stdout


def _install_blocking_pre_commit(data_root: Path) -> Path:
    hook = data_root / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\nprintf 'blocked by object authority rollback smoke\\n' >&2\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)
    return hook


def _remove_hook(path: Path) -> None:
    if path.exists():
        path.unlink()


def _create_payload(object_id: str, object_type: str, *, title: str | None = None, content: str | None = None) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": object_id,
        "type": object_type,
        "status": "draft" if object_type == "creative" else "parsed",
        "title": title or object_id,
        "summary": "object authority test",
        "content": content or f"content for {object_id}",
    }
    if object_type == "creative":
        base["tags"] = ["object-test"]
    else:
        base["source"] = ["manual"]
        base["anchors"] = ["test"]
    if object_type == "claim":
        base["counter_arguments"] = ["strong test opposition"]
        base["scope"] = "test"
        base["invalidation_conditions"] = ["counter evidence"]
    if object_type == "skill":
        base["practice_log"] = ["success: done once", "failure: missed once"]
    if object_type == "fact":
        base["verification_sources"] = ["manual verification"]
        base["counter_examples"] = ["boundary case"]
    return base


def _create(data_root: Path, payload: dict[str, Any], request_id: str) -> dict[str, Any]:
    return _json(
        _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(payload, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                request_id,
                "--confirmed",
                "--json",
            ],
            data_root,
        ),
        f"object-create {payload['id']}",
    )


def _update(data_root: Path, object_id: str, patch: dict[str, Any], base_revision: str, request_id: str) -> dict[str, Any]:
    return _json(
        _run(
            [
                "object-update",
                "--object-id",
                object_id,
                "--patch-json",
                json.dumps(patch, ensure_ascii=False),
                "--base-revision",
                base_revision,
                "--actor",
                "human",
                "--request-id",
                request_id,
                "--confirmed",
                "--json",
            ],
            data_root,
        ),
        f"object-update {object_id}",
    )


def _read_object_file(data_root: Path, object_type: str, object_id: str) -> str:
    path = data_root / "objects" / object_type / f"{object_id.replace('.', '_')}.yaml"
    return path.read_text(encoding="utf-8")


def main() -> int:
    data_root = Path(tempfile.mkdtemp(prefix="pkos-object-authority-"))
    non_git_root = Path(tempfile.mkdtemp(prefix="pkos-object-authority-nongit-"))
    try:
        _init_git(data_root)
        core_head_before = _git_head(ROOT)

        empty_list = _json(_run(["object-list", "--json"], data_root), "empty object-list")
        if empty_list.get("count") != 0 or empty_list.get("items") != []:
            print("FAIL: empty object-list was not empty")
            return 1

        contracts = _json(_run(["object-types", "--json"], data_root), "object-types")
        by_type = {item["type"]: item for item in contracts.get("types", [])}
        for object_type in ("fact", "claim", "skill", "creative"):
            contract = by_type.get(object_type)
            if not contract or "status" not in contract.get("editableFields", []) or "srs" not in contract.get("immutableFields", []):
                print(f"FAIL: object type contract missing fields for {object_type}")
                return 1
            object_id_contract = contract.get("objectId")
            if not isinstance(object_id_contract, dict):
                print(f"FAIL: object type contract missing objectId contract for {object_type}")
                return 1
            if object_id_contract.get("minLength") != 3 or object_id_contract.get("maxLength") != 64:
                print(f"FAIL: objectId length contract mismatch for {object_type}")
                return 1
            if not isinstance(object_id_contract.get("pattern"), str) or not object_id_contract.get("humanReadablePattern"):
                print(f"FAIL: objectId pattern contract missing for {object_type}")
                return 1
            if not str(object_id_contract.get("example", "")).startswith(f"{object_type}."):
                print(f"FAIL: objectId example does not use type prefix for {object_type}")
                return 1
            if object_id_contract.get("prefixRequirement") != "must_start_with_type_dot":
                print(f"FAIL: objectId prefix contract mismatch for {object_type}")
                return 1
            field_types = contract.get("fieldTypes") or {}
            if object_type == "fact":
                if "tags" in contract.get("editableFields", []):
                    print("FAIL: fact contract exposed non-schema tags field")
                    return 1
                if field_types.get("source") != "string_list" or field_types.get("anchors") != "string_list":
                    print("FAIL: fact contract did not expose source/anchors as string_list")
                    return 1
            if object_type == "creative":
                if "tags" not in contract.get("editableFields", []) or field_types.get("tags") != "string_list":
                    print("FAIL: creative contract did not expose tags as string_list")
                    return 1
        if by_type["creative"].get("srsEligible") is not False or "draft" not in by_type["creative"].get("statusEnum", []):
            print("FAIL: creative type contract regressed")
            return 1

        exact_max_id = "fact." + ("a" * 59)
        if len(exact_max_id) != 64:
            print("FAIL: exact max id fixture length is wrong")
            return 1
        _create(data_root, _create_payload(exact_max_id, "fact"), "object-create-exact-max-id")
        too_long_id = "fact." + ("b" * 60)
        too_long = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload(too_long_id, "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-too-long-id",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(too_long, "invalid_object_id", "object id over max length")
        too_short = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload("fa", "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-too-short-id",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(too_short, "invalid_object_id", "object id under min length")
        _create(data_root, _create_payload("fact.compat-hyphen.name", "fact"), "object-create-compat-hyphen")
        _create(data_root, _create_payload("fact.compat_under.name", "fact"), "object-create-compat-underscore")
        _create(
            data_root,
            _create_payload(
                "fact.object.multiline",
                "fact",
                content="PKOS_OBJECT_GUI_ACCEPTANCE_7D42C1\nObject authority writes must survive multiline YAML.",
            ),
            "object-create-multiline-content",
        )

        minimal_fact = _create(
            data_root,
            {
                "id": "fact.gui-minimal",
                "type": "fact",
                "status": "raw",
                "title": "Minimal fact",
                "summary": "schema minimal",
                "content": "minimal content",
                "source": ["manual"],
                "anchors": ["manual"],
            },
            "object-create-minimal-fact",
        )
        if minimal_fact.get("status") != "created":
            print("FAIL: minimal fact create failed")
            return 1

        head_before_bad_field = _git_head(data_root)
        fact_tags = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**_create_payload("fact.object.tags_rejected", "fact"), "tags": ["not allowed"]}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-fact-tags-rejected",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(fact_tags, "invalid_object_field", "fact tags rejected")
        if (data_root / "objects" / "fact" / "fact_object_tags_rejected.yaml").exists() or _git_head(data_root) != head_before_bad_field or _git_status(data_root):
            print("FAIL: fact tags failure left object, commit, or dirty status")
            return 1

        head_before_bad_source = _git_head(data_root)
        source_string = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**_create_payload("fact.object.source_string", "fact"), "source": "gpt"}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-source-string",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(source_string, "schema_validation_failed", "source string rejected")
        source_string_text = source_string.stdout.replace("\\", "/")
        if str(data_root).replace("\\", "/") in source_string_text or "AppData/Local/Temp" in source_string_text:
            print("FAIL: source string schema error leaked absolute Data Root path")
            return 1
        if (data_root / "objects" / "fact" / "fact_object_source_string.yaml").exists() or _git_head(data_root) != head_before_bad_source or _git_status(data_root):
            print("FAIL: source string failure left object, commit, or dirty status")
            return 1

        fact_payload = _create_payload("fact.object.alpha", "fact", title="中文事实", content="定义正文在这里")
        claim_payload = _create_payload("claim.object.beta", "claim")
        skill_payload = _create_payload("skill.object.gamma", "skill")
        creative_payload = _create_payload("creative.object.delta", "creative", content="内部创作材料")
        fact = _create(data_root, fact_payload, "object-create-fact-1")
        _create(data_root, claim_payload, "object-create-claim-1")
        _create(data_root, skill_payload, "object-create-skill-1")
        _create(data_root, creative_payload, "object-create-creative-1")
        if fact.get("status") != "created" or not fact.get("commitHash") or len(fact.get("fileRevisionSha256", "")) != 64:
            print("FAIL: object-create did not return commit/revision")
            return 1
        if _git_head(ROOT) != core_head_before:
            print("FAIL: object mutation changed core repository HEAD")
            return 1

        duplicate = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(fact_payload, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-duplicate-new-request",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(duplicate, "object_id_exists", "duplicate object id")

        replay = _json(
            _run(
                [
                    "object-create",
                    "--payload-json",
                    json.dumps(fact_payload, ensure_ascii=False),
                    "--actor",
                    "human",
                    "--request-id",
                    "object-create-fact-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            ),
            "object-create replay",
        )
        if replay.get("status") != "replayed" or _git_status(data_root):
            print("FAIL: create requestId replay changed data root")
            return 1

        conflict = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**fact_payload, "summary": "different"}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-fact-1",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(conflict, "idempotency_conflict", "create requestId conflict")

        no_confirm = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload("fact.object.no_confirm", "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-no-confirm",
                "--json",
            ],
            data_root,
        )
        _expect_failure(no_confirm, "confirmation_required", "object-create requires confirmation")

        with_srs = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**_create_payload("fact.object.srs", "fact"), "srs": {"due_at": "2099-01-01T00:00:00Z"}}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-client-srs",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(with_srs, "immutable_field", "client srs rejected")

        invalid_status = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**_create_payload("fact.object.bad_status", "fact"), "status": "draft"}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-bad-status",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(invalid_status, "schema_validation_failed", "invalid fact status")

        traversal = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps({**_create_payload("../fact.object.bad", "fact")}, ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-traversal",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(traversal, "invalid_object_id", "path traversal id")

        absolute = _run(
            [
                "object-get",
                "--object-id",
                "C:\\temp\\fact.object.alpha",
                "--json",
            ],
            data_root,
        )
        _expect_failure(absolute, "invalid_object_id", "absolute path id")

        listed = _json(_run(["object-list", "--type", "fact", "--status", "parsed", "--q", "中文", "--json"], data_root), "object-list filters")
        if listed.get("count") != 1 or listed["items"][0]["id"] != "fact.object.alpha":
            print("FAIL: object-list filtering failed")
            return 1
        if listed["items"][0].get("location", "").startswith("/") or "\\" in listed["items"][0].get("location", ""):
            print("FAIL: object-list returned unsafe location")
            return 1

        detail = _json(_run(["object-get", "--object-id", "fact.object.alpha", "--json"], data_root), "object-get")
        if detail.get("object", {}).get("title") != "中文事实" or detail.get("objectContentSha256") == detail.get("fileRevisionSha256"):
            print("FAIL: object-get did not return detail/hashes")
            return 1
        if "created_at" not in detail.get("object", {}) or "updated_at" not in detail.get("object", {}):
            print("FAIL: server timestamps missing")
            return 1
        if "srs" not in detail.get("object", {}) or "srs" in detail.get("editableFields", []):
            print("FAIL: SRS projection missing or editable")
            return 1

        rendered = _json(_run(["object-render", "--object-id", "fact.object.alpha", "--json"], data_root), "object-render")
        if rendered.get("body") != "定义正文在这里" or not rendered.get("sections") or len(rendered.get("objectContentSha256", "")) != 64:
            print("FAIL: object-render body/sections failed")
            return 1

        file_before_unknown = _read_object_file(data_root, "fact", "fact.object.alpha")
        object_path = data_root / "objects" / "fact" / "fact_object_alpha.yaml"
        object_path.write_text(file_before_unknown + "custom_unknown: keep-me\n", encoding="utf-8")
        subprocess.run(["git", "add", "objects/fact/fact_object_alpha.yaml"], cwd=data_root, check=True)
        subprocess.run(["git", "commit", "-m", "seed unknown field"], cwd=data_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        detail_with_unknown = _json(_run(["object-get", "--object-id", "fact.object.alpha", "--json"], data_root), "object-get unknown")
        revision = str(detail_with_unknown["fileRevisionSha256"])
        updated = _update(
            data_root,
            "fact.object.alpha",
            {"title": "中文事实更新", "summary": "更新摘要", "content": "更新后的正文"},
            revision,
            "object-update-fact-1",
        )
        if updated.get("status") != "updated" or updated.get("fileRevisionSha256") == revision:
            print("FAIL: object-update did not change revision")
            return 1
        if "custom_unknown: keep-me" not in _read_object_file(data_root, "fact", "fact.object.alpha"):
            print("FAIL: unknown fields were not preserved")
            return 1

        immutable = _run(
            [
                "object-update",
                "--object-id",
                "fact.object.alpha",
                "--patch-json",
                json.dumps({"id": "fact.object.changed"}, ensure_ascii=False),
                "--base-revision",
                updated["fileRevisionSha256"],
                "--actor",
                "human",
                "--request-id",
                "object-update-immutable",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(immutable, "immutable_field", "immutable id update")
        stale = _run(
            [
                "object-update",
                "--object-id",
                "fact.object.alpha",
                "--patch-json",
                json.dumps({"summary": "stale"}, ensure_ascii=False),
                "--base-revision",
                revision,
                "--actor",
                "human",
                "--request-id",
                "object-update-stale",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(stale, "object_revision_conflict", "stale baseRevision")

        validation_rollback_before = object_path.read_bytes()
        validation_failure = _run(
            [
                "object-update",
                "--object-id",
                "fact.object.alpha",
                "--patch-json",
                json.dumps({"status": "bad-status"}, ensure_ascii=False),
                "--base-revision",
                updated["fileRevisionSha256"],
                "--actor",
                "human",
                "--request-id",
                "object-update-validation-fail",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(validation_failure, "schema_validation_failed", "validation failure rollback")
        if object_path.read_bytes() != validation_rollback_before:
            print("FAIL: validation failure changed object file")
            return 1

        review_status = _json(_run(["review-status", "--json"], data_root), "review-status after object create")
        if review_status.get("counts", {}).get("due", 0) < 3:
            print("FAIL: review onboarding did not include reviewable objects")
            return 1
        if any(item.get("objectId") == "creative.object.delta" for item in _json(_run(["review-queue", "--json"], data_root), "review queue creative")["due"]):
            print("FAIL: creative entered review queue")
            return 1

        _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.object.alpha",
                    "--rating",
                    "4",
                    "--reviewed-at",
                    "2026-07-20T00:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "object-review-rate-1",
                    "--current-path",
                    "runtime/review/current.json",
                    "--queue-path",
                    "runtime/review/queue.json",
                    "--json",
                ],
                data_root,
            ),
            "review-rate before content change",
        )
        rated = _json(_run(["object-get", "--object-id", "fact.object.alpha", "--json"], data_root), "object-get rated")
        _update(data_root, "fact.object.alpha", {"content": "再次更新正文"}, rated["fileRevisionSha256"], "object-update-content-change")
        queue_after_change = _json(_run(["review-queue", "--json"], data_root), "review queue after content change")
        changed_item = next(item for item in queue_after_change["due"] + queue_after_change["upcoming"] if item["objectId"] == "fact.object.alpha")
        if changed_item.get("contentChangedSinceLastReview") is not True:
            print("FAIL: content update did not mark review content changed")
            return 1

        blocker_payload = _create_payload("fact.object.blocked", "fact")
        blocker_payload["content"] = "mentions fact.object.alpha as a strong reference"
        _create(data_root, blocker_payload, "object-create-blocker-1")
        preflight_blocked = _json(_run(["object-delete-preflight", "--object-id", "fact.object.alpha", "--json"], data_root), "delete preflight blocked")
        if preflight_blocked.get("canDelete") is not False or not preflight_blocked.get("blockers"):
            print("FAIL: strong object reference did not block delete")
            return 1
        if "objectReferences" not in preflight_blocked or "referenceCoverage" not in preflight_blocked:
            print("FAIL: delete preflight omitted reference coverage")
            return 1

        delete_target = _create(data_root, _create_payload("fact.object.delete_me", "fact"), "object-create-delete-me-1")
        _json(
            _run(
                [
                    "review-rate",
                    "--object-id",
                    "fact.object.delete_me",
                    "--rating",
                    "3",
                    "--reviewed-at",
                    "2026-07-20T01:00:00Z",
                    "--actor",
                    "human",
                    "--request-id",
                    "object-review-delete-me",
                    "--current-path",
                    "runtime/review/current.json",
                    "--queue-path",
                    "runtime/review/queue.json",
                    "--json",
                ],
                data_root,
            ),
            "review-rate delete target",
        )
        preflight = _json(_run(["object-delete-preflight", "--object-id", "fact.object.delete_me", "--json"], data_root), "delete preflight")
        if preflight.get("canDelete") is not True or preflight.get("reviewEventCount", 0) < 1 or not preflight.get("warnings"):
            print("FAIL: delete preflight did not warn about review history")
            return 1
        delete_current = _json(_run(["object-get", "--object-id", "fact.object.delete_me", "--json"], data_root), "object-get delete target")
        delete_revision = delete_current["fileRevisionSha256"]
        typed_mismatch = _run(
            [
                "object-delete",
                "--object-id",
                "fact.object.delete_me",
                "--typed-object-id",
                "fact.object.other",
                "--base-revision",
                delete_revision,
                "--reason",
                "cleanup",
                "--actor",
                "human",
                "--request-id",
                "object-delete-mismatch",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(typed_mismatch, "typed_object_id_mismatch", "typed object id mismatch")
        missing_reason = _run(
            [
                "object-delete",
                "--object-id",
                "fact.object.delete_me",
                "--typed-object-id",
                "fact.object.delete_me",
                "--base-revision",
                delete_revision,
                "--reason",
                " ",
                "--actor",
                "human",
                "--request-id",
                "object-delete-no-reason",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(missing_reason, "invalid_reason", "delete reason required")
        deleted = _json(
            _run(
                [
                    "object-delete",
                    "--object-id",
                    "fact.object.delete_me",
                    "--typed-object-id",
                    "fact.object.delete_me",
                    "--base-revision",
                    delete_revision,
                    "--reason",
                    "manual cleanup",
                    "--actor",
                    "human",
                    "--request-id",
                    "object-delete-delete-me-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            ),
            "object-delete",
        )
        if deleted.get("status") != "deleted" or (data_root / "objects" / "fact" / "fact_object_delete_me.yaml").exists():
            print("FAIL: hard delete did not remove object file")
            return 1
        tombstones = list((data_root / "objects" / "deletions").glob("*.jsonl"))
        if len(tombstones) != 1:
            print("FAIL: deletion tombstone was not written")
            return 1
        tombstone_text = tombstones[0].read_text(encoding="utf-8")
        tombstone = json.loads(tombstone_text.splitlines()[-1])
        for forbidden in ("title", "summary", "content", "source", "anchors"):
            if forbidden in tombstone or forbidden in tombstone_text and forbidden == "content":
                print("FAIL: tombstone leaked object body metadata")
                return 1
        if tombstone.get("objectId") != "fact.object.delete_me" or not tombstone.get("reasonSha256"):
            print("FAIL: tombstone missing minimal deletion fields")
            return 1
        tombstone_recreate = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload("fact.object.delete_me", "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-tombstoned",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(tombstone_recreate, "object_id_tombstoned", "tombstoned id rejected")
        orphan_view = _json(_run(["review-rebuild", "--json"], data_root), "review rebuild orphan")
        orphan = next(item for item in orphan_view["items"] if item["objectId"] == "fact.object.delete_me")
        if orphan.get("orphaned") is not True:
            print("FAIL: deleted object's review history did not become orphaned")
            return 1
        if any(item.get("objectId") == "fact.object.delete_me" for item in _json(_run(["review-queue", "--json"], data_root), "queue after delete")["due"]):
            print("FAIL: deleted object remained in normal review queue")
            return 1
        delete_replay = _json(
            _run(
                [
                    "object-delete",
                    "--object-id",
                    "fact.object.delete_me",
                    "--typed-object-id",
                    "fact.object.delete_me",
                    "--base-revision",
                    delete_revision,
                    "--reason",
                    "manual cleanup",
                    "--actor",
                    "human",
                    "--request-id",
                    "object-delete-delete-me-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            ),
            "object-delete replay",
        )
        if delete_replay.get("status") != "replayed":
            print("FAIL: delete replay was not deterministic")
            return 1

        malformed = data_root / "objects" / "fact" / "fact_bad_parse.yaml"
        malformed.write_text("id: fact.bad.parse\n bad: indent\n", encoding="utf-8")
        preflight_parse = _json(_run(["object-delete-preflight", "--object-id", "fact.object.alpha", "--json"], data_root), "preflight parse error")
        if not any(blocker.get("code") == "scanner_parse_error" for blocker in preflight_parse.get("blockers", [])):
            print("FAIL: scanner parse error did not block delete")
            return 1
        malformed.unlink()

        create_hook = _install_blocking_pre_commit(data_root)
        try:
            create_fail = _run(
                [
                    "object-create",
                    "--payload-json",
                    json.dumps(_create_payload("fact.object.commit_fail_create", "fact"), ensure_ascii=False),
                    "--actor",
                    "human",
                    "--request-id",
                    "object-create-commit-fail-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            )
            _expect_failure(create_fail, "git_commit_failed", "create commit failure rollback")
        finally:
            _remove_hook(create_hook)
        if (data_root / "objects" / "fact" / "fact_object_commit_fail_create.yaml").exists() or _git_status(data_root):
            print("FAIL: create commit failure left object or git status dirty")
            return 1

        before_update_rollback = _json(_run(["object-get", "--object-id", "fact.object.alpha", "--json"], data_root), "pre update rollback detail")
        update_hook = _install_blocking_pre_commit(data_root)
        try:
            update_fail = _run(
                [
                    "object-update",
                    "--object-id",
                    "fact.object.alpha",
                    "--patch-json",
                    json.dumps({"summary": "should roll back"}, ensure_ascii=False),
                    "--base-revision",
                    before_update_rollback["fileRevisionSha256"],
                    "--actor",
                    "human",
                    "--request-id",
                    "object-update-commit-fail-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            )
            _expect_failure(update_fail, "git_commit_failed", "update commit failure rollback")
        finally:
            _remove_hook(update_hook)
        after_update_rollback = _json(_run(["object-get", "--object-id", "fact.object.alpha", "--json"], data_root), "post update rollback detail")
        if after_update_rollback["object"].get("summary") == "should roll back" or after_update_rollback["fileRevisionSha256"] != before_update_rollback["fileRevisionSha256"] or _git_status(data_root):
            print("FAIL: update commit failure did not restore preimage cleanly")
            return 1

        delete_rollback_target = _create(data_root, _create_payload("fact.object.commit_fail_delete", "fact"), "object-create-commit-fail-delete-target")
        delete_hook = _install_blocking_pre_commit(data_root)
        try:
            delete_fail = _run(
                [
                    "object-delete",
                    "--object-id",
                    "fact.object.commit_fail_delete",
                    "--typed-object-id",
                    "fact.object.commit_fail_delete",
                    "--base-revision",
                    delete_rollback_target["fileRevisionSha256"],
                    "--reason",
                    "rollback smoke",
                    "--actor",
                    "human",
                    "--request-id",
                    "object-delete-commit-fail-1",
                    "--confirmed",
                    "--json",
                ],
                data_root,
            )
            _expect_failure(delete_fail, "git_commit_failed", "delete commit failure rollback")
        finally:
            _remove_hook(delete_hook)
        if not (data_root / "objects" / "fact" / "fact_object_commit_fail_delete.yaml").exists() or _git_status(data_root):
            print("FAIL: delete commit failure left object missing or git status dirty")
            return 1
        deletion_log_text = "".join(path.read_text(encoding="utf-8") for path in (data_root / "objects" / "deletions").glob("*.jsonl"))
        if "object-delete-commit-fail-1" in deletion_log_text:
            print("FAIL: delete commit failure leaked tombstone")
            return 1

        dirty_marker = data_root / "dirty.txt"
        dirty_marker.write_text("dirty", encoding="utf-8")
        dirty = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload("fact.object.dirty", "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-dirty",
                "--confirmed",
                "--json",
            ],
            data_root,
        )
        _expect_failure(dirty, "data_root_dirty", "dirty data root blocks mutation")
        dirty_marker.unlink()

        non_git = _run(
            [
                "object-create",
                "--payload-json",
                json.dumps(_create_payload("fact.object.nongit", "fact"), ensure_ascii=False),
                "--actor",
                "human",
                "--request-id",
                "object-create-nongit",
                "--confirmed",
                "--json",
            ],
            non_git_root,
        )
        _expect_failure(non_git, "data_root_not_git", "non-git data root")

        index_one = _json(_run(["object-rebuild", "--json"], data_root), "object-rebuild")
        index_two = _json(_run(["object-rebuild", "--json"], data_root), "object-rebuild again")
        if json.dumps(index_one.get("items"), ensure_ascii=False, sort_keys=True) != json.dumps(index_two.get("items"), ensure_ascii=False, sort_keys=True):
            print("FAIL: object index was not deterministic")
            return 1
        if not (data_root / "runtime" / "objects" / "index.json").exists():
            print("FAIL: object index was not written")
            return 1

        object_flow_source = "\n".join(path.read_text(encoding="utf-8", errors="ignore") for path in (ROOT / "tools" / "object_flow").rglob("*.py"))
        if "tools.server" in object_flow_source:
            print("FAIL: object_flow imports legacy tools.server")
            return 1
        if "openai" in object_flow_source.lower() or "deepseek" in object_flow_source.lower():
            print("FAIL: object_flow uses LLM/provider code")
            return 1

        print("OBJECT_AUTHORITY_MVP_OK")
        return 0
    finally:
        shutil.rmtree(data_root, ignore_errors=True)
        shutil.rmtree(non_git_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
