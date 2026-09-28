import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureDatabase } from "../../../db/runtime";
import { assistantMemories, assistantMessages, assistantOperations, assistantSettings, cleaningMarks, contentItems, dailyReviews, deals, events, expenseEntries, focusSessions, ingredients, personalProducts, platformPromotions, tasks, workouts, workspaceSettings } from "../../../db/schema";
import { buildDemoRows } from "../../../lib/demo-data";
import { normalizeModules, type ModuleId } from "../../../lib/modules";
import { DEAL_CATEGORY_OPTIONS, DEAL_STAGES, normalizeDealCategories, normalizeDealStage, toDealView, type DealStage } from "../../../lib/deals";
import { findRetryableExpenseRequest, generateReview, hasExplicitMutationIntent, inferEventDeletionAction, inferPersonalProductAction, isAssistantRetryRequest, isExpenseCaptureRequest, runAssistantConversation, runExpenseCapture, type AssistantAction, type AssistantMemoryWrite, type ConversationContext, type ReviewContext } from "../../../lib/personal-assistant";
import { expenseAmountToCents, expenseDateTime, normalizeExpenseCategory } from "../../../lib/expenses";
import { calendarStartForTask, dueDateForDay, isDateOnlyDue, suggestTaskStart, taskDateKey, type BusyInterval } from "../../../lib/task-scheduler";

const DEFAULT_AI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_AI_MODEL = "glm-5.3-flash";
const PERSONAL_PRODUCT_STAGES = new Set(["计划中", "开发中", "待宣发", "已发布"]);
const CONTENT_STATUSES = new Set(["构思中", "写作中", "初稿完成", "待审核", "待发布", "已发布", "已归档"]);

function shanghaiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type ReviewPeriod = "daily" | "weekly" | "monthly";

function shiftDateKey(dateKey: string, days: number) {
  return shanghaiDate(new Date(new Date(`${dateKey}T12:00:00+08:00`).getTime() + days * 86400000));
}

