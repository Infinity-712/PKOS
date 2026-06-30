"""Generate weekly digest as a traceable index over objects."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re

from tools.common.object_store import build_object_index

ISO_TS = "%Y-%m-%dT%H:%M:%SZ"
WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")


def _parse_week(week_str: str) -> tuple[int, int] | None:
    m = WEEK_RE.match(week_str.strip())
    if not m:
        return None
    year = int(m.group(1))
    week = int(m.group(2))
    if week < 1 or week > 53:
        return None
    return year, week


def _current_week_utc() -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    iso = now.isocalendar()
    return iso.year, iso.week


def _parse_updated_at(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, ISO_TS).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _week_label(year: int, week: int) -> str:
    return f"{year}-W{week:02d}"


def run_gen_digest(objects_dir: Path, output_dir: Path, week: str | None = None) -> int:
    target = _parse_week(week) if week else _current_week_utc()
    if target is None:
        print("ERROR: invalid --week format, expected YYYY-Www")
        return 2

    target_year, target_week = target
    week_label = _week_label(target_year, target_week)

    index, issues = build_object_index(objects_dir)
    if issues:
        print(f"DIGEST CHECK FAILED: {len(issues)} object issue(s)")
        for issue in issues:
            print(f" - {issue.format()}")
        return 1

    entries = []
    for rec in sorted(index.values(), key=lambda r: (r.data.get("updated_at", ""), r.object_type, r.object_id)):
        updated_at = str(rec.data.get("updated_at", "")).strip()
        dt = _parse_updated_at(updated_at)
        if dt is None:
            continue
        iso = dt.isocalendar()
        if iso.year != target_year or iso.week != target_week:
            continue

        title = str(rec.data.get("title") or rec.data.get("summary") or rec.object_id)
        summary = str(rec.data.get("summary") or "")
        references = [rec.object_id]

        # acceptance: all reference ids must be resolvable
        for ref in references:
            if ref not in index:
                print(f"DIGEST CHECK FAILED: unresolved reference id: {ref}")
                return 1

        entries.append(
            {
                "id": rec.object_id,
                "type": rec.object_type,
                "title": title,
                "summary": summary,
                "updated_at": updated_at,
                "references": references,
            }
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{week_label}.md"

    lines = [
        f"# PKOS Weekly Digest ({week_label})",
        "",
        "- 注意：本文件是知识进展索引（派生视图），不是权威事实层。",
        "- 每条都必须可回链到 objects/ 中的对象 id。",
        "",
    ]

    if not entries:
        lines.append("_No updated objects in this week._")
    else:
        lines.extend([
            "| id | type | title | summary | updated_at | references |",
            "|---|---|---|---|---|---|",
        ])
        for e in entries:
            refs = ", ".join(f"`{r}`" for r in e["references"])
            lines.append(
                f"| `{e['id']}` | `{e['type']}` | {e['title']} | {e['summary']} | `{e['updated_at']}` | [{refs}] |"
            )

    lines.append("")
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"digest generated: {output_path.as_posix()} ({len(entries)} item(s))")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate PKOS weekly digest")
    parser.add_argument("--objects-dir", default="objects", help="Objects directory")
    parser.add_argument("--output-dir", default="digests", help="Digest output directory")
    parser.add_argument("--week", default=None, help="ISO week: YYYY-Www (UTC)")
    args = parser.parse_args()
    return run_gen_digest(Path(args.objects_dir), Path(args.output_dir), args.week)


if __name__ == "__main__":
    raise SystemExit(main())
