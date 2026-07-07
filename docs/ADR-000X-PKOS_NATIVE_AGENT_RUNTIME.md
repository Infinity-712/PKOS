
# ADR-000X: Adopt PKOS-native Agent Runtime for v0.6

## Status

Proposed.

## Date

2026-07-06

## Context

PKOS v0.5-alpha/beta 已经完成 Python/CLI 基础底座，包括：

- `PKOS_DATA_ROOT` 与 core/vault 分离；
    
- append-only `inbox/items.jsonl` 与 `state/snapshots.jsonl`；
    
- Flow Hub runtime：`runtime/flow/*.json` 与 `runtime/agent_context.json`；
    
- Inbox Review MVP：review action log + derived current view；
    
- Agent 权限边界与 bounded context contract；
    
- Moonlolo/OpenClaw/WeChat 历史集成验证。
    

这些能力证明 PKOS 已经具备一个 authority-first 的基础层：

```text
Git/file authority
+ append-only logs
+ derived runtime views
+ review actions
+ deterministic CLI/backend interfaces
+ human review gates
```

此前的 OpenClaw/Moonlolo/WeChat 路线验证了真实入口与外部 Agent 框架集成的可行性，但也暴露出关键不匹配：

1. OpenClaw 的 session lifecycle、memory lifecycle、channel routing 与 PKOS 的任务流、状态流、总结流、权威层边界不一致。
    
2. WeChat 通道与服务器手工配置增加了长期维护成本。
    
3. OpenClaw 的 durable memory 机制与 PKOS 的 authority/memory/review 分层不同。
    
4. 继续围绕 OpenClaw 扩展会让 PKOS 的核心架构被外部 runtime 决定。
    
5. 当前阶段更需要本地跑通 PKOS-native 业务逻辑，而不是继续调试微信与服务器生产链路。
    

同时，已审计一个开源通用 Agent 项目 Apix。结论是：

- Apix 不适合 fork 或整体迁入 PKOS；
    
- Apix 的 Python/FastAPI 多服务、MySQL/Redis/Milvus、MCP、多 Agent、Docker sandbox 对 PKOS v0.6 过重；
    
- Apix 中若干模式值得借鉴，例如 Agent graph loop、stream event envelope、generation state/abort、tool execution wrapper、message tree、RAG-as-tool、skill 按需加载。
    

因此需要明确 PKOS v0.6 的 Agent Runtime 主线。

---

## Decision

PKOS v0.6 采用 **PKOS-native Agent Runtime** 作为新主线。

核心决策如下：

1. **自研 Agent Runtime**
    
    - 使用 TS/Node 作为 Agent Runtime 主技术栈。
        
    - 使用 SQLite 作为 Agent runtime store。
        
    - SQLite 只保存 runtime data，不成为 PKOS authority layer。
        
2. **Web + Electron 优先**
    
    - Web Dashboard 是权威管理面。
        
    - Electron Desktop 是日常 Agent 交互层。
        
    - 第一阶段不做微信通道，不做手机端，不做服务器常驻生产部署。
        
3. **OpenClaw / WeChat 退役为历史路线**
    
    - OpenClaw 不再作为 PKOS 主 Agent Runtime。
        
    - WeChat 不再作为第一阶段入口。
        
    - Moonlolo/OpenClaw 相关代码和文档保留为历史集成与经验资产。
        
    - 可借鉴 OpenClaw 的 session reset、MEMORY.md、daily memory、dreaming、active recall 等设计，但不直接依赖 OpenClaw。
        
4. **Apix 仅作为架构参考**
    
    - 不 fork Apix。
        
    - 不迁入 Apix 代码。
        
    - 只借鉴以下模式：
        
        - Agent loop / graph runner；
            
        - structured streaming event envelope；
            
        - generation state / abort / partial buffer；
            
        - tool registry / tool executor；
            
        - conversation message tree；
            
        - RAG as tool；
            
        - skill manifest / 按需加载；
            
        - Electron bridge 思路。
            
    - 不采用 Apix 的 MySQL/Redis/Milvus、多服务拆分、MCP、多 Agent/swarm、完整 sandbox、完整 RAG。
        
