export type CalendarLayoutInput = {
  id: string;
  startAt: string;
  endAt: string;
};

export type CalendarLayoutResult<T extends CalendarLayoutInput> = {
  item: T;
  startMinute: number;
  endMinute: number;
  topMinutes: number;
  visibleMinutes: number;
  durationMinutes: number;
  column: number;
  columnCount: number;
};

function minuteOfDay(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

export function layoutCalendarDay<T extends CalendarLayoutInput>(items: T[], startHour = 7, endHour = 23): CalendarLayoutResult<T>[] {
  const rangeStart = startHour * 60;
  const rangeEnd = endHour * 60;
  const normalized = items.flatMap((item) => {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const startMinute = minuteOfDay(start);
    const endMinute = startMinute + durationMinutes;
    const visibleStart = Math.max(rangeStart, startMinute);
    const visibleEnd = Math.min(rangeEnd, endMinute);
    if (visibleEnd <= visibleStart) return [];
    return [{
      item,
      startMinute,
      endMinute,
      topMinutes: visibleStart - rangeStart,
      visibleMinutes: visibleEnd - visibleStart,
      durationMinutes,
      column: 0,
      columnCount: 1,
    }];
  }).sort((left, right) => left.startMinute - right.startMinute || right.endMinute - left.endMinute || left.item.id.localeCompare(right.item.id));

  const output: CalendarLayoutResult<T>[] = [];
  let group: CalendarLayoutResult<T>[] = [];
  let groupEnd = -Infinity;

  const flushGroup = () => {
    if (!group.length) return;
    const columnEnds: number[] = [];
    for (const entry of group) {
      let column = columnEnds.findIndex((endMinute) => endMinute <= entry.startMinute);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = entry.endMinute;
      entry.column = column;
    }
    const columnCount = Math.max(1, columnEnds.length);
    for (const entry of group) {
      entry.columnCount = columnCount;
      output.push(entry);
    }
    group = [];
    groupEnd = -Infinity;
  };

  for (const entry of normalized) {
    if (group.length && entry.startMinute >= groupEnd) flushGroup();
    group.push(entry);
    groupEnd = Math.max(groupEnd, entry.endMinute);
  }
  flushGroup();
  return output;
}
