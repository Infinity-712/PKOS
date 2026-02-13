from __future__ import annotations

from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.common.object_store import build_object_index
from tools.digest.gen_digest import run_gen_digest


def main() -> int:
    base = Path("tools/tests/fixtures/digest")
    work = Path("tools/tests/tmp_digest")
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(base, work)

    objects_dir = work / "objects"
    output_dir = work / "output"
    rc = run_gen_digest(objects_dir, output_dir, "2026-W07")
    if rc != 0:
        print("FAIL: gen-digest returned non-zero")
        return 1

    digest_path = output_dir / "2026-W07.md"
    if not digest_path.exists():
        print("FAIL: digest file not generated")
        return 1

    text = digest_path.read_text(encoding="utf-8")
    index, issues = build_object_index(objects_dir)
    if issues:
        print("FAIL: object index has issues")
        return 1

    data_lines = [line for line in text.splitlines() if line.startswith("| `")]
    if not data_lines:
        print("FAIL: digest has no entries")
        return 1

    for line in data_lines:
        parts = [p.strip() for p in line.split("|")]
        # ['', '`id`', '`type`', 'title', 'summary', '`updated`', '[`id`]', '']
        if len(parts) < 7:
            print("FAIL: malformed digest line")
            return 1
        references_cell = parts[6]
        refs = [r.strip("`[] ") for r in references_cell.split(",") if r.strip()]
        if not refs:
            print("FAIL: digest entry missing references")
            return 1
        for ref in refs:
            if ref not in index:
                print(f"FAIL: unresolved digest reference: {ref}")
                return 1

    print("PASS: digest entries all contain resolvable references")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