5. **PKOS authority-first 保持不变**
    
    - Git/file authority 仍是唯一权威层。
        
    - `objects/`、`review/`、`digests/`、`docs/`、`raw_vault/`、`inbox/items.jsonl`、`state/snapshots.jsonl`、`review/logs/*.jsonl` 仍是权威或权威轨迹。
        
    - Agent 不能直接写 `trusted/`、`objects/`、正式 `tasks/`、governance docs。
        
    - 所有写回必须经过 Writeback Router。
        
    - 高风险变更必须进入 Dashboard review gate。
        

---

## Scope

### In Scope for v0.6-spike

```text
TS/Node Agent Server
SQLite runtime DB
local Web Dashboard integration
Electron Desktop shell
chat session persistence
structured streaming events
generation state / abort
bounded Context Builder
Flow Hub context source
ToolRegistry L0/L1
WritebackRouter
inboxAppend
stateAppend
createReviewCandidate
agent_events / tool_calls audit
review_candidates list
```

### Out of Scope for v0.6-spike

```text
WeChat channel
OpenClaw runtime integration
mobile app
server production deployment
MCP
multi-agent / swarm
full RAG
Milvus/vector DB
sandboxed code execution
automatic trusted/object/task writes
automatic governance mutation
automatic durable memory promotion
```

---

## Architecture

### Target Local Architecture

```text
Local PC

┌──────────────────────────────────────────────┐
│              Electron Desktop                │
│  - Agent chat                                │
│  - Quick capture                             │
│  - State input                               │
│  - Active task prompt                        │
│  - Local notification                        │
└──────────────────────┬───────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼───────────────────────┐
│              PKOS Agent Server               │
│              TS/Node + SQLite                │
│                                              │
│  - AgentRunner                               │
│  - GenerationManager                         │
│  - SessionManager                            │
│  - ContextBuilder                            │
│  - MemoryManager                             │
│  - ToolRegistry                              │
│  - ToolExecutor                              │
│  - WritebackRouter                           │
│  - ReminderScheduler                         │
│  - EventStore / AuditLogger                  │
└──────────────────────┬───────────────────────┘
                       │ controlled APIs / CLI adapter
┌──────────────────────▼───────────────────────┐
│                 PKOS Core                    │
│                                              │
│  Python CLI                                  │
│  Flow Hub                                    │
│  inbox-append                                │
│  state-append                                │
│  inbox-review                                │
│  digests                                     │
│  objects / review / vault                    │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│              Web Dashboard                   │
│                                              │
│  - Inbox Review                              │
│  - Agent Memory Editor                       │
│  - Review Candidates                         │
│  - Task Flow                                 │
│  - Reminder Settings                         │
│  - Audit Log                                 │
│  - Object / Trusted management               │
└──────────────────────────────────────────────┘
```

---

## Data Layer

### Authority Layer

The authority layer remains Git/file based:

```text
objects/
review/
digests/
docs/
raw_vault/
inbox/items.jsonl
state/snapshots.jsonl
review/logs/*.jsonl
```

Agent Server and SQLite must not replace this layer.

### Runtime Layer

SQLite may store:

```text
chat_sessions
chat_messages
generations
agent_events
tool_calls
agent_memory
session_summaries
task_items
reminders
scheduler_runs
writeback_requests
review_candidates
```

SQLite is allowed to be:

```text
runtime store
audit index
chat/session store
tool-call trace
scheduler state
memory candidate store
```

SQLite is not allowed to be:

```text
PKOS authority layer
trusted source of facts
replacement for review logs
replacement for vault append-only logs
replacement for Git/file governance
```

---

## Agent Runtime Components

### AgentRunner

