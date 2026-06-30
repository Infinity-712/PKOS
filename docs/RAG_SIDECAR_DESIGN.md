# RAG Sidecar Design

RAG Sidecar is a derived retrieval layer. It is not authority.

## Principles

- Indexes must be deletable and rebuildable.
- Chunks must point to source files.
- Retrieval results must preserve object status.
- Retrieval must not bypass trusted gates.
- Agent responses must distinguish authority level.

## Source Metadata

Every chunk should include:

- `source_path`
- `object_id` when applicable
- `object_type` when applicable
- `status`
- `updated_at`
- `chunk_id`

## Retrieval Priority

1. deterministic read;
2. metadata filter;
3. full-text / BM25;
4. vector retrieval;
5. rerank / compression.

## Status-Aware Usage

| Status | Agent usage |
| --- | --- |
| `raw` | only say the user once recorded it |
| `parsed` | candidate material |
| `challenged` | unresolved; mention objections |
| `trusted` | comparatively reliable knowledge |
| `deprecated` | do not cite by default |
| `creative` | writing material, not fact |

## Runtime Outputs

Planned derived outputs:

- `runtime/index.json`
- full-text index files
- optional vector index files
- retrieval debug traces

These files are caches. They can be deleted and regenerated.
