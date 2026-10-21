from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""


def _tree_hash(path: Path) -> str:
    if not path.exists():
        return ""
    h = hashlib.sha256()
    for child in sorted(p for p in path.rglob("*") if p.is_file()):
        h.update(child.relative_to(path).as_posix().encode("utf-8"))
        h.update(b"\0")
        h.update(child.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def _run(args: list[str], cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, text=True, encoding="utf-8", capture_output=True)


def _write_seed_object(repo: Path) -> Path:
    path = repo / "objects" / "fact" / "legacy_quarantine_fact.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "id: fact.legacy.quarantine",
                "type: fact",
                "status: parsed",
                'title: "Legacy quarantine fact"',
                'summary: "Mutation must stay disabled"',
                'content: "Legacy writeback must not mutate this object"',
                "source:",
                '  - "internal://legacy-quarantine"',
                "anchors:",
                '  - "legacy-quarantine"',
                'created_at: "2026-07-20T00:00:00Z"',
                'updated_at: "2026-07-20T00:00:00Z"',
                "srs:",
                '  due_at: "2026-01-01T00:00:00Z"',
                "  interval_days: 1",
                "  ease: 2.5",
                '  last_reviewed_at: ""',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def _init_git(repo: Path) -> str:
    _run(["git", "init"], repo).check_returncode()
    _run(["git", "config", "user.email", "pkos-test@example.invalid"], repo).check_returncode()
    _run(["git", "config", "user.name", "PKOS Test"], repo).check_returncode()
    _run(["git", "add", "."], repo).check_returncode()
    _run(["git", "commit", "-m", "seed"], repo).check_returncode()
    return _run(["git", "rev-parse", "HEAD"], repo).stdout.strip()


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


@contextmanager
def _legacy_client(repo: Path) -> Iterator[Any]:
    old_env = {
        "PKOS_REPO_ROOT": os.environ.get("PKOS_REPO_ROOT"),
        "PKOS_WRITE_TOKEN": os.environ.get("PKOS_WRITE_TOKEN"),
    }
    os.environ["PKOS_REPO_ROOT"] = str(repo)
    os.environ["PKOS_WRITE_TOKEN"] = "legacy-test-token"
    try:
        from fastapi.testclient import TestClient
        from tools.server.main import create_app

        with TestClient(create_app()) as client:
            yield client
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _check_legacy_client_isolation() -> None:
    with tempfile.TemporaryDirectory(prefix="pkos-legacy-isolation-") as directory:
        root = Path(directory)
        repo = root / "client"
        ambient = root / "ambient"
        object_path = _write_seed_object(repo)
        _write_seed_object(ambient)
        ambient_hash = _tree_hash(ambient)
        ambient_env = {
            "PKOS_REPO_ROOT": str(ambient),
            "PKOS_WRITE_TOKEN": "ambient-test-token",
        }
        with patch.dict(os.environ, ambient_env):
            with _legacy_client(repo) as client:
                response = client.get("/api/objects/fact.legacy.quarantine")
                _assert(response.status_code == 200, "isolation object lookup failed")
                _assert(
                    response.json().get("_path") == object_path.as_posix(),
                    "request-time root escaped the temporary client repository",
                )
                _assert(os.environ["PKOS_WRITE_TOKEN"] == "legacy-test-token", "client token restored too early")
                ratings = client.post(
                    "/api/review/ratings:batch",
                    headers={"X-PKOS-Token": "legacy-test-token"},
                    json={"items": [{"id": "fact.legacy.quarantine", "score": 4}]},
                )
                _assert(ratings.status_code == 410, "isolation ratings request was not quarantined")
                _assert(client.post("/api/chat", json={"message": "hello"}).status_code == 410, "isolation chat request was not quarantined")
            for key, value in ambient_env.items():
                _assert(os.environ.get(key) == value, f"client did not restore {key}")
        _assert(_tree_hash(ambient) == ambient_hash, "legacy requests changed the ambient sentinel repository")


def _check_fastapi_quarantine() -> None:
    repo = Path(tempfile.mkdtemp(prefix="pkos-legacy-fastapi-"))
    try:
        object_path = _write_seed_object(repo)
        (repo / "review" / "logs").mkdir(parents=True, exist_ok=True)
        head_before = _init_git(repo)
        object_hash_before = _sha256(object_path)
        log_hash_before = _tree_hash(repo / "review" / "logs")

        with _legacy_client(repo) as client:
            response = client.post(
                "/api/review/ratings:batch",
                headers={"X-PKOS-Token": "legacy-test-token"},
                json={"items": [{"id": "fact.legacy.quarantine", "score": 4}]},
            )
            _assert(response.status_code == 410, f"ratings endpoint expected 410, got {response.status_code}: {response.text}")
            payload = response.json()
            _assert(payload.get("error") == "legacy_writeback_disabled", "ratings endpoint did not return quarantine code")

            _assert(_sha256(object_path) == object_hash_before, "legacy ratings endpoint mutated object file")
            _assert(_tree_hash(repo / "review" / "logs") == log_hash_before, "legacy ratings endpoint changed review logs")
            head_after = _run(["git", "rev-parse", "HEAD"], repo).stdout.strip()
            _assert(head_after == head_before, "legacy ratings endpoint changed git HEAD")

            chat = client.post("/api/chat", json={"message": "hello"})
            _assert(chat.status_code == 410, f"legacy chat expected 410, got {chat.status_code}: {chat.text}")
            _assert(chat.json().get("error") == "legacy_chat_retired", "legacy chat did not return retired code")

            health = client.get("/api/health")
            _assert(health.status_code == 200, "legacy health failed")
            health_payload = health.json()
            _assert(health_payload.get("service") == "pkos-legacy-fastapi", "health missing legacy service name")
            _assert(health_payload.get("legacy") is True, "health missing legacy=true")
            _assert(health_payload.get("readOnly") is True, "health missing readOnly=true")
            _assert(health_payload.get("authorityWriteEnabled") is False, "health missing authorityWriteEnabled=false")
            _assert(health_payload.get("replacement") == "pkos-agent-server", "health missing replacement")
    finally:
        shutil.rmtree(repo, ignore_errors=True)


def _check_source_boundaries() -> None:
    server_text = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "tools" / "server").glob("*.py"))
    _assert("DEEPSEEK_API_KEY" not in server_text, "legacy server references DEEPSEEK_API_KEY")
    _assert("ProviderRegistry" not in server_text, "legacy server references ProviderRegistry")
    _assert("PKOS_ENABLE_LEGACY" not in server_text, "legacy mutation has a re-enable flag")
    _assert("legacy_writeback_disabled" in server_text, "legacy writeback disabled code missing")
    _assert("legacy_chat_retired" in server_text, "legacy chat retired code missing")

    runtime_script = (ROOT / "scripts" / "local-runtime.ps1").read_text(encoding="utf-8")
    _assert("8000" not in runtime_script, "local runtime script references port 8000")
    _assert("8787" not in runtime_script, "local runtime script references port 8787")

    current_sources = []
    for base in ["apps", "packages", "scripts"]:
        for path in (ROOT / base).rglob("*"):
            if path.is_file() and path.suffix.lower() in {".ts", ".tsx", ".js", ".mjs", ".json", ".ps1", ".sh", ".md"}:
                if "node_modules" not in path.parts:
                    current_sources.append(path)
    offenders = []
    for path in current_sources:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "127.0.0.1:8787" in text or "localhost:8787" in text:
            offenders.append(path.relative_to(ROOT).as_posix())
    _assert(not offenders, f"current app references legacy 8787: {offenders}")