function reviewPeriod(periodType: ReviewPeriod, value = new Date()) {
  const today = shanghaiDate(value);
  if (periodType === "daily") return { periodType, periodKey: today, reviewDate: today, rangeStart: today, rangeEnd: today };
  if (periodType === "monthly") {
    const [year, month] = today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const rangeStart = `${today.slice(0, 7)}-01`;
    const rangeEnd = `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
    return { periodType, periodKey: today.slice(0, 7), reviewDate: rangeEnd, rangeStart, rangeEnd };
  }
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(value);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const rangeStart = shiftDateKey(today, -((weekdayIndex + 6) % 7));
  const rangeEnd = shiftDateKey(rangeStart, 6);
  return { periodType, periodKey: rangeStart, reviewDate: rangeEnd, rangeStart, rangeEnd };
}

function inShanghaiRange(value: string | null, rangeStart: string, rangeEnd: string) {
  if (!value) return false;
  const key = shanghaiDate(new Date(value));
  return key >= rangeStart && key <= rangeEnd;
}

function normalizedTitle(value: string) {
  return value.toLowerCase().replace(/[\s，。、“”‘’·:：!！?？]/g, "");
}

function stableKeyHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_(?:BUSY|LOCKED)|database is locked|internal error|temporar|network/i.test(message);
}

async function retryDatabaseWrite<T>(label: string, operation: () => Promise<T>) {
  const delays = [0, 80, 220];
  let lastError: unknown;
  for (const [attempt, delay] of delays.entries()) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === delays.length - 1) throw error;
      console.warn("[workspace-db-retry]", JSON.stringify({ label, attempt: attempt + 1 }));
    }
  }
  throw lastError;
}

function validDate(value: string | undefined | null) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T18:00:00+08:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduledTaskEnd(startAt: string, estimatedMinutes: number) {
  return new Date(new Date(startAt).getTime() + Math.min(720, Math.max(5, estimatedMinutes || 30)) * 60000).toISOString();
}

function schedulingBusyIntervals(
  eventRows: Array<{ startAt: string; endAt: string }>,
  taskRows: Array<{ id: string; dueDate: string | null; scheduledStart: string | null; estimatedMinutes: number }>,
  workoutRows: Array<{ startedAt: string; durationMinutes: number }>,
  excludeTaskId = "",
) {
  const busy: BusyInterval[] = eventRows.map((event) => ({ startAt: event.startAt, endAt: event.endAt }));
  for (const task of taskRows) {
    if (task.id === excludeTaskId) continue;
    const startAt = calendarStartForTask(task);
    if (startAt) busy.push({ startAt, endAt: scheduledTaskEnd(startAt, task.estimatedMinutes) });
  }
  for (const workout of workoutRows) {
    busy.push({ startAt: workout.startedAt, endAt: scheduledTaskEnd(workout.startedAt, workout.durationMinutes) });
  }
  return busy;
}

async function autoScheduleTask({
  title,
  dateKey,
  estimatedMinutes,
  priority,
  excludeTaskId = "",
}: {
  title: string;
  dateKey: string;
  estimatedMinutes: number;
  priority: string;
  excludeTaskId?: string;
}) {
  const db = getDb();
  const [eventRows, taskRows, workoutRows] = await Promise.all([
    db.select({ startAt: events.startAt, endAt: events.endAt }).from(events),
    db.select({ id: tasks.id, dueDate: tasks.dueDate, scheduledStart: tasks.scheduledStart, estimatedMinutes: tasks.estimatedMinutes }).from(tasks),
    db.select({ startedAt: workouts.startedAt, durationMinutes: workouts.durationMinutes }).from(workouts),
  ]);
  return suggestTaskStart({
    title,
    dateKey,
    estimatedMinutes,
    priority,
    busy: schedulingBusyIntervals(eventRows, taskRows, workoutRows, excludeTaskId),
  });
}

async function backfillTaskSchedules() {
  const db = getDb();
  const [eventRows, taskRows, workoutRows] = await Promise.all([
    db.select({ startAt: events.startAt, endAt: events.endAt }).from(events),
    db.select().from(tasks).orderBy(asc(tasks.dueDate), asc(tasks.createdAt)),
    db.select({ startedAt: workouts.startedAt, durationMinutes: workouts.durationMinutes }).from(workouts),
  ]);
  const busy = schedulingBusyIntervals(eventRows, taskRows.filter((task) => Boolean(task.scheduledStart)), workoutRows);
  for (const task of taskRows) {
    if (!task.dueDate || task.scheduledStart) continue;
    const legacyStart = calendarStartForTask(task);
    const scheduledStart = legacyStart ?? (isDateOnlyDue(task.dueDate) ? suggestTaskStart({
      title: task.title,
      dateKey: taskDateKey(task.dueDate),
      estimatedMinutes: task.estimatedMinutes,
      priority: task.priority,
      busy,
      now: task.status === "done" ? new Date(0) : new Date(),
    }) : null);
    if (!scheduledStart) continue;
    await db.update(tasks).set({ scheduledStart }).where(eq(tasks.id, task.id));
    busy.push({ startAt: scheduledStart, endAt: scheduledTaskEnd(scheduledStart, task.estimatedMinutes) });
  }
}

type AssistantActionReceipt = {
  ok: boolean;
  kind: AssistantAction["type"] | "memory";
  label: string;
  state: "done" | "failed" | "pending" | "cancelled" | "undone";
  action?: AssistantAction;
  undoId?: string;
};

function actionPreview(action: AssistantAction) {
  if (action.type === "create_event") return `创建日程：${action.title}`;
  if (action.type === "reschedule_event") return `调整日程：${action.targetTitle}`;
  if (action.type === "update_event") return `修改日程：${action.targetTitle || action.eventId}`;
  if (action.type === "delete_event") return `删除日程：${action.targetTitle || action.eventId}`;
  if (action.type === "create_task") return `新建任务：${action.title}`;
  if (action.type === "complete_task") return `完成任务：${action.targetTitle}`;
  if (action.type === "reopen_task") return `恢复任务：${action.targetTitle || action.taskId}`;
  if (action.type === "update_task") return `修改任务：${action.targetTitle || action.taskId}`;
  if (action.type === "delete_tasks") return `删除 ${action.taskIds.length + (action.targetTitles?.length || 0)} 条任务`;
  if (action.type === "log_workout") return `记录训练：${action.workoutType}`;
  if (action.type === "update_workout") return `修改训练：${action.targetTitle || action.workoutId}`;
  if (action.type === "delete_workout") return `删除训练：${action.targetTitle || action.workoutId}`;
  if (action.type === "add_ingredient") return `加入冰箱：${action.name}`;
  if (action.type === "update_ingredient") return `修改食材：${action.targetTitle || action.ingredientId}`;
  if (action.type === "consume_ingredient") return `吃完：${action.targetTitle || action.ingredientId}`;
  if (action.type === "delete_ingredient") return `删除食材：${action.targetTitle || action.ingredientId}`;
  if (action.type === "add_expense") return `记账：${action.title} ¥${action.amount.toFixed(2)}`;
  if (action.type === "update_expense") return `修改账目：${action.targetTitle || action.expenseId}`;
  if (action.type === "delete_expense") return `删除账目：${action.targetTitle || action.expenseId}`;
  if (action.type === "create_personal_product") return `新增个人产品：${action.name}`;
  if (action.type === "update_personal_product") return `修改个人产品：${action.targetTitle || action.productId}`;
  if (action.type === "delete_personal_product") return `删除个人产品：${action.targetTitle || action.productId}`;
  if (action.type === "focus_start") return `开始 ${action.plannedMinutes || 30} 分钟专注`;
  if (action.type === "focus_stop") return "结束当前专注";
  if (action.type === "create_deal") return `新增商单：${action.title}`;
  if (action.type === "update_deal") return `修改商单：${action.targetTitle || action.dealId}`;
  if (action.type === "update_content") return `修改稿件：${action.targetTitle || action.contentId}`;
  if (action.type === "forget_memory") return `忘记：${action.targetContent || action.memoryId}`;
  return `调整 ${action.items.length} 项任务的优先级`;
}

function memoryId(category: string, content: string) {
  const normalized = `${category}:${content}`.toLowerCase().replace(/\s+/g, "").slice(0, 500);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) hash = Math.imul(hash ^ normalized.charCodeAt(index), 16777619);
  return `memory:${(hash >>> 0).toString(16)}`;
}

async function saveAssistantMemories(sourceMessageId: string, writes: AssistantMemoryWrite[]) {
  if (!writes.length) return [];
  const db = getDb();
  const now = new Date().toISOString();
  for (const memory of writes) {
    await db.insert(assistantMemories).values({
      id: memoryId(memory.category, memory.content), category: memory.category, content: memory.content,
      sourceMessageId, status: "active", createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: assistantMemories.id,
      set: { category: memory.category, content: memory.content, sourceMessageId, status: "active", updatedAt: now },
    });
  }
  return writes;
}

function resolveActionTarget<T extends { id: string }>(
  rows: T[],
  id: string | undefined,
  targetTitle: string | undefined,
  getTitle: (row: T) => string,
) {
  if (id) {
    const row = rows.find((item) => item.id === id);
    return row ? { row } : { error: "没有找到指定记录" };
  }
  const target = normalizedTitle(targetTitle || "");
  if (!target) return { error: "缺少要操作的对象" };
  const exact = rows.filter((item) => normalizedTitle(getTitle(item)) === target);
  const matches = exact.length ? exact : rows.filter((item) => {
    const title = normalizedTitle(getTitle(item));
    return title.includes(target) || target.includes(title);
  });
  if (matches.length > 1) return { error: `找到多条「${targetTitle}」，请说得更具体` };
  return matches.length === 1 ? { row: matches[0] } : { error: `没有找到「${targetTitle}」` };
}

async function trashAssistantRows<T extends { id: string }>(
  actionType: string,
  entityType: string,
  rows: T[],
  deleteRows: () => Promise<unknown>,
) {
  const db = getDb();
  const operationId = `assistant-operation:${crypto.randomUUID()}`;
  await db.insert(assistantOperations).values({
    id: operationId,
    actionType,
    entityType,
    entityIds: JSON.stringify(rows.map((row) => row.id)),
    beforeState: JSON.stringify(rows),
    afterState: "[]",
    status: "prepared",
  });
  try {
    await deleteRows();
    await db.update(assistantOperations).set({ status: "applied" }).where(eq(assistantOperations.id, operationId));
    return operationId;
  } catch (error) {
    await db.update(assistantOperations).set({ status: "failed" }).where(eq(assistantOperations.id, operationId));
    throw error;
  }
}

async function undoAssistantOperation(operationId: string) {
  const db = getDb();
  const [operation] = await db.select().from(assistantOperations).where(eq(assistantOperations.id, operationId)).limit(1);
  if (!operation || operation.status !== "applied") throw new Error("这项操作已经撤销或不能再撤销");
  const rows = JSON.parse(operation.beforeState) as Array<Record<string, unknown>>;
  if (!rows.length) throw new Error("没有可恢复的数据");
  if (operation.entityType === "task") {
    await retryDatabaseWrite("undo-task", () => db.insert(tasks).values(rows as Array<typeof tasks.$inferInsert>).onConflictDoNothing());
  } else if (operation.entityType === "event") {
    await retryDatabaseWrite("undo-event", () => db.insert(events).values(rows as Array<typeof events.$inferInsert>).onConflictDoNothing());
  } else if (operation.entityType === "expense") {
    await retryDatabaseWrite("undo-expense", () => db.insert(expenseEntries).values(rows as Array<typeof expenseEntries.$inferInsert>).onConflictDoNothing());
  } else if (operation.entityType === "ingredient") {
    await retryDatabaseWrite("undo-ingredient", () => db.insert(ingredients).values(rows as Array<typeof ingredients.$inferInsert>).onConflictDoNothing());
  } else if (operation.entityType === "workout") {
    await retryDatabaseWrite("undo-workout", () => db.insert(workouts).values(rows as Array<typeof workouts.$inferInsert>).onConflictDoNothing());
  } else if (operation.entityType === "personal_product") {
    await retryDatabaseWrite("undo-personal-product", () => db.insert(personalProducts).values(rows as Array<typeof personalProducts.$inferInsert>).onConflictDoNothing());
  } else {
    throw new Error("这类操作暂不支持撤销");
  }
  await db.update(assistantOperations).set({ status: "undone", undoneAt: new Date().toISOString() }).where(eq(assistantOperations.id, operationId));
  return operation;
}

async function executeAssistantActions(
  actions: AssistantAction[],
  namespace: string,
  options: { dedupeRecentExpenses?: boolean; expenseFallbackDate?: Date } = {},
): Promise<AssistantActionReceipt[]> {
  const db = getDb();
  const [eventRows, taskRows, workoutRows, ingredientRows, productRows, expenseRows, dealRows, contentRows, memoryRows, activeFocusRows, recentExpenseRows] = await Promise.all([
    db.select().from(events).orderBy(asc(events.startAt)),
    db.select().from(tasks).orderBy(desc(tasks.updatedAt)),
    db.select().from(workouts).orderBy(desc(workouts.startedAt)),
    db.select().from(ingredients).orderBy(desc(ingredients.updatedAt)),
    db.select().from(personalProducts).orderBy(desc(personalProducts.updatedAt)),
    db.select().from(expenseEntries).orderBy(desc(expenseEntries.spentAt)),
    db.select().from(deals).orderBy(desc(deals.updatedAt)),
    db.select().from(contentItems).orderBy(desc(contentItems.modifiedAt)),
    db.select().from(assistantMemories).where(eq(assistantMemories.status, "active")).orderBy(desc(assistantMemories.updatedAt)),
    db.select().from(focusSessions).where(eq(focusSessions.status, "active")).orderBy(desc(focusSessions.startedAt)),
    options.dedupeRecentExpenses
      ? db.select().from(expenseEntries).orderBy(desc(expenseEntries.createdAt)).limit(500)
      : Promise.resolve([] as Array<typeof expenseEntries.$inferSelect>),
  ]);
  const schedulingBusy = schedulingBusyIntervals(eventRows, taskRows, workoutRows);
  const knownProductNames = new Set(productRows.map((product) => normalizedTitle(product.name)));
  const usedDuplicateExpenseIds = new Set<string>();
  const expenseOccurrences = new Map<string, number>();
  const ingredientOccurrences = new Map<string, number>();
  const results: AssistantActionReceipt[] = [];
  for (const [index, action] of actions.entries()) {
    const actionId = `${namespace}:${index}`;
    if (action.type === "create_event") {
      const start = validDate(action.startAt);
      if (!start) { results.push({ ok: false, kind: action.type, state: "failed", label: `无法识别「${action.title}」的开始时间` }); continue; }
      const explicitEnd = validDate(action.endAt);
      const defaultMinutes = /比赛|球赛|赛事/.test(action.title) ? 120 : 60;
      const end = explicitEnd && explicitEnd > start ? explicitEnd : new Date(start.getTime() + defaultMinutes * 60000);
      await db.insert(events).values({
        id: `assistant-event:${actionId}`, title: action.title, startAt: start.toISOString(), endAt: end.toISOString(),
        category: action.category || (/比赛|球赛|赛事/.test(action.title) ? "personal" : "meeting"),
        location: action.location || "", source: "personal-assistant", externalId: actionId,
      }).onConflictDoNothing();
      results.push({ ok: true, kind: action.type, state: "done", label: `已加入日程：${action.title}（${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(start)}）` });
      continue;
    }
    if (action.type === "reschedule_event") {
      const target = normalizedTitle(action.targetTitle);
      const matches = eventRows.filter((event) => {
        const title = normalizedTitle(event.title);
        return title === target || title.includes(target) || target.includes(title);
      });
      const start = validDate(action.startAt);
      if (matches.length !== 1 || !start) {
        results.push({ ok: false, kind: action.type, state: "failed", label: matches.length > 1 ? `找到多条「${action.targetTitle}」，请说得更具体` : `没有找到唯一的「${action.targetTitle}」日程` });
        continue;
      }
      const originalMinutes = Math.max(30, Math.round((new Date(matches[0].endAt).getTime() - new Date(matches[0].startAt).getTime()) / 60000));
      const explicitEnd = validDate(action.endAt);
      const end = explicitEnd && explicitEnd > start ? explicitEnd : new Date(start.getTime() + originalMinutes * 60000);
      await db.update(events).set({ startAt: start.toISOString(), endAt: end.toISOString(), updatedAt: new Date().toISOString() }).where(eq(events.id, matches[0].id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已调整日程：${matches[0].title}` });
      continue;
    }
    if (action.type === "update_event") {
      const target = resolveActionTarget(eventRows, action.eventId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { title?: string; startAt?: string; endAt?: string; location?: string; category?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (action.title !== undefined) set.title = action.title.trim();
      if (action.location !== undefined) set.location = action.location;
      if (action.category !== undefined) set.category = action.category;
      const start = action.startAt ? validDate(action.startAt) : new Date(target.row.startAt);
      const end = action.endAt ? validDate(action.endAt) : new Date(target.row.endAt);
      if (!start || !end || end <= start || (action.title !== undefined && !set.title)) {
        results.push({ ok: false, kind: action.type, state: "failed", label: `「${target.row.title}」的标题或起止时间不正确` });
        continue;
      }
      if (action.startAt !== undefined) set.startAt = start.toISOString();
      if (action.endAt !== undefined) set.endAt = end.toISOString();
      await db.update(events).set(set).where(eq(events.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改日程：${set.title || target.row.title}` });
      continue;
    }
    if (action.type === "delete_event") {
      let matchedRows: typeof eventRows = [];
      if (action.eventId) {
        const row = eventRows.find((event) => event.id === action.eventId);
        if (row) matchedRows = [row];
      } else {
        const requestedTitle = normalizedTitle(action.targetTitle || "");
        const exactMatches = eventRows.filter((event) => normalizedTitle(event.title) === requestedTitle);
        if (exactMatches.length) {
          matchedRows = exactMatches;
        } else {
          const target = resolveActionTarget(eventRows, undefined, action.targetTitle, (row) => row.title);
          if (target.row) matchedRows = [target.row];
        }
      }
      if (!matchedRows.length) { results.push({ ok: false, kind: action.type, state: "failed", label: `没有找到日程「${action.targetTitle || action.eventId}」` }); continue; }
      const ids = matchedRows.map((row) => row.id);
      const undoId = await trashAssistantRows(action.type, "event", matchedRows, () => retryDatabaseWrite("assistant-delete-event", () => db.delete(events).where(inArray(events.id, ids))));
      const duplicateLabel = matchedRows.length > 1 ? `${matchedRows.length} 条同名` : "";
      results.push({ ok: true, kind: action.type, state: "done", label: `已删除${duplicateLabel}日程：${matchedRows[0].title}`, undoId });
      continue;
    }
    if (action.type === "create_task") {
      const due = validDate(action.dueDate);
      const explicitStart = validDate(action.scheduledStart);
      const priority = ["high", "medium", "low"].includes(action.priority || "") ? action.priority as "high" | "medium" | "low" : "medium";
      const estimatedMinutes = Math.min(720, Math.max(5, action.estimatedMinutes || 30));
      const dateKey = explicitStart ? taskDateKey(explicitStart) : due ? taskDateKey(due) : "";
      const scheduledStart = explicitStart?.toISOString() ?? (dateKey ? suggestTaskStart({
        title: action.title,
        dateKey,
        estimatedMinutes,
        priority,
        busy: schedulingBusy,
      }) : null);
      await db.insert(tasks).values({
        id: `assistant-task:${actionId}`, title: action.title, project: action.project || "助理收件箱",
        priority, estimatedMinutes,
        dueDate: dateKey ? dueDateForDay(dateKey) : null, scheduledStart,
        source: "personal-assistant", externalId: actionId,
      }).onConflictDoNothing();
      if (scheduledStart) schedulingBusy.push({ startAt: scheduledStart, endAt: scheduledTaskEnd(scheduledStart, estimatedMinutes) });
      const scheduledLabel = scheduledStart ? `（${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(scheduledStart))}）` : "";
      results.push({ ok: true, kind: action.type, state: "done", label: `已新建任务：${action.title}${scheduledLabel}` });
      continue;
    }
    if (action.type === "complete_task") {
      const target = normalizedTitle(action.targetTitle);
      const matches = taskRows.filter((task) => task.status !== "done").filter((task) => {
        const title = normalizedTitle(task.title);
        return title === target || title.includes(target) || target.includes(title);
      });
      if (matches.length !== 1) {
        results.push({ ok: false, kind: action.type, state: "failed", label: matches.length > 1 ? `找到多条「${action.targetTitle}」任务，请说得更具体` : `没有找到唯一的「${action.targetTitle}」任务` });
        continue;
      }
      const completedAt = new Date().toISOString();
      await db.update(tasks).set({ status: "done", completedAt, updatedAt: completedAt }).where(eq(tasks.id, matches[0].id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已完成任务：${matches[0].title}` });
      continue;
    }
    if (action.type === "reopen_task") {
      const target = resolveActionTarget(taskRows, action.taskId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      await db.update(tasks).set({ status: "todo", completedAt: null, updatedAt: new Date().toISOString() }).where(eq(tasks.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已恢复任务：${target.row.title}` });
      continue;
    }
    if (action.type === "update_task") {
      const target = resolveActionTarget(taskRows, action.taskId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { title?: string; project?: string; priority?: string; estimatedMinutes?: number; dueDate?: string | null; scheduledStart?: string | null; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (action.title !== undefined) {
        if (!action.title.trim()) { results.push({ ok: false, kind: action.type, state: "failed", label: "任务名称不能为空" }); continue; }
        set.title = action.title.trim();
      }
      if (action.project !== undefined) set.project = action.project.trim() || target.row.project;
      if (action.priority !== undefined) {
        if (!["high", "medium", "low"].includes(action.priority)) { results.push({ ok: false, kind: action.type, state: "failed", label: "任务优先级不正确" }); continue; }
        set.priority = action.priority;
      }
      if (action.estimatedMinutes !== undefined) {
        if (action.estimatedMinutes < 5 || action.estimatedMinutes > 720) { results.push({ ok: false, kind: action.type, state: "failed", label: "任务时长需要在 5 到 720 分钟之间" }); continue; }
        set.estimatedMinutes = Math.round(action.estimatedMinutes);
      }
      let dateKey = target.row.dueDate ? taskDateKey(target.row.dueDate) : "";
      if (action.dueDate !== undefined) {
        if (action.dueDate === null) {
          dateKey = "";
          set.dueDate = null;
          if (action.scheduledStart === undefined) set.scheduledStart = null;
        } else {
          const due = validDate(action.dueDate);
          if (!due) { results.push({ ok: false, kind: action.type, state: "failed", label: "任务日期格式不正确" }); continue; }
          dateKey = taskDateKey(due);
          set.dueDate = dueDateForDay(dateKey);
        }
      }
      if (action.scheduledStart !== undefined) {
        if (action.scheduledStart === null) {
          set.scheduledStart = null;
        } else {
          const start = validDate(action.scheduledStart);
          if (!start) { results.push({ ok: false, kind: action.type, state: "failed", label: "任务开始时间格式不正确" }); continue; }
          dateKey = taskDateKey(start);
          set.scheduledStart = start.toISOString();
          set.dueDate = dueDateForDay(dateKey);
        }
      } else if (action.dueDate !== undefined && dateKey) {
        set.scheduledStart = await autoScheduleTask({
          title: set.title || target.row.title,
          dateKey,
          estimatedMinutes: set.estimatedMinutes ?? target.row.estimatedMinutes,
          priority: set.priority ?? target.row.priority,
          excludeTaskId: target.row.id,
        });
      }
      await db.update(tasks).set(set).where(eq(tasks.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改任务：${set.title || target.row.title}` });
      continue;
    }
    if (action.type === "delete_tasks") {
      const selected = new Map<string, typeof taskRows[number]>();
      const missing: string[] = [];
      for (const taskId of action.taskIds) {
        const row = taskRows.find((task) => task.id === taskId);
        if (row) selected.set(row.id, row); else missing.push(taskId);
      }
      for (const title of action.targetTitles || []) {
        const target = resolveActionTarget(taskRows, undefined, title, (row) => row.title);
        if (target.row) selected.set(target.row.id, target.row); else missing.push(title);
      }
      if (missing.length || !selected.size) {
        results.push({ ok: false, kind: action.type, state: "failed", label: missing.length ? `没有唯一找到：${missing.slice(0, 3).join("、")}` : "没有找到要删除的任务" });
        continue;
      }
      const rows = [...selected.values()].slice(0, 40);
      const ids = rows.map((row) => row.id);
      const undoId = await trashAssistantRows(action.type, "task", rows, () => retryDatabaseWrite("assistant-delete-tasks", () => db.delete(tasks).where(inArray(tasks.id, ids))));
      results.push({ ok: true, kind: action.type, state: "done", label: `已删除 ${rows.length} 条任务`, undoId });
      continue;
    }
    if (action.type === "log_workout") {
      const startedAt = validDate(action.startedAt);
      if (!startedAt) { results.push({ ok: false, kind: action.type, state: "failed", label: "训练时间不清楚，请补充日期或时间" }); continue; }
      await db.insert(workouts).values({
        id: `assistant-workout:${actionId}`, type: action.workoutType, startedAt: startedAt.toISOString(),
        durationMinutes: Math.min(720, Math.max(5, action.durationMinutes || 30)), intensity: action.intensity || "中等",
        notes: action.notes || "", source: "personal-assistant",
      }).onConflictDoNothing();
      results.push({ ok: true, kind: action.type, state: "done", label: `已记录训练：${action.workoutType}` });
      continue;
    }
    if (action.type === "update_workout") {
      const target = resolveActionTarget(workoutRows, action.workoutId, action.targetTitle, (row) => row.type);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { type?: string; startedAt?: string; durationMinutes?: number; intensity?: string; notes?: string } = {};
      if (action.workoutType !== undefined) set.type = action.workoutType.trim();
      if (action.startedAt !== undefined) {
        const startedAt = validDate(action.startedAt);
        if (!startedAt) { results.push({ ok: false, kind: action.type, state: "failed", label: "训练时间格式不正确" }); continue; }
        set.startedAt = startedAt.toISOString();
      }
      if (action.durationMinutes !== undefined) {
        if (action.durationMinutes < 5 || action.durationMinutes > 720) { results.push({ ok: false, kind: action.type, state: "failed", label: "训练时长需要在 5 到 720 分钟之间" }); continue; }
        set.durationMinutes = Math.round(action.durationMinutes);
      }
      if (action.intensity !== undefined) set.intensity = action.intensity;
      if (action.notes !== undefined) set.notes = action.notes;
      if (set.type === "") { results.push({ ok: false, kind: action.type, state: "failed", label: "训练名称不能为空" }); continue; }
      await db.update(workouts).set(set).where(eq(workouts.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改训练：${set.type || target.row.type}` });
      continue;
    }
    if (action.type === "delete_workout") {
      const target = resolveActionTarget(workoutRows, action.workoutId, action.targetTitle, (row) => row.type);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const undoId = await trashAssistantRows(action.type, "workout", [target.row], () => retryDatabaseWrite("assistant-delete-workout", () => db.delete(workouts).where(eq(workouts.id, target.row!.id))));
      results.push({ ok: true, kind: action.type, state: "done", label: `已删除训练：${target.row.type}`, undoId });
      continue;
    }
    if (action.type === "add_ingredient") {
      const semanticKey = `${normalizedTitle(action.name)}:${action.amount || "适量"}:${action.category || "其他"}:${action.storage || "冷藏"}`;
      const occurrence = ingredientOccurrences.get(semanticKey) || 0;
      ingredientOccurrences.set(semanticKey, occurrence + 1);
      const ingredientActionId = `${namespace}:ingredient:${stableKeyHash(semanticKey)}:${occurrence}`;
      await retryDatabaseWrite("assistant-add-ingredient", () => db.insert(ingredients).values({
        id: `assistant-ingredient:${ingredientActionId}`, name: action.name, amount: action.amount || "适量",
        category: action.category || "其他", storage: action.storage || "冷藏",
        expiresAt: action.expiresAt || null, note: action.note || "",
      }).onConflictDoNothing());
      results.push({ ok: true, kind: action.type, state: "done", label: `已加入冰箱：${action.name}` });
      continue;
    }
    if (action.type === "update_ingredient") {
      const target = resolveActionTarget(ingredientRows, action.ingredientId, action.targetTitle, (row) => row.name);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { name?: string; amount?: string; category?: string; storage?: string; expiresAt?: string | null; note?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (action.name !== undefined) set.name = action.name.trim();
      if (action.amount !== undefined) set.amount = action.amount;
      if (action.category !== undefined) set.category = action.category;
      if (action.storage !== undefined) set.storage = action.storage;
      if (action.expiresAt !== undefined) {
        if (action.expiresAt && !validDate(action.expiresAt)) { results.push({ ok: false, kind: action.type, state: "failed", label: "食材日期格式不正确" }); continue; }
        set.expiresAt = action.expiresAt;
      }
      if (action.note !== undefined) set.note = action.note;
      if (set.name === "") { results.push({ ok: false, kind: action.type, state: "failed", label: "食材名称不能为空" }); continue; }
      await retryDatabaseWrite("assistant-update-ingredient", () => db.update(ingredients).set(set).where(eq(ingredients.id, target.row!.id)));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改食材：${set.name || target.row.name}` });
      continue;
    }
    if (action.type === "consume_ingredient" || action.type === "delete_ingredient") {
      const target = resolveActionTarget(ingredientRows, action.ingredientId, action.targetTitle, (row) => row.name);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const undoId = await trashAssistantRows(action.type, "ingredient", [target.row], () => retryDatabaseWrite("assistant-delete-ingredient", () => db.delete(ingredients).where(eq(ingredients.id, target.row!.id))));
      results.push({ ok: true, kind: action.type, state: "done", label: action.type === "consume_ingredient" ? `已吃完：${target.row.name}` : `已删除食材：${target.row.name}`, undoId });
      continue;
    }
    if (action.type === "add_expense") {
      const amountCents = expenseAmountToCents(action.amount);
      const spentAt = expenseDateTime(action.spentAt, options.expenseFallbackDate || new Date());
      if (!amountCents || !spentAt) {
        results.push({ ok: false, kind: action.type, state: "failed", label: `无法识别「${action.title}」的金额或日期` });
        continue;
      }
      const category = normalizeExpenseCategory(action.category);
      const semanticKey = `${normalizedTitle(action.title)}:${amountCents}:${shanghaiDate(new Date(spentAt))}`;
      const occurrence = expenseOccurrences.get(semanticKey) || 0;
      expenseOccurrences.set(semanticKey, occurrence + 1);
      const expenseActionId = `${namespace}:expense:${stableKeyHash(semanticKey)}:${occurrence}`;
      const duplicate = options.dedupeRecentExpenses && recentExpenseRows.find((expense) => (
        !usedDuplicateExpenseIds.has(expense.id)
        && expense.source === "personal-assistant"
        && normalizedTitle(expense.title) === normalizedTitle(action.title)
        && expense.amountCents === amountCents
        && shanghaiDate(new Date(expense.spentAt)) === shanghaiDate(new Date(spentAt))
        && Date.now() - new Date(expense.createdAt).getTime() < 24 * 60 * 60 * 1000
      ));
      if (duplicate) {
        usedDuplicateExpenseIds.add(duplicate.id);
        results.push({ ok: true, kind: action.type, state: "done", label: `账本中已有，未重复记录：${action.title} ¥${(amountCents / 100).toFixed(2)}` });
        continue;
      }
      await retryDatabaseWrite("assistant-add-expense", () => db.insert(expenseEntries).values({
        id: `assistant-expense:${expenseActionId}`, title: action.title, amountCents, category, spentAt,
        note: action.note || "", source: "personal-assistant", externalId: expenseActionId,
      }).onConflictDoNothing());
      usedDuplicateExpenseIds.add(`assistant-expense:${expenseActionId}`);
      recentExpenseRows.push({
        id: `assistant-expense:${expenseActionId}`, title: action.title, amountCents, category, spentAt,
        note: action.note || "", source: "personal-assistant", externalId: expenseActionId,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      results.push({ ok: true, kind: action.type, state: "done", label: `已记账：${action.title} ¥${(amountCents / 100).toFixed(2)} · ${category}` });
      continue;
    }
    if (action.type === "update_expense") {
      const target = resolveActionTarget(expenseRows, action.expenseId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { title?: string; amountCents?: number; category?: string; spentAt?: string; note?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (action.title !== undefined) set.title = action.title.trim();
      if (action.amount !== undefined) {
        const amountCents = expenseAmountToCents(action.amount);
        if (!amountCents) { results.push({ ok: false, kind: action.type, state: "failed", label: "支出金额不正确" }); continue; }
        set.amountCents = amountCents;
      }
      if (action.category !== undefined) set.category = normalizeExpenseCategory(action.category);
      if (action.spentAt !== undefined) {
        const spentAt = expenseDateTime(action.spentAt);
        if (!spentAt) { results.push({ ok: false, kind: action.type, state: "failed", label: "支出日期格式不正确" }); continue; }
        set.spentAt = spentAt;
      }
      if (action.note !== undefined) set.note = action.note;
      if (set.title === "") { results.push({ ok: false, kind: action.type, state: "failed", label: "支出名称不能为空" }); continue; }
      await retryDatabaseWrite("assistant-update-expense", () => db.update(expenseEntries).set(set).where(eq(expenseEntries.id, target.row!.id)));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改账目：${set.title || target.row.title}` });
      continue;
    }
    if (action.type === "delete_expense") {
      const target = resolveActionTarget(expenseRows, action.expenseId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const undoId = await trashAssistantRows(action.type, "expense", [target.row], () => retryDatabaseWrite("assistant-delete-expense", () => db.delete(expenseEntries).where(eq(expenseEntries.id, target.row!.id))));
      results.push({ ok: true, kind: action.type, state: "done", label: `已删除账目：${target.row.title}`, undoId });
      continue;
    }
    if (action.type === "create_personal_product") {
      const normalizedName = normalizedTitle(action.name);
      if (knownProductNames.has(normalizedName)) {
        results.push({ ok: true, kind: action.type, state: "done", label: `个人产品中已有：${action.name}` });
        continue;
      }
      const stage = PERSONAL_PRODUCT_STAGES.has(action.stage || "") ? action.stage! : "计划中";
      await db.insert(personalProducts).values({
        id: `assistant-product:${actionId}`, name: action.name, path: action.path || "", stage,
        note: action.note || "",
      }).onConflictDoNothing();
      knownProductNames.add(normalizedName);
      results.push({ ok: true, kind: action.type, state: "done", label: `已新增个人产品：${action.name}` });
      continue;
    }
    if (action.type === "update_personal_product") {
      const target = resolveActionTarget(productRows, action.productId, action.targetTitle, (row) => row.name);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { name?: string; path?: string; stage?: string; note?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (action.name !== undefined) set.name = action.name.trim();
      if (action.path !== undefined) set.path = action.path;
      if (action.stage !== undefined) {
        if (!PERSONAL_PRODUCT_STAGES.has(action.stage)) { results.push({ ok: false, kind: action.type, state: "failed", label: "个人产品阶段不正确" }); continue; }
        set.stage = action.stage;
      }
      if (action.note !== undefined) set.note = action.note;
      if (set.name === "") { results.push({ ok: false, kind: action.type, state: "failed", label: "个人产品名称不能为空" }); continue; }
      await db.update(personalProducts).set(set).where(eq(personalProducts.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改个人产品：${set.name || target.row.name}` });
      continue;
    }
    if (action.type === "delete_personal_product") {
      const target = resolveActionTarget(productRows, action.productId, action.targetTitle, (row) => row.name);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const undoId = await trashAssistantRows(action.type, "personal_product", [target.row], () => retryDatabaseWrite("assistant-delete-personal-product", () => db.delete(personalProducts).where(eq(personalProducts.id, target.row!.id))));
      results.push({ ok: true, kind: action.type, state: "done", label: `已删除个人产品：${target.row.name}`, undoId });
      continue;
    }
    if (action.type === "focus_start") {
      if (activeFocusRows.length) { results.push({ ok: false, kind: action.type, state: "failed", label: "已经有一轮专注正在进行" }); continue; }
      const plannedMinutes = Math.min(240, Math.max(5, Math.round(action.plannedMinutes || 30)));
      await db.insert(focusSessions).values({ id: `assistant-focus:${actionId}`, plannedMinutes, startedAt: new Date().toISOString(), status: "active" }).onConflictDoNothing();
      results.push({ ok: true, kind: action.type, state: "done", label: `已开始 ${plannedMinutes} 分钟专注` });
      continue;
    }
    if (action.type === "focus_stop") {
      const active = activeFocusRows[0];
      if (!active) { results.push({ ok: false, kind: action.type, state: "failed", label: "当前没有正在进行的专注" }); continue; }
      const startedAt = new Date(active.startedAt).getTime();
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      await db.update(focusSessions).set({ status: "completed", endedAt: new Date().toISOString(), durationSeconds }).where(eq(focusSessions.id, active.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已结束专注，记录 ${Math.round(durationSeconds / 60)} 分钟` });
      continue;
    }
    if (action.type === "create_deal") {
      const categories = normalizeDealCategories(action.categories);
      if (!categories.length) { results.push({ ok: false, kind: action.type, state: "failed", label: `商单类别不在选项中：${DEAL_CATEGORY_OPTIONS.join("、")}` }); continue; }
      const now = new Date().toISOString();
      await db.insert(deals).values({
        id: `assistant-deal:${actionId}`,
        title: action.title,
        stage: normalizeDealStage(action.stage),
        categories: JSON.stringify(categories),
        price: action.price === undefined ? null : Math.round(action.price),
        paidAmount: action.paidAmount === undefined ? null : Math.round(action.paidAmount),
        receivedAt: validDate(action.receivedAt)?.toISOString() ?? now,
        publishedAt: validDate(action.publishedAt)?.toISOString() ?? null,
        month: action.month || null,
        source: "personal-assistant",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
      results.push({ ok: true, kind: action.type, state: "done", label: `已新增商单：${action.title}` });
      continue;
    }
    if (action.type === "update_deal") {
      const target = resolveActionTarget(dealRows, action.dealId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const now = new Date().toISOString();
      const set: { title?: string; categories?: string; price?: number; paidAmount?: number; stage?: string; receivedAt?: string | null; publishedAt?: string | null; month?: string | null; updatedAt: string } = { updatedAt: now };
      if (action.title !== undefined) set.title = action.title.trim();
      if (action.categories !== undefined) {
        const categories = normalizeDealCategories(action.categories);
        if (!categories.length) { results.push({ ok: false, kind: action.type, state: "failed", label: `商单类别不在选项中：${DEAL_CATEGORY_OPTIONS.join("、")}` }); continue; }
        set.categories = JSON.stringify(categories);
      }
      if (action.price !== undefined) set.price = Math.round(action.price);
      if (action.paidAmount !== undefined) set.paidAmount = Math.round(action.paidAmount);
      if (action.stage !== undefined) {
        if (!DEAL_STAGES.includes(action.stage as DealStage)) { results.push({ ok: false, kind: action.type, state: "failed", label: "商单状态不正确" }); continue; }
        set.stage = action.stage;
      }
      if (action.receivedAt !== undefined) set.receivedAt = validDate(action.receivedAt)?.toISOString() ?? null;
      if (action.publishedAt !== undefined) set.publishedAt = validDate(action.publishedAt)?.toISOString() ?? null;
      if (action.month !== undefined) set.month = action.month;
      if (set.title === "") { results.push({ ok: false, kind: action.type, state: "failed", label: "商单名称不能为空" }); continue; }
      await db.update(deals).set(set).where(eq(deals.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改商单：${set.title || target.row.title}` });
      continue;
    }
    if (action.type === "update_content") {
      const target = resolveActionTarget(contentRows, action.contentId, action.targetTitle, (row) => row.title);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      const set: { status?: string; linkedDeal?: string | null } = {};
      if (action.status !== undefined) {
        const allowedStatuses = ["构思中", "写作中", "初稿完成", "待审核", "待发布", "已发布", "已归档"];
        if (!allowedStatuses.includes(action.status)) { results.push({ ok: false, kind: action.type, state: "failed", label: "稿件状态不正确" }); continue; }
        set.status = action.status;
      }
      if (action.linkedDeal !== undefined) set.linkedDeal = action.linkedDeal;
      await db.update(contentItems).set(set).where(eq(contentItems.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已修改稿件索引：${target.row.title}` });
      continue;
    }
    if (action.type === "forget_memory") {
      const target = resolveActionTarget(memoryRows, action.memoryId, action.targetContent, (row) => row.content);
      if (!target.row) { results.push({ ok: false, kind: action.type, state: "failed", label: target.error! }); continue; }
      await db.update(assistantMemories).set({ status: "forgotten", updatedAt: new Date().toISOString() }).where(eq(assistantMemories.id, target.row.id));
      results.push({ ok: true, kind: action.type, state: "done", label: `已忘记：${target.row.content}` });
      continue;
    }
    const ordered = [...action.items].sort((a, b) => a.rank - b.rank);
    const selected = ordered.map((item) => ({ item, task: taskRows.find((task) => task.id === item.taskId && task.status !== "done") }));
    const ids = new Set(ordered.map((item) => item.taskId));
    if (!ordered.length || selected.some((entry) => !entry.task) || ids.size !== ordered.length) {
      results.push({ ok: false, kind: action.type, state: "failed", label: "任务清单已经变化，请重新让我安排今天" });
      continue;
    }
    const rankDate = shanghaiDate();
    await db.update(tasks).set({ assistantRank: null, assistantRankDate: null, assistantReason: "" }).where(eq(tasks.assistantRankDate, rankDate));
    for (const [rankIndex, entry] of selected.entries()) {
      await db.update(tasks).set({
        assistantRank: rankIndex + 1, assistantRankDate: rankDate,
        assistantReason: entry.item.reason, updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, entry.task!.id));
    }
    results.push({ ok: true, kind: action.type, state: "done", label: `已排好今天 ${selected.length} 项任务的执行顺序` });
  }
  return results;
}

async function finalizeExpiredFocusSessions() {
  const db = getDb();
  const activeRows = await db.select().from(focusSessions).where(eq(focusSessions.status, "active"));
  const now = Date.now();
  for (const session of activeRows) {
    const startedAt = new Date(session.startedAt).getTime();
    const plannedSeconds = session.plannedMinutes * 60;
    if (!Number.isFinite(startedAt) || now < startedAt + plannedSeconds * 1000) continue;
    await db.update(focusSessions).set({
      status: "completed",
      endedAt: new Date(startedAt + plannedSeconds * 1000).toISOString(),
      durationSeconds: plannedSeconds,
    }).where(eq(focusSessions.id, session.id));
  }
}

async function readWorkspaceSettings() {
  const db = getDb();
  const [row] = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, "workspace")).limit(1);
  if (!row) {
    await db.insert(workspaceSettings).values({ id: "workspace", enabledModules: "[]" }).onConflictDoNothing();
    return { enabledModules: [] as ModuleId[], onboardedAt: null as string | null };
  }
  return { enabledModules: normalizeModules(JSON.parse(row.enabledModules) as unknown), onboardedAt: row.onboardedAt };
}

// Demo rows exist to show what a filled-in view looks like, so only the modules
// the user switched on get populated.
async function loadDemoData(enabled: readonly ModuleId[]) {
  const db = getDb();
  const rows = buildDemoRows();
  const now = new Date().toISOString();
  const on = (id: ModuleId) => enabled.length === 0 || enabled.includes(id);
  await db.insert(tasks).values(rows.tasks.map((row) => ({ ...row, updatedAt: now }))).onConflictDoNothing();
  await db.insert(events).values(rows.events).onConflictDoNothing();
  if (on("deals")) await db.insert(deals).values(rows.deals.map((row) => ({ ...row, updatedAt: now }))).onConflictDoNothing();
  if (on("expenses")) await db.insert(expenseEntries).values(rows.expenses).onConflictDoNothing();
  if (on("contents")) await db.insert(contentItems).values(rows.contents).onConflictDoNothing();
  if (on("health")) {
    await db.insert(ingredients).values(rows.ingredients).onConflictDoNothing();
    await db.insert(workouts).values(rows.workouts).onConflictDoNothing();
    await db.insert(cleaningMarks).values(rows.cleanings).onConflictDoNothing();
  }
  if (on("platforms")) await db.insert(platformPromotions).values(rows.promotions).onConflictDoNothing();
  if (on("products")) await db.insert(personalProducts).values(rows.products).onConflictDoNothing();
  if (on("review")) await db.insert(dailyReviews).values(rows.reviews).onConflictDoNothing();
}

async function clearDemoData() {
  const db = getDb();
  await db.delete(tasks).where(like(tasks.id, "demo-%"));
  await db.delete(events).where(like(events.id, "demo-%"));
  await db.delete(deals).where(like(deals.id, "demo-%"));
  await db.delete(expenseEntries).where(like(expenseEntries.id, "demo-%"));
  await db.delete(contentItems).where(like(contentItems.id, "demo-%"));
  await db.delete(ingredients).where(like(ingredients.id, "demo-%"));
  await db.delete(workouts).where(like(workouts.id, "demo-%"));
  await db.delete(cleaningMarks).where(like(cleaningMarks.id, "demo-%"));
  await db.delete(platformPromotions).where(like(platformPromotions.id, "demo-%"));
  await db.delete(personalProducts).where(like(personalProducts.id, "demo-%"));
  await db.delete(dailyReviews).where(like(dailyReviews.id, "demo-%"));
}


export async function GET() {
  try {
    await ensureDatabase();
    await finalizeExpiredFocusSessions();
    await backfillTaskSchedules();
    const db = getDb();
    const [taskRows, eventRows, focusRows, expenseRows, dealRows, contentRows, ingredientRows, workoutRows, cleaningRows, promotionRows, productRows, assistantRows, reviewRows, messageRows, memoryRows] = await Promise.all([
      db.select().from(tasks).orderBy(asc(tasks.status), asc(tasks.dueDate), desc(tasks.createdAt)),
      db.select().from(events).orderBy(asc(events.startAt)),
      db.select().from(focusSessions).orderBy(desc(focusSessions.startedAt)).limit(500),
      db.select().from(expenseEntries).orderBy(desc(expenseEntries.spentAt)).limit(2000),
      db.select().from(deals).orderBy(desc(deals.publishedAt)),
      db.select().from(contentItems).orderBy(desc(contentItems.modifiedAt)),
      db.select().from(ingredients).orderBy(asc(ingredients.expiresAt), asc(ingredients.category), asc(ingredients.name)),
      db.select().from(workouts).orderBy(desc(workouts.startedAt)),
      db.select().from(cleaningMarks).orderBy(asc(cleaningMarks.date)),
      db.select().from(platformPromotions).orderBy(desc(platformPromotions.createdAt)),
      db.select().from(personalProducts).orderBy(asc(personalProducts.stage), desc(personalProducts.updatedAt)),
      db.select().from(assistantSettings).where(eq(assistantSettings.id, "personal-assistant")).limit(1),
      db.select().from(dailyReviews).orderBy(desc(dailyReviews.generatedAt)).limit(180),
      db.select().from(assistantMessages).orderBy(desc(assistantMessages.createdAt)).limit(30),
      db.select().from(assistantMemories).where(eq(assistantMemories.status, "active")).orderBy(desc(assistantMemories.updatedAt)).limit(100),
    ]);
    const settings = await readWorkspaceSettings();
    const firstRun = !taskRows.length && !eventRows.length && !dealRows.length && !expenseRows.length && !ingredientRows.length && !workoutRows.length;
    const demoInstalled = [taskRows, dealRows, expenseRows, ingredientRows].some((rows) =>
      rows.some((row) => row.id.startsWith("demo-"))
    );
    return Response.json({
      tasks: taskRows,
      events: eventRows,
      focusSessions: focusRows,
      expenses: expenseRows,
      deals: dealRows.map(toDealView),
      contents: contentRows,
      ingredients: ingredientRows,
      workouts: workoutRows,
      cleanings: cleaningRows,
      promotions: promotionRows,
      products: productRows,
      assistant: {
        configured: Boolean(assistantRows[0]?.apiKey),
        baseUrl: assistantRows[0]?.baseUrl ?? DEFAULT_AI_BASE_URL,
        model: assistantRows[0]?.model ?? DEFAULT_AI_MODEL,
        reviewTime: assistantRows[0]?.reviewTime ?? "21:30",
        autoReview: assistantRows[0]?.autoReview ?? true,
        lastCallAt: assistantRows[0]?.lastCallAt ?? "",
        messages: messageRows.reverse().map((message) => ({
          id: message.id, role: message.role, content: message.content,
          actions: JSON.parse(message.actions) as unknown, createdAt: message.createdAt,
        })),
        memories: memoryRows,
        review: reviewRows.find((review) => review.periodType === "daily") ? (() => {
          const review = reviewRows.find((item) => item.periodType === "daily")!;
          return {
            reviewDate: review.reviewDate, periodType: review.periodType, periodKey: review.periodKey,
            rangeStart: review.rangeStart, rangeEnd: review.rangeEnd,
            generatedAt: review.generatedAt, generationCount: review.generationCount,
            content: JSON.parse(review.content) as unknown,
          };
        })() : null,
        reviews: reviewRows.map((review) => ({
          reviewDate: review.reviewDate, periodType: review.periodType, periodKey: review.periodKey,
          rangeStart: review.rangeStart, rangeEnd: review.rangeEnd,
          generatedAt: review.generatedAt,
          generationCount: review.generationCount,
          content: JSON.parse(review.content) as unknown,
        })),
      },
      meta: { firstRun, demoInstalled },
      settings: { enabledModules: settings.enabledModules, onboarded: Boolean(settings.onboardedAt) },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const payload = await request.json() as Record<string, unknown>;
    const kind = String(payload.kind ?? "task");
    const db = getDb();

    if (kind === "focus_start") {
      await finalizeExpiredFocusSessions();
      const [active] = await db.select().from(focusSessions).where(eq(focusSessions.status, "active")).limit(1);
      if (active) return Response.json({ error: "已有一轮专注正在进行", item: active }, { status: 409 });
      const requestedMinutes = Number(payload.plannedMinutes ?? 30);
      const plannedMinutes = Math.min(180, Math.max(5, Math.round(Number.isFinite(requestedMinutes) ? requestedMinutes : 30)));
      const [created] = await db.insert(focusSessions).values({
        id: crypto.randomUUID(), plannedMinutes, startedAt: new Date().toISOString(), status: "active",
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "assistant_config") {
      const [existing] = await db.select().from(assistantSettings).where(eq(assistantSettings.id, "personal-assistant")).limit(1);
      const baseUrl = String(payload.baseUrl ?? existing?.baseUrl ?? DEFAULT_AI_BASE_URL).trim().replace(/\/+$/, "");
      const model = String(payload.model ?? existing?.model ?? DEFAULT_AI_MODEL).trim();
      const apiKey = String(payload.apiKey ?? "").trim() || existing?.apiKey || "";
      const reviewTime = String(payload.reviewTime ?? existing?.reviewTime ?? "21:30").trim();
      const autoReview = payload.autoReview !== false;
      if (!baseUrl || !model || !apiKey) return Response.json({ error: "请填写 Base URL、模型和 API Key" }, { status: 400 });
      if (!/^\d{2}:\d{2}$/.test(reviewTime)) return Response.json({ error: "复盘时间格式不正确" }, { status: 400 });
      try {
        const url = new URL(baseUrl);
        if (!(["https:", "http:"].includes(url.protocol))) throw new Error();
      } catch {
        return Response.json({ error: "AI Base URL 不正确" }, { status: 400 });
      }
      const now = new Date().toISOString();
      await db.insert(assistantSettings).values({
        id: "personal-assistant", provider: "openai-compatible", baseUrl, apiKey, model,
        reviewTime, autoReview, updatedAt: now,
      }).onConflictDoUpdate({
        target: assistantSettings.id,
        set: { baseUrl, apiKey, model, reviewTime, autoReview, updatedAt: now },
      });
      return Response.json({ ok: true, configured: true });
    }

    if (kind === "assistant_memory_forget") {
      const id = String(payload.id ?? "").trim();
      if (!id.startsWith("memory:")) return Response.json({ error: "记忆 ID 不正确" }, { status: 400 });
      await db.update(assistantMemories).set({ status: "forgotten", updatedAt: new Date().toISOString() }).where(eq(assistantMemories.id, id));
      return Response.json({ ok: true });
    }

    if (kind === "assistant_undo") {
      const operationId = String(payload.operationId ?? "").trim();
      const replyId = String(payload.replyId ?? "").trim();
      if (!operationId.startsWith("assistant-operation:")) return Response.json({ error: "撤销信息不正确" }, { status: 400 });
      const operation = await undoAssistantOperation(operationId);
      if (replyId.startsWith("assistant-reply:")) {
        const [reply] = await db.select().from(assistantMessages).where(eq(assistantMessages.id, replyId)).limit(1);
        if (reply) {
          const receipts = JSON.parse(reply.actions) as AssistantActionReceipt[];
          const updated = receipts.map((receipt) => receipt.undoId === operationId
            ? { ...receipt, ok: false, state: "undone" as const, label: `已撤销：${receipt.label}`, undoId: undefined }
            : receipt);
          await db.update(assistantMessages).set({ actions: JSON.stringify(updated) }).where(eq(assistantMessages.id, replyId));
        }
      }
      return Response.json({ ok: true, restored: JSON.parse(operation.entityIds) as string[] });
    }

    if (kind === "assistant_action_decide") {
      const replyId = String(payload.replyId ?? "").trim();
      const decision = String(payload.decision ?? "");
      if (!replyId.startsWith("assistant-reply:") || !(decision === "confirm" || decision === "cancel")) {
        return Response.json({ error: "确认信息不正确" }, { status: 400 });
      }
      const [reply] = await db.select().from(assistantMessages).where(eq(assistantMessages.id, replyId)).limit(1);
      if (!reply || reply.role !== "assistant") return Response.json({ error: "没有找到待确认操作" }, { status: 404 });
      const receipts = JSON.parse(reply.actions) as AssistantActionReceipt[];
      const pending = receipts.filter((receipt) => receipt.state === "pending" && receipt.action);
      if (!pending.length) return Response.json({ error: "这些操作已经处理过了" }, { status: 409 });
      if (decision === "cancel") {
        const cancelled = receipts.map((receipt) => receipt.state === "pending" ? { ...receipt, ok: false, state: "cancelled" as const, label: `已取消：${receipt.label}`, action: undefined } : receipt);
        await db.update(assistantMessages).set({ actions: JSON.stringify(cancelled) }).where(eq(assistantMessages.id, replyId));
        return Response.json({ ok: true, actions: cancelled });
      }
      const results = await executeAssistantActions(pending.map((receipt) => receipt.action!), `confirmed:${replyId}`);
      const completed = [...receipts.filter((receipt) => receipt.state !== "pending"), ...results];
      await db.update(assistantMessages).set({ actions: JSON.stringify(completed) }).where(eq(assistantMessages.id, replyId));
      return Response.json({ ok: true, actions: completed });
    }

    if (kind === "assistant_chat") {
      const message = String(payload.message ?? "").trim().slice(0, 2000);
      const clientMessageId = String(payload.clientMessageId ?? "").trim();
      if (!message) return Response.json({ error: "请先告诉助理你想做什么" }, { status: 400 });
      if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(clientMessageId)) return Response.json({ error: "消息 ID 不正确" }, { status: 400 });
      const replyId = `assistant-reply:${clientMessageId}`;
      const [existingReply] = await db.select().from(assistantMessages).where(eq(assistantMessages.id, replyId)).limit(1);
      if (existingReply) {
        return Response.json({ ok: true, reply: existingReply.content, actions: JSON.parse(existingReply.actions) as unknown, replayed: true });
      }
      const [config] = await db.select().from(assistantSettings).where(eq(assistantSettings.id, "personal-assistant")).limit(1);
      if (!config?.apiKey) return Response.json({ error: "请先在设置中配置个人助理 API Key" }, { status: 409 });
      const directExpenseCapture = isExpenseCaptureRequest(message);
      const retryRequest = !directExpenseCapture && isAssistantRetryRequest(message);
      const retryHistoryRows = retryRequest
        ? await db.select().from(assistantMessages).orderBy(desc(assistantMessages.createdAt)).limit(60)
        : [];
      const retryExpense = retryRequest ? findRetryableExpenseRequest(retryHistoryRows) : null;
      const expenseInstruction = directExpenseCapture ? message : retryExpense?.message;
      const expenseCapture = Boolean(expenseInstruction);
      let planned: { reply: string; actions: AssistantAction[]; memories: AssistantMemoryWrite[] };
      if (expenseCapture) {
        planned = await runExpenseCapture({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }, expenseInstruction!);
      } else {
        // 重试措辞但找不到可重试的记账时，不做记账专用兜底，交给正常对话，让模型结合历史回答。
      const [eventRows, taskRows, workoutRows, ingredientRows, historyRows, memoryRows, dealRows, contentRows, productRows, focusRows, expenseRows] = await Promise.all([
        db.select().from(events).orderBy(asc(events.startAt)),
        db.select().from(tasks).orderBy(desc(tasks.updatedAt)),
        db.select().from(workouts).orderBy(desc(workouts.startedAt)).limit(30),
        db.select().from(ingredients).orderBy(asc(ingredients.expiresAt)).limit(100),
        db.select().from(assistantMessages).orderBy(desc(assistantMessages.createdAt)).limit(60),
        db.select().from(assistantMemories).where(eq(assistantMemories.status, "active")).orderBy(desc(assistantMemories.updatedAt)).limit(100),
        db.select().from(deals).orderBy(desc(deals.publishedAt)).limit(100),
        db.select().from(contentItems).orderBy(desc(contentItems.modifiedAt)).limit(100),
        db.select().from(personalProducts).orderBy(desc(personalProducts.updatedAt)).limit(100),
        db.select().from(focusSessions).orderBy(desc(focusSessions.startedAt)).limit(100),
        db.select().from(expenseEntries).orderBy(desc(expenseEntries.spentAt)).limit(500),
      ]);
      const now = new Date();
      const horizon = now.getTime() + 30 * 86400000;
      const conversationContext: ConversationContext = {
        now: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(now).replace(" ", "T") + "+08:00",
        timezone: "Asia/Shanghai",
        upcomingEvents: eventRows.filter((event) => {
          const start = new Date(event.startAt).getTime();
          return start >= now.getTime() - 86400000 && start <= horizon;
        }).slice(0, 60).map((event) => ({ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, location: event.location })),
        openTasks: taskRows.filter((task) => task.status !== "done").slice(0, 100).map((task) => ({ id: task.id, title: task.title, project: task.project, priority: task.priority, estimatedMinutes: task.estimatedMinutes, dueDate: task.dueDate, scheduledStart: task.scheduledStart })),
        recentWorkouts: workoutRows.map((workout) => ({ id: workout.id, type: workout.type, startedAt: workout.startedAt, durationMinutes: workout.durationMinutes, intensity: workout.intensity, notes: workout.notes })),
        ingredients: ingredientRows.map((item) => ({ id: item.id, name: item.name, amount: item.amount, category: item.category, storage: item.storage, expiresAt: item.expiresAt, note: item.note })),
        activeDeals: dealRows.filter((deal) => deal.stage !== "paid").map((deal) => ({ id: deal.id, title: deal.title, stage: deal.stage, categories: JSON.parse(deal.categories) as string[], price: deal.price, paidAmount: deal.paidAmount, publishedAt: deal.publishedAt })),
        contentItems: contentRows.map((item) => ({ id: item.id, title: item.title, status: item.status, linkedDeal: item.linkedDeal, pendingCount: item.pendingCount })),
        personalProducts: productRows.map((product) => ({ id: product.id, name: product.name, path: product.path, stage: product.stage, note: product.note })),
        recentExpenses: expenseRows.map((expense) => ({ id: expense.id, title: expense.title, amountCents: expense.amountCents, category: expense.category, spentAt: expense.spentAt, note: expense.note })),
        todayFocusMinutes: Math.round(focusRows.filter((session) => shanghaiDate(new Date(session.startedAt)) === shanghaiDate()).reduce((sum, session) => sum + session.durationSeconds, 0) / 60),
        activeFocus: focusRows.find((session) => session.status === "active") ? (() => { const session = focusRows.find((row) => row.status === "active")!; return { id: session.id, plannedMinutes: session.plannedMinutes, startedAt: session.startedAt }; })() : null,
        memories: memoryRows.map((memory) => ({ id: memory.id, category: memory.category, content: memory.content })),
      };
      // 裁剪历史中 assistant 的"库存快照"类消息（食材/冰箱/库存的旧状态已被实时 ingredients 覆盖，
      // 保留会让模型误引用已吃完或删除的食材）。用户消息仍保留以便理解意图。
      const INVENTORY_SNAPSHOT_RE = /冰箱|库存|存货|食材|吃完/;
      const history = historyRows.reverse().filter((item) => {
        if (item.role === "assistant" && INVENTORY_SNAPSHOT_RE.test(item.content)) return false;
        return item.role === "user" || item.role === "assistant";
      }).map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));
      planned = await runAssistantConversation({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }, message, conversationContext, history);
      const inferredEventDeletion = inferEventDeletionAction(message, eventRows);
      if (inferredEventDeletion) {
        planned.actions = [
          ...planned.actions.filter((action) => action.type !== "delete_event"),
          inferredEventDeletion,
        ];
      }
      }
      const inferredProduct = inferPersonalProductAction(message);
      if (inferredProduct) {
        const proposedProduct = planned.actions.find((action): action is Extract<AssistantAction, { type: "create_personal_product" }> => action.type === "create_personal_product");
        const productAction = proposedProduct ?? inferredProduct;
        const mentionsAnotherAction = /任务|待办|提醒|日程|会议|训练|健身|食材|冰箱|优先级|排序/.test(message);
        if (mentionsAnotherAction) {
          planned.actions = planned.actions.filter((action) => action.type !== "create_task" || !/个人产品/.test(action.title));
          if (!proposedProduct) planned.actions.push(productAction);
        } else {
          planned.actions = [productAction];
        }
        planned.reply = `好，我来把「${productAction.name}」加入个人产品。${productAction.path ? "会保留你提供的本地目录。" : "你没有提供本地目录，我会先留空，不会编造路径。"}`;
      } else if (!inferredProduct && /个人产品/.test(message) && /(?:新增|新建|添加|加入|加到|收录)/.test(message) && !planned.actions.some((action) => action.type === "create_personal_product")) {
        planned.reply = "我可以新增个人产品，但还没有识别出项目名。请直接告诉我：在个人产品中新增一个叫「项目名」的项目。";
      }
      const savedMemories = await saveAssistantMemories(clientMessageId, planned.memories);
      const memoryReceipts: AssistantActionReceipt[] = savedMemories.map((memory) => ({ ok: true, kind: "memory", state: "done", label: `已记住：${memory.content}` }));
      const allowedActions = expenseCapture || retryRequest || hasExplicitMutationIntent(message) || inferredProduct ? planned.actions : [];
      if (expenseCapture && !allowedActions.length) throw new Error("没有识别出可写入的支出或库存食材");
      const allPurchaseCaptureActions = expenseCapture && allowedActions.length > 0
        && allowedActions.every((action) => action.type === "add_expense" || action.type === "add_ingredient");
      // An explicit chat instruction is the authorization for ordinary workbench
      // mutations. Global database/backup/file operations are not represented in
      // AssistantAction at all, so normal multi-step business requests execute once
      // and return receipts instead of asking for a second confirmation.
      const requiresConfirmation = false;
      if (requiresConfirmation) {
        const pending: AssistantActionReceipt[] = [...memoryReceipts, ...allowedActions.map((action) => ({ ok: false, kind: action.type, state: "pending" as const, label: actionPreview(action), action }))];
        const createdAt = new Date();
        await db.insert(assistantMessages).values({ id: clientMessageId, role: "user", content: message, actions: "[]", createdAt: createdAt.toISOString() }).onConflictDoNothing();
        await db.insert(assistantMessages).values({ id: replyId, role: "assistant", content: planned.reply, actions: JSON.stringify(pending), createdAt: new Date(createdAt.getTime() + 1).toISOString() }).onConflictDoNothing();
        await db.update(assistantSettings).set({ lastCallAt: createdAt.toISOString(), updatedAt: createdAt.toISOString() }).where(eq(assistantSettings.id, "personal-assistant"));
        return Response.json({ ok: true, reply: planned.reply, actions: pending, needsConfirmation: true });
      }
      const actionNamespace = retryExpense?.id || clientMessageId;
      const results = await executeAssistantActions(allowedActions, actionNamespace, {
        dedupeRecentExpenses: Boolean(retryExpense),
        expenseFallbackDate: retryExpense?.createdAt ? new Date(retryExpense.createdAt) : undefined,
      });
      const receipts: AssistantActionReceipt[] = [...memoryReceipts, ...results];
      const expenseResults = results.filter((receipt) => receipt.kind === "add_expense");
      const completedExpenses = expenseResults.filter((receipt) => receipt.ok).length;
      const ingredientResults = results.filter((receipt) => receipt.kind === "add_ingredient");
      const completedIngredients = ingredientResults.filter((receipt) => receipt.ok).length;
      const expectedExpenses = allowedActions.filter((action) => action.type === "add_expense").length;
      const expectedIngredients = allowedActions.filter((action) => action.type === "add_ingredient").length;
      const expenseTotal = allowedActions.reduce((sum, action) => sum + (action.type === "add_expense" ? action.amount : 0), 0);
      const completedPurchaseCapture = completedExpenses + completedIngredients === expectedExpenses + expectedIngredients;
      let reply = planned.reply;
      if (allPurchaseCaptureActions) {
        if (completedPurchaseCapture) {
          const expenseText = expectedExpenses
            ? `${retryExpense ? "已重新核对并补齐" : "已记下"} ${completedExpenses} 笔支出，共 ¥${expenseTotal.toFixed(2)}`
            : "";
          const ingredientText = expectedIngredients ? `${completedIngredients} 种食材已加入库存` : "";
          reply = [expenseText, ingredientText].filter(Boolean).join("；") + "。";
        } else {
          reply = `识别到 ${expectedExpenses} 笔支出、${expectedIngredients} 种库存食材；实际写入 ${completedExpenses} 笔支出、${completedIngredients} 种食材，失败项没有保存。`;
        }
      } else if (hasExplicitMutationIntent(message)) {
        const succeeded = results.filter((receipt) => receipt.ok);
        const failed = results.filter((receipt) => !receipt.ok);
        if (!allowedActions.length) {
          reply = "这次没有修改工作台：我没有识别出可以安全执行的具体操作，请告诉我准确的对象名称。";
        } else if (!succeeded.length) {
          reply = `这次没有修改工作台：${failed.map((receipt) => receipt.label).join("；")}`;
        } else {
          reply = succeeded.map((receipt) => receipt.label).join("；");
          if (failed.length) reply += `。未完成：${failed.map((receipt) => receipt.label).join("；")}`;
        }
      }
      const createdAt = new Date();
      if (retryExpense && allPurchaseCaptureActions && completedPurchaseCapture) {
        await db.update(assistantMessages)
          .set({ actions: JSON.stringify(results) })
          .where(eq(assistantMessages.id, `assistant-reply:${retryExpense.id}`));
      }
      await db.insert(assistantMessages).values({ id: clientMessageId, role: "user", content: message, actions: "[]", createdAt: createdAt.toISOString() }).onConflictDoNothing();
      await db.insert(assistantMessages).values({ id: replyId, role: "assistant", content: reply, actions: JSON.stringify(receipts), createdAt: new Date(createdAt.getTime() + 1).toISOString() }).onConflictDoNothing();
      await db.update(assistantSettings).set({ lastCallAt: createdAt.toISOString(), updatedAt: createdAt.toISOString() }).where(eq(assistantSettings.id, "personal-assistant"));
      return Response.json({ ok: true, reply, actions: receipts });
    }

    if (kind === "assistant_review_generate") {
      await finalizeExpiredFocusSessions();
      const [config] = await db.select().from(assistantSettings).where(eq(assistantSettings.id, "personal-assistant")).limit(1);
      if (!config?.apiKey) return Response.json({ error: "请先在设置中配置个人助理 API Key" }, { status: 409 });
      const requestedPeriod = String(payload.periodType ?? "daily");
      if (!(["daily", "weekly", "monthly"] as string[]).includes(requestedPeriod)) return Response.json({ error: "复盘周期不正确" }, { status: 400 });
      const dataDateText = String(payload.dataDate ?? "").trim();
      const dataDate = /^\d{4}-\d{2}-\d{2}$/.test(dataDateText)
        ? new Date(`${dataDateText}T12:00:00+08:00`)
        : new Date();
      const period = reviewPeriod(requestedPeriod as ReviewPeriod, dataDate);
      const [existingReview] = await db.select().from(dailyReviews).where(and(
        eq(dailyReviews.periodType, period.periodType),
        eq(dailyReviews.periodKey, period.periodKey),
      )).limit(1);
      const [taskRows, eventRows, focusRows, dealRows, contentRows, ingredientRows, workoutRows, expenseRows, memoryRows] = await Promise.all([
        db.select().from(tasks),
        db.select().from(events),
        db.select().from(focusSessions).where(eq(focusSessions.status, "completed")),
        db.select().from(deals),
        db.select().from(contentItems).orderBy(desc(contentItems.modifiedAt)),
        db.select().from(ingredients).orderBy(asc(ingredients.expiresAt)),
        db.select().from(workouts).orderBy(desc(workouts.startedAt)),
        db.select().from(expenseEntries).orderBy(desc(expenseEntries.spentAt)).limit(2000),
        db.select().from(assistantMemories).where(eq(assistantMemories.status, "active")).orderBy(desc(assistantMemories.updatedAt)).limit(60),
      ]);
      const now = new Date();
      const threeDays = now.getTime() + 3 * 86400000;
      const nextRangeEnd = period.periodType === "monthly"
        ? (() => {
            const [year, month] = period.rangeEnd.split("-").map(Number);
            const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            return `${new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
          })()
        : shiftDateKey(period.rangeEnd, period.periodType === "weekly" ? 7 : 1);
      const mappedDeals = dealRows.map(toDealView);
      const context: ReviewContext = {
        periodType: period.periodType,
        periodKey: period.periodKey,
        date: period.reviewDate,
        rangeStart: period.rangeStart,
        rangeEnd: period.rangeEnd,
        completedTasks: taskRows.filter((task) => task.status === "done" && inShanghaiRange(task.completedAt, period.rangeStart, period.rangeEnd)).slice(0, 40).map((task) => task.title),
        dueOpenTasks: taskRows.filter((task) => task.status !== "done" && task.dueDate && shanghaiDate(new Date(task.dueDate)) <= nextRangeEnd).slice(0, 20).map((task) => ({ title: task.title, project: task.project, priority: task.priority, dueDate: task.dueDate })),
        unscheduledTasks: taskRows.filter((task) => task.status !== "done" && !task.dueDate).slice(0, 12).map((task) => ({ title: task.title, project: task.project, priority: task.priority })),
        events: eventRows.filter((event) => inShanghaiRange(event.startAt, period.rangeStart, period.rangeEnd)).slice(0, 40).map((event) => ({ title: event.title, startAt: event.startAt, endAt: event.endAt, category: event.category })),
        focusMinutes: Math.round(focusRows.filter((session) => inShanghaiRange(session.startedAt, period.rangeStart, period.rangeEnd)).reduce((sum, session) => sum + session.durationSeconds, 0) / 60),
        activeDeals: mappedDeals.filter((deal) => deal.stage !== "paid").slice(0, 12).map((deal) => ({ campaign: deal.campaign, stage: deal.stage, nextAction: deal.nextAction, deadline: deal.deadline })),
        contentSignals: contentRows.filter((item) => item.pendingCount > 0 || inShanghaiRange(item.modifiedAt, period.rangeStart, period.rangeEnd)).slice(0, 24).map((item) => ({ title: item.title, status: item.status, pendingCount: item.pendingCount, linkedDeal: item.linkedDeal })),
        workouts: workoutRows.filter((workout) => inShanghaiRange(workout.startedAt, period.rangeStart, period.rangeEnd)).slice(0, 24).map((workout) => ({ type: workout.type, startedAt: workout.startedAt, durationMinutes: workout.durationMinutes, intensity: workout.intensity })),
        expiringIngredients: ingredientRows.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() <= threeDays).slice(0, 12).map((item) => ({ name: item.name, amount: item.amount, expiresAt: item.expiresAt })),
        expenses: expenseRows.filter((expense) => inShanghaiRange(expense.spentAt, period.rangeStart, period.rangeEnd)).slice(0, 200).map((expense) => ({ title: expense.title, amountCents: expense.amountCents, category: expense.category, spentAt: expense.spentAt })),
        memories: memoryRows.map((memory) => ({ category: memory.category, content: memory.content })),
      };
      const content = await generateReview({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }, context);
      const generatedAt = new Date().toISOString();
      const generationCount = (existingReview?.generationCount ?? 0) + 1;
      await db.insert(dailyReviews).values({
        id: `${period.periodType}-review:${period.periodKey}`, reviewDate: period.reviewDate,
        periodType: period.periodType, periodKey: period.periodKey,
        rangeStart: period.rangeStart, rangeEnd: period.rangeEnd,
        content: JSON.stringify(content), generationCount, generatedAt,
      }).onConflictDoUpdate({
        target: dailyReviews.id,
        set: { reviewDate: period.reviewDate, periodType: period.periodType, periodKey: period.periodKey, rangeStart: period.rangeStart, rangeEnd: period.rangeEnd, content: JSON.stringify(content), generationCount, generatedAt },
      });
      await db.update(assistantSettings).set({ lastCallAt: generatedAt, updatedAt: generatedAt }).where(eq(assistantSettings.id, "personal-assistant"));
      return Response.json({ ok: true, review: { reviewDate: period.reviewDate, periodType: period.periodType, periodKey: period.periodKey, rangeStart: period.rangeStart, rangeEnd: period.rangeEnd, generatedAt, generationCount, content } });
    }





    if (kind === "week_archive") {
      const now = new Date();
      const mondayOffset = now.getDay() === 0 ? -6 : 1 - now.getDay();
      const monday = new Date(now); monday.setDate(now.getDate() + mondayOffset); monday.setHours(0, 0, 0, 0);
      const weekEnd = monday.getTime() + 7 * 86400000;
      const rows = await db.select().from(tasks);
      const rolling = rows.filter((row) => row.status !== "done" && row.dueDate && new Date(row.dueDate).getTime() < weekEnd);
      for (const row of rolling) {
        if (!row.dueDate) continue;
        const nextDateKey = shiftDateKey(taskDateKey(row.dueDate), 7);
        const scheduledStart = row.scheduledStart ? new Date(new Date(row.scheduledStart).getTime() + 7 * 86400000).toISOString() : null;
        await db.update(tasks).set({ dueDate: dueDateForDay(nextDateKey), scheduledStart, updatedAt: new Date().toISOString() }).where(eq(tasks.id, row.id));
      }
      return Response.json({ rolled: rolling.length });
    }

    if (kind === "content") {
      const title = String(payload.title ?? "").trim().slice(0, 120);
      if (!title) return Response.json({ error: "请填写稿件标题" }, { status: 400 });
      const status = String(payload.status ?? "写作中").trim();
      if (!CONTENT_STATUSES.has(status)) return Response.json({ error: "不支持的稿件状态" }, { status: 400 });
      const now = new Date().toISOString();
      const wordCount = Number(payload.wordCount ?? 0);
      const pendingCount = Number(payload.pendingCount ?? 0);
      const [created] = await db.insert(contentItems).values({
        id: crypto.randomUUID(),
        title,
        kind: String(payload.type ?? "笔记").trim().slice(0, 20) || "笔记",
        status,
        wordCount: Number.isFinite(wordCount) ? Math.max(0, Math.round(wordCount)) : 0,
        pendingCount: Number.isFinite(pendingCount) ? Math.max(0, Math.round(pendingCount)) : 0,
        linkedDeal: payload.linkedDeal ? String(payload.linkedDeal).trim().slice(0, 120) : null,
        modifiedAt: now,
        createdAt: now,
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "workspace_settings") {
      const enabledModules = normalizeModules(payload.enabledModules);
      const now = new Date().toISOString();
      const [existing] = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, "workspace")).limit(1);
      const onboardedAt = payload.onboarded === false ? null : (existing?.onboardedAt ?? now);
      await db.insert(workspaceSettings).values({
        id: "workspace",
        enabledModules: JSON.stringify(enabledModules),
        onboardedAt,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: workspaceSettings.id,
        set: { enabledModules: JSON.stringify(enabledModules), onboardedAt, updatedAt: now },
      });
      return Response.json({ ok: true, enabledModules, onboarded: Boolean(onboardedAt) });
    }

    if (kind === "demo_load") {
      await loadDemoData((await readWorkspaceSettings()).enabledModules);
      return Response.json({ ok: true });
    }

    if (kind === "demo_clear") {
      await clearDemoData();
      return Response.json({ ok: true });
    }

    if (kind === "expense") {
      const title = String(payload.title ?? "").trim().slice(0, 120);
      const amountCents = expenseAmountToCents(payload.amount);
      const spentAt = expenseDateTime(payload.spentAt);
      if (!title) return Response.json({ error: "请填写这笔支出" }, { status: 400 });
      if (!amountCents) return Response.json({ error: "请输入正确的支出金额" }, { status: 400 });
      if (!spentAt) return Response.json({ error: "支出日期格式不正确" }, { status: 400 });
      const [created] = await db.insert(expenseEntries).values({
        id: crypto.randomUUID(), title, amountCents,
        category: normalizeExpenseCategory(payload.category), spentAt,
        note: String(payload.note ?? "").trim().slice(0, 500), source: "workspace",
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "ingredient") {
      const name = String(payload.name ?? "").trim();
      if (!name) return Response.json({ error: "请填写食材名称" }, { status: 400 });
      const storage = String(payload.storage ?? "冷藏").trim() || "冷藏";
      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(), name, amount: String(payload.amount ?? "适量").trim() || "适量",
        category: String(payload.category ?? "其他"), storage,
        expiresAt: payload.expiresAt ? String(payload.expiresAt) : null,
        note: String(payload.note ?? "").trim(), createdAt: now, updatedAt: now,
      };
      await retryDatabaseWrite("create-ingredient", () => db.insert(ingredients).values(item));
      return Response.json({ item }, { status: 201 });
    }

    if (kind === "workout") {
      const type = String(payload.type ?? "").trim();
      const startedAt = String(payload.startedAt ?? "");
      if (!type || !startedAt || Number.isNaN(new Date(startedAt).getTime())) return Response.json({ error: "请补齐训练类型和时间" }, { status: 400 });
      const requestedDuration = Number(payload.durationMinutes ?? 30);
      if (!Number.isFinite(requestedDuration) || requestedDuration < 5 || requestedDuration > 720) return Response.json({ error: "训练时长需要在 5 到 720 分钟之间" }, { status: 400 });
      const durationMinutes = Math.round(requestedDuration);
      const [created] = await db.insert(workouts).values({
        id: crypto.randomUUID(), type, startedAt, durationMinutes,
        intensity: String(payload.intensity ?? "中等"), notes: String(payload.notes ?? "").trim(),
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "cleaning") {
      const date = String(payload.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "日期格式不正确" }, { status: 400 });
      const minutesOfDay = (value: unknown) => {
        const minutes = Number(value);
        return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? Math.round(minutes) : null;
      };
      const kind = payload.extra === true ? "extra" : (payload.startMinutes !== undefined || payload.endMinutes !== undefined ? "hours" : "missed");
      const startMinutes = kind === "hours" ? minutesOfDay(payload.startMinutes) : null;
      const endMinutes = kind === "hours" ? minutesOfDay(payload.endMinutes) : null;
      if (kind === "hours" && (startMinutes === null || endMinutes === null || endMinutes - startMinutes < 30)) {
        return Response.json({ error: "保洁时间需要至少 30 分钟" }, { status: 400 });
      }
      await db.delete(cleaningMarks).where(eq(cleaningMarks.date, date));
      const [created] = await db.insert(cleaningMarks).values({
        id: crypto.randomUUID(), date, note: String(payload.note ?? "").trim(),
        kind, startMinutes, endMinutes,
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "platform_promotion") {
      const platform = String(payload.platform ?? "").trim();
      const topic = String(payload.topic ?? "").trim();
      if (!platform || !topic) return Response.json({ error: "请填写平台和话题" }, { status: 400 });
      const [created] = await db.insert(platformPromotions).values({
        id: crypto.randomUUID(), platform, topic,
        startDate: payload.startDate ? String(payload.startDate) : null,
        endDate: payload.endDate ? String(payload.endDate) : null,
        rules: String(payload.rules ?? "").trim(),
        note: String(payload.note ?? "").trim(),
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "personal_product") {
      const name = String(payload.name ?? "").trim();
      const path = String(payload.path ?? "").trim();
      if (!name) return Response.json({ error: "请填写项目名" }, { status: 400 });
      const stage = String(payload.stage ?? "计划中").trim();
      if (!PERSONAL_PRODUCT_STAGES.has(stage)) return Response.json({ error: "不支持的个人产品阶段" }, { status: 400 });
      const [created] = await db.insert(personalProducts).values({
        id: crypto.randomUUID(), name, path, stage,
        note: String(payload.note ?? "").trim(),
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "task") {
      const title = String(payload.title ?? "").trim();
      if (!title) return Response.json({ error: "任务标题不能为空" }, { status: 400 });
      const requestedDuration = Number(payload.estimatedMinutes ?? 30);
      if (!Number.isFinite(requestedDuration) || requestedDuration < 5 || requestedDuration > 720) return Response.json({ error: "任务时长需要在 5 到 720 分钟之间" }, { status: 400 });
      const estimatedMinutes = Math.round(requestedDuration);
      const priority = ["high", "medium", "low"].includes(String(payload.priority ?? "")) ? String(payload.priority) : "medium";
      const due = payload.dueDate ? validDate(String(payload.dueDate)) : null;
      const explicitStart = payload.scheduledStart ? validDate(String(payload.scheduledStart)) : null;
      if (payload.dueDate && !due) return Response.json({ error: "任务日期格式不正确" }, { status: 400 });
      if (payload.scheduledStart && !explicitStart) return Response.json({ error: "任务开始时间格式不正确" }, { status: 400 });
      const dateKey = explicitStart ? taskDateKey(explicitStart) : due ? taskDateKey(due) : "";
      const scheduledStart = explicitStart?.toISOString() ?? (dateKey ? await autoScheduleTask({ title, dateKey, estimatedMinutes, priority }) : null);
      const [created] = await db.insert(tasks).values({
        id: crypto.randomUUID(), title, project: String(payload.project ?? "收件箱"),
        priority, estimatedMinutes,
        dueDate: dateKey ? dueDateForDay(dateKey) : null, scheduledStart,
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    if (kind === "event") {
      const title = String(payload.title ?? "").trim();
      if (!title || !payload.startAt || !payload.endAt) return Response.json({ error: "请补齐日程信息" }, { status: 400 });
      const [created] = await db.insert(events).values({
        id: crypto.randomUUID(), title, startAt: String(payload.startAt), endAt: String(payload.endAt),
        category: String(payload.category ?? "meeting"), location: String(payload.location ?? ""),
      }).returning();
      return Response.json({ item: created }, { status: 201 });
    }

    const title = String(payload.title ?? "").trim();
    const categories = normalizeDealCategories(payload.categories);
    if (!title) return Response.json({ error: "请填写商单名称" }, { status: 400 });
    if (!categories.length) return Response.json({ error: `请选择商单类别：${DEAL_CATEGORY_OPTIONS.join("、")}` }, { status: 400 });
    const stage = normalizeDealStage(payload.stage);
    const now = new Date().toISOString();
    const numberValue = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const receivedAt = payload.receivedAt ? validDate(String(payload.receivedAt)) : new Date();
    if (!receivedAt) return Response.json({ error: "接单日期格式不正确" }, { status: 400 });
    if (payload.publishedAt && !validDate(String(payload.publishedAt))) return Response.json({ error: "发布日期格式不正确" }, { status: 400 });
    const [created] = await db.insert(deals).values({
      id: crypto.randomUUID(), title, stage,
      categories: JSON.stringify(categories), price: numberValue(payload.price), paidAmount: numberValue(payload.paidAmount),
      receivedAt: receivedAt.toISOString(),
      publishedAt: payload.publishedAt ? validDate(String(payload.publishedAt))!.toISOString() : null,
      month: payload.month ? String(payload.month) : null,
      source: "local", createdAt: now, updatedAt: now,
    }).returning();
    return Response.json({ item: toDealView(created) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const payload = await request.json() as { kind?: string; id?: string; linkedDeal?: string; status?: string; stage?: string; publishedAt?: string | null; title?: string; project?: string; note?: string; dueDate?: string | null; scheduledStart?: string | null; autoSchedule?: boolean; priority?: string; estimatedMinutes?: number; startAt?: string; endAt?: string; startedAt?: string; spentAt?: string; durationMinutes?: number; amount?: number | string; category?: string; startMinutes?: number; endMinutes?: number; fromDate?: string };
    const db = getDb();
    if (payload.kind === "content" && payload.status) {
      const allowedStatuses = ["构思中", "写作中", "初稿完成", "待审核", "待发布", "已发布", "已归档"];
      if (!allowedStatuses.includes(payload.status)) return Response.json({ error: "不支持的稿件状态" }, { status: 400 });
      if (payload.linkedDeal) {
        const updated = await db.update(contentItems).set({ status: payload.status }).where(eq(contentItems.linkedDeal, payload.linkedDeal)).returning({ id: contentItems.id });
        return Response.json({ ok: true, updated: updated.length });
      }
      if (!payload.id) return Response.json({ error: "缺少稿件 ID" }, { status: 400 });
      const updated = await db.update(contentItems).set({ status: payload.status }).where(eq(contentItems.id, payload.id)).returning({ id: contentItems.id });
      return Response.json({ ok: true, updated: updated.length });
    }
    if (!payload.id) return Response.json({ error: "缺少 ID" }, { status: 400 });
    if (payload.kind === "expense") {
      const [current] = await db.select().from(expenseEntries).where(eq(expenseEntries.id, payload.id)).limit(1);
      if (!current) return Response.json({ error: "没有找到这笔支出" }, { status: 404 });
      const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 120) : current.title;
      const amountCents = payload.amount === undefined ? current.amountCents : expenseAmountToCents(payload.amount);
      const spentAt = payload.spentAt === undefined ? current.spentAt : expenseDateTime(payload.spentAt);
      if (!title) return Response.json({ error: "请填写这笔支出" }, { status: 400 });
      if (!amountCents) return Response.json({ error: "请输入正确的支出金额" }, { status: 400 });
      if (!spentAt) return Response.json({ error: "支出日期格式不正确" }, { status: 400 });
      const [updated] = await db.update(expenseEntries).set({
        title, amountCents, spentAt,
        category: payload.category === undefined ? current.category : normalizeExpenseCategory(payload.category),
        note: payload.note === undefined ? current.note : payload.note.trim().slice(0, 500),
        updatedAt: new Date().toISOString(),
      }).where(eq(expenseEntries.id, payload.id)).returning();
      return Response.json({ ok: true, item: updated });
    }
    if (payload.kind === "focus_complete") {
      const [session] = await db.select().from(focusSessions).where(eq(focusSessions.id, payload.id)).limit(1);
      if (!session) return Response.json({ error: "没有找到这轮专注" }, { status: 404 });
      if (session.status !== "active") return Response.json({ ok: true, item: session });
      const startedAt = new Date(session.startedAt).getTime();
      const now = Date.now();
      const plannedSeconds = session.plannedMinutes * 60;
      const durationSeconds = Math.min(plannedSeconds, Math.max(0, Math.floor((now - startedAt) / 1000)));
      const endedAt = new Date(startedAt + durationSeconds * 1000).toISOString();
      const [updated] = await db.update(focusSessions).set({ status: "completed", endedAt, durationSeconds }).where(eq(focusSessions.id, payload.id)).returning();
      return Response.json({ ok: true, item: updated });
    }
    if (payload.kind === "event" && payload.startAt && payload.endAt) {
      const startAt = validDate(payload.startAt);
      const endAt = validDate(payload.endAt);
      if (!startAt || !endAt || endAt <= startAt) return Response.json({ error: "日程起止时间不正确" }, { status: 400 });
      const [updated] = await db.update(events).set({ startAt: startAt.toISOString(), endAt: endAt.toISOString(), updatedAt: new Date().toISOString() }).where(eq(events.id, payload.id)).returning();
      if (!updated) return Response.json({ error: "没有找到这条日程" }, { status: 404 });
      return Response.json({ ok: true, item: updated });
    }
    if (payload.kind === "workout" && (payload.startedAt !== undefined || payload.durationMinutes !== undefined)) {
      const set: { startedAt?: string; durationMinutes?: number } = {};
      if (payload.startedAt !== undefined) {
        const startedAt = validDate(payload.startedAt);
        if (!startedAt) return Response.json({ error: "训练时间格式不正确" }, { status: 400 });
        set.startedAt = startedAt.toISOString();
      }
      if (payload.durationMinutes !== undefined) {
        const durationMinutes = Number(payload.durationMinutes);
        if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) return Response.json({ error: "训练时长需要在 5 到 720 分钟之间" }, { status: 400 });
        set.durationMinutes = Math.round(durationMinutes);
      }
      const [updated] = await db.update(workouts).set(set).where(eq(workouts.id, payload.id)).returning();
      if (!updated) return Response.json({ error: "没有找到这条训练记录" }, { status: 404 });
      return Response.json({ ok: true, item: updated });
    }
    if (payload.kind === "cleaning" && payload.startMinutes !== undefined && payload.endMinutes !== undefined) {
      // 保洁块拖动：虚拟块的 id 形如 cleaning-YYYY-MM-DD，落库为该日期的自定义时间。
      const dateMatch = String(payload.id ?? "").match(/^cleaning-(\d{4}-\d{2}-\d{2})$/);
      if (dateMatch) {
        const minutesOfDay = (value: unknown) => {
          const minutes = Number(value);
          return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? Math.round(minutes) : null;
        };
        const startMinutes = minutesOfDay(payload.startMinutes);
        const endMinutes = minutesOfDay(payload.endMinutes);
        if (startMinutes === null || endMinutes === null || endMinutes - startMinutes < 30) {
          return Response.json({ error: "保洁时间需要至少 30 分钟" }, { status: 400 });
        }
        const targetDate = dateMatch[1];
        // 跨天移动：源日期标记为 moved，目标日期写入自定义时间；同日移动只更新 hours。
        const fromDate = typeof payload.fromDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.fromDate) && payload.fromDate !== targetDate ? payload.fromDate : null;
        if (fromDate) {
          await db.delete(cleaningMarks).where(and(eq(cleaningMarks.date, fromDate), inArray(cleaningMarks.kind, ["hours", "moved"])));
          await db.insert(cleaningMarks).values({ id: crypto.randomUUID(), date: fromDate, note: "", kind: "moved" });
        }
        await db.delete(cleaningMarks).where(and(eq(cleaningMarks.date, targetDate), inArray(cleaningMarks.kind, ["hours", "moved"])));
        const [created] = await db.insert(cleaningMarks).values({
          id: crypto.randomUUID(), date: targetDate, note: "",
          kind: "hours", startMinutes, endMinutes,
        }).returning();
        return Response.json({ ok: true, item: created });
      }
      const minutesOfDay = (value: unknown) => {
        const minutes = Number(value);
        return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? Math.round(minutes) : null;
      };
      const startMinutes = minutesOfDay(payload.startMinutes);
      const endMinutes = minutesOfDay(payload.endMinutes);
      if (startMinutes === null || endMinutes === null || endMinutes - startMinutes < 30) {
        return Response.json({ error: "保洁时间需要至少 30 分钟" }, { status: 400 });
      }
      const [existing] = await db.select().from(cleaningMarks).where(eq(cleaningMarks.id, payload.id)).limit(1);
      if (!existing) return Response.json({ error: "没有找到这条保洁记录" }, { status: 404 });
      const [updated] = await db.update(cleaningMarks)
        .set({ kind: "hours", startMinutes, endMinutes })
        .where(eq(cleaningMarks.id, payload.id))
        .returning();
      return Response.json({ ok: true, item: updated });
    }
    if (payload.kind === "personal_product") {
      const set: { stage?: string; note?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
      if (payload.stage) {
        const stage = String(payload.stage);
        if (!PERSONAL_PRODUCT_STAGES.has(stage)) return Response.json({ error: "不支持的个人产品阶段" }, { status: 400 });
        set.stage = stage;
      }
      if (typeof payload.note === "string") set.note = payload.note;
      await db.update(personalProducts).set(set).where(eq(personalProducts.id, payload.id));
      return Response.json({ ok: true });
    }
    if (payload.kind === "deal" && (payload.stage !== undefined || payload.publishedAt !== undefined)) {
      const now = new Date().toISOString();
      const [current] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, payload.id)).limit(1);
      if (!current) return Response.json({ error: "没有找到这条商单" }, { status: 404 });
      const set: { stage?: DealStage; publishedAt?: string | null; updatedAt: string } = { updatedAt: now };
      if (payload.stage !== undefined) {
        if (!DEAL_STAGES.includes(payload.stage as DealStage)) return Response.json({ error: "不支持的商单状态" }, { status: 400 });
        set.stage = payload.stage as DealStage;
      }
      if (payload.publishedAt !== undefined) {
        if (payload.publishedAt === null || payload.publishedAt === "") {
          set.publishedAt = null;
        } else {
          const publishedAt = validDate(String(payload.publishedAt));
          if (!publishedAt) return Response.json({ error: "发布日期格式不正确" }, { status: 400 });
          set.publishedAt = publishedAt.toISOString();
        }
      }
      await db.update(deals).set(set).where(eq(deals.id, payload.id));
      return Response.json({ ok: true });
    }
    if (payload.kind !== "task") return Response.json({ error: "不支持的更新类型" }, { status: 400 });
    const [currentTask] = await db.select().from(tasks).where(eq(tasks.id, payload.id)).limit(1);
    if (!currentTask) return Response.json({ error: "没有找到这条任务" }, { status: 404 });
    const set: { status?: string; title?: string; project?: string; dueDate?: string | null; scheduledStart?: string | null; priority?: string; estimatedMinutes?: number; completedAt?: string | null; updatedAt: string } = { updatedAt: new Date().toISOString() };
    if (payload.status) { set.status = payload.status === "done" ? "done" : "todo"; set.completedAt = payload.status === "done" ? new Date().toISOString() : null; }
    if (typeof payload.title === "string") {
      if (!payload.title.trim()) return Response.json({ error: "任务名称不能为空" }, { status: 400 });
      set.title = payload.title.trim();
    }
    if (typeof payload.project === "string" && payload.project.trim()) set.project = payload.project.trim();
    if (typeof payload.priority === "string") {
      if (!["high", "medium", "low"].includes(payload.priority)) return Response.json({ error: "任务优先级不正确" }, { status: 400 });
      set.priority = payload.priority;
    }
    if (payload.estimatedMinutes !== undefined) {
      const estimatedMinutes = Number(payload.estimatedMinutes);
      if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 5 || estimatedMinutes > 720) return Response.json({ error: "任务时长需要在 5 到 720 分钟之间" }, { status: 400 });
      set.estimatedMinutes = Math.round(estimatedMinutes);
    }
    let nextDateKey = currentTask.dueDate ? taskDateKey(currentTask.dueDate) : "";
    if (payload.dueDate !== undefined) {
      if (!payload.dueDate) {
        nextDateKey = "";
        set.dueDate = null;
        set.scheduledStart = null;
      } else {
        const due = validDate(payload.dueDate);
        if (!due) return Response.json({ error: "任务日期格式不正确" }, { status: 400 });
        nextDateKey = taskDateKey(due);
        set.dueDate = dueDateForDay(nextDateKey);
      }
    }
    if (payload.scheduledStart !== undefined && payload.scheduledStart !== null) {
      const scheduledStart = validDate(payload.scheduledStart);
      if (!scheduledStart) return Response.json({ error: "任务开始时间格式不正确" }, { status: 400 });
      nextDateKey = taskDateKey(scheduledStart);
      set.scheduledStart = scheduledStart.toISOString();
      set.dueDate = dueDateForDay(nextDateKey);
    } else if (payload.scheduledStart === null && !payload.autoSchedule) {
      set.scheduledStart = null;
    }
    if (payload.autoSchedule && nextDateKey) {
      set.scheduledStart = await autoScheduleTask({
        title: set.title ?? currentTask.title,
        dateKey: nextDateKey,
        estimatedMinutes: set.estimatedMinutes ?? currentTask.estimatedMinutes,
        priority: set.priority ?? currentTask.priority,
        excludeTaskId: currentTask.id,
      });
    }
    const [updated] = await db.update(tasks).set(set).where(and(eq(tasks.id, payload.id))).returning();
    return Response.json({ ok: true, item: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  let deleteKind = "";
  try {
    await ensureDatabase();
    const payload = await request.json() as { kind?: string; id?: string };
    if (!payload.id) return Response.json({ error: "缺少 ID" }, { status: 400 });
    deleteKind = String(payload.kind ?? "");
    const db = getDb();
    if (payload.kind === "expense") {
      await retryDatabaseWrite("delete-expense", () => db.delete(expenseEntries).where(eq(expenseEntries.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "task") {
      await retryDatabaseWrite("delete-task", () => db.delete(tasks).where(eq(tasks.id, payload.id!)));
      return Response.json({ ok: true, deleted: true });
    }
    if (payload.kind === "ingredient") {
      await retryDatabaseWrite("delete-ingredient", () => db.delete(ingredients).where(eq(ingredients.id, payload.id!)));
      return Response.json({ ok: true, deleted: true });
    }
    if (payload.kind === "workout") {
      await retryDatabaseWrite("delete-workout", () => db.delete(workouts).where(eq(workouts.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "cleaning") {
      await retryDatabaseWrite("delete-cleaning", () => db.delete(cleaningMarks).where(eq(cleaningMarks.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "event") {
      await retryDatabaseWrite("delete-event", () => db.delete(events).where(eq(events.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "platform_promotion") {
      await retryDatabaseWrite("delete-platform-promotion", () => db.delete(platformPromotions).where(eq(platformPromotions.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "deal") {
      await retryDatabaseWrite("delete-deal", () => db.delete(deals).where(eq(deals.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "content") {
      await retryDatabaseWrite("delete-content", () => db.delete(contentItems).where(eq(contentItems.id, payload.id!)));
      return Response.json({ ok: true });
    }
    if (payload.kind === "personal_product") {
      await retryDatabaseWrite("delete-personal-product", () => db.delete(personalProducts).where(eq(personalProducts.id, payload.id!)));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "不支持的删除类型" }, { status: 400 });
  } catch (error) {
    const transient = isTransientDatabaseError(error);
    console.error("[workspace-delete]", JSON.stringify({
      requestId, kind: deleteKind || "unknown", transient,
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({
      error: transient ? "本地数据库暂时繁忙，请再试一次" : error instanceof Error ? error.message : "删除失败",
      requestId,
    }, { status: transient ? 503 : 500 });
  }
}
