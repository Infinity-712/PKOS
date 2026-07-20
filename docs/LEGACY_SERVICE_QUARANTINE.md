# Legacy Service Quarantine

> Status: active quarantine. Legacy services are retained for historical inspection only and must not receive new features.

## Current Mainline

The only GUI authority path for the current PKOS mainline is:

```text
apps/web-dashboard / apps/desktop
  -> pkos-agent-server on 127.0.0.1:8790
  -> Python Core deterministic CLI
  -> active PKOS_DATA_ROOT
```

Current maintained components:

- `apps/agent-server`
- `apps/web-dashboard`
- `apps/desktop`
- Python Core authority CLI
- `scripts/local-runtime.ps1`
- port `8790`

## Quarantined Components

Legacy components:

- `site-private/dashboard`
- `tools/server`
- port `8000`
- port `8787`
- old FastAPI review writeback
- old FastAPI chat placeholder
- `export-site-data` static dashboard workflow

These components may remain in the repository for historical reproducibility, but they are outside the current mainline.

## Read-only Boundary

Legacy static dashboard may inspect derived data:

- `site-private/_pkos/index.json`
- `site-private/_pkos/queues.json`
- `site-private/_pkos/digests.json`

Legacy FastAPI may keep read-only endpoints for historical inspection:

- health
- objects list/get
- rendered object view
- review queue view
- digest view

## Authority Writer Prohibition

Legacy services must not:

- write `objects/**`;
- write `review/logs/**`;
- modify `object.srs`;
- write `tasks/**`;
- write `reminders/**`;
- write `digests/**`;
- Git commit Data Root or Core Root;
- call DeepSeek or any Provider Runtime;
- proxy to the 8790 Agent Server;
- use environment flags to re-enable mutation;
- connect to formal `PKOS_DATA_ROOT` for mutation;
- add new features.

## Disabled Endpoints

Legacy FastAPI mutation endpoints return `410 Gone`:

```json
{
  "error": "legacy_writeback_disabled",
  "message": "Legacy FastAPI writeback is retired. Use the PKOS Agent Server on port 8790."
}
```

Legacy FastAPI chat returns `410 Gone`:

```json
{
  "error": "legacy_chat_retired",
  "message": "Chat is available only through the PKOS Agent Server on port 8790."
}
```

## Ports

- `8790`: current Agent Server; allowed GUI authority service.
- `5173`: current Web Dashboard dev UI.
- `8000`: legacy static preview only.
- `8787`: legacy FastAPI read-only only.

`scripts/local-runtime.ps1` must not start `8000` or `8787`.

## Data Root Warning

Legacy services do not define the current authority boundary. Do not connect them to a formal or acceptance `PKOS_DATA_ROOT` for mutation. Static exports are derived caches; they are not authority.

## Current Replacement

Use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime.ps1 start
```

Then use the current Web Dashboard, Electron Desktop, or Python Core CLI.

## Extraction Prerequisites

Before moving legacy components to a historical repository:

1. Web Dashboard has object list/get/render parity.
2. Web Dashboard has digest browsing parity.
3. Review/SRS no longer depends on static export snippets.
4. Shared Python modules under `tools/common` remain in Core.
5. No current tests, docs, or startup scripts depend on `site-private/dashboard` or `tools/server`.

Extraction should preserve Git history, for example with an archive branch or subtree split. Do not hide dependency problems with a simple delete-only change.
