from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.flow_hub.append_logs import run_inbox_append, run_state_append
from tools.flow_hub.flow import run_export_agent_context, run_gen_flow


def _jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    work = Path("tools/tests/tmp_inbox_state")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    inbox_path = work / "inbox" / "items.jsonl"
    state_path = work / "state" / "snapshots.jsonl"
    runtime_flow = work / "runtime" / "flow"
    context_path = work / "runtime" / "agent_context.json"

    run_inbox_append(inbox_path, "note", "first note", tags=["alpha"], metadata={"k": "v"})
    run_inbox_append(inbox_path, "task", "second item")
    inbox_items = _jsonl(inbox_path)
    if len(inbox_items) != 2:
        print("FAIL: inbox append did not preserve both lines")
        return 1
    if inbox_items[0]["content"] != "first note" or inbox_items[1]["capture_type"] != "task":
        print("FAIL: inbox item fields are wrong")
        return 1

    run_state_append(state_path, "low", "anxious", "chest_tight", context="dorm", mode="recovery")
    run_state_append(
        state_path,
        "medium",
        "calm",
        "normal",
        context="library",
        mode="study",
        risk_overload="low",
        note="latest state",
    )
    state_items = _jsonl(state_path)
    if len(state_items) != 2:
        print("FAIL: state append did not preserve both lines")
        return 1

    rc = run_gen_flow(Path("objects"), Path("review"), state_path.parent, runtime_flow)
    if rc != 0:
        print("FAIL: gen-flow returned non-zero")
        return 1
    current_state = json.loads((runtime_flow / "current_state.json").read_text(encoding="utf-8"))
    state = current_state["state"]
    if state["energy"] != "medium" or state["context"] != "library" or state["note"] != "latest state":
        print("FAIL: gen-flow did not use latest state snapshot")
        return 1

    rc = run_export_agent_context(Path("objects"), Path("review"), Path("digests"), state_path.parent, runtime_flow, context_path)
    if rc != 0:
        print("FAIL: export-agent-context returned non-zero")
        return 1
    context = json.loads(context_path.read_text(encoding="utf-8"))
    if context["current_state"]["energy"] != "medium" or context["current_state"]["mode"] != "study":
        print("FAIL: agent context did not include latest current_state")
        return 1

    ignore_text = Path(".gitignore").read_text(encoding="utf-8")
    for rule in ("/runtime/agent_context.json", "/runtime/flow/*.json", "/inbox/*.jsonl", "/state/*.jsonl"):
        if rule not in ignore_text:
            print(f"FAIL: .gitignore missing {rule}")
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
    print("PASS: Inbox and state append logs verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
