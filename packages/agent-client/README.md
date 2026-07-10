# PKOS Agent Client

> Status: v0.6 shared browser/renderer client.

This package is a small TypeScript client for local PKOS Agent Server APIs. It is not an authority layer and does not read or write PKOS files directly.

## Scope

- Browser and Electron renderer compatible.
- No React dependency.
- No Electron dependency.
- No Node-only runtime API in `src/`.
- Uses native `fetch`.
- Parses chat NDJSON with Web Streams.
- Performs minimal runtime validation for server JSON.

Covered APIs:

- `GET /health`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `GET /api/chat/provider-status`
- `GET /api/chat/provider-profiles`
- `POST /api/chat/provider-selection`
- `POST /api/chat/send`
- `POST /api/chat/generations/:generationId/abort`
- `POST /api/actions/inbox-append`
- `POST /api/actions/state-append`
- `GET /api/pkos/state-timeline`

Web-only authority management surfaces such as Inbox Review, Action Resolution, and Audit can keep their local client code.

## Behavior

POST calls do not automatically retry. Callers that need idempotent retry should use the exported request attempt model, which freezes `requestId`, endpoint, and payload until the user explicitly starts a new request.

Real-provider chat consent is per request. `sendChatMessage()` can forward `allowExternalProvider: true`, but the client never stores consent and never decides provider policy by itself. Callers can use `getProviderStatus()` and `getProviderProfiles()` to render provider/model/reasoning state without exposing endpoint path/query, API keys, authorization headers, environment variables, or filesystem paths.

`setProviderSelection()` posts only `profileId`, `modelId`, and `reasoningPreset` to the fixed local endpoint. It does not accept arbitrary URLs, keys, headers, model text input, or request body overrides, and it does not automatically retry.

`abortGeneration(generationId)` calls the fixed backend abort endpoint. It requests local provider stream cancellation, but remote model services may already have processed part of a request.

The client does not persist payloads, does not use browser storage, and does not print message/content/note fields. It also does not expose Python commands, executable paths, or filesystem paths.

## NDJSON

`parseNdjsonStream()` accepts a `ReadableStream<Uint8Array>` and yields parsed JSON items. It handles chunk boundaries and a final line without a trailing newline. Invalid JSON raises `NdjsonParseError` with the line number.

## Commands

```bash
npm install
npm run check
npm run build
npm run smoke
```

Expected smoke marker:

```text
AGENT_CLIENT_SMOKE_OK
```
