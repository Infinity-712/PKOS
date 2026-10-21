"""Reentrant, process-exclusive locking shared by Data Root writers."""
from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
import hashlib
import inspect
import os
from pathlib import Path
import tempfile
import threading
import time


class DataRootLockTimeout(TimeoutError):
    pass


class _LockState:
    def __init__(self):
        self.mutex = threading.RLock()
        self.depth = 0


_registry: dict[str, _LockState] = {}
_registry_mutex = threading.Lock()


def _after_fork():
    global _registry, _registry_mutex
    _registry = {}
    _registry_mutex = threading.Lock()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_after_fork)


@contextmanager
def data_root_lock(data_root: Path, *, timeout: float = 60.0):
    """Lock a canonical root across threads/processes; nested calls are safe.

    Lock files live outside authority and are never unlinked: deleting one can
    split waiting processes across different inodes. No vault files are touched.
    """
    key = os.path.normcase(str(Path(data_root).resolve()))
    with _registry_mutex:
        state = _registry.setdefault(key, _LockState())
    deadline = time.monotonic() + timeout
    if not state.mutex.acquire(timeout=max(0.0, timeout)):
        raise DataRootLockTimeout("timed out waiting for Data Root writer")
    handle = None
    acquired = False
    try:
        if state.depth == 0:
            directory = Path(tempfile.gettempdir()) / "pkos-data-root-locks"
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            lock_path = directory / (hashlib.sha256(key.encode("utf-8")).hexdigest() + ".lock")
            handle = lock_path.open("a+b")
            if lock_path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            while True:
                try:
                    if os.name == "nt":
                        import msvcrt
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    break
                except (BlockingIOError, PermissionError):
                    if time.monotonic() >= deadline:
                        raise DataRootLockTimeout("timed out waiting for Data Root writer")
                    time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
        state.depth += 1
        try:
            yield
        finally:
            state.depth -= 1
    finally:
        try:
            if handle is not None:
                try:
                    if acquired:
                        if os.name == "nt":
                            import msvcrt
                            handle.seek(0)
                            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                        else:
                            import fcntl
                            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                finally:
                    handle.close()
        finally:
            state.mutex.release()


def with_data_root_lock(function):
    """Decorate a function whose signature has a positional/keyword data_root."""
    signature = inspect.signature(function)

    @wraps(function)
    def locked(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        with data_root_lock(bound.arguments["data_root"]):
            return function(*args, **kwargs)

    return locked
