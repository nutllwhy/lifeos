import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarStartForTask,
  dueDateForDay,
  fixedBusyIntervals,
  isDateOnlyDue,
  suggestTaskStart,
  taskDateKey,
} from "../lib/task-scheduler.ts";

test("keeps task day separate from its scheduled time", () => {
  const dueDate = dueDateForDay("2026-08-31");
  assert.equal(dueDate, "2026-08-31T18:00:00+08:00");
  assert.equal(isDateOnlyDue(dueDate), true);
  assert.equal(calendarStartForTask({ dueDate, scheduledStart: null }), null);
  assert.equal(calendarStartForTask({ dueDate, scheduledStart: "2026-08-31T15:00:00+08:00" }), "2026-08-31T15:00:00+08:00");
  assert.equal(taskDateKey(dueDate), "2026-08-31");
});

test("suggests a content-aware free slot and avoids occupied time", () => {
  const writing = suggestTaskStart({
    title: "完成公众号脚本",
    dateKey: "2026-08-31",
    estimatedMinutes: 60,
    now: new Date("2026-08-30T12:00:00+08:00"),
  });
  assert.equal(writing, "2026-08-31T09:00:00+08:00");

  const publishing = suggestTaskStart({
    title: "发布短视频",
    dateKey: "2026-08-31",
    estimatedMinutes: 30,
    busy: [{ startAt: "2026-08-31T18:00:00+08:00", endAt: "2026-08-31T19:00:00+08:00" }],
    now: new Date("2026-08-30T12:00:00+08:00"),
  });
  assert.notEqual(publishing, "2026-08-31T18:00:00+08:00");
  assert.equal(fixedBusyIntervals("2026-08-31").length, 1);
  assert.equal(fixedBusyIntervals("2026-09-05").length, 0);
});

test("does not put a newly scheduled task earlier than the current time", () => {
  const result = suggestTaskStart({
    title: "整理今天的素材",
    dateKey: "2026-08-31",
    estimatedMinutes: 30,
    now: new Date("2026-08-31T18:20:00+08:00"),
  });
  assert.ok(result);
  assert.ok(new Date(result).getTime() >= new Date("2026-08-31T18:30:00+08:00").getTime());
});
