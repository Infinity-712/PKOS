# Moonlolo Production Ingress Stabilization

Status:
- Production ingress verified.
- Real WeChat messages can explicitly append to PKOS inbox/state.
- Regression test passed.

Verified commands:
- 记一下 ... -> inbox append -> confirmation reply
- 状态 ... -> state append -> confirmation reply

Runtime path:
- WeChat
- openclaw-gateway
- /app/reminder/process_reply.mjs
- /app/reminder/pkos_client.mjs
- /app/pkos-core/tools.pkos
- /data/pkos-vault/inbox or /data/pkos-vault/state
- /app/reminder/send.mjs
- WeChat confirmation reply

Docker boundary:
- /home/infinity/apps/moonlolo-reminder -> /app/reminder
- /home/infinity/apps/pkos-core -> /app/pkos-core:ro
- /home/infinity/data/pkos-vault -> /data/pkos-vault

Environment:
- REMINDER_DIR=/app/reminder
- OPENCLAW_DIR=/home/node/.openclaw
- PKOS_CORE_ROOT=/app/pkos-core
- PKOS_DATA_ROOT=/data/pkos-vault

Security boundary:
- Moonlolo may append inbox/state/runtime operational data.
- Moonlolo must not mutate trusted objects.
- pkos-core is mounted read-only.
- Vault ACL grants UID 1000 runtime access.
- No automatic trusted migration.
- No automatic task creation.
- No automatic chat logging.

Stabilization fixes:
- process_reply.mjs writes pkos_errors.log on PKOS append failures.
- pkos_client.mjs getAgentContext() runs gen-flow before export-agent-context --print.
- Regression test verifies doctor, appendInbox, appendState, and current_state refresh.

Schema lessons:
- Do not overload enum fields for test semantics.
- source remains a stable ingress category, such as moonlolo/manual/app.
- context and mode must use allowed schema values.
- Test semantics belong in tags, metadata, or note.

Operational rule:
- Do not expand Moonlolo beyond explicit append commands until Inbox Review exists.
