from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tools.common.object_store import build_object_index

SCHEMA_VERSION = "0.5-alpha"
DEFAULT_CONTEXT_BUDGET = {
    "max_review_items": 5,
    "max_writing_items": 5,
    "max_digest_chars": 2000,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def current_state(generated_at: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": "default",
        "items": [],
        "state": {
            "energy": "unknown",
            "mood": "unknown",
            "body": "unknown",
            "context": "unknown",
            "mode": "unknown",
            "risk": {
                "short_video": "unknown",
                "rumination": "unknown",
                "overload": "unknown",
            },
        },
    }


def empty_queue(generated_at: str, source: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": source,
        "items": [],
    }


def _parse_queue_file(path: Path, queue_name: str, index: dict[str, Any]) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| `"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 5:
            continue

        object_id = parts[1].strip("`")
        rec = index.get(object_id)
        path_text = parts[4].split("](")[-1].rstrip(") ")
        item = {
            "object_id": object_id,
            "title": parts[2],
            "due_at": parts[3].strip("`"),
            "path": path_text,
            "queue": queue_name,
        }
        if rec:
            item["object_type"] = rec.object_type
            item["status"] = rec.status
            item["title"] = str(rec.data.get("title") or item["title"] or object_id)
            item["path"] = rec.path.as_posix()
        items.append(item)
    return items


def review_queue(objects_dir: Path, review_dir: Path, generated_at: str) -> dict[str, Any]:
    index, _issues = build_object_index(objects_dir)
    items = [
        *_parse_queue_file(review_dir / "daily_queue.md", "daily", index),
        *_parse_queue_file(review_dir / "weekly_queue.md", "weekly", index),
    ]
    items.sort(key=lambda x: (str(x.get("due_at", "")), str(x.get("queue", "")), str(x.get("object_id", ""))))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": "review_queue_markdown",
        "items": items,
    }


