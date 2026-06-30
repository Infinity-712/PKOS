from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    repo_root: Path = Path('.')
    objects_dir: Path = Path('objects')
    review_dir: Path = Path('review')
    digests_dir: Path = Path('digests')
    write_token: str = ""
    allow_origins: tuple[str, ...] = (
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    )


def load_config() -> ServerConfig:
    token = os.getenv('PKOS_WRITE_TOKEN', '')
    root = Path(os.getenv('PKOS_REPO_ROOT', '.')).resolve()
    return ServerConfig(
        host='127.0.0.1',
        port=int(os.getenv('PKOS_SERVER_PORT', '8787')),
        repo_root=root,
        objects_dir=Path(os.getenv('PKOS_OBJECTS_DIR', 'objects')),
        review_dir=Path(os.getenv('PKOS_REVIEW_DIR', 'review')),
        digests_dir=Path(os.getenv('PKOS_DIGESTS_DIR', 'digests')),
        write_token=token,
    )