Responsibilities:

- handle one chat generation lifecycle;
    
- call ContextBuilder;
    
- call LLM provider;
    
- stream structured events;
    
- execute allowed tools;
    
- persist messages/generations/tool calls;
    
- stop safely on abort/error.
    

Non-responsibilities:

- direct authority mutation;
    
- direct arbitrary file write;
    
- hidden memory promotion;
    
- autonomous task creation.
    

---

### GenerationManager

Responsibilities:

- create generation;
    
- mark running/completed/failed/aborted;
    
- keep partial content;
    
- support abort by generation/session;
    
- emit generation events.
    

Borrowed pattern:

- Apix `GenerationManager` generation state and abort handling.
    

PKOS-specific constraint:

- partial content is runtime audit only;
    
- partial content cannot become durable memory or PKOS trusted fact.
    

---

### Event Envelope

All runtime events should use a structured envelope:

```ts
type AgentEvent = {
  id: string
  ts: string
  sessionId?: string
  generationId?: string
  type:
    | "generation_started"
    | "content_delta"
    | "generation_completed"
    | "generation_aborted"
    | "generation_failed"
    | "tool_call_started"
    | "tool_call_completed"
    | "tool_call_failed"
    | "writeback_requested"
    | "writeback_written"
    | "writeback_blocked"
    | "review_candidate_created"
    | "scheduler_run"
  payload: unknown
  severity: "debug" | "info" | "warn" | "error"
}
```

Rules:

- every streamed event should be persistable;
    
- every side-effect should have an audit event;
    
- failure must not be hidden behind successful assistant wording.
    

---

### ContextBuilder

Context order:

```text
1. System boundary
2. Persona memory
3. Agent authority policy
4. Current state
5. Active task / Today Queue
6. Reminder context
7. Relevant project memory
8. Recent session window
9. Retrieved knowledge, if enabled
```

Required source metadata:

```text
source_kind
source_path or table/id
status
generated_at
captured_at when applicable
```

Forbidden context patterns:

```text
full vault injection
full chat history injection
unbounded RAG injection
raw inbox fulltext by default
old state as current state
unreviewed memory as durable fact
```

Initial implementation may read:

```text
runtime/agent_context.json
runtime/flow/*.json
recent SQLite chat messages
reviewed SQLite memory
```

---

### ToolRegistry and ToolExecutor

Permission levels:

```text
L0 read-only
L1 append-only low-risk
L2 deterministic write with confirmation
L3 authority mutation, human-only
L4 destructive / governance, human-only
```

Initial tools:

```text
L0:
  readAgentContext
  readFlowHub
  listRecentSessions
  getReviewQueue

L1:
  inboxAppend
  stateAppend
  createReviewCandidate

L2:
  updateRuntimeReminder
  pauseReminder
  enableReminder
```

Explicitly forbidden tools for Agent:

```text
writeObjects
writeTrusted
writeFormalTasks
modifyGovernanceDocs
deleteVaultFiles
modifyReviewActionLog
arbitraryShellExec
```

Tool execution requirements:

- validate input schema;
    
- check permission policy;
    
- write `tool_calls`;
    
- write `agent_events`;
    
- return structured error;
    
- never crash the Agent loop on tool failure.
    

---

### WritebackRouter

WritebackRouter is the hard authority boundary.

Allowed direct writebacks:

```text
appendInbox
appendState
createReviewCandidate
recordAuditEvent
```

Review-required writebacks:

```text
requestMemoryReview
requestTaskMutation
requestObjectMutation
requestGovernanceChange
```

Forbidden direct writebacks:

```text
objects/
trusted/
formal tasks
governance docs
review action logs
destructive operations
```

Writeback output must distinguish:

```text
written
queued_for_review
blocked
duplicate
error
```

Failure rule:

```text
If vault append fails, the assistant must not claim success.
```

---

### MemoryManager

Memory types:

```text
persona_memory
user_preference
project_memory
operational_memory
archived_memory
session_summary
```

Statuses:

```text
candidate
reviewed
rejected
archived
```

Rules:

- LLM-generated memory starts as `candidate`.
    
- Durable `reviewed` memory requires Dashboard review.
    
- Session summary is not automatically durable memory.
    
- Old operational state must not become current state.
    
- Memory must have source linkage.
    

---

### ReminderScheduler

Initial reminder types:

```text
once
daily
weekly
interval
manual enable/disable
```

Rules:

- reminders are persisted in SQLite;
    
- every trigger writes `scheduler_runs`;
    
- every notification writes `agent_events`;
    
- current_state may affect wording but not silently change reminder frequency;
    
- high-impact reminder changes require review/confirmation.
    

---

## Implementation Plan

### Phase 0: Repository Preparation

Create documentation only:

```text
docs/ADR-000X-PKOS_NATIVE_AGENT_RUNTIME.md
docs/AGENT_RUNTIME_ARCHITECTURE.md
docs/OPENCLAW_RETIREMENT_AND_LESSONS.md
```

No runtime code yet.

Acceptance:

- ADR exists;
    
- OpenClaw/WeChat clearly marked retired from mainline;
    
- Apix marked as reference, not dependency;
    
- v0.6-spike scope clearly bounded.
    

---

### Phase 1: Agent Server Skeleton

Create:

```text
apps/agent-server/
  src/index.ts
  src/server/httpServer.ts
  src/server/chatRoutes.ts
  src/events/AgentEvent.ts
  src/events/EventStore.ts
  src/db/schema.sql
  src/db/connection.ts
```

Acceptance:

- local server starts;
    
- can create chat session;
    
- can send mock message;
    
- mock generation streams:
    
    - `generation_started`
        
    - `content_delta`
        
    - `generation_completed`
        
- SQLite stores:
    
    - `chat_sessions`
        
    - `chat_messages`
        
    - `generations`
        
    - `agent_events`
        

---

### Phase 2: Runtime and Context

Create:

```text
src/runtime/AgentRunner.ts
src/runtime/GenerationManager.ts
src/context/ContextBuilder.ts
src/context/FlowHubContextSource.ts
src/providers/LlmProvider.ts
src/providers/OpenAICompatibleProvider.ts
```

Acceptance:

- dry-run provider can stream without paid API;
    
- generation abort works;
    
- partial content persists;
    
- ContextBuilder reads Flow Hub / `runtime/agent_context.json`;
    
- context items include source/timestamp/status.
    

---

### Phase 3: Tooling and Writeback

Create:

```text
src/tools/ToolRegistry.ts
src/tools/ToolExecutor.ts
src/tools/builtin/inboxAppend.ts
src/tools/builtin/stateAppend.ts
src/tools/builtin/createReviewCandidate.ts
src/writeback/WritebackRouter.ts
src/writeback/VaultAppendClient.ts
src/writeback/WritebackSchemas.ts
```

Acceptance:

- “记一下 ...” can only call `inboxAppend`;
    
- “状态 ...” can only call `stateAppend`;
    
- forbidden writes return `blocked` or `queued_for_review`;
    
- every tool call is audited;
    
- tool failure returns structured error and does not crash generation.
    

---

### Phase 4: Dashboard and Electron Minimal Integration

Dashboard:

```text
ReviewCandidates
AuditLogViewer
AgentMemoryEditor draft view
```

Electron:

```text
ChatWindow
agentClient
quick capture input
state input
```

Acceptance:

- Electron can talk to local Agent Server;
    
- Web Dashboard can view review candidates and audit log;
    
- Dashboard remains authority management surface;
    
- Electron remains interaction surface.
    

---

## Consequences

### Positive

- PKOS owns its Agent lifecycle, memory, session, scheduler, and writeback boundaries.
    
- Local-first development becomes possible.
    
- Server no longer acts as primary exploration environment.
    
