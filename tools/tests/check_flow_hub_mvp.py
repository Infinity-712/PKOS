from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.flow_hub.flow import run_export_agent_context, run_gen_flow


REQUIRED_FLOW_FILES = [
    "current_state.json",
    "today_queue.json",
    "review_queue.json",
    "recovery_queue.json",
    "writing_queue.json",
    "flow_budget.json",
]


def main() -> int:
    work = Path("tools/tests/tmp_flow_hub")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    runtime_flow = work / "runtime" / "flow"
    context_path = work / "runtime" / "agent_context.json"

    rc = run_gen_flow(Path("objects"), Path("review"), Path("state"), runtime_flow)
    if rc != 0:
        print("FAIL: gen-flow returned non-zero")
        return 1

    for name in REQUIRED_FLOW_FILES:
        path = runtime_flow / name
        if not path.exists():
            print(f"FAIL: missing flow output: {name}")
            return 1
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("schema_version", "generated_at", "source", "items"):
            if key not in data:
                print(f"FAIL: {name} missing key: {key}")
                return 1

    rc = run_export_agent_context(Path("objects"), Path("review"), Path("digests"), Path("state"), runtime_flow, context_path)
    if rc != 0 or not context_path.exists():
        print("FAIL: export-agent-context did not generate context")
        return 1

    context = json.loads(context_path.read_text(encoding="utf-8"))
    required_context_keys = {
        "schema_version",
        "generated_at",
        "context_budget",
        "current_state",
        "flow_budget",
        "today_queue",
        "review_queue",
        "recovery_queue",
        "writing_queue",
        "latest_digest",
        "operational_skills",
        "retrieved_objects",
        "safety",
    }
    missing = required_context_keys - set(context)
    if missing:
        print(f"FAIL: agent context missing keys: {sorted(missing)}")
        return 1

    if len(context["review_queue"]) > context["context_budget"]["max_review_items"]:
        print("FAIL: review_queue is not bounded")
        return 1
    if len(context["writing_queue"]) > context["context_budget"]["max_writing_items"]:
        print("FAIL: writing_queue is not bounded")
        return 1
    excerpt = context["latest_digest"].get("excerpt")
    if excerpt is not None and len(excerpt) > context["context_budget"]["max_digest_chars"]:
        print("FAIL: digest excerpt is not bounded")
        return 1
    if context["safety"].get("trusted_migration_allowed") is not False:
        print("FAIL: trusted migration safety flag is not false")
        return 1

    help_result = subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", "--help"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if help_result.returncode != 0:
        print("FAIL: tools.pkos --help failed")
        return 1
    if "publish-check" in help_result.stdout:
        print("FAIL: publish-check appears in CLI help")
        return 1

    shutil.rmtree(work)
    print("PASS: Flow Hub MVP outputs and bounded context verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
