import { useState } from "react";

import {
  addBeijingCalendarDays,
  addBeijingCalendarMonthsClamped,
  beijingPartsToUtcIso,
  formatTaskDueAtBeijing,
  isSameBeijingDate,
  pad,
  roundUpToNextHalfHourBeijing,
  utcIsoToBeijingParts,
  type BeijingDateTimeParts,
} from "./taskDue.js";

type TaskDuePickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const TIME_OPTIONS = [
  "00:00",
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
];

export function TaskDuePicker(props: TaskDuePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BeijingDateTimeParts>(() => initialDraft(props.value));
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(initialDraft(props.value)));

  function openPicker(): void {
    const next = initialDraft(props.value);
    setDraft(next);
    setVisibleMonth(monthStart(next));
    setOpen(true);
  }

  function chooseQuick(days: number | "month"): void {
    const baseDate = roundUpToNextHalfHourBeijing();
    const withCurrentTime = { ...baseDate, hour: draft.hour, minute: draft.minute };
    const next = days === "month" ? addBeijingCalendarMonthsClamped(withCurrentTime, 1) : addBeijingCalendarDays(withCurrentTime, days);
    setDraft(next);
    setVisibleMonth(monthStart(next));
  }

  function chooseTime(value: string): void {
    const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
    setDraft({ ...draft, hour, minute });
  }

  function confirm(): void {
    props.onChange(beijingPartsToUtcIso(draft.year, draft.month, draft.day, draft.hour, draft.minute));
    setOpen(false);
  }

  return (
    <div className="task-due-picker">
      <div className="task-due-trigger">
        <button type="button" onClick={openPicker} aria-label="设置截止时间">
          {props.value ? formatTaskDueAtBeijing(props.value) : "设置截止时间"}
        </button>
        {props.value ? (
          <button type="button" onClick={() => props.onChange(null)} aria-label="清除截止时间">
            清除
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="task-due-popover" role="dialog" aria-label="选择截止时间">
          <div className="quick-date-row">
            <button type="button" aria-label="选择今天" onClick={() => chooseQuick(0)}>
              <span aria-hidden="true">今</span> 今天
            </button>
            <button type="button" aria-label="选择明天" onClick={() => chooseQuick(1)}>
              <span aria-hidden="true">明</span> 明天
            </button>
            <button type="button" aria-label="选择下周" onClick={() => chooseQuick(7)}>
              <span aria-hidden="true">周</span> 下周
            </button>
            <button type="button" aria-label="选择下月" onClick={() => chooseQuick("month")}>
              <span aria-hidden="true">月</span> 下月
            </button>
          </div>
          <div className="task-due-grid">
            <CalendarPanel
              visibleMonth={visibleMonth}
              selected={draft}
              onVisibleMonthChange={setVisibleMonth}
              onSelect={(next) => setDraft({ ...draft, year: next.year, month: next.month, day: next.day })}
            />
            <div className="time-list" role="listbox" aria-label="选择时间">
              {TIME_OPTIONS.map((time) => {
                const selected = time === `${pad(draft.hour)}:${pad(draft.minute)}`;
                return (
                  <button key={time} type="button" className={selected ? "active" : ""} onClick={() => chooseTime(time)} aria-selected={selected}>
                    {time}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="task-due-actions">
            <span className="subtle">{`${pad(draft.year, 4)}-${pad(draft.month)}-${pad(draft.day)} ${pad(draft.hour)}:${pad(draft.minute)} 北京时间`}</span>
            <button type="button" onClick={() => setOpen(false)}>
              关闭
            </button>
            <button type="button" onClick={confirm}>
              确定
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalendarPanel(props: {
  visibleMonth: BeijingDateTimeParts;
  selected: BeijingDateTimeParts;
  onVisibleMonthChange: (value: BeijingDateTimeParts) => void;
  onSelect: (value: BeijingDateTimeParts) => void;
}) {
  const today = roundUpToNextHalfHourBeijing();
  const days = calendarDays(props.visibleMonth);
  return (
    <div className="calendar-panel">
      <div className="calendar-heading">
        <button type="button" aria-label="上个月" onClick={() => props.onVisibleMonthChange(addBeijingCalendarMonthsClamped(props.visibleMonth, -1))}>
          ‹
        </button>
        <strong>{`${pad(props.visibleMonth.year, 4)}-${pad(props.visibleMonth.month)}`}</strong>
        <button type="button" aria-label="下个月" onClick={() => props.onVisibleMonthChange(addBeijingCalendarMonthsClamped(props.visibleMonth, 1))}>
          ›
        </button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-days">
        {days.map((day) => {
          const muted = day.month !== props.visibleMonth.month;
          const selected = isSameBeijingDate(day, props.selected);
          const isToday = isSameBeijingDate(day, today);
          return (
            <button
              key={`${day.year}-${day.month}-${day.day}`}
              type="button"
              className={`${muted ? "muted-day" : ""} ${selected ? "active" : ""} ${isToday ? "today" : ""}`}
              onClick={() => props.onSelect(day)}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function initialDraft(value: string | null): BeijingDateTimeParts {
  return value ? utcIsoToBeijingParts(value) : roundUpToNextHalfHourBeijing();
}

function monthStart(value: BeijingDateTimeParts): BeijingDateTimeParts {
  return { ...value, day: 1 };
}

function calendarDays(month: BeijingDateTimeParts): BeijingDateTimeParts[] {
  const first = new Date(Date.UTC(month.year, month.month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const result: BeijingDateTimeParts[] = [];
  for (let index = -mondayOffset; index < 42 - mondayOffset; index += 1) {
    const date = new Date(Date.UTC(month.year, month.month - 1, 1 + index));
    result.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: month.hour,
      minute: month.minute,
    });
  }
  return result;
}
