from __future__ import annotations

from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.queue_gen.gen_queue import run_gen_queue


def main() -> int:
    base = Path("tools/tests/fixtures/gen_queue")
    work = Path("tools/tests/tmp_gen_queue")
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(base, work)

    objects = work / "objects"
    review = work / "review"
    target = objects / "fact" / "missing_srs.yaml"

    rc1 = run_gen_queue(objects, review)
    first = target.read_text(encoding="utf-8")
    rc2 = run_gen_queue(objects, review)
    second = target.read_text(encoding="utf-8")

    if rc1 != 0 or rc2 != 0:
        print("FAIL: gen-queue returned non-zero")
        return 1
    if first != second:
        print("FAIL: object file changed again on second run")
        return 1

    print("PASS: gen-queue idempotent after first default fill")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
