export type BusyInterval = {
  startAt: string;
  endAt: string;
};

export type SchedulableTask = {
  dueDate: string | null;
  scheduledStart: string | null;
};

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function shanghaiParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export function taskDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = shanghaiParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function dueDateForDay(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  return `${dateKey}T18:00:00+08:00`;
}

export function isDateOnlyDue(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const parts = shanghaiParts(date);
  return parts.hour === 18 && parts.minute === 0;
}

export function calendarStartForTask(task: SchedulableTask) {
  if (task.scheduledStart && !Number.isNaN(new Date(task.scheduledStart).getTime())) return task.scheduledStart;
  if (task.dueDate && !isDateOnlyDue(task.dueDate) && !Number.isNaN(new Date(task.dueDate).getTime())) return task.dueDate;
  return null;
}

function localIso(dateKey: string, minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${dateKey}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

function preferredMinute(title: string, priority: string) {
  if (/凌晨|深夜/.test(title)) return 21 * 60;
  if (/晚上|晚间/.test(title)) return 19 * 60;
  if (/傍晚/.test(title)) return 17 * 60 + 30;
  if (/下午/.test(title)) return 14 * 60 + 30;
  if (/中午/.test(title)) return 12 * 60;
  if (/上午|早上|晨间/.test(title)) return 9 * 60 + 30;
  if (/直播|比赛|赛事|发布|上线|发稿|推送|开播/.test(title)) return 18 * 60;
  if (/拍摄|录制|剪辑|配音|口播|素材/.test(title)) return 15 * 60;
  if (/会议|沟通|对齐|回复|电话|联系|确认|结算|报销|合同/.test(title)) return 14 * 60;
  if (/写|脚本|方案|文章|设计|开发|研究|分析|整理|复盘|规划|备课/.test(title)) return 10 * 60;
  if (/采购|取件|寄件|预约|看诊|办事/.test(title)) return 16 * 60;
  return priority === "high" ? 10 * 60 : priority === "low" ? 16 * 60 : 14 * 60;
}

function overlapCount(startMs: number, endMs: number, busy: BusyInterval[]) {
  return busy.reduce((count, interval) => {
    const busyStart = new Date(interval.startAt).getTime();
    const busyEnd = new Date(interval.endAt).getTime();
    if (!Number.isFinite(busyStart) || !Number.isFinite(busyEnd) || busyEnd <= busyStart) return count;
    return startMs < busyEnd && endMs > busyStart ? count + 1 : count;
  }, 0);
}

export function fixedBusyIntervals(dateKey: string) {
  const noon = new Date(`${dateKey}T12:00:00+08:00`);
  if (Number.isNaN(noon.getTime())) return [];
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TIME_ZONE, weekday: "short" }).format(noon);
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";
  return isWeekday ? [{ startAt: `${dateKey}T10:00:00+08:00`, endAt: `${dateKey}T12:00:00+08:00` }] : [];
}

export function suggestTaskStart({
  title,
  dateKey,
  estimatedMinutes,
  priority = "medium",
  busy = [],
  now = new Date(),
}: {
  title: string;
  dateKey: string;
  estimatedMinutes: number;
  priority?: string;
  busy?: BusyInterval[];
  now?: Date;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const minutes = Math.min(720, Math.max(5, Math.round(estimatedMinutes || 30)));
  const preferred = preferredMinute(title, priority);
  const todayKey = taskDateKey(now);
  const nowParts = shanghaiParts(now);
  const earliestToday = Math.ceil((nowParts.hour * 60 + nowParts.minute + 15) / 30) * 30;
  const candidates: number[] = [];
  for (let start = 8 * 60; start + minutes <= 23 * 60; start += 30) {
    if (dateKey === todayKey && start < earliestToday) continue;
    const overlapsLunch = start < 13 * 60 + 30 && start + minutes > 12 * 60;
    if (!overlapsLunch) candidates.push(start);
  }
  if (!candidates.length) return null;
  const allBusy = [...busy, ...fixedBusyIntervals(dateKey)];
  const ranked = candidates.map((start) => {
    const startAt = localIso(dateKey, start);
    const startMs = new Date(startAt).getTime();
    const conflicts = overlapCount(startMs, startMs + minutes * 60000, allBusy);
    return { start, startAt, conflicts, distance: Math.abs(start - preferred) };
  }).sort((a, b) => a.conflicts - b.conflicts || a.distance - b.distance || a.start - b.start);
  return ranked[0]?.startAt ?? null;
}
