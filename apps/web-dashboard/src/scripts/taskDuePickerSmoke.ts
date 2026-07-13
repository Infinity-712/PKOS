import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  addBeijingCalendarDays,
  addBeijingCalendarMonthsClamped,
  beijingPartsToUtcIso,
  formatTaskDueAtBeijing,
  roundUpToNextHalfHourBeijing,
  utcIsoToBeijingParts,
} from "../features/tasks/taskDue.js";

const stored = beijingPartsToUtcIso(2026, 7, 15, 18, 0);
assert(stored === "2026-07-15T10:00:00.000Z", "Beijing 18:00 did not store as UTC 10:00Z");
assert(formatTaskDueAtBeijing(stored) === "2026-07-15 18:00", "UTC 10:00Z did not display as Beijing 18:00");
assertParts(utcIsoToBeijingParts(stored), { year: 2026, month: 7, day: 15, hour: 18, minute: 0 }, "UTC to Beijing parts mismatch");

const rounded = roundUpToNextHalfHourBeijing(new Date("2026-07-15T09:41:00.000Z"));
assertParts(rounded, { year: 2026, month: 7, day: 15, hour: 18, minute: 0 }, "round up to next half hour failed");
const tomorrow = addBeijingCalendarDays({ year: 2026, month: 7, day: 15, hour: 18, minute: 0 }, 1);
assertParts(tomorrow, { year: 2026, month: 7, day: 16, hour: 18, minute: 0 }, "tomorrow quick date failed");
const nextWeek = addBeijingCalendarDays({ year: 2026, month: 7, day: 15, hour: 18, minute: 0 }, 7);
assertParts(nextWeek, { year: 2026, month: 7, day: 22, hour: 18, minute: 0 }, "next week quick date failed");
const clamped = addBeijingCalendarMonthsClamped({ year: 2026, month: 1, day: 31, hour: 18, minute: 0 }, 1);
assertParts(clamped, { year: 2026, month: 2, day: 28, hour: 18, minute: 0 }, "next month clamp failed");
const leap = addBeijingCalendarMonthsClamped({ year: 2028, month: 1, day: 31, hour: 18, minute: 0 }, 1);
assertParts(leap, { year: 2028, month: 2, day: 29, hour: 18, minute: 0 }, "leap year month clamp failed");

const source = [
  ...readFiles(join(process.cwd(), "src", "features", "tasks")),
  readFileSync(join(process.cwd(), "src", "pages", "TasksPage.tsx"), "utf8"),
].join("\n");
assert(source.includes("设置截止时间"), "due picker trigger copy missing");
assert(source.includes("今天") && source.includes("明天") && source.includes("下周") && source.includes("下月"), "quick date labels missing");
assert(source.includes("00:00") && source.includes("23:30"), "half-hour time list boundary missing");
assert(!source.includes("reminder") && !source.includes("repeat"), "due picker introduced reminder/repeat behavior");

console.log("TASK_DUE_PICKER_SMOKE_OK");

function assertParts(
  actual: { year: number; month: number; day: number; hour: number; minute: number },
  expected: { year: number; month: number; day: number; hour: number; minute: number },
  message: string,
): void {
  assert(
    actual.year === expected.year &&
      actual.month === expected.month &&
      actual.day === expected.day &&
      actual.hour === expected.hour &&
      actual.minute === expected.minute,
    `${message}: ${JSON.stringify(actual)}`,
  );
}

function readFiles(root: string): string[] {
  const entries = readdirSync(root);
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      contents.push(...readFiles(path));
    } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !path.endsWith(join("scripts", "taskDuePickerSmoke.ts"))) {
      contents.push(readFileSync(path, "utf8"));
    }
  }
  return contents;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
