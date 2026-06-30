from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable


def _run_git(repo_root: Path, args: list[str]) -> str:
    r = subprocess.run(['git', *args], cwd=repo_root, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip() or f'git {args} failed')
    return r.stdout.strip()


def ensure_repo(repo_root: Path) -> None:
    _run_git(repo_root, ['rev-parse', '--is-inside-work-tree'])


def commit_files(repo_root: Path, files: Iterable[Path], message: str) -> str:
    rels = [str(p.as_posix()) for p in files]
    if not rels:
        raise RuntimeError('no files to commit')
    _run_git(repo_root, ['add', '--', *rels])
    _run_git(repo_root, ['commit', '-m', message])
    return _run_git(repo_root, ['rev-parse', '--short', 'HEAD'])
