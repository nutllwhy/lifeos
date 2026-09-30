import assert from "node:assert/strict";
import test from "node:test";
import { layoutCalendarDay } from "../lib/calendar-layout.ts";

// The layout reads wall-clock hours, which is what the calendar shows, so the
// fixtures have to be built in the machine's own zone. Writing literal
// "+08:00" instants made these tests pass only on a UTC+8 box.
const event = (id, start, end) => {
  const at = (hhmm) => {
    const [hour, minute] = hhmm.split(":").map(Number);
    return new Date(2026, 7, 31, hour, minute).toISOString();
  };
  return { id, startAt: at(start), endAt: at(end) };
};

test("maps event duration to continuous timeline minutes", () => {
  const [item] = layoutCalendarDay([event("workout", "09:00", "11:00")]);
  assert.equal(item.topMinutes, 120);
  assert.equal(item.visibleMinutes, 120);
  assert.equal(item.durationMinutes, 120);
  assert.equal(item.columnCount, 1);
});

test("places overlapping events in stable side-by-side columns", () => {
  const layout = layoutCalendarDay([
    event("a", "09:00", "11:00"),
    event("b", "09:30", "10:30"),
    event("c", "10:30", "12:00"),
    event("d", "13:00", "14:00"),
  ]);
  const byId = Object.fromEntries(layout.map((item) => [item.item.id, item]));
  assert.equal(byId.a.columnCount, 2);
  assert.equal(byId.b.columnCount, 2);
  assert.equal(byId.c.columnCount, 2);
  assert.notEqual(byId.a.column, byId.b.column);
  assert.equal(byId.d.columnCount, 1);
});

test("clips blocks to the visible calendar range", () => {
  const [item] = layoutCalendarDay([event("early", "06:30", "07:30")]);
  assert.equal(item.topMinutes, 0);
  assert.equal(item.visibleMinutes, 30);
  assert.equal(item.durationMinutes, 60);
});
