import { randomUUID } from "node:crypto";

import type { AgentDatabase } from "../db/connection.js";
import { createAgentEvent, nowIso } from "../events/AgentEvent.js";
import { EventStore } from "../events/EventStore.js";
import type { RuntimeIdentity } from "../runtime/RuntimeIdentity.js";
import { PkosCliClient, type ReminderDueCliItem } from "../writeback/PkosCliClient.js";

type ReminderDeliveryAttemptRow = {
  id: string;
  reminder_id: string;
  remind_at: string;
  runtime_fingerprint: string;
  delivery_channel: string;
  delivery_state: string;
  first_seen_at: string;
  last_attempt_at: string;
  attempt_count: number;
  acknowledged_in_runtime_at: string | null;
  error_code: string | null;
};

export type RuntimeReminderNotification = {
  id: string;
  reminderId: string;
  remindAt: string;
  runtimeFingerprint: string;
  deliveryChannel: string;
  deliveryState: string;
  firstSeenAt: string;
  lastAttemptAt: string;
  attemptCount: number;
  acknowledgedInRuntimeAt: string | null;
  errorCode: string | null;
};

export type ReminderSchedulerScanResult = {
  ok: true;
  generatedAt: string;
  evaluatedAt: string;
  count: number;
  notifications: RuntimeReminderNotification[];
};

const DELIVERY_CHANNEL = "desktop_panel";

export class ReminderScheduler {
  private readonly cli: PkosCliClient;
  private readonly events: EventStore;

  constructor(
    private readonly db: AgentDatabase,
    private readonly runtimeIdentity: RuntimeIdentity,
    options: { cli?: PkosCliClient; events?: EventStore } = {},
  ) {
    this.cli = options.cli ?? new PkosCliClient();
    this.events = options.events ?? new EventStore(db);
  }

  async scan(options: { now?: string; limit?: number } = {}): Promise<ReminderSchedulerScanResult> {
    const due = await this.cli.reminderDue({ now: options.now, limit: options.limit ?? 100 });
    if (!due.ok) {
      throw new Error(`${due.errorCode}: ${due.message}`);
    }

    const now = nowIso();
    for (const item of due.due) {
      this.upsertAttempt(item, now);
    }

    this.events.record(
      createAgentEvent({
        type: "scheduler_run",
        severity: "info",
        payload: {
          scheduler: "reminder_scheduler",
          dueCount: due.due.length,
          evaluatedAt: due.evaluatedAt,
          authority: "reminders_jsonl",
          runtimeOnly: true,
        },
      }),
    );

    const dueIds = new Set(due.due.map((item) => item.id));
    return {
      ok: true,
      generatedAt: due.generatedAt,
      evaluatedAt: due.evaluatedAt,
      count: dueIds.size,
      notifications: this.listPending(dueIds),
    };
  }

  listPending(reminderIds?: Set<string>): RuntimeReminderNotification[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM reminder_delivery_attempts
         WHERE runtime_fingerprint = ?
           AND delivery_channel = ?
           AND delivery_state = 'pending'
           AND acknowledged_in_runtime_at IS NULL
         ORDER BY remind_at, first_seen_at, reminder_id`,
      )
      .all(this.runtimeIdentity.runtimeFingerprint, DELIVERY_CHANNEL) as ReminderDeliveryAttemptRow[];
    return rows.filter((row) => !reminderIds || reminderIds.has(row.reminder_id)).map(toNotification);
  }

  private upsertAttempt(item: ReminderDueCliItem, ts: string): void {
    const existing = this.db
      .prepare(
        `SELECT id
         FROM reminder_delivery_attempts
         WHERE reminder_id = ?
           AND runtime_fingerprint = ?
           AND delivery_channel = ?`,
      )
      .get(item.id, this.runtimeIdentity.runtimeFingerprint, DELIVERY_CHANNEL) as { id?: string } | undefined;
    if (existing?.id) {
      this.db
        .prepare(
          `UPDATE reminder_delivery_attempts
           SET remind_at = ?,
               last_attempt_at = ?,
               error_code = NULL
           WHERE id = ?`,
        )
        .run(item.remindAt, ts, existing.id);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO reminder_delivery_attempts
          (id, reminder_id, remind_at, runtime_fingerprint, delivery_channel, delivery_state, first_seen_at, last_attempt_at, attempt_count, acknowledged_in_runtime_at, error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(randomUUID(), item.id, item.remindAt, this.runtimeIdentity.runtimeFingerprint, DELIVERY_CHANNEL, "pending", ts, ts, 1);
  }
}

function toNotification(row: ReminderDeliveryAttemptRow): RuntimeReminderNotification {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    remindAt: row.remind_at,
    runtimeFingerprint: row.runtime_fingerprint,
    deliveryChannel: row.delivery_channel,
    deliveryState: row.delivery_state,
    firstSeenAt: row.first_seen_at,
    lastAttemptAt: row.last_attempt_at,
    attemptCount: row.attempt_count,
    acknowledgedInRuntimeAt: row.acknowledged_in_runtime_at,
    errorCode: row.error_code,
  };
}
