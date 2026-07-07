import type { AgentDatabase } from "../db/connection.js";
import type { AgentEvent } from "./AgentEvent.js";
import { serializePayload } from "./AgentEvent.js";

type AgentEventRow = {
  id: string;
  ts: string;
  session_id: string | null;
  generation_id: string | null;
  type: AgentEvent["type"];
  severity: AgentEvent["severity"];
  payload_json: string;
};

export class EventStore {
  constructor(private readonly db: AgentDatabase) {}

  record(event: AgentEvent): AgentEvent {
    this.db
      .prepare(
        `INSERT INTO agent_events
          (id, ts, session_id, generation_id, type, severity, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.ts,
        event.sessionId ?? null,
        event.generationId ?? null,
        event.type,
        event.severity,
        serializePayload(event.payload),
      );
    return event;
  }

  listForGeneration(generationId: string): AgentEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_events WHERE generation_id = ? ORDER BY ts, id")
      .all(generationId) as AgentEventRow[];
    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      sessionId: row.session_id ?? undefined,
      generationId: row.generation_id ?? undefined,
      type: row.type,
      severity: row.severity,
      payload: JSON.parse(row.payload_json),
    }));
  }
}