def _check_static_dashboard_quarantine() -> None:
    app_text = (ROOT / "site-private" / "dashboard" / "app.js").read_text(encoding="utf-8")
    _assert("Legacy PKOS Dashboard" in app_text, "legacy dashboard English notice missing")
    _assert("历史只读界面" in app_text, "legacy dashboard Chinese notice missing")
    _assert("authority 写回已禁用" in app_text, "legacy dashboard bilingual authority warning missing")
    for forbidden in [
        "pkos review-log append",
        "/api/review/ratings:batch",
        "ratings:batch",
        "Command Builder",
        "Copy All",
        "setRating(",
        "renderBuilder(",
        "data-score",
        "pkos-review-ratings",
    ]:
        _assert(forbidden not in app_text, f"legacy dashboard still exposes writeback affordance: {forbidden}")


def _check_docs_quarantine() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    operations = (ROOT / "docs" / "OPERATIONS.md").read_text(encoding="utf-8")
    quarantine_doc = ROOT / "docs" / "LEGACY_SERVICE_QUARANTINE.md"
    _assert(quarantine_doc.exists(), "legacy quarantine doc missing")
    _assert("scripts/local-runtime.ps1 start" in readme, "README main path does not point to local-runtime")
    _assert("Legacy" in readme and "8787" in readme, "README does not classify 8787 as legacy")
    _assert("Legacy" in operations and "ratings:batch" in operations, "OPERATIONS does not classify legacy ratings endpoint")
    _assert("pkos-agent-server" in quarantine_doc.read_text(encoding="utf-8"), "quarantine doc missing replacement service")

    help_result = _run([sys.executable, "-B", "-m", "tools.pkos", "--help"])
    _assert(help_result.returncode == 0, "tools.pkos --help failed")
    _assert("[legacy read-only]" in help_result.stdout, "serve help is not marked legacy read-only")


def main() -> int:
    _check_legacy_client_isolation()
    _check_fastapi_quarantine()
    _check_source_boundaries()
    _check_static_dashboard_quarantine()
    _check_docs_quarantine()
    print("LEGACY_QUARANTINE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