def writing_queue(objects_dir: Path, generated_at: str) -> dict[str, Any]:
    index, _issues = build_object_index(objects_dir)
    items: list[dict[str, Any]] = []
    for rec in sorted(index.values(), key=lambda r: (str(r.data.get("updated_at", "")), r.object_id)):
        if rec.object_type != "creative" or rec.status not in {"draft", "revised"}:
            continue
        items.append(
            {
                "object_id": rec.object_id,
                "object_type": "creative",
                "title": str(rec.data.get("title") or rec.object_id),
                "status": rec.status,
                "path": rec.path.as_posix(),
                "updated_at": str(rec.data.get("updated_at") or ""),
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": "objects/creative",
        "items": items,
    }


def flow_budget(generated_at: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "source": "default",
        "items": [],
        "week": None,
        "main_flows": [],
        "secondary_flows": [],
        "parked_flows": [],
        "rules": {
            "max_main_flows_per_day": 2,
            "recovery_required_daily": True,
        },
    }


def build_flow_models(objects_dir: Path, review_dir: Path, generated_at: str | None = None) -> dict[str, dict[str, Any]]:
    ts = generated_at or utc_now()
    return {
        "current_state": current_state(ts),
        "today_queue": empty_queue(ts, "none"),
        "review_queue": review_queue(objects_dir, review_dir, ts),
        "recovery_queue": empty_queue(ts, "not_implemented"),
        "writing_queue": writing_queue(objects_dir, ts),
        "flow_budget": flow_budget(ts),
    }


def run_gen_flow(objects_dir: Path, review_dir: Path, runtime_flow_dir: Path) -> int:
    runtime_flow_dir.mkdir(parents=True, exist_ok=True)
    models = build_flow_models(objects_dir, review_dir)
    for name, model in models.items():
        write_json(runtime_flow_dir / f"{name}.json", model)
        print(f"generated: {(runtime_flow_dir / f'{name}.json').as_posix()}")
    return 0


def _latest_digest(digests_dir: Path, max_chars: int) -> dict[str, Any]:
    digest_files = sorted(digests_dir.glob("*.md"), key=lambda p: p.name, reverse=True) if digests_dir.exists() else []
    if not digest_files:
        return {"id": None, "path": None, "week": None, "excerpt": None}

    path = digest_files[0]
    text = path.read_text(encoding="utf-8")
    week = path.stem
    m = re.match(r"^\d{4}-W\d{2}$", week)
    return {
        "id": week if m else path.stem,
        "path": path.as_posix(),
        "week": week if m else None,
        "excerpt": text[:max_chars],
    }


def _flow_model_from_file_or_build(
    name: str,
    runtime_flow_dir: Path,
    fallback: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    data = read_json(runtime_flow_dir / f"{name}.json")
    if isinstance(data, dict):
        return data
    return fallback[name]


def build_agent_context(
    objects_dir: Path,
    review_dir: Path,
    digests_dir: Path,
    runtime_flow_dir: Path,
    generated_at: str | None = None,
    budget: dict[str, int] | None = None,
) -> dict[str, Any]:
    ts = generated_at or utc_now()
    context_budget = dict(DEFAULT_CONTEXT_BUDGET)
    if budget:
        context_budget.update(budget)

    fallback = build_flow_models(objects_dir, review_dir, ts)
    current_state_model = _flow_model_from_file_or_build("current_state", runtime_flow_dir, fallback)
    today_queue_model = _flow_model_from_file_or_build("today_queue", runtime_flow_dir, fallback)
    review_queue_model = _flow_model_from_file_or_build("review_queue", runtime_flow_dir, fallback)
    recovery_queue_model = _flow_model_from_file_or_build("recovery_queue", runtime_flow_dir, fallback)
    writing_queue_model = _flow_model_from_file_or_build("writing_queue", runtime_flow_dir, fallback)
    flow_budget_model = _flow_model_from_file_or_build("flow_budget", runtime_flow_dir, fallback)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": ts,
        "context_budget": context_budget,
        "current_state": current_state_model.get("state", current_state_model),
        "flow_budget": {
            "week": flow_budget_model.get("week"),
            "main_flows": flow_budget_model.get("main_flows", []),
            "secondary_flows": flow_budget_model.get("secondary_flows", []),
            "parked_flows": flow_budget_model.get("parked_flows", []),
            "rules": flow_budget_model.get("rules", {}),
        },
        "today_queue": list(today_queue_model.get("items", [])),
        "review_queue": list(review_queue_model.get("items", []))[: int(context_budget["max_review_items"])],
        "recovery_queue": list(recovery_queue_model.get("items", [])),
        "writing_queue": list(writing_queue_model.get("items", []))[: int(context_budget["max_writing_items"])],
        "latest_digest": _latest_digest(digests_dir, int(context_budget["max_digest_chars"])),
        "operational_skills": [],
        "retrieved_objects": [],
        "safety": {
            "authority": "runtime cache only; not a source of truth",
            "agent_may_write": False,
            "trusted_migration_allowed": False,
        },
    }


def run_export_agent_context(
    objects_dir: Path,
    review_dir: Path,
    digests_dir: Path,
    runtime_flow_dir: Path,
    output_path: Path,
) -> int:
    context = build_agent_context(objects_dir, review_dir, digests_dir, runtime_flow_dir)
    write_json(output_path, context)
    print(f"generated: {output_path.as_posix()}")
    return 0


def main_gen_flow() -> int:
    parser = argparse.ArgumentParser(description="Generate Flow Hub runtime JSON")
    parser.add_argument("--objects-dir", default="objects")
    parser.add_argument("--review-dir", default="review")
    parser.add_argument("--runtime-flow-dir", default="runtime/flow")
    args = parser.parse_args()
    return run_gen_flow(Path(args.objects_dir), Path(args.review_dir), Path(args.runtime_flow_dir))


def main_export_agent_context() -> int:
    parser = argparse.ArgumentParser(description="Export bounded Moonlolo Agent Context Pack")
    parser.add_argument("--objects-dir", default="objects")
    parser.add_argument("--review-dir", default="review")
    parser.add_argument("--digests-dir", default="digests")
    parser.add_argument("--runtime-flow-dir", default="runtime/flow")
    parser.add_argument("--output", default="runtime/agent_context.json")
    args = parser.parse_args()
    return run_export_agent_context(
        Path(args.objects_dir),
        Path(args.review_dir),
        Path(args.digests_dir),
        Path(args.runtime_flow_dir),
        Path(args.output),
    )
