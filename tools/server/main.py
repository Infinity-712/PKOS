from __future__ import annotations

import argparse
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from tools.server.api_digests import router as digests_router
from tools.server.api_objects import router as objects_router
from tools.server.api_review import router as review_router
from tools.server.api_write import router as write_router
from tools.server.config import load_config


def create_app() -> FastAPI:
    cfg = load_config()
    app = FastAPI(title='PKOS Local Backend', version='0.4-mvp')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.allow_origins),
        allow_methods=['GET', 'POST'],
        allow_headers=['*'],
    )

    @app.get('/api/health')
    def health():
        return {
            'status': 'ok',
            'version': 'v0.4-mvp',
            'time': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
            'host': cfg.host,
        }

    @app.post('/api/chat')
    def chat_placeholder():
        return {'status': 'not_implemented', 'reason': 'LLM write capability is disabled in v0.4 MVP'}

    app.include_router(objects_router)
    app.include_router(review_router)
    app.include_router(digests_router)
    app.include_router(write_router)
    return app


app = create_app()


def main() -> int:
    parser = argparse.ArgumentParser(description='Run PKOS local backend API server')
    parser.add_argument('--port', type=int, default=None)
    args = parser.parse_args()

    cfg = load_config()
    port = args.port or cfg.port
    uvicorn.run('tools.server.main:app', host='127.0.0.1', port=port, reload=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
