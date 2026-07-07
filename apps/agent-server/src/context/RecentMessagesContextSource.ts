import type { AgentDatabase } from "../db/connection.js";
import type { ContextSourceResult } from "./ContextTypes.js";
import { withEstimatedChars } from "./ContextTypes.js";

type RecentMessagesContextSourceOptions = {
  limit?: number;
  maxMessageChars?: number;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

export class RecentMessagesContextSource {
  private readonly limit: number;
  private readonly maxMessageChars: number;

  constructor(
    private readonly db: AgentDatabase,
    options: RecentMessagesContextSourceOptions = {},
  ) {
    this.limit = options.limit ?? 12;
    this.maxMessageChars = options.maxMessageChars ?? 2000;
  }

  load(sessionId: string): ContextSourceResult {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = ? AND role IN ('user', 'assistant')
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(sessionId, this.limit) as ChatMessageRow[];

    const items = rows
      .reverse()
      .map((row) => {
        const truncated = row.content.length > this.maxMessageChars;
        const content = truncated ? row.content.slice(0, this.maxMessageChars) : row.content;
        return withEstimatedChars({
          id: `sqlite.chat_messages.${row.id}`,
          kind: "recent_message",
          authority: "runtime",
          source: { type: "sqlite", table: "chat_messages", recordId: row.id },
          capturedAt: row.created_at,
          stale: false,
          priority: 10,
          content: {
            role: row.role,
            content,
            truncated,
          },
        });
      });

    return { items, warnings: [] };
  }
}
