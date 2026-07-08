export class NdjsonParseError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
  ) {
    super(message);
    this.name = "NdjsonParseError";
  }
}

export async function* parseNdjsonStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineNumber = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        lineNumber += 1;
        if (line.trim()) {
          yield parseLine(line, lineNumber);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      lineNumber += 1;
      yield parseLine(buffer, lineNumber);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new NdjsonParseError(`invalid NDJSON at line ${lineNumber}: ${detail}`, lineNumber);
  }
}
