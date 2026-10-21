import type { ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export type CompatScenario = "normal" | "failed" | "truncated" | "disconnect" | "slow";

// Deliberately cut both JSON syntax and multibyte characters. TCP may coalesce writes;
// callers must separately test these exact byte cuts and observable HTTP timing.
export function splitCompatBytes(bytes: Buffer): Buffer[] {
  const cuts = new Set([Math.min(11, bytes.length)]);
  for (let i = 0; i < bytes.length; i++) {
    if ((bytes[i] & 0xe0) === 0xc0 || (bytes[i] & 0xf0) === 0xe0 || (bytes[i] & 0xf8) === 0xf0) {
      cuts.add(i + 1);
      i += (bytes[i] & 0xf8) === 0xf0 ? 3 : (bytes[i] & 0xf0) === 0xe0 ? 2 : 1;
    }
  }
  const result: Buffer[] = [];
  let start = 0;
  for (const end of [...cuts, bytes.length].sort((a, b) => a - b)) {
    if (end > start) result.push(bytes.subarray(start, end));
    start = end;
  }
  return result;
}

export function wrapCompatResponse(res: ServerResponse, scenario: CompatScenario): { finished: () => Promise<void> } {
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  let queue = Promise.resolve();
  let pending = "";
  let grouped = false;
  let stopped = false;
  const isStream = () => String(res.getHeader("Content-Type")).includes("application/x-ndjson");

  const enqueue = (text: string, split = true) => {
    queue = queue.then(async () => {
      for (const bytes of split ? splitCompatBytes(Buffer.from(text)) : [Buffer.from(text)]) {
        if (res.destroyed || res.writableEnded) return;
        write(bytes);
        await delay(12);
      }
    });
  };

  res.write = ((chunk: string | Uint8Array) => {
    if (!isStream()) return write(chunk);
    if (stopped) return true;
    const line = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (!grouped && pending) {
      enqueue(pending + line, false);
      grouped = true;
      pending = "";
    } else if (scenario === "disconnect" && line.includes('"content_delta"')) {
      enqueue(pending + line.slice(0, 30));
      pending = "";
      stopped = true;
      queue = queue.then(() => { res.destroy(); });
    } else {
      if (pending) enqueue(pending);
      pending = line;
    }
    return true;
  }) as ServerResponse["write"];

  res.end = ((chunk?: string | Uint8Array) => {
    if (!isStream()) return chunk === undefined ? end() : end(chunk);
    if (!stopped) {
      if (chunk !== undefined) pending += String(chunk);
      const tail = pending.replace(/\n$/, "");
      enqueue(scenario === "truncated" ? tail.slice(0, 25) : tail);
      pending = "";
      stopped = true;
      queue = queue.then(() => { if (!res.destroyed) end(); });
    }
    return res;
  }) as ServerResponse["end"];

  return { finished: () => queue };
}
