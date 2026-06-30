from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "integrations" / "moonlolo" / "pkos_client.mjs"
ADAPTER_README = ROOT / "integrations" / "moonlolo" / "README.md"
SERVER_DOC = ROOT / "docs" / "SERVER_DEPLOYMENT.md"


def _fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def main() -> int:
    if not ADAPTER.exists():
        return _fail("missing integrations/moonlolo/pkos_client.mjs")
    if not ADAPTER_README.exists():
        return _fail("missing integrations/moonlolo/README.md")
    if not SERVER_DOC.exists():
        return _fail("missing docs/SERVER_DEPLOYMENT.md")

    adapter_text = ADAPTER.read_text(encoding="utf-8")
    docs_text = "\n".join(
        [
            ADAPTER_README.read_text(encoding="utf-8"),
            SERVER_DOC.read_text(encoding="utf-8"),
        ]
    )

    forbidden_snippets = [
        "?.",
        "??",
        "shell: true",
        "exec(",
        "execSync(",
        "spawn(",
    ]
    for snippet in forbidden_snippets:
        if snippet in adapter_text:
            return _fail(f"adapter contains forbidden subprocess pattern: {snippet}")

    for line_no, line in enumerate(adapter_text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("await ") or stripped.startswith("await("):
            return _fail(f"adapter contains top-level await-like syntax at line {line_no}")

    required_snippets = [
        "spawnSync(",
        '"paths"',
        '"doctor"',
        '"export-agent-context"',
        '"inbox-append"',
        '"state-append"',
    ]
    for snippet in required_snippets:
        if snippet not in adapter_text:
            return _fail(f"adapter missing required snippet: {snippet}")

    bad_doc_patterns = [
        "git add /home/infinity/data/pkos-vault",
        "git add pkos-vault",
        "commit pkos-vault",
        "commit real vault",
        "commit the vault",
    ]
    lowered_docs = docs_text.lower()
    for pattern in bad_doc_patterns:
        if pattern in lowered_docs:
            return _fail(f"docs appear to ask for committing real vault data: {pattern}")

    help_result = subprocess.run(
        [sys.executable, "-B", "-m", "tools.pkos", "--help"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if help_result.returncode != 0:
        return _fail("tools.pkos --help failed")
    if "publish-check" in help_result.stdout:
        return _fail("publish-check appears in CLI help")

    node = shutil.which("node")
    if node:
        result = subprocess.run(
            [node, "--check", str(ADAPTER)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            print(result.stdout)
            print(result.stderr)
            return _fail("node --check failed for Moonlolo adapter")
        print("node --check: passed")
    else:
        print("node --check: skipped (node not found)")

    print("PASS: Moonlolo adapter example verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