- OpenClaw/WeChat complexity is removed from first-stage scope.
    
- SQLite gives durable runtime state without replacing vault authority.
    
- Apix lessons can be used without importing its complexity.
    

### Negative

- More implementation work than extending OpenClaw.
    
- Need to build and maintain Agent Server, SQLite migrations, Web/Electron integration.
    
- Need to define memory and task semantics ourselves.
    
- Short-term loss of WeChat low-friction entry.
    
- Requires stronger internal discipline to avoid recreating a general-purpose Agent framework.
    

### Risks

|Risk|Impact|Mitigation|
|---|---|---|
|Scope creep|v0.6 becomes too large|Keep v0.6 to local Agent Server + streaming + L1 writeback|
|SQLite becomes authority|PKOS fact model degrades|ADR states SQLite is runtime only; review/vault remain authority|
|Memory pollution|Agent writes guesses as facts|all memory starts candidate; Dashboard review required|
|Tool overreach|Agent modifies authority files|ToolRegistry + WritebackRouter block L3/L4|
|RAG too early|retrieval bypasses review gate|no full RAG in v0.6|
|Electron/Web coupling|unclear authority boundary|Web manages authority; Electron handles interaction|
|Apix over-import|accidental complexity|Apix reference only; no fork/no code migration|
|OpenClaw relapse|old route grows again|mark OpenClaw as retired from mainline|

---

## Alternatives Considered

### Alternative A: Continue OpenClaw-centric development

Rejected.

Reason:

- Session/memory/channel lifecycle mismatch;
    
- WeChat and server configuration overhead;
    
- difficult to make PKOS authority-first;
    
- long-term runtime owned by external framework.
    

### Alternative B: Fork or embed Apix

Rejected.

Reason:

- Apix is too heavy for v0.6;
    
- Python/FastAPI/MySQL/Redis/Milvus stack mismatches TS/Node + SQLite target;
    
- permission model does not satisfy PKOS L0-L4/human-review gates;
    
- multi-agent, MCP, sandbox, RAG are premature.
    

### Alternative C: Web Dashboard only, no Agent Runtime

Rejected as mainline, acceptable fallback.

Reason:

- safer and smaller, but does not validate task-flow traversal, active reminders, desktop Agent interaction.
    

### Alternative D: Full self-hosted mobile/server first

Rejected for v0.6.

Reason:

- persistence and mobile are useful later;
    
- current priority is local business logic and authority boundary validation.
    

---

## Acceptance Criteria

This ADR is accepted when:

1. Repository contains the ADR document.
    
2. OpenClaw/WeChat are marked retired from the mainline roadmap.
    
3. Apix is documented as reference-only.
    
4. v0.6-spike scope is bounded to local Agent Server + Web/Electron minimal integration.
    
5. SQLite is explicitly documented as runtime-only.
    
6. WritebackRouter and ToolRegistry are required before any Agent side-effect.
    
7. No implementation work starts with RAG/MCP/multi-agent/server production.
    

---

## Follow-up Documents

After accepting this ADR, create:

```text
docs/AGENT_RUNTIME_ARCHITECTURE.md
docs/OPENCLAW_RETIREMENT_AND_LESSONS.md
docs/AGENT_RUNTIME_V0.6_SPIKE_PLAN.md
```

These are not part of the ADR itself, but should be written before broad implementation.

---

## Notes for Codex

Codex should not start from Electron UI or RAG.

The first implementation commit after this ADR should be:

```text
apps/agent-server/src/db/schema.sql
apps/agent-server/src/events/AgentEvent.ts
apps/agent-server/src/runtime/GenerationManager.ts
apps/agent-server/src/server/chatRoutes.ts
```

with dry-run streaming and SQLite audit only.

Do not implement:

```text
MCP
RAG
multi-agent
sandbox
OpenClaw bridge
WeChat
server deployment
authority mutation
```

until the local runtime skeleton passes acceptance.