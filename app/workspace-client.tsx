"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DEAL_CATEGORY_OPTIONS } from "../lib/deals";
import { MODULES, type ModuleId } from "../lib/modules";
import { currentQuarterLabel, type Goals } from "../lib/goals";
import { BRAND } from "../lib/brand";
import { EXPENSE_CATEGORIES } from "../lib/expenses";
import { layoutCalendarDay } from "../lib/calendar-layout";
import { calendarStartForTask } from "../lib/task-scheduler";

type DesktopBackup = { id: string; createdAt: string; sizeLabel: string; recordCounts: Record<string, number> };

declare global {
  interface Window {
    workbenchDesktop?: {
      isDesktop: true;
      notifyFocusComplete: (minutes: number) => Promise<{ ok: boolean }>;
      onNavigate: (callback: (destination: string) => void) => () => void;
      backupNow: () => Promise<{ ok: boolean; error?: string }>;
      backupList: () => Promise<{ ok: boolean; backups?: DesktopBackup[]; error?: string }>;
      backupRestore: (backupId: string) => Promise<{ ok: boolean; error?: string }>;
      backupDelete: (backupId: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

type View = "today" | "calendar" | "deals" | "expenses" | "health" | "review" | "platforms" | "products" | "connections";
type Task = { id: string; title: string; project: string; status: string; priority: string; estimatedMinutes: number; dueDate: string | null; scheduledStart: string | null; completedAt: string | null; assistantRank: number | null; assistantRankDate: string | null; assistantReason: string; source: string };
type Event = { id: string; title: string; startAt: string; endAt: string; category: string; location: string; source: string };
type FocusSession = { id: string; plannedMinutes: number; startedAt: string; endedAt: string | null; durationSeconds: number; status: "active" | "completed" };
type Expense = { id: string; title: string; amountCents: number; category: string; spentAt: string; note: string; source: string; createdAt: string; updatedAt: string };
type Deal = { id: string; brand: string; campaign: string; stage: string; nextAction: string; deadline: string | null; month: string | null; amountLabel: string; source: string; category: string; categories: string[]; settled: boolean; price: number | null; paidAmount: number | null; receivedAt: string | null };
type ContentItem = { id: string; title: string; kind: string; status: string; wordCount: number; pendingCount: number; linkedDeal: string | null; modifiedAt: string; createdAt: string };
type Ingredient = { id: string; name: string; amount: string; category: string; storage: string; expiresAt: string | null; note: string };
type Workout = { id: string; type: string; startedAt: string; durationMinutes: number; intensity: string; notes: string; source: string };
type CleaningMark = { id: string; date: string; note: string; kind: string; startMinutes: number | null; endMinutes: number | null };
type PlatformPromotion = { id: string; platform: string; topic: string; startDate: string | null; endDate: string | null; rules: string; note: string; status: string };
type PersonalProduct = { id: string; name: string; path: string; stage: string; note: string };
type ReviewPeriod = "daily" | "weekly" | "monthly";
type DailyReviewContent = { summary: string; wins: string[]; unfinished: Array<{ item: string; action: string }>; signals: string[]; tomorrowTop3: Array<{ title: string; why: string; minutes: number }>; question: string };
type DailyReview = { reviewDate: string; periodType: ReviewPeriod; periodKey: string; rangeStart: string; rangeEnd: string; generatedAt: string; generationCount: number; content: DailyReviewContent };
type AssistantActionReceipt = { ok: boolean; kind: string; label: string; state?: "done" | "failed" | "pending" | "cancelled" | "undone"; undoId?: string };
type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; actions: AssistantActionReceipt[]; createdAt: string };
type AssistantMemory = { id: string; category: string; content: string; sourceMessageId: string | null; status: string; createdAt: string; updatedAt: string };
type AssistantState = { configured: boolean; baseUrl: string; model: string; reviewTime: string; autoReview: boolean; lastCallAt: string; messages: AssistantMessage[]; memories: AssistantMemory[]; review: DailyReview | null; reviews: DailyReview[] };
type WorkspaceSettings = { enabledModules: ModuleId[]; onboarded: boolean; goals: Goals };
type WorkspaceData = { tasks: Task[]; events: Event[]; focusSessions: FocusSession[]; expenses: Expense[]; deals: Deal[]; contents: ContentItem[]; ingredients: Ingredient[]; workouts: Workout[]; cleanings: CleaningMark[]; promotions: PlatformPromotion[]; products: PersonalProduct[]; assistant: AssistantState; meta: { firstRun: boolean; demoInstalled: boolean }; settings: WorkspaceSettings };

const AI_MODEL_OPTIONS = [
  { value: "glm-5.3-flash", label: "GLM-5.3 Flash（更快）" },
  { value: "glm-5.3", label: "GLM-5.3（更强）" },
] as const;

const CLEANING_TIME = "10:00–12:00";
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR = 23;
const CALENDAR_HOUR_HEIGHT = 72;
const CALENDAR_SNAP_MINUTES = 15;

const nav: { id: View; label: string; icon: string }[] = [
  { id: "today", label: "本周", icon: "◐" },
  { id: "calendar", label: "日历", icon: "▦" },
  { id: "deals", label: "商单", icon: "◇" },
  { id: "expenses", label: "记账", icon: "¥" },
  { id: "connections", label: "设置", icon: "⚙" },
  { id: "health", label: "健康", icon: "♡" },
  { id: "platforms", label: "平台扶持", icon: "◈" },
  { id: "products", label: "个人产品", icon: "▣" },
  { id: "review", label: "复盘日志", icon: "↗" },
];

const stageMeta: Record<string, { label: string; color: string }> = {
  lead: { label: "未开始", color: "#8d7cf6" },
  execution: { label: "进行中", color: "#ef9b55" },
  delivery: { label: "已完成", color: "#e66e70" },
  paid: { label: "已结算", color: "#55a783" },
};

const contentStatusOptions = ["构思中", "写作中", "初稿完成", "待审核", "待发布", "已发布", "已归档"];

function sameDay(value: string, date = new Date()) {
  const target = new Date(value);
  return target.getFullYear() === date.getFullYear() && target.getMonth() === date.getMonth() && target.getDate() === date.getDate();
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftLocalDateKey(dateKey: string, days: number) {
  return localDateKey(new Date(new Date(`${dateKey}T12:00:00+08:00`).getTime() + days * 86400000));
}

function currentReviewPeriod(periodType: ReviewPeriod, value = new Date()) {
  const today = localDateKey(value);
  if (periodType === "daily") return { periodKey: today, rangeStart: today, rangeEnd: today };
  if (periodType === "monthly") {
    const [year, month] = today.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { periodKey: today.slice(0, 7), rangeStart: `${today.slice(0, 7)}-01`, rangeEnd: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
  }
  const mondayOffset = (value.getDay() + 6) % 7;
  const rangeStart = shiftLocalDateKey(today, -mondayOffset);
  return { periodKey: rangeStart, rangeStart, rangeEnd: shiftLocalDateKey(rangeStart, 6) };
}

// 复盘数据日期：00:00 执行时复盘前一天（当天数据已完整），否则复盘执行当天
function reviewDataDate(reviewTime: string, value = new Date()) {
  if (reviewTime === "00:00") {
    const previous = new Date(value);
    previous.setDate(previous.getDate() - 1);
    return localDateKey(previous);
  }
  return localDateKey(value);
}

function dateInRange(value: string | null, rangeStart: string, rangeEnd: string) {
  if (!value) return false;
  const key = localDateKey(new Date(value));
  return key >= rangeStart && key <= rangeEnd;
}

function time(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function timeFieldValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function shortDate(value: string | null) {
  if (!value) return "未定";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function durationText(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} 分钟`;
  return `${hours} 小时${rest ? ` ${rest} 分钟` : ""}`;
}

function focusTotal(seconds: number) {
  if (seconds >= 3600) return { value: Math.round(seconds / 360) / 10, unit: "小时" };
  return { value: Math.round(seconds / 60), unit: "分钟" };
}

export function Workspace() {
  const [view, setView] = useState<View>("today");
  const [data, setData] = useState<WorkspaceData>({
    tasks: [], events: [], focusSessions: [], expenses: [], deals: [], contents: [], ingredients: [], workouts: [], cleanings: [], promotions: [], products: [],
    assistant: { configured: false, baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flash", reviewTime: "21:30", autoReview: true, lastCallAt: "", messages: [], memories: [], review: null, reviews: [] },
    meta: { firstRun: true, demoInstalled: false },
    settings: { enabledModules: [], onboarded: true, goals: { annual: [], quarterly: [] } },
  });
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState<"task" | "event" | "deal" | "content" | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [composerDue, setComposerDue] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [assistantGenerating, setAssistantGenerating] = useState(false);
  const [assistantChatting, setAssistantChatting] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDeciding, setAssistantDeciding] = useState<string | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusMinutes, setFocusMinutes] = useState(30);
  const [focusClock, setFocusClock] = useState(() => Date.now());
  const [focusSaving, setFocusSaving] = useState(false);
  const focusCompleteInFlight = useRef<string | null>(null);
  const autoReviewAttempted = useRef(new Set<string>());
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error("暂时无法读取工作台");
      setData(await response.json());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(frame);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);
  // 操作提示 5 秒后自动消失，避免一直悬浮遮挡页面
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setComposer(null); setEditingTask(null); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => window.workbenchDesktop?.onNavigate((destination) => {
    if (destination === "assistant") {
      setView("today");
      setAssistantOpen(true);
      window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="给智能助理发消息"]')?.focus(), 60);
      return;
    }
    if (nav.some((item) => item.id === destination)) setView(destination as View);
  }), []);

  const activeFocus = data.focusSessions.find((session) => session.status === "active") ?? null;
  const focusRemainingSeconds = activeFocus
    ? Math.max(0, activeFocus.plannedMinutes * 60 - Math.floor((focusClock - new Date(activeFocus.startedAt).getTime()) / 1000))
    : 0;
  useEffect(() => {
    if (!activeFocus) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- seed the countdown before the first tick */
    setFocusClock(Date.now());
    const timer = window.setInterval(() => setFocusClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeFocus?.id]);
  useEffect(() => {
    if (!activeFocus || focusRemainingSeconds > 0 || focusCompleteInFlight.current === activeFocus.id) return;
    focusCompleteInFlight.current = activeFocus.id;
    void (async () => {
      try {
        const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "focus_complete", id: activeFocus.id }) });
        if (!response.ok) throw new Error("专注记录保存失败");
        await load();
        setFocusOpen(false);
        setNotice(`已记录 ${activeFocus.plannedMinutes} 分钟专注`);
        await window.workbenchDesktop?.notifyFocusComplete(activeFocus.plannedMinutes);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "专注记录保存失败");
      } finally {
        focusCompleteInFlight.current = null;
      }
    })();
  }, [activeFocus, focusRemainingSeconds, load]);

  async function startFocus() {
    setFocusSaving(true);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "focus_start", plannedMinutes: focusMinutes }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "暂时无法开始专注");
      await load();
      setFocusClock(Date.now());
      setNotice(`开始 ${focusMinutes} 分钟专注`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法开始专注");
    } finally {
      setFocusSaving(false);
    }
  }

  async function stopFocus() {
    if (!activeFocus) return;
    setFocusSaving(true);
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "focus_complete", id: activeFocus.id }) });
      const result = await response.json() as { error?: string; item?: FocusSession };
      if (!response.ok) throw new Error(result.error || "专注记录保存失败");
      await load();
      setFocusOpen(false);
      const total = focusTotal(result.item?.durationSeconds ?? 0);
      setNotice(`已记录 ${total.value} ${total.unit}专注`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "专注记录保存失败");
    } finally {
      setFocusSaving(false);
    }
  }

  const openTasks = data.tasks.filter((task) => task.status !== "done");
  async function toggleTask(task: Task) {
    const status = task.status === "done" ? "todo" : "done";
    setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status } : item) }));
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", id: task.id, status }) });
      if (!response.ok) throw new Error("保存失败");
    } catch {
      setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status: task.status } : item) }));
      setNotice("服务暂不可用，这次改动没有保存上");
    }
  }

  async function loadDemo(kind: "demo_load" | "demo_clear") {
    setDemoBusy(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "操作失败");
      await load();
      setNotice(kind === "demo_load" ? "已载入演示数据，可以在各个视图里翻看" : "演示数据已清除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "演示数据处理失败");
    } finally {
      setDemoBusy(false);
    }
  }

  async function finishSetup(modules: ModuleId[], goals?: Goals, withDemo = false, ai: { baseUrl: string; model: string; apiKey: string } | null = null): Promise<string | null> {
    const post = async (body: Record<string, unknown>) => {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "本地服务没有响应");
    };
    try {
      await post({ kind: "workspace_settings", enabledModules: modules, goals, onboarded: true });
      if (ai?.apiKey.trim()) await post({ kind: "assistant_config", baseUrl: ai.baseUrl, model: ai.model, apiKey: ai.apiKey });
      if (withDemo) await post({ kind: "demo_load" });
      await load();
      setNotice(withDemo ? "设置完成，已载入演示数据" : "设置完成，随时可以在设置页调整模块");
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "设置没有保存上";
      setNotice(message);
      return message;
    }
  }

  const generateAssistantReview = useCallback(async (periodType: ReviewPeriod = "daily", automatic = false, dataDate?: string) => {
    if (!data.assistant.configured) {
      setView("connections");
      setNotice("先在设置中配置个人助理 API Key");
      return;
    }
    setAssistantGenerating(true);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "assistant_review_generate", periodType, automatic, ...(dataDate ? { dataDate } : {}) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "个人助理复盘失败");
      await load();
      const periodLabel = periodType === "weekly" ? "本周" : periodType === "monthly" ? "本月" : "今日";
      setNotice(`${periodLabel}复盘已更新`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "个人助理复盘失败");
    } finally {
      setAssistantGenerating(false);
    }
  }, [data.assistant.configured, load]);

  async function sendAssistantMessage(message: string) {
    if (!data.assistant.configured) {
      setView("connections");
      setNotice("先在设置中配置个人助理 API Key");
      return;
    }
    setAssistantOpen(true);
    setAssistantChatting(true);
    try {
      const clientMessageId = crypto.randomUUID();
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "assistant_chat", clientMessageId, message }) });
      const result = await response.json() as { error?: string; actions?: Array<{ ok: boolean }> };
      if (!response.ok) throw new Error(result.error || "个人助理暂时没有回应");
      await load();
      if (result.actions?.some((action) => action.ok)) setNotice("个人助理已执行并更新工作台");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "个人助理暂时没有回应";
      setNotice(reason);
      throw new Error(reason);
    } finally {
      setAssistantChatting(false);
    }
  }

  async function decideAssistantActions(replyId: string, decision: "confirm" | "cancel") {
    setAssistantDeciding(replyId);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "assistant_action_decide", replyId, decision }) });
      const result = await response.json() as { error?: string; actions?: AssistantActionReceipt[] };
      if (!response.ok) throw new Error(result.error || "这次操作没有处理成功");
      await load();
      setNotice(decision === "confirm" ? "已按确认方案更新工作台" : "已取消这次操作");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "这次操作没有处理成功");
    } finally {
      setAssistantDeciding(null);
    }
  }

  async function undoAssistantAction(replyId: string, operationId: string) {
    setAssistantDeciding(operationId);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "assistant_undo", replyId, operationId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "这次撤销没有处理成功");
      await load();
      setNotice("已撤销，数据已经恢复");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "这次撤销没有处理成功");
    } finally {
      setAssistantDeciding(null);
    }
  }

  useEffect(() => {
    if (window.workbenchDesktop?.isDesktop) return;
    if (loading || !data.assistant.configured || !data.assistant.autoReview || assistantGenerating) return;
    const now = new Date();
    const [hour, minute] = data.assistant.reviewTime.split(":").map(Number);
    if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return;
    const dataDate = reviewDataDate(data.assistant.reviewTime || "21:30", now);
    const dataDateObj = new Date(`${dataDate}T12:00:00+08:00`);
    const candidates: ReviewPeriod[] = ["daily"];
    if (dataDateObj.getDay() === 0) candidates.push("weekly");
    const [dYear, dMonth, dDay] = dataDate.split("-").map(Number);
    const monthLastDay = new Date(Date.UTC(dYear, dMonth, 0)).getUTCDate();
    if (dDay === monthLastDay) candidates.push("monthly");
    const pending = candidates.find((periodType) => {
      const period = currentReviewPeriod(periodType, dataDateObj);
      const attemptKey = `${periodType}:${period.periodKey}`;
      return !data.assistant.reviews.some((review) => review.periodType === periodType && review.periodKey === period.periodKey) && !autoReviewAttempted.current.has(attemptKey);
    });
    if (!pending) return;
    const attemptKey = `${pending}:${currentReviewPeriod(pending, dataDateObj).periodKey}`;
    autoReviewAttempted.current.add(attemptKey);
    const timer = window.setTimeout(() => { void generateAssistantReview(pending, true, dataDate); }, 0);
    return () => window.clearTimeout(timer);
  }, [assistantGenerating, data.assistant.autoReview, data.assistant.configured, data.assistant.reviewTime, data.assistant.reviews, generateAssistantReview, loading]);

  const dateLabel = mounted ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()) : "";
  // Derived after mount: computing it during render makes the server and the
  // client disagree whenever a render straddles an hour boundary.
  const hour = mounted ? new Date().getHours() : -1;
  const greeting = hour < 0 ? "" : hour < 5 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  const enabled = data.settings.enabledModules;
  const visibleNav = enabled.length
    ? nav.filter((item) => item.id === "today" || item.id === "calendar" || item.id === "connections" || enabled.includes(item.id as ModuleId))
    : nav;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">{BRAND.mark}</span><span>{BRAND.name}</span></div>
        <nav aria-label="主导航">
          {visibleNav.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sync-panel connected">
          <div className="sync-title"><span className="pulse" />本地数据</div>
          <p>全部记录都存在这台设备上</p>
          <button onClick={() => setView("connections")}>打开设置 <span>→</span></button>
        </div>
        <div className="profile"><div className="avatar">{BRAND.mark}</div><div><strong>{BRAND.name}</strong><span>{BRAND.tagline}</span></div><button aria-label="打开设置" onClick={() => setView("connections")}>···</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{dateLabel}</p><h1>{view === "today" ? greeting : nav.find((item) => item.id === view)?.label}</h1></div>
          <div className="top-actions">
            <button className={activeFocus ? "focus-launch active" : "focus-launch"} onClick={() => setFocusOpen(true)} aria-label={activeFocus ? "查看正在进行的专注" : "开始专注"}>
              <span>{activeFocus ? "●" : "◉"}</span><em>{activeFocus ? `${String(Math.floor(focusRemainingSeconds / 60)).padStart(2, "0")}:${String(focusRemainingSeconds % 60).padStart(2, "0")}` : "开始专注"}</em>
            </button>
            <button className="search-button" aria-label="搜索"><span>⌕</span><em>搜索</em><kbd>⌘ K</kbd></button>
          </div>
        </header>

        {(setupOpen || !data.settings.onboarded) && !loading && (
          <SetupWizard
            assistant={data.assistant}
            onClose={() => setSetupOpen(false)}
            onFinish={(modules, goals, withDemo, ai) => finishSetup(modules, goals, withDemo, ai)}
          />
        )}

        {data.meta.firstRun && !loading && (
          <div className="workflow-alerts">
            <article className="workflow-alert">
              <span className="workflow-alert-icon">◇</span>
              <div>
                <strong>工作台还是空的</strong>
                <p>你可以直接开始添加任务和日程，也可以先载入一套虚构的演示数据，看看每个视图被用起来是什么样子。演示数据随时可以一键清除。</p>
              </div>
              <button disabled={demoBusy} onClick={() => void loadDemo("demo_load")}>{demoBusy ? "正在载入…" : "载入演示数据"}</button>
            </article>
          </div>
        )}

        {loading ? <LoadingState /> : (
          <div className="view-stage">
            {view === "today" && <TodayView events={data.events} tasks={openTasks} allTasks={data.tasks} deals={data.deals} contents={data.contents} workouts={data.workouts} cleanings={data.cleanings} goals={data.settings.goals} assistant={data.assistant} chatting={assistantChatting} assistantOpen={assistantOpen} assistantDeciding={assistantDeciding} setAssistantOpen={setAssistantOpen} sendAssistantMessage={sendAssistantMessage} decideAssistantActions={decideAssistantActions} undoAssistantAction={undoAssistantAction} openAssistantSettings={() => setView("connections")} openReviewLog={() => setView("review")} toggleTask={toggleTask} openTaskOn={(day) => { const pad = (n: number) => String(n).padStart(2, "0"); setComposerDue(`${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`); setEditingTask(null); setComposer("task"); }} openEdit={(task) => { setComposerDue(null); setEditingTask(task); setComposer("task"); }} refresh={load} notify={setNotice} />}
            {view === "calendar" && <CalendarView events={data.events} workouts={data.workouts} cleanings={data.cleanings} tasks={data.tasks} openEdit={(task) => { setComposerDue(null); setEditingTask(task); setComposer("task"); }} refresh={load} notify={setNotice} />}
            {view === "deals" && <DealWorkspaceView deals={data.deals} contents={data.contents} refresh={load} openDealComposer={() => setComposer("deal")} openContentComposer={() => setComposer("content")} notify={setNotice} />}
            {view === "expenses" && <ExpensesView expenses={data.expenses} refresh={load} notify={setNotice} />}
            {view === "health" && <HealthView ingredients={data.ingredients} workouts={data.workouts} refresh={load} notify={setNotice} />}
            {view === "platforms" && <PlatformsView promotions={data.promotions} refresh={load} notify={setNotice} />}
            {view === "products" && <ProductsView products={data.products} refresh={load} notify={setNotice} />}
            {view === "connections" && <ConnectionsView assistant={data.assistant} meta={data.meta} settings={data.settings} saveModules={finishSetup} openSetup={() => setSetupOpen(true)} demoBusy={demoBusy} onDemo={loadDemo} refresh={load} notify={setNotice} />}
            {view === "review" && <ReviewView tasks={data.tasks} events={data.events} focusSessions={data.focusSessions} assistant={data.assistant} generating={assistantGenerating} generate={(periodType) => generateAssistantReview(periodType, false, data.assistant.reviewTime === "00:00" ? reviewDataDate(data.assistant.reviewTime) : undefined)} openSettings={() => setView("connections")} />}
          </div>
        )}
      </section>

      {focusOpen && <FocusTimer active={activeFocus} remainingSeconds={focusRemainingSeconds} minutes={focusMinutes} saving={focusSaving} setMinutes={setFocusMinutes} start={() => void startFocus()} stop={() => void stopFocus()} close={() => setFocusOpen(false)} />}
      {composer && <Composer key={editingTask?.id ?? "new"} kind={composer} editingTask={editingTask} defaultDueDate={composerDue} notify={setNotice} close={() => { setComposer(null); setEditingTask(null); setComposerDue(null); }} saved={async (message) => { setComposer(null); setEditingTask(null); setComposerDue(null); await load(); setNotice(message ?? "已收入工作台"); }} />}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}
    </main>
  );
}

function FocusTimer({ active, remainingSeconds, minutes, saving, setMinutes, start, stop, close }: { active: FocusSession | null; remainingSeconds: number; minutes: number; saving: boolean; setMinutes: (minutes: number) => void; start: () => void; stop: () => void; close: () => void }) {
  const progress = active ? Math.max(0, Math.min(100, (remainingSeconds / (active.plannedMinutes * 60)) * 100)) : 100;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
    <section className={`focus-timer${active ? " running" : ""}`} role="dialog" aria-modal="true" aria-label={active ? "专注计时中" : "开始专注"}>
      <header><h2>{active ? "专注中" : "开始专注"}</h2><button onClick={close} aria-label="收起专注计时">×</button></header>
      {active ? <>
        <div className="focus-countdown">{String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}<i>:</i>{String(remainingSeconds % 60).padStart(2, "0")}</div>
        <div className="focus-progress"><i style={{ width: `${progress}%` }} /></div>
        <footer><button className="focus-secondary" onClick={close}>收起</button><button className="focus-stop" disabled={saving} onClick={stop}>{saving ? "记录中…" : "结束并记录"}</button></footer>
      </> : <>
        <div className="focus-duration">
          <button onClick={() => setMinutes(Math.max(5, minutes - 5))} disabled={minutes <= 5} aria-label="减少五分钟">−</button>
          <div><strong>{minutes}</strong><span>分钟</span></div>
          <button onClick={() => setMinutes(Math.min(180, minutes + 5))} disabled={minutes >= 180} aria-label="增加五分钟">＋</button>
        </div>
        <div className="focus-presets">{[15, 30, 45, 60].map((value) => <button className={minutes === value ? "active" : ""} key={value} onClick={() => setMinutes(value)}>{value}</button>)}</div>
        <button className="focus-start" disabled={saving} onClick={start}>{saving ? "正在开始…" : "开始"}</button>
      </>}
    </section>
  </div>;
}

function LoadingState() {
  return <div className="loading-state"><div className="loading-line wide" /><div className="loading-grid"><div /><div /><div /></div><p>正在整理今天的时间…</p></div>;
}

function toDueIso(day: Date) {
  const d = new Date(day); d.setHours(18, 0, 0, 0);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

type CalendarDragItem = { kind: "task" | "event" | "workout" | "cleaning"; id: string; label: string };
type CalendarDropTarget = { dateKey: string; minuteOfDay: number | null };

function useCalendarPointerDrag(onDrop: (item: CalendarDragItem, target: CalendarDropTarget) => void | Promise<void>) {
  const onDropRef = useRef(onDrop);
  const dragRef = useRef<{ item: CalendarDragItem; pointerId: number; startX: number; startY: number; source: HTMLElement; moved: boolean; grabOffsetMinutes: number } | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [visual, setVisual] = useState<{ label: string; x: number; y: number } | null>(null);

  useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);
  useEffect(() => {
    const clearTarget = () => {
      targetRef.current?.classList.remove("drag-over");
      targetRef.current?.style.removeProperty("--calendar-drop-y");
      if (targetRef.current) delete targetRef.current.dataset.calendarDropMinute;
      targetRef.current = null;
    };
    const cleanup = () => {
      const drag = dragRef.current;
      clearTarget();
      drag?.source.classList.remove("dragging");
      if (drag) {
        try { drag.source.releasePointerCapture(drag.pointerId); } catch { /* pointer may already be released */ }
      }
      dragRef.current = null;
      setVisual(null);
    };
    const findTarget = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-calendar-drop-date]") ?? null;
    const updateTarget = (next: HTMLElement | null, pointerY: number) => {
      if (next !== targetRef.current) {
        clearTarget();
        targetRef.current = next;
        next?.classList.add("drag-over");
      }
      if (!next) return;
      const startHour = Number(next.dataset.calendarDropStartHour);
      const endHour = Number(next.dataset.calendarDropEndHour);
      if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
        delete next.dataset.calendarDropMinute;
        next.style.removeProperty("--calendar-drop-y");
        return;
      }
      const rect = next.getBoundingClientRect();
      const rangeMinutes = (endHour - startHour) * 60;
      const rawMinutes = ((pointerY - rect.top) / Math.max(1, rect.height)) * rangeMinutes - (dragRef.current?.grabOffsetMinutes ?? 0);
      const snapped = Math.round(rawMinutes / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES;
      const minuteOfDay = Math.max(startHour * 60, Math.min(endHour * 60 - CALENDAR_SNAP_MINUTES, startHour * 60 + snapped));
      const indicatorY = ((minuteOfDay - startHour * 60) / rangeMinutes) * rect.height;
      next.dataset.calendarDropMinute = String(minuteOfDay);
      next.style.setProperty("--calendar-drop-y", `${indicatorY}px`);
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.source.classList.add("dragging");
        try { drag.source.setPointerCapture(drag.pointerId); } catch { /* capture is optional */ }
      }
      event.preventDefault();
      setVisual({ label: drag.item.label, x: event.clientX, y: event.clientY });
      updateTarget(findTarget(event.clientX, event.clientY), event.clientY);
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.moved) {
        event.preventDefault();
        suppressClickUntilRef.current = performance.now() + 500;
        const target = targetRef.current;
        const dateKey = target?.dataset.calendarDropDate ?? "";
        const minuteValue = target?.dataset.calendarDropMinute;
        if (dateKey) void onDropRef.current(drag.item, { dateKey, minuteOfDay: minuteValue === undefined ? null : Number(minuteValue) });
      }
      cleanup();
    };
    const cancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) cleanup();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish, { passive: false });
    document.addEventListener("pointercancel", cancel);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      cleanup();
    };
  }, []);

  return {
    visual,
    begin(item: CalendarDragItem, event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || dragRef.current) return;
      const source = event.currentTarget;
      const timeBlock = source.closest<HTMLElement>(".calendar-time-block");
      const grabOffsetMinutes = timeBlock ? Math.max(0, (event.clientY - timeBlock.getBoundingClientRect().top) * 60 / CALENDAR_HOUR_HEIGHT) : 0;
      dragRef.current = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, source, moved: false, grabOffsetMinutes };
    },
    suppressClick() { return performance.now() < suppressClickUntilRef.current; },
  };
}

function CalendarDragGhost({ visual }: { visual: { label: string; x: number; y: number } | null }) {
  if (!visual) return null;
  return <div className="calendar-drag-ghost" style={{ left: visual.x + 12, top: visual.y + 12 }}>{visual.label}</div>;
}

type CalendarResizeItem = CalendarDragItem & { startAt: string; durationMinutes: number; visibleMinutes: number; maxDurationMinutes: number };

function useCalendarResize(onResize: (item: CalendarResizeItem, durationMinutes: number) => void | Promise<void>) {
  const onResizeRef = useRef(onResize);
  const resizeRef = useRef<{ item: CalendarResizeItem; pointerId: number; startY: number; source: HTMLElement; durationMinutes: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [visual, setVisual] = useState<{ minutes: number; x: number; y: number } | null>(null);

  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => {
    const cleanup = () => {
      const resize = resizeRef.current;
      resize?.source.classList.remove("resizing");
      resize?.source.style.removeProperty("height");
      resizeRef.current = null;
      setVisual(null);
    };
    const move = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || event.pointerId !== resize.pointerId) return;
      event.preventDefault();
      const rawDelta = ((event.clientY - resize.startY) / CALENDAR_HOUR_HEIGHT) * 60;
      const snappedDuration = Math.round((resize.item.durationMinutes + rawDelta) / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES;
      const durationMinutes = Math.max(CALENDAR_SNAP_MINUTES, Math.min(resize.item.maxDurationMinutes, snappedDuration));
      resize.durationMinutes = durationMinutes;
      const visibleDelta = durationMinutes - resize.item.durationMinutes;
      const visibleMinutes = Math.max(CALENDAR_SNAP_MINUTES, resize.item.visibleMinutes + visibleDelta);
      resize.source.style.height = `${Math.max(24, visibleMinutes * CALENDAR_HOUR_HEIGHT / 60 - 2)}px`;
      setVisual({ minutes: durationMinutes, x: event.clientX, y: event.clientY });
    };
    const finish = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || event.pointerId !== resize.pointerId) return;
      event.preventDefault();
      suppressClickUntilRef.current = performance.now() + 500;
      if (resize.durationMinutes !== resize.item.durationMinutes) void onResizeRef.current(resize.item, resize.durationMinutes);
      cleanup();
    };
    const cancel = (event: PointerEvent) => {
      if (resizeRef.current?.pointerId === event.pointerId) cleanup();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish, { passive: false });
    document.addEventListener("pointercancel", cancel);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      cleanup();
    };
  }, []);

  return {
    visual,
    begin(item: CalendarResizeItem, event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || resizeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const source = event.currentTarget.closest<HTMLElement>(".calendar-time-block");
      if (!source) return;
      resizeRef.current = { item, pointerId: event.pointerId, startY: event.clientY, source, durationMinutes: item.durationMinutes };
      source.classList.add("resizing");
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    },
    suppressClick() { return performance.now() < suppressClickUntilRef.current; },
  };
}

function CalendarResizeBubble({ visual }: { visual: { minutes: number; x: number; y: number } | null }) {
  if (!visual) return null;
  return <div className="calendar-resize-bubble" style={{ left: visual.x + 12, top: visual.y - 12 }}>{durationText(visual.minutes)}</div>;
}

function GoalsEditor({ goals, busy, onSave, notify }: { goals: Goals; busy: boolean; onSave: (goals: Goals) => Promise<string | null>; notify: (message: string) => void }) {
  const [annual, setAnnual] = useState(goals.annual.join("\n"));
  const [quarterly, setQuarterly] = useState(goals.quarterly.join("\n"));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        annual: annual.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
        quarterly: quarterly.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
      });
      notify("目标已保存");
    } catch {
      notify("目标没有保存上");
    } finally {
      setSaving(false);
    }
  }

  return <div className="goals-editor">
    <label className="setup-field">年度计划<textarea rows={3} value={annual} disabled={busy || saving} onChange={(event) => setAnnual(event.target.value)} placeholder="一行一个" /></label>
    <label className="setup-field">本季度重点<textarea rows={3} value={quarterly} disabled={busy || saving} onChange={(event) => setQuarterly(event.target.value)} placeholder="一行一个" /></label>
    <div className="goals-editor-actions"><button className="connection-action" disabled={busy || saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存目标"}</button></div>
  </div>;
}

function GoalCard({ title, items, empty, onEdit }: { title: string; items: string[]; empty: string; onEdit?: () => void }) {
  return <article className="range-card">
    <h3>{title}</h3>
    {items.length ? <ul className="range-list">{items.map((item) => <li key={item}><strong>{item}</strong></li>)}</ul>
      : <p className="range-empty">{empty}{onEdit && <button type="button" onClick={onEdit}>现在写下</button>}</p>}
  </article>;
}

function TodayView({ events, tasks, allTasks, deals, contents, workouts, cleanings, goals, assistant, chatting, assistantOpen, assistantDeciding, setAssistantOpen, sendAssistantMessage, decideAssistantActions, undoAssistantAction, openAssistantSettings, openReviewLog, toggleTask, openTaskOn, openEdit, refresh, notify }: { events: Event[]; tasks: Task[]; allTasks: Task[]; deals: Deal[]; contents: ContentItem[]; workouts: Workout[]; cleanings: CleaningMark[]; goals: Goals; assistant: AssistantState; chatting: boolean; assistantOpen: boolean; assistantDeciding: string | null; setAssistantOpen: (open: boolean) => void; sendAssistantMessage: (message: string) => Promise<void>; decideAssistantActions: (replyId: string, decision: "confirm" | "cancel") => Promise<void>; undoAssistantAction: (replyId: string, operationId: string) => Promise<void>; openAssistantSettings: () => void; openReviewLog: () => void; toggleTask: (task: Task) => void; openTaskOn: (day: Date) => void; openEdit: (task: Task) => void; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); }, []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today); monday.setDate(today.getDate() + mondayOffset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const weekStartDate = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(monday);
  const weekEndDate = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(sunday);
  const weekNumber = (() => { const jan1 = new Date(monday.getFullYear(), 0, 1); return Math.ceil(((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7); })();
  const monthLabel = new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(today);

  const activeTasks = tasks.filter((t) => t.status !== "done");
  const isToday = (d: Date) => d.toDateString() === today.toDateString();
  const todayKey = localDateKey(today);
  const taskPriorityWeight: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortTasksForDay = (items: Task[], day: Date) => [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : -1;
    if (isToday(day)) {
      const aRank = a.assistantRankDate === todayKey ? a.assistantRank ?? 999 : 999;
      const bRank = b.assistantRankDate === todayKey ? b.assistantRank ?? 999 : 999;
      if (aRank !== bRank) return aRank - bRank;
    }
    const priorityGap = (taskPriorityWeight[a.priority] ?? 1) - (taskPriorityWeight[b.priority] ?? 1);
    return priorityGap || String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""));
  });

  const isPast = (d: Date) => d.getTime() < today.getTime();
  const md = (d: Date) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(d);

  const [dayOffset, setDayOffset] = useState(0);
  const viewDays = Array.from({ length: 5 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + dayOffset + i); return d; });
  const viewByDay = viewDays.map((day) => ({ day, tasks: sortTasksForDay(allTasks.filter((t) => t.dueDate && sameDay(t.dueDate, day)), day) }));
  const unscheduledTasks = activeTasks.filter((t) => !t.dueDate);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime();
  const inMonth = (value: string | null) => !!value && new Date(value).getTime() >= monthStart && new Date(value).getTime() < monthEnd;

  const contentsMonth = contents.filter((item) => inMonth(item.modifiedAt)).length;
  const workoutsMonth = workouts.filter((workout) => inMonth(workout.startedAt));

  const cnMonth = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;
  const thisMonthLabel = cnMonth(today);
  const prevMonthLabel = cnMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const workoutDays = workoutsMonth.length;
  const obCount = contentsMonth;
  const completedDeals = deals.filter((deal) => (deal.stage === "delivery" || deal.stage === "paid") && deal.month === thisMonthLabel).length;
  const sumPriceByMonth = (label: string) => deals.filter((deal) => deal.month === label).reduce((sum, deal) => sum + (deal.price ?? 0), 0);
  const lastMonthAmount = sumPriceByMonth(prevMonthLabel);
  const thisMonthAmount = sumPriceByMonth(thisMonthLabel);
  const totalAmount = deals.reduce((sum, deal) => sum + (deal.price ?? 0), 0);

  async function moveTaskToDay(day: Date, id: string) {
    const task = allTasks.find((item) => item.id === id);
    if (!task || (task.dueDate && sameDay(task.dueDate, day))) return;
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", id, dueDate: toDueIso(day), autoSchedule: true }) });
      if (!response.ok) throw new Error("保存失败");
      await refresh();
      notify(`已挪到${isToday(day) ? "今天" : new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(day)}`);
    } catch {
      notify("移动失败：服务暂不可用，请稍后重试");
    }
  }
  const dayPointerDrag = useCalendarPointerDrag(async (item, target) => {
    if (item.kind !== "task") return;
    await moveTaskToDay(new Date(`${target.dateKey}T12:00:00`), item.id);
  });

  const workoutOn = (day: Date) => workouts.some((workout) => sameDay(workout.startedAt, day));
  async function toggleWorkout(day: Date) {
    const existing = workouts.find((workout) => sameDay(workout.startedAt, day));
    try {
      if (existing) {
        const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "workout", id: existing.id }) });
        if (!response.ok) throw new Error("取消记录失败");
      } else {
        const startedAt = new Date(day);
        startedAt.setHours(18, 0, 0, 0);
        const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "workout", type: "健身", startedAt: startedAt.toISOString(), durationMinutes: 120, intensity: "中等" }) });
        if (!response.ok) throw new Error("记录训练失败");
      }
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  }

  const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isCleaningDay = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
  const cleaningMiss = (d: Date) => cleanings.find((mark) => mark.date === dateKey(d) && mark.kind === "missed");
  const cleaningExtra = (d: Date) => cleanings.find((mark) => mark.date === dateKey(d) && mark.kind === "extra");
  async function toggleCleaning(day: Date) {
    const existing = cleaningMiss(day);
    try {
      if (existing) {
        const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "cleaning", id: existing.id }) });
        if (!response.ok) throw new Error("取消标记失败");
      } else {
        const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "cleaning", date: dateKey(day) }) });
        if (!response.ok) throw new Error("标记失败");
      }
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  }
  async function toggleCleaningExtra(day: Date) {
    const existing = cleaningExtra(day);
    try {
      if (existing) {
        const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "cleaning", id: existing.id }) });
        if (!response.ok) throw new Error("取消补班失败");
      } else {
        const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "cleaning", date: dateKey(day), extra: true }) });
        if (!response.ok) throw new Error("添加补班失败");
      }
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  }
  const monthKey = dateKey(today).slice(0, 7);
  const cleaningMissed = cleanings.filter((mark) => mark.date.startsWith(monthKey) && mark.kind === "missed").length;
  const cleaningExtraCount = cleanings.filter((mark) => mark.date.startsWith(monthKey) && mark.kind === "extra").length;
  const cleaningExpected = (() => { const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); let count = 0; for (let d = 1; d <= last; d++) { const wd = new Date(today.getFullYear(), today.getMonth(), d).getDay(); if (wd >= 1 && wd <= 5) count++; } return count; })();

  if (!mounted) return <section className="week-planner" aria-busy="true"><div className="range-row"><div className="range-card"><h3>年度计划</h3></div><div className="range-card"><h3>本季度重点</h3></div></div></section>;

  return <section className="week-planner">
    <CalendarDragGhost visual={dayPointerDrag.visual} />
    <AssistantConversation assistant={assistant} chatting={chatting} open={assistantOpen} deciding={assistantDeciding} setOpen={setAssistantOpen} send={sendAssistantMessage} decide={decideAssistantActions} undo={undoAssistantAction} openSettings={openAssistantSettings} openReviews={openReviewLog} />

    <header className="week-header">
      <div className="week-title-row"><h2>本周 W{weekNumber}</h2><time>{weekStartDate} — {weekEndDate}</time></div>
      <div className="day-pager">
        <button className="pager-button" disabled={dayOffset <= -7} onClick={() => setDayOffset((value) => Math.max(-7, value - 1))} aria-label="往前翻一天">‹</button>
        <span>{md(viewDays[0])} — {md(viewDays[4])}</span>
        <button className="pager-button" disabled={dayOffset === 0} onClick={() => setDayOffset(0)}>回到今天</button>
        <button className="pager-button" disabled={dayOffset >= 7} onClick={() => setDayOffset((value) => Math.min(7, value + 1))} aria-label="往后翻一天">›</button>
      </div>
    </header>
    <div className="day-columns">
      {viewByDay.map(({ day, tasks: dayTasks }) => (
        <article key={day.toISOString()} className={`day-card ${isToday(day) ? "today" : ""} ${isPast(day) && !isToday(day) ? "past" : ""}`} data-calendar-drop-date={localDateKey(day)}>
          <header><strong>{isToday(day) ? "今天" : new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(day)}</strong><time>{md(day)}</time></header>
          <div className="day-tasks">
            {dayTasks.map((task) => (
              <div key={task.id} className="day-task" data-calendar-draggable="true" role="button" tabIndex={0} onPointerDown={(event) => dayPointerDrag.begin({ kind: "task", id: task.id, label: task.title }, event)} onClick={(event) => { if (dayPointerDrag.suppressClick()) { event.preventDefault(); event.stopPropagation(); return; } openEdit(task); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEdit(task); } }} title={task.assistantRankDate === todayKey && task.assistantReason ? task.assistantReason : "点击编辑 · 拖动可挪日期"}>
                <span className={`day-task-check ${task.status === "done" ? "checked" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleTask(task); }}>{task.status === "done" ? "✓" : ""}</span>
                <span className={task.status === "done" ? "done" : ""}>{task.assistantRankDate === todayKey && task.assistantRank && <em className="assistant-rank">{task.assistantRank}</em>}{calendarStartForTask(task) && <em className="task-time">{time(calendarStartForTask(task)!)}</em>}{task.title}</span>
              </div>
            ))}
            {events.filter((event) => sameDay(event.startAt, day)).sort((a, b) => a.startAt.localeCompare(b.startAt)).map((event) => (
              <div key={event.id} className="day-event" title="日历日程">
                <span>{time(event.startAt)}</span>
                <em>{event.title}</em>
              </div>
            ))}
            <label className={`day-task workout-item ${workoutOn(day) ? "done" : ""}`} onClick={() => void toggleWorkout(day)}>
              <span className={`day-task-check workout-check ${workoutOn(day) ? "checked" : ""}`}>{workoutOn(day) ? "✓" : ""}</span>
              <span className={workoutOn(day) ? "done" : ""}>健身</span>
            </label>
            {isCleaningDay(day) ? (
              <label className={`day-task cleaning-item ${cleaningMiss(day) ? "missed" : ""}`} onClick={() => void toggleCleaning(day)} title="点击标记 / 取消「阿姨未到」">
                <span className={`day-task-check cleaning-check ${cleaningMiss(day) ? "" : "checked"}`}>{cleaningMiss(day) ? "" : "✓"}</span>
                <span className={cleaningMiss(day) ? "done" : ""}>保洁 {CLEANING_TIME}{cleaningMiss(day) ? " · 未到" : ""}</span>
              </label>
            ) : (
              <label className={`day-task cleaning-item ${cleaningExtra(day) ? "" : "cleaning-extra"}`} onClick={() => void toggleCleaningExtra(day)} title="点击添加 / 取消周末保洁补班">
                <span className={`day-task-check cleaning-check ${cleaningExtra(day) ? "checked" : ""}`}>{cleaningExtra(day) ? "✓" : ""}</span>
                <span className={cleaningExtra(day) ? "done" : ""}>保洁 {CLEANING_TIME} · 补班</span>
              </label>
            )}
            {!dayTasks.length && !workoutOn(day) && !events.some((event) => sameDay(event.startAt, day)) && <p className="day-empty">—</p>}
          </div>
          <button className="day-add" onClick={() => openTaskOn(day)}>+</button>
        </article>
      ))}
    </div>

    {unscheduledTasks.length > 0 && (
      <section className="unscheduled-panel">
        <p className="section-kicker">待安排</p>
        <div className="unscheduled-list">
          {unscheduledTasks.map((task) => (
            <span key={task.id} className={`unscheduled-tag ${task.priority}`} onClick={() => openEdit(task)} title="点击安排时间">{task.title}</span>
          ))}
        </div>
      </section>
    )}

    <div className="range-row secondary-goals">
      <GoalCard title="年度计划" items={goals.annual} empty="还没有写下的年度计划" />
      <GoalCard title={`本季度重点 · ${currentQuarterLabel(today)}`} items={goals.quarterly} empty="还没有写下的季度重点" onEdit={openAssistantSettings} />
    </div>

    <header className="month-head">
      <h2>{monthLabel} 概览</h2>
    </header>
    <div className="month-summary-grid">
      <article className="month-summary-card"><p className="summary-label">身体节奏</p><div className="summary-big">{workoutDays}<small>天</small></div><p className="summary-sub">本月训练天数</p></article>
      <article className="month-summary-card"><p className="summary-label">内容产出</p><div className="summary-row"><div className="summary-half"><span>{obCount}</span><small>篇笔记</small></div><div className="summary-half"><span>{completedDeals}</span><small>完成商单</small></div></div></article>
      <article className="month-summary-card"><p className="summary-label">商单金额</p><div className="summary-money"><div><span className="money-label">上月</span><strong>¥{lastMonthAmount.toLocaleString("zh-CN")}</strong></div><div><span className="money-label">本月</span><strong>¥{thisMonthAmount.toLocaleString("zh-CN")}</strong></div><div><span className="money-label">总计</span><strong>¥{totalAmount.toLocaleString("zh-CN")}</strong></div></div></article>
      <article className="month-summary-card"><p className="summary-label">保洁结算</p><div className="summary-big">{Math.max(0, cleaningExpected - cleaningMissed) + cleaningExtraCount}<small>天</small></div><p className="summary-sub">本月应来 {cleaningExpected} 天 · 缺勤 {cleaningMissed} 天 · 补班 {cleaningExtraCount} 天</p></article>
    </div>
  </section>;
}

function assistantInlineMarkdown(text: string, keyPrefix: string) {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g);
  return tokens.map((token, index) => {
    const key = `${keyPrefix}:${index}`;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={key}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={key}>{token.slice(1, -1)}</code>;
    const link = token.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return token;
  });
}

function AssistantMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={`heading:${index}`}>{assistantInlineMarkdown(heading[2], `heading:${index}`)}</h3>);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const value = lines[index].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={`ul:${index}`}>{assistantInlineMarkdown(value, `ul:${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-block:${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const value = lines[index].replace(/^\s*\d+[.)]\s+/, "");
        items.push(<li key={`ol:${index}`}>{assistantInlineMarkdown(value, `ol:${index}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-block:${index}`}>{items}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={`quote:${index}`}>{assistantInlineMarkdown(line.replace(/^>\s?/, ""), `quote:${index}`)}</blockquote>);
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+|^>\s?/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph:${index}`}>{paragraph.map((value, lineIndex) => <span key={`line:${index}:${lineIndex}`}>{lineIndex > 0 && <br />}{assistantInlineMarkdown(value, `paragraph:${index}:${lineIndex}`)}</span>)}</p>);
  }
  return <div className="assistant-markdown">{blocks}</div>;
}

function AssistantConversation({ assistant, chatting, open, deciding, setOpen, send, decide, undo, openSettings, openReviews }: { assistant: AssistantState; chatting: boolean; open: boolean; deciding: string | null; setOpen: (open: boolean) => void; send: (message: string) => Promise<void>; decide: (replyId: string, decision: "confirm" | "cancel") => Promise<void>; undo: (replyId: string, operationId: string) => Promise<void>; openSettings: () => void; openReviews: () => void }) {
  const [message, setMessage] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [sendError, setSendError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const visible = assistant.messages.slice(-30);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, visible.length, chatting, pendingMessage, sendError]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = message.trim();
    if (!next || chatting) return;
    setMessage("");
    setPendingMessage(next);
    setSendError("");
    setOpen(true);
    try {
      await send(next);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "刚才没有收到回答，请再试一次");
    } finally {
      setPendingMessage("");
    }
  }
  const form = (className: string) => <form className={className} onSubmit={submit}>
    <input value={message} onChange={(event) => setMessage(event.target.value)} disabled={!assistant.configured || chatting} placeholder={assistant.configured ? "问个问题，或交代一件事" : "先在设置中配置 API Key"} aria-label="给智能助理发消息" />
    <button disabled={!assistant.configured || chatting || !message.trim()}>{chatting ? "思考中…" : "发送"}</button>
  </form>;
  return <>
    <section className="assistant-entry">
      <header><div className="assistant-title"><div className="assistant-avatar">助</div><h2>智能助理</h2></div><div className="assistant-header-actions">{!assistant.configured && <button className="assistant-config-link" onClick={openSettings}>接入 API Key</button>}<button className="assistant-log-link" onClick={() => setOpen(true)}>对话{assistant.messages.length ? ` · ${Math.ceil(assistant.messages.length / 2)}` : ""}</button></div></header>
      {form("assistant-entry-form")}
    </section>
    {open && <><button className="assistant-drawer-backdrop" aria-label="关闭助理对话" onClick={() => setOpen(false)} /><aside className="assistant-drawer" role="dialog" aria-modal="true" aria-label="智能助理对话">
      <header><div className="assistant-title"><div className="assistant-avatar">助</div><div><h2>智能助理</h2><span>{assistant.memories.length} 条长期记忆</span></div></div><div className="assistant-header-actions"><button className="assistant-log-link" onClick={openReviews}>复盘日志</button><button className="assistant-drawer-close" aria-label="关闭" onClick={() => setOpen(false)}>×</button></div></header>
      <div className="assistant-drawer-messages" ref={messagesRef} aria-live="polite">{visible.map((item) => {
        const receipts = item.actions ?? [];
        const pending = receipts.some((receipt) => receipt.state === "pending");
        return <article className={`assistant-message ${item.role}`} key={item.id}><span>{item.role === "assistant" ? "助" : "你"}</span><div><div className="assistant-message-copy"><AssistantMarkdown content={item.content} /></div>{item.role === "assistant" && <footer className="assistant-receipts">{receipts.length === 0 ? <small className="assistant-answer-only">仅回答 · 未修改工作台</small> : receipts.map((receipt, index) => { const state = receipt.state ?? (receipt.ok ? "done" : "failed"); return <span className="assistant-receipt-row" key={`${item.id}:receipt:${index}`}><small className={`assistant-receipt ${state}`}>{receipt.label}</small>{receipt.undoId && state === "done" && <button className="assistant-undo" disabled={deciding === receipt.undoId} onClick={() => void undo(item.id, receipt.undoId!)}>{deciding === receipt.undoId ? "撤销中…" : "撤销"}</button>}</span>; })}{pending && <div className="assistant-confirm-actions"><button disabled={deciding === item.id} onClick={() => void decide(item.id, "cancel")}>取消</button><button disabled={deciding === item.id} onClick={() => void decide(item.id, "confirm")}>{deciding === item.id ? "处理中…" : "确认执行"}</button></div>}</footer>}</div></article>;
      })}{pendingMessage && <article className="assistant-message user pending-message"><span>你</span><div><div className="assistant-message-copy"><AssistantMarkdown content={pendingMessage} /></div></div></article>}{(chatting || pendingMessage) && <article className="assistant-message assistant thinking" aria-label="智能助理正在想一下"><span>助</span><div><div className="assistant-message-copy"><div className="assistant-thinking"><i /><i /><i /><b>正在想一下</b></div></div></div></article>}{sendError && !chatting && <article className="assistant-message assistant error"><span>助</span><div><div className="assistant-message-copy"><p>{sendError}</p></div></div></article>}</div>
      {form("assistant-drawer-form")}
    </aside></>}
  </>;
}


function CalendarView({ events, workouts, cleanings, tasks, openEdit, refresh, notify }: { events: Event[]; workouts: Workout[]; cleanings: CleaningMark[]; tasks: Task[]; openEdit: (task: Task) => void; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const start = new Date();
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const md = (d: Date) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(d);
  const weekEnd = new Date(start); weekEnd.setDate(start.getDate() + 6);
  const eventIds = new Set(events.map((item) => item.id));
  const toLocalIso = (d: Date) => { const p = (n: number) => String(n).padStart(2, "0"); const offset = -d.getTimezoneOffset(); const sign = offset >= 0 ? "+" : "-"; const abs = Math.abs(offset); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`; };
  const pad = (n: number) => String(n).padStart(2, "0");
  const CLEANING_DEFAULT_START = 10 * 60;
  const CLEANING_DEFAULT_END = 12 * 60;
  const cleaningHoursFor = (day: Date) => {
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    const hoursMark = cleanings.find((mark) => mark.date === key && mark.kind === "hours" && mark.startMinutes !== null && mark.endMinutes !== null);
    if (hoursMark) return { key, startMinutes: hoursMark.startMinutes!, endMinutes: hoursMark.endMinutes!, custom: true };
    // 该日期的默认块已被移走时，拖动时长以原默认 2 小时计。
    return { key, startMinutes: CLEANING_DEFAULT_START, endMinutes: CLEANING_DEFAULT_END, custom: false };
  };
  async function moveCleaningTo(day: Date, minuteOfDay: number, label: string, sourceId: string) {
    const hours = cleaningHoursFor(day);
    const sourceDate = /^cleaning-(\d{4}-\d{2}-\d{2})$/.exec(sourceId)?.[1] ?? "";
    const sameDayMove = !sourceDate || sourceDate === hours.key;
    const durationMinutes = hours.endMinutes - hours.startMinutes;
    const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    const startMinutes = minuteOfDay;
    const endMinutes = Math.min(23 * 60 + 59, minuteOfDay + durationMinutes);
    if (sameDayMove && hours.custom && hours.startMinutes === startMinutes && hours.endMinutes === endMinutes) return;
    try {
      const body: Record<string, unknown> = { kind: "cleaning", id: `cleaning-${hours.key}`, startMinutes, endMinutes };
      if (!sameDayMove) body.fromDate = sourceDate;
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("保存失败");
      await refresh();
      notify(sameDayMove
        ? `已将「${label}」移到${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(day)} ${clock(startMinutes)}`
        : `已将「${label}」移到${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(day)} ${clock(startMinutes)}`);
    } catch {
      notify("移动失败：服务暂不可用，请稍后重试");
    }
  }
  async function moveToCell(item: CalendarDragItem, day: Date, minuteOfDay: number) {
    const nextStart = new Date(day); nextStart.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
    const timeLabel = time(nextStart.toISOString());
    if (item.kind === "task") {
      const target = tasks.find((task) => task.id === item.id);
      if (!target) return;
      const currentStart = calendarStartForTask(target);
      if (currentStart) {
        const current = new Date(currentStart);
        if (sameDay(currentStart, day) && current.getHours() * 60 + current.getMinutes() === minuteOfDay) return;
      }
      try {
        const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", id: item.id, dueDate: toDueIso(day), scheduledStart: toLocalIso(nextStart) }) });
        if (!response.ok) throw new Error("保存失败");
        await refresh();
        notify(`已将「${target.title}」移到${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(day)} ${timeLabel}`);
      } catch {
        notify("移动失败：服务暂不可用，请稍后重试");
      }
      return;
    }
    if (item.kind === "workout") {
      const target = workouts.find((workout) => workout.id === item.id);
      if (!target) return;
      const current = new Date(target.startedAt);
      if (sameDay(target.startedAt, day) && current.getHours() * 60 + current.getMinutes() === minuteOfDay) return;
      try {
        const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "workout", id: item.id, startedAt: toLocalIso(nextStart) }) });
        if (!response.ok) throw new Error("保存失败");
        await refresh();
        notify(`已将「${item.label}」移到${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(day)} ${timeLabel}`);
      } catch {
        notify("移动失败：服务暂不可用，请稍后重试");
      }
      return;
    }
    const target = events.find((event) => event.id === item.id);
    if (!target) return;
    const oldStart = new Date(target.startAt);
    if (sameDay(target.startAt, day) && oldStart.getHours() * 60 + oldStart.getMinutes() === minuteOfDay) return;
    const minutes = Math.max(30, Math.round((new Date(target.endAt).getTime() - oldStart.getTime()) / 60000));
    const nextEnd = new Date(nextStart.getTime() + minutes * 60000);
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "event", id: item.id, startAt: toLocalIso(nextStart), endAt: toLocalIso(nextEnd) }) });
      if (!response.ok) throw new Error("保存失败");
      await refresh();
      notify(`已将「${target.title}」移到${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(day)} ${timeLabel}`);
    } catch {
      notify("移动失败：服务暂不可用，请稍后重试");
    }
  }
  const calendarPointerDrag = useCalendarPointerDrag(async (item, target) => {
    if (target.minuteOfDay === null) return;
    if (item.kind === "cleaning") {
      await moveCleaningTo(new Date(`${target.dateKey}T12:00:00`), target.minuteOfDay, item.label, item.id);
      return;
    }
    await moveToCell(item, new Date(`${target.dateKey}T12:00:00`), target.minuteOfDay);
  });
  const cleaningDays = days.filter((day) => {
    const key = localDateKey(day);
    // 默认周一至周五渲染保洁块；有自定义时间（hours）、已移走（moved）或补班（extra）的日期也渲染，周末拖入照样显示。
    if (day.getDay() >= 1 && day.getDay() <= 5) return true;
    return cleanings.some((mark) => mark.date === key && (mark.kind === "hours" || mark.kind === "moved" || mark.kind === "extra"));
  });
  const cleaningItems: Event[] = cleaningDays.map((day) => {
    const hours = cleaningHoursFor(day);
    const key = localDateKey(day);
    const movedAway = cleanings.some((mark) => mark.date === key && mark.kind === "moved");
    const extra = !movedAway && cleanings.some((mark) => mark.date === key && mark.kind === "extra");
    const missed = !movedAway && !extra && cleanings.some((mark) => mark.date === key && mark.kind === "missed");
    const startDate = new Date(day); startDate.setHours(Math.floor(hours.startMinutes / 60), hours.startMinutes % 60, 0, 0);
    const endDate = new Date(day); endDate.setHours(Math.floor(hours.endMinutes / 60), hours.endMinutes % 60, 0, 0);
    const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    return { id: `cleaning-${key}`, title: movedAway ? "保洁 · 已移走" : missed ? "保洁 · 未到" : extra ? "保洁 · 补班" : "保洁阿姨", startAt: startDate.toISOString(), endAt: endDate.toISOString(), category: movedAway ? "cleaning-moved" : missed ? "cleaning-missed" : extra ? "cleaning-extra" : "cleaning", location: `${clock(hours.startMinutes)}–${clock(hours.endMinutes)}`, source: "cleaning" };
  });
  const taskItems: Event[] = tasks.flatMap((task) => {
    const startAt = calendarStartForTask(task);
    if (!startAt) return [];
    const endAt = new Date(new Date(startAt).getTime() + Math.max(5, task.estimatedMinutes) * 60000).toISOString();
    return [{ id: `task-${task.id}`, title: task.title, startAt, endAt, category: task.status === "done" ? "task-done" : "task", location: task.project, source: "task" }];
  });
  const calendarItems: Event[] = [...events, ...workouts.map((workout) => ({
    id: workout.id, title: `训练 · ${workout.type}`, startAt: workout.startedAt,
    endAt: new Date(new Date(workout.startedAt).getTime() + workout.durationMinutes * 60000).toISOString(),
    category: "health", location: `${workout.durationMinutes} 分钟 · ${workout.intensity}`, source: "workspace-health",
  })), ...cleaningItems, ...taskItems];
  async function resizeCalendarItem(item: CalendarResizeItem, durationMinutes: number) {
    try {
      let payload: Record<string, unknown>;
      if (item.kind === "task") {
        payload = { kind: "task", id: item.id, estimatedMinutes: durationMinutes };
      } else if (item.kind === "workout") {
        payload = { kind: "workout", id: item.id, durationMinutes };
      } else {
        const target = events.find((event) => event.id === item.id);
        if (!target) return;
        payload = { kind: "event", id: item.id, startAt: target.startAt, endAt: new Date(new Date(target.startAt).getTime() + durationMinutes * 60000).toISOString() };
      }
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("保存失败");
      await refresh();
      notify(`已将「${item.label}」调整为${durationText(durationMinutes)}`);
    } catch {
      notify("调整失败：服务暂不可用，请稍后重试");
    }
  }
  const calendarResize = useCalendarResize(resizeCalendarItem);
  const calendarLayouts = days.map((day) => ({
    day,
    items: layoutCalendarDay(calendarItems.filter((item) => sameDay(item.startAt, day)), CALENDAR_START_HOUR, CALENDAR_END_HOUR),
  }));
  const calendarHours = Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1 }, (_, index) => CALENDAR_START_HOUR + index);
  const trackHeight = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT;
  return <section className="panel calendar-panel">
    <CalendarDragGhost visual={calendarPointerDrag.visual} />
    <CalendarResizeBubble visual={calendarResize.visual} />
    <div className="panel-heading"><h2>{weekOffset === 0 ? "本周日历" : "周日历"}</h2><div className="calendar-actions"><button onClick={() => setWeekOffset((value) => value - 1)} aria-label="上一周">‹</button><span>{md(start)} – {md(weekEnd)}</span><button onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>今天</button><button onClick={() => setWeekOffset((value) => value + 1)} aria-label="下一周">›</button></div></div>
    <div className="calendar-scroll">
      <div className="calendar-week" style={{ minWidth: 880 }}>
        <div className="calendar-week-head"><div className="week-time-head">GMT+8</div>{days.map((day) => <div key={day.toISOString()} className={sameDay(day.toISOString()) ? "day-head current" : "day-head"}><span>{new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(day)}</span><strong>{day.getDate()}</strong></div>)}</div>
        <div className="calendar-week-body">
          <div className="calendar-time-track" style={{ height: trackHeight }}>{calendarHours.map((hour, index) => <span key={hour} style={{ top: Math.min(index * CALENDAR_HOUR_HEIGHT, trackHeight - 1) }}>{hour}:00</span>)}</div>
          {calendarLayouts.map(({ day, items }) => <div className="calendar-day-track" key={day.toISOString()} style={{ height: trackHeight }} data-calendar-drop-date={localDateKey(day)} data-calendar-drop-start-hour={CALENDAR_START_HOUR} data-calendar-drop-end-hour={CALENDAR_END_HOUR}>{items.map((entry) => {
            const item = entry.item;
            const taskId = item.source === "task" ? item.id.slice(5) : "";
            const task = taskId ? tasks.find((candidate) => candidate.id === taskId) : null;
            const isCleaning = item.source === "cleaning";
            const draggable = item.source === "task" || item.source === "workspace-health" || isCleaning || eventIds.has(item.id);
            const kind: CalendarDragItem["kind"] = task ? "task" : isCleaning ? "cleaning" : item.source === "workspace-health" ? "workout" : "event";
            const sourceId = task?.id ?? item.id;
            const dragItem: CalendarDragItem = { kind, id: sourceId, label: item.title };
            const startMinute = new Date(item.startAt).getHours() * 60 + new Date(item.startAt).getMinutes();
            const resizeItem: CalendarResizeItem = { ...dragItem, startAt: item.startAt, durationMinutes: entry.durationMinutes, visibleMinutes: entry.visibleMinutes, maxDurationMinutes: Math.max(CALENDAR_SNAP_MINUTES, Math.min(720, CALENDAR_END_HOUR * 60 - startMinute)) };
            const columnWidth = 100 / entry.columnCount;
            const blockStyle = {
              top: entry.topMinutes * CALENDAR_HOUR_HEIGHT / 60,
              height: Math.max(24, entry.visibleMinutes * CALENDAR_HOUR_HEIGHT / 60 - 2),
              left: `calc(${entry.column * columnWidth}% + 3px)`,
              width: `calc(${columnWidth}% - 6px)`,
            };
            return <div className={`calendar-time-block mini-event ${item.category}`} style={blockStyle} key={item.id} data-calendar-draggable={draggable ? "true" : undefined} role={task ? "button" : undefined} tabIndex={task ? 0 : undefined} title={task ? "拖动改时间 · 拖底边改时长 · 点击编辑" : isCleaning ? "拖动改当天保洁时间" : draggable ? "拖动改时间 · 拖底边改时长" : "固定安排"} onPointerDown={(pointerEvent) => { if (draggable) calendarPointerDrag.begin(dragItem, pointerEvent); }} onClick={() => { if (task && !calendarPointerDrag.suppressClick() && !calendarResize.suppressClick()) openEdit(task); }} onKeyDown={(keyEvent) => { if (task && (keyEvent.key === "Enter" || keyEvent.key === " ")) { keyEvent.preventDefault(); openEdit(task); } }}><strong>{item.title}</strong><span>{time(item.startAt)}–{time(item.endAt)}</span><small>{durationText(entry.durationMinutes)}</small>{draggable && !isCleaning && <i className="calendar-resize-handle" aria-label={`调整「${item.title}」时长`} title="拖动调整时长" onPointerDown={(pointerEvent) => calendarResize.begin(resizeItem, pointerEvent)} onClick={(clickEvent) => { clickEvent.preventDefault(); clickEvent.stopPropagation(); }} />}</div>;
          })}</div>)}
        </div>
      </div>
    </div>
  </section>;
}

type ExpensePeriod = "week" | "month" | "year" | "all";

const expensePeriodLabels: Record<ExpensePeriod, string> = { week: "本周", month: "本月", year: "本年", all: "全部" };

function expensePeriodStart(period: ExpensePeriod, now = new Date()) {
  if (period === "all") return "";
  const today = localDateKey(now);
  if (period === "year") return `${today.slice(0, 4)}-01-01`;
  if (period === "month") return `${today.slice(0, 7)}-01`;
  const mondayOffset = (now.getDay() + 6) % 7;
  return shiftLocalDateKey(today, -mondayOffset);
}

function formatExpenseAmount(amountCents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amountCents / 100);
}

const EXPENSE_DONUT_COLORS = ["#559a77", "#7d9ecb", "#d9a05b", "#c67f9e", "#6fb3a8", "#a08bd4", "#d4895f", "#8bb16a", "#e0b05a", "#7fa8c9", "#c98fb4", "#93a66d"];

function ExpenseDonutChart({ items, selected, onSelect, totalCents }: { items: Array<{ category: string; amountCents: number; share: number }>; selected: string; onSelect: (category: string) => void; totalCents: number }) {
  const size = 176;
  const cx = size / 2, cy = size / 2, outer = 68, inner = 42;
  const total = items.reduce((sum, item) => sum + item.amountCents, 0) || 1;
  let angle = -90;
  const arcs = items.map((item) => {
    const sweep = Math.max(0.4, item.amountCents / total * 360);
    const arc = { item, start: angle, end: angle + sweep };
    /* eslint-disable-next-line react-hooks/immutability -- local sweep accumulator, not render state */
    angle += sweep;
    return arc;
  });
  const polar = (degrees: number, radius: number) => {
    const rad = degrees * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)] as const;
  };
  const ringPath = (start: number, end: number) => {
    const large = end - start > 180 ? 1 : 0;
    const [x1, y1] = polar(start, outer);
    const [x2, y2] = polar(end, outer);
    const [x3, y3] = polar(end, inner);
    const [x4, y4] = polar(start, inner);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  };
  const selectedItem = items.find((item) => item.category === selected);
  return (
    <div className="expense-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="支出分类占比饼图">
        {arcs.map((arc, index) => {
          const isSelected = selected === "全部" || arc.item.category === selected;
          const dimmed = selected !== "全部" && !isSelected;
          return <path key={arc.item.category} d={ringPath(arc.start, arc.end)} fill={EXPENSE_DONUT_COLORS[index % EXPENSE_DONUT_COLORS.length]} className={`donut-segment ${isSelected ? "active" : ""}`} style={{ opacity: dimmed ? 0.25 : 1 }} onClick={() => onSelect(arc.item.category)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(arc.item.category); } }}><title>{`${arc.item.category} · ${formatExpenseAmount(arc.item.amountCents)} · ${Math.round(arc.item.share)}%`}</title></path>;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="donut-center-label">{selected === "全部" ? "总支出" : selected}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="donut-center-value">{formatExpenseAmount(selected === "全部" ? totalCents : (selectedItem?.amountCents ?? 0))}</text>
      </svg>
      <div className="donut-legend">
        {items.slice(0, 10).map((item, index) => (
          <button key={item.category} className={selected === item.category ? "active" : ""} onClick={() => onSelect(selected === item.category ? "全部" : item.category)}>
            <i style={{ background: EXPENSE_DONUT_COLORS[index % EXPENSE_DONUT_COLORS.length] }} />
            <span>{item.category}</span>
            <em>{Math.round(item.share)}%</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExpensesView({ expenses, refresh, notify }: { expenses: Expense[]; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [period, setPeriod] = useState<ExpensePeriod>("month");
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);
  const today = localDateKey();
  const rangeStart = expensePeriodStart(period);
  const periodExpenses = expenses.filter((expense) => {
    const key = localDateKey(new Date(expense.spentAt));
    return (!rangeStart || key >= rangeStart) && key <= today;
  });
  const totalCents = periodExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const earliestKey = periodExpenses.length ? periodExpenses.reduce((earliest, expense) => {
    const key = localDateKey(new Date(expense.spentAt));
    return key < earliest ? key : earliest;
  }, today) : today;
  const averageStart = rangeStart || earliestKey;
  const elapsedDays = Math.max(1, Math.floor((new Date(`${today}T12:00:00+08:00`).getTime() - new Date(`${averageStart}T12:00:00+08:00`).getTime()) / 86400000) + 1);
  const categoryTotals = Array.from(periodExpenses.reduce((map, expense) => {
    map.set(expense.category, (map.get(expense.category) ?? 0) + expense.amountCents);
    return map;
  }, new Map<string, number>())).map(([category, amountCents]) => ({ category, amountCents, share: totalCents ? amountCents / totalCents * 100 : 0 })).sort((a, b) => b.amountCents - a.amountCents);
  const topCategory = categoryTotals[0] ?? null;
  // 趋势图用固定滚动窗口：周=最近7天按天，月=最近30天按天，年/全部=最近12个月按月。
  // 桶固定补齐、空桶照画，柱子位置可对比；年/全部基于全部支出而非当前周期过滤，避免稀疏时只剩一根柱。
  const monthlyMode = period === "year" || period === "all";
  const trendBuckets = monthlyMode
    ? Array.from({ length: 12 }, (_, index) => {
      const anchor = new Date(`${today}T12:00:00+08:00`);
      anchor.setDate(1);
      anchor.setMonth(anchor.getMonth() - (11 - index));
      return { key: localDateKey(anchor).slice(0, 7), label: `${anchor.getMonth() + 1}月` };
    })
    : (() => {
      const half = period === "week" ? 3 : 15;
      return Array.from({ length: half * 2 + 1 }, (_, index) => {
        const offset = index - half;
        const key = shiftLocalDateKey(today, offset);
        return { key, label: key.slice(8), isToday: offset === 0, isFuture: offset > 0 };
      });
    })();
  const expenseSource = monthlyMode ? expenses : periodExpenses;
  const trendMap = expenseSource.reduce((map, expense) => {
    const day = localDateKey(new Date(expense.spentAt));
    const key = monthlyMode ? day.slice(0, 7) : day;
    map.set(key, (map.get(key) ?? 0) + expense.amountCents);
    return map;
  }, new Map<string, number>());
  const trend = trendBuckets.map((bucket) => ({ key: bucket.key, label: bucket.label, amountCents: trendMap.get(bucket.key) ?? 0, isToday: "isToday" in bucket ? bucket.isToday : false, isFuture: "isFuture" in bucket ? bucket.isFuture : false }));
  const trendMax = Math.max(1, ...trend.map((item) => item.amountCents));
  const trendHasData = trend.some((item) => item.amountCents > 0);
  const categories = Array.from(new Set([...EXPENSE_CATEGORIES, ...expenses.map((expense) => expense.category)])).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const visibleExpenses = periodExpenses.filter((expense) => categoryFilter === "全部" || expense.category === categoryFilter).slice(0, 100);

  function openNew() {
    setEditing(null);
    setEntryOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setEntryOpen(true);
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch("/api/workspace", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "expense", ...(editing ? { id: editing.id } : {}), ...payload }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "这笔支出没有保存上");
      setEntryOpen(false);
      setEditing(null);
      await refresh();
      notify(editing ? "支出已更新" : "支出已记下");
    } catch (error) {
      notify(error instanceof Error ? error.message : "这笔支出没有保存上");
    } finally {
      setSaving(false);
    }
  }

  async function removeExpense(expense: Expense) {
    if (!window.confirm(`删除「${expense.title}」这笔支出？`)) return;
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "expense", id: expense.id }) });
      if (!response.ok) throw new Error("删除失败");
      await refresh();
      notify("这笔支出已删除");
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
    }
  }

  return <section className="expenses-view">
    <div className="expense-toolbar">
      <div className="expense-period-tabs" role="tablist" aria-label="支出周期">{(Object.keys(expensePeriodLabels) as ExpensePeriod[]).map((item) => <button role="tab" aria-selected={period === item} className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{expensePeriodLabels[item]}</button>)}</div>
      <button className="primary-button" onClick={openNew}><span>＋</span>记一笔</button>
    </div>

    <div className="expense-metrics">
      <article className="expense-total"><span>{expensePeriodLabels[period]}支出</span><strong>{formatExpenseAmount(totalCents)}</strong></article>
      <article><span>日均</span><strong>{formatExpenseAmount(Math.round(totalCents / elapsedDays))}</strong></article>
      <article><span>最多类别</span><strong>{topCategory?.category ?? "—"}</strong><small>{topCategory ? formatExpenseAmount(topCategory.amountCents) : ""}</small></article>
      <article><span>记录</span><strong>{periodExpenses.length}</strong><small>笔</small></article>
    </div>

    <div className="expense-insights-grid">
      <section className="panel expense-category-panel"><div className="panel-heading compact"><h2>花在哪里</h2></div><div className="expense-category-list">{categoryTotals.length ? categoryTotals.map((item) => <button key={item.category} className={categoryFilter === item.category ? "active" : ""} onClick={() => setCategoryFilter(categoryFilter === item.category ? "全部" : item.category)}><span className="expense-category-name">{item.category}</span><i><b style={{ width: `${Math.max(2, item.share)}%` }} /></i><strong>{formatExpenseAmount(item.amountCents)}</strong><small>{Math.round(item.share)}%</small></button>) : <div className="expense-empty">—</div>}</div></section>
      <div className="expense-insights-right">
      <section className="panel expense-trend-panel"><div className="panel-heading compact"><h2>支出趋势</h2><small className="expense-trend-range">{period === "year" || period === "all" ? "近 12 个月" : period === "week" ? "过去 3 天 · 今天 · 未来 3 天" : "过去 15 天 · 今天 · 未来 15 天"}</small></div><div className={`expense-trend ${!trendHasData ? "expense-trend-empty" : ""}`}>{trend.length ? trend.map((item) => <div key={item.key} className={[item.amountCents ? "has-data" : "", item.isToday ? "is-today" : "", item.isFuture ? "is-future" : ""].filter(Boolean).join(" ")} title={`${item.key} · ${formatExpenseAmount(item.amountCents)}`}><span>{item.amountCents ? formatExpenseAmount(item.amountCents) : ""}</span><i><b style={{ height: `${item.amountCents ? Math.max(5, item.amountCents / trendMax * 100) : 1}%` }} /></i><small>{item.label}</small></div>) : <div className="expense-empty">—</div>}</div></section>
      <section className="panel expense-donut-panel"><div className="panel-heading compact"><h2>分类占比</h2><small className="expense-trend-range">点击扇区查看分类明细</small></div>{categoryTotals.length ? <ExpenseDonutChart items={categoryTotals} selected={categoryFilter} onSelect={(category) => setCategoryFilter(categoryFilter === category ? "全部" : category)} totalCents={totalCents} /> : <div className="expense-empty">—</div>}</section>
    </div>
    </div>

    <section className="panel expense-list-panel"><div className="panel-heading compact"><h2>最近明细{categoryFilter !== "全部" ? ` · ${categoryFilter}` : ""}</h2><select aria-label="按类别筛选" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="全部">全部类别</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></div><div className="expense-list">{visibleExpenses.length ? visibleExpenses.map((expense) => <article key={expense.id}><time>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(expense.spentAt))}</time><div><strong>{expense.title}</strong><small>{expense.category}{expense.note ? ` · ${expense.note}` : ""}</small></div><em>{formatExpenseAmount(expense.amountCents)}</em><span>{expense.source === "personal-assistant" ? "助理" : "手动"}</span><div className="expense-row-actions"><button onClick={() => openEdit(expense)}>编辑</button><button onClick={() => void removeExpense(expense)}>删除</button></div></article>) : <div className="expense-empty expense-list-empty">还没有支出记录</div>}</div></section>

    {entryOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) { setEntryOpen(false); setEditing(null); } }}><form key={editing?.id ?? "new-expense"} className="composer expense-composer" onSubmit={saveExpense}><header><h2>{editing ? "编辑支出" : "记一笔"}</h2><button type="button" onClick={() => { setEntryOpen(false); setEditing(null); }} aria-label="关闭">×</button></header><label>花在什么上<input name="title" autoFocus required defaultValue={editing?.title ?? ""} placeholder="例如：午饭" /></label><div className="form-row"><label>金额<input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required defaultValue={editing ? (editing.amountCents / 100).toFixed(2) : ""} placeholder="0.00" /></label><label>日期<input name="spentAt" type="date" required defaultValue={editing ? localDateKey(new Date(editing.spentAt)) : today} /></label></div><label>分类<input name="category" list="expense-category-options" required defaultValue={editing?.category ?? "其他"} /><datalist id="expense-category-options">{categories.map((category) => <option value={category} key={category} />)}</datalist></label><label>备注（可选）<input name="note" defaultValue={editing?.note ?? ""} /></label><footer><span>按 Esc 关闭</span><button className="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存"}</button></footer></form></div>}
  </section>;
}

function mealIdeas(ingredients: Ingredient[]) {
  if (!ingredients.length) return [{ title: "先告诉我冰箱里有什么", body: "录入食材后，这里会只用现有库存给出搭配，不会虚构你没有的东西。", tone: "empty" }];
  const byCategory = (category: string) => ingredients.filter((item) => item.category === category).map((item) => item.name);
  const protein = byCategory("蛋白质");
  const vegetables = byCategory("蔬菜");
  const staples = byCategory("主食");
  const fruit = byCategory("水果");
  const condiments = byCategory("调味料");
  const first = (items: string[], fallback: string) => items.slice(0, 2).join(" + ") || fallback;
  return [
    { title: "完整一餐", body: `${first(protein, "还缺一份蛋白质")} · ${first(vegetables, "还缺一份蔬菜")} · ${first(staples, "按需要补主食")}`, tone: "balanced" },
    { title: "轻量搭配", body: `${first(protein, "补充蛋白质")} · ${first(vegetables, "补充蔬菜")}${fruit.length ? ` · ${fruit.slice(0, 1).join("")}` : ""}`, tone: "light" },
    ...(condiments.length ? [{ title: "风味加成", body: `手头有${condiments.slice(0, 3).join("、")}，今天炒菜、拌面或煎肉时顺手用上`, tone: "season" }] : []),
  ];
}

function HealthView({ ingredients, workouts, refresh, notify }: { ingredients: Ingredient[]; workouts: Workout[]; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [savingIngredient, setSavingIngredient] = useState(false);
  const [removingIngredientId, setRemovingIngredientId] = useState<string | null>(null);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const ideas = mealIdeas(ingredients);
  const frozen = ingredients.filter((item) => item.storage === "冷冻");
  const chilled = ingredients.filter((item) => item.storage === "冷藏");
  const pantry = ingredients.filter((item) => item.storage !== "冷冻" && item.storage !== "冷藏");

  async function addIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingIngredient(true);
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ingredient", ...payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "食材保存失败");
      form.reset();
      await refresh();
      notify("已加入食材库存；下次本地同步时会写入 OB");
    } catch (error) { notify(error instanceof Error ? error.message : "食材保存失败"); }
    finally { setSavingIngredient(false); }
  }

  async function removeIngredient(item: Ingredient) {
    setRemovingIngredientId(item.id);
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ingredient", id: item.id }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "暂时无法移除食材");
      await refresh();
      notify(`已将「${item.name}」标记为吃完`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "暂时无法移除食材");
    } finally {
      setRemovingIngredientId(null);
    }
  }

  async function addWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingWorkout(true);
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "workout", ...payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "训练记录保存失败");
      form.reset();
      await refresh();
      notify("训练已记录，并加入周日历");
    } catch (error) { notify(error instanceof Error ? error.message : "训练记录保存失败"); }
    finally { setSavingWorkout(false); }
  }

  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const recentWorkouts = workouts.slice(0, 5);
  const weeklyMinutes = workouts.filter((workout) => now.getTime() - new Date(workout.startedAt).getTime() < 7 * 86400000).reduce((sum, workout) => sum + workout.durationMinutes, 0);
  const weeklyCount = workouts.filter((workout) => now.getTime() - new Date(workout.startedAt).getTime() < 7 * 86400000).length;
  const expiringSoon = ingredients.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() < now.getTime() + 3 * 86400000).length;
  const lastWorkout = recentWorkouts[0];
  const gapDays = lastWorkout ? (() => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(lastWorkout.startedAt); b.setHours(0, 0, 0, 0); return Math.round((a.getTime() - b.getTime()) / 86400000); })() : null;
  return <section>
    <div className="health-summary">
      <article><span>食材库存</span><strong>{ingredients.length}</strong><small>种食材 · {expiringSoon ? `${expiringSoon} 种 3 天内到期` : "没有临期食材"}</small></article>
      <article><span>本周训练</span><strong>{weeklyMinutes}</strong><small>分钟 · {weeklyCount} 次 · 目标 150 分钟</small><span className="summary-bar"><i style={{ width: `${Math.min(100, Math.round(weeklyMinutes / 150 * 100))}%` }} /></span></article>
      <article><span>训练节奏</span><strong className="summary-text">{gapDays === null ? "尚未记录" : gapDays === 0 ? "今天已练" : `${gapDays} 天没练`}</strong><small>{lastWorkout ? `${lastWorkout.type} · ${lastWorkout.durationMinutes} 分钟 · ${shortDate(lastWorkout.startedAt)}` : "动起来之后，从这里开始记录"}</small></article>
    </div>
    <div className="health-grid">
      <section className="panel fridge-panel"><div className="panel-heading"><h2>食材库存</h2></div><form className="health-form ingredient-form" onSubmit={addIngredient}><input name="name" required placeholder="食材，例如：鸡蛋" aria-label="食材名称" /><input name="amount" placeholder="数量，例如：6 个" aria-label="食材数量" /><select name="category" aria-label="食材分类"><option>蛋白质</option><option>蔬菜</option><option>主食</option><option>水果</option><option>乳制品</option><option>调味料</option><option>其他</option></select><select name="storage" aria-label="存放位置"><option value="冷藏">冷藏</option><option value="冷冻">冷冻</option><option value="常温">常温</option></select><input name="expiresAt" type="date" aria-label="保质期" /><button disabled={savingIngredient}>{savingIngredient ? "保存中…" : "+ 加入库存"}</button></form><div className="ingredient-list">{(frozen.length > 0 || chilled.length > 0 || pantry.length > 0) ? <>{[{ key: "冷冻", label: "冷冻", items: frozen }, { key: "冷藏", label: "冷藏", items: chilled }, { key: "常温", label: "常温", items: pantry }].map((group) => group.items.length > 0 && <div className="ingredient-group" key={group.key}><p className="ingredient-group-label">{group.label}</p>{group.items.map((item) => <article key={item.id}><span className={`food-dot c-${item.category}`} /><div><strong>{item.name}</strong><small>{item.amount} · {item.category}{item.expiresAt ? ` · ${shortDate(item.expiresAt)} 前` : ""}</small></div><button type="button" disabled={removingIngredientId === item.id} aria-busy={removingIngredientId === item.id} onClick={() => void removeIngredient(item)} aria-label={`将 ${item.name} 标记为吃完`}>{removingIngredientId === item.id ? "处理中…" : "吃完"}</button></article>)}</div>)}</> : <div className="empty-health">暂无食材</div>}</div></section>
      <aside className="meal-panel"><h2>今天可以怎么搭</h2><div className="meal-ideas">{ideas.map((idea) => <article className={idea.tone} key={idea.title}><span>{idea.tone === "balanced" ? "01" : idea.tone === "light" ? "02" : idea.tone === "season" ? "03" : "—"}</span><div><strong>{idea.title}</strong><p>{idea.body}</p></div></article>)}</div></aside>
    </div>
    <div className="workout-grid">
      <section className="panel workout-form-panel"><div className="panel-heading"><h2>记录一次训练</h2></div><form className="health-form workout-form" onSubmit={addWorkout}><label>训练类型<input name="type" required placeholder="力量 / 跑步 / 游泳…" /></label><label>开始时间<input name="startedAt" type="datetime-local" required defaultValue={localNow} /></label><label>时长（分钟）<input name="durationMinutes" type="number" min="5" max="360" defaultValue="45" /></label><label>强度<select name="intensity" defaultValue="中等"><option>轻松</option><option>中等</option><option>较高</option></select></label><label className="workout-notes">备注<input name="notes" placeholder="动作、组数或身体感受" /></label><button disabled={savingWorkout}>{savingWorkout ? "记录中…" : "完成并加入日历"}</button></form></section>
      <section className="panel recent-workouts"><div className="panel-heading"><h2>最近训练</h2><span>{workouts.length} 次</span></div><div>{recentWorkouts.length ? recentWorkouts.map((workout) => <article key={workout.id}><time>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(workout.startedAt))}</time><div><strong>{workout.type}</strong><small>{workout.durationMinutes} 分钟 · {workout.intensity}{workout.notes ? ` · ${workout.notes}` : ""}</small></div></article>) : <div className="empty-health">暂无训练</div>}</div></section>
    </div>
  </section>;
}

function PlatformsView({ promotions, refresh, notify }: { promotions: PlatformPromotion[]; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ platform: "", topic: "", startDate: "", endDate: "", rules: "", note: "" });

  const platforms = ["小红书", "抖音", "视频号", "B站"];
  const now = new Date();
  const active = promotions.filter((p) => p.status === "active");
  const expired = promotions.filter((p) => p.status === "expired");
  const grouped = platforms.map((platform) => ({
    platform,
    items: active.filter((p) => p.platform === platform),
  })).filter((g) => g.items.length > 0);
  const ungrouped = active.filter((p) => !platforms.includes(p.platform));

  async function addPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.platform || !form.topic) return notify("请填写平台和话题");
    setSaving(true);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "platform_promotion", ...form }) });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "保存失败"); }
      setForm({ platform: "", topic: "", startDate: "", endDate: "", rules: "", note: "" });
      await refresh();
      notify("已添加平台扶持话题");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function removePromotion(id: string) {
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "platform_promotion", id }) });
      if (!response.ok) throw new Error("删除失败");
      await refresh();
      notify("已删除");
    } catch (error) { notify(error instanceof Error ? error.message : "删除失败"); }
  }

  const dateRange = (p: PlatformPromotion) => {
    if (!p.startDate && !p.endDate) return "";
    const fmt = (d: string) => new Date(d).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    if (p.startDate && p.endDate) return `${fmt(p.startDate)} – ${fmt(p.endDate)}`;
    if (p.startDate) return `从 ${fmt(p.startDate)} 起`;
    return p.endDate ? `到 ${fmt(p.endDate)} 止` : "";
  };

  const isExpiringSoon = (p: PlatformPromotion) => {
    if (!p.endDate) return false;
    const end = new Date(p.endDate);
    const diff = (end.getTime() - now.getTime()) / 86400000;
    return diff >= 0 && diff <= 7;
  };

  return <section>

    <div className="platforms-grid">
      {grouped.map((group) => (
        <article key={group.platform} className="platform-card">
          <header><span className="platform-dot" /><h3>{group.platform}</h3><span className="platform-count">{group.items.length}</span></header>
          <div className="platform-list">
            {group.items.map((item) => (
              <div key={item.id} className={`platform-item ${isExpiringSoon(item) ? "expiring" : ""}`}>
                <div className="platform-item-main">
                  <strong>{item.topic}</strong>
                  {item.rules && <p>{item.rules}</p>}
                  {item.note && <small>{item.note}</small>}
                </div>
                <div className="platform-item-meta">
                  {dateRange(item) && <time>{dateRange(item)}</time>}
                  <button onClick={() => void removePromotion(item.id)} aria-label="删除">×</button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
      {ungrouped.length > 0 && (
        <article className="platform-card">
          <header><span className="platform-dot" /><h3>其他平台</h3><span className="platform-count">{ungrouped.length}</span></header>
          <div className="platform-list">
            {ungrouped.map((item) => (
              <div key={item.id} className={`platform-item ${isExpiringSoon(item) ? "expiring" : ""}`}>
                <div className="platform-item-main">
                  <strong>{item.topic}</strong>
                  <small>{item.platform}</small>
                  {item.rules && <p>{item.rules}</p>}
                </div>
                <div className="platform-item-meta">
                  {dateRange(item) && <time>{dateRange(item)}</time>}
                  <button onClick={() => void removePromotion(item.id)} aria-label="删除">×</button>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}
      {active.length === 0 && <div className="empty-platforms">暂无记录</div>}
    </div>

    {expired.length > 0 && (
      <div className="platforms-expired">
        <p className="section-kicker">已过期</p>
        <div className="platform-list">
          {expired.map((item) => (
            <div key={item.id} className="platform-item expired">
              <div className="platform-item-main">
                <strong>{item.topic}</strong>
                <small>{item.platform}</small>
              </div>
              <div className="platform-item-meta">
                <button onClick={() => void removePromotion(item.id)} aria-label="删除">×</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    <section className="panel platform-form-panel">
      <div className="panel-heading"><h2>添加扶持话题</h2></div>
      <form className="health-form platform-form" onSubmit={addPromotion}>
        <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} aria-label="平台">
          <option value="">选择平台…</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="其他">其他</option>
        </select>
        <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="扶持话题，例如：秋日穿搭" aria-label="话题" />
        <input value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} type="date" aria-label="开始日期" />
        <input value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} type="date" aria-label="结束日期" />
        <input value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="活动规则摘要（可选）" aria-label="规则" />
        <button disabled={saving}>{saving ? "保存中…" : "+ 添加"}</button>
      </form>
    </section>
  </section>;
}

function ProductsView({ products, refresh, notify }: { products: PersonalProduct[]; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", path: "", stage: "计划中", note: "" });

  const stages = ["计划中", "开发中", "待宣发", "已发布"];
  const stageColors: Record<string, string> = {
    "计划中": "#8d7cf6",
    "开发中": "#ef9b55",
    "待宣发": "#e56f5c",
    "已发布": "#59a37d",
  };

  const grouped = stages.map((stage) => ({
    stage,
    items: products.filter((p) => p.stage === stage),
  })).filter((g) => g.items.length > 0);

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name) return notify("请填写项目名");
    setSaving(true);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "personal_product", ...form }) });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "保存失败"); }
      setForm({ name: "", path: "", stage: "计划中", note: "" });
      await refresh();
      notify("已添加个人产品");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function updateStage(id: string, stage: string) {
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "personal_product", id, stage }) });
      if (!response.ok) throw new Error("更新失败");
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "更新失败"); }
  }

  async function updateNote(id: string, note: string) {
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "personal_product", id, note }) });
      if (!response.ok) throw new Error("保存失败");
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败"); }
  }

  async function removeProduct(id: string) {
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "personal_product", id }) });
      if (!response.ok) throw new Error("删除失败");
      await refresh();
      notify("已删除");
    } catch (error) { notify(error instanceof Error ? error.message : "删除失败"); }
  }

  return <section>

    <div className="products-grid">
      {grouped.map((group) => (
        <div key={group.stage} className="products-column">
          <header className="products-column-header">
            <span className="products-stage-dot" style={{ background: stageColors[group.stage] }} />
            <h3>{group.stage}</h3>
            <span className="products-count">{group.items.length}</span>
          </header>
          <div className="products-list">
            {group.items.map((item) => (
              <article key={item.id} className="product-card">
                <div className="product-card-header">
                  <strong>{item.name}</strong>
                  <button className="product-delete" onClick={() => void removeProduct(item.id)} aria-label="删除">×</button>
                </div>
                <div className="product-stage-selector">
                  {stages.map((s) => (
                    <button
                      key={s}
                      className={`product-stage-btn ${item.stage === s ? "active" : ""}`}
                      style={item.stage === s ? { background: stageColors[s], color: "white" } : {}}
                      onClick={() => void updateStage(item.id, s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <textarea
                  className="product-note"
                  value={item.note}
                  onChange={(e) => void updateNote(item.id, e.target.value)}
                  placeholder="迭代备注、待办事项…"
                  rows={3}
                />
                {item.path && <div className="product-path">{item.path}</div>}
              </article>
            ))}
          </div>
        </div>
      ))}
      {products.length === 0 && <div className="empty-products">暂无产品</div>}
    </div>

    <section className="panel product-form-panel">
      <div className="panel-heading"><h2>添加产品</h2></div>
      <form className="health-form product-form" onSubmit={addProduct}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="项目名，例如：视频动效系统" aria-label="项目名" />
        <input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="目录路径（可选）" aria-label="路径" />
        <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} aria-label="阶段">
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="迭代备注（可选）" aria-label="备注" />
        <button disabled={saving}>{saving ? "保存中…" : "+ 添加"}</button>
      </form>
    </section>
  </section>;
}

function DealWorkspaceView({ deals, contents, refresh, openDealComposer, openContentComposer, notify }: { deals: Deal[]; contents: ContentItem[]; refresh: () => Promise<void>; openDealComposer: () => void; openContentComposer: () => void; notify: (message: string) => void }) {
  const [section, setSection] = useState<"progress" | "content">("progress");
  return <section>
    <div className="deal-workspace-tabs" role="tablist" aria-label="商单工作区">
      <button role="tab" aria-selected={section === "progress"} className={section === "progress" ? "active" : ""} onClick={() => setSection("progress")}>进度</button>
      <button role="tab" aria-selected={section === "content"} className={section === "content" ? "active" : ""} onClick={() => setSection("content")}>稿件</button>
    </div>
    {section === "progress"
      ? <DealsView deals={deals} refresh={refresh} openComposer={openDealComposer} notify={notify} />
      : <ContentView contents={contents} deals={deals} refresh={refresh} openComposer={openContentComposer} notify={notify} />}
  </section>;
}

function DealsView({ deals, refresh, openComposer, notify }: { deals: Deal[]; refresh: () => Promise<void>; openComposer: () => void; notify: (message: string) => void }) {
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function move(deal: Deal, stage: string) {
    const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "deal", id: deal.id, stage }) });
    if (!response.ok) return notify("进度保存失败，请稍后重试");
    await refresh();
    notify(`已更新为「${stageMeta[stage]?.label ?? stage}」`);
  }
  async function updatePublishedAt(deal: Deal, date: string) {
    setSavingDate(deal.id);
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "deal", id: deal.id, publishedAt: date || null }) });
      if (!response.ok) return notify("发布日期保存失败，请稍后重试");
      await refresh();
      notify(date ? `「${deal.campaign}」发布日期已改为 ${date}` : `「${deal.campaign}」发布日期已清空`);
    } finally {
      setSavingDate(null);
    }
  }
  async function remove(deal: Deal) {
    setDeletingId(deal.id);
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "deal", id: deal.id }) });
      if (!response.ok) return notify("删除失败，请稍后重试");
      await refresh();
      notify(`已删除「${deal.campaign}」`);
    } finally {
      setDeletingId(null);
    }
  }
  return <section>
    <div className="view-actions"><button className="primary-button" onClick={openComposer}>+　新增商单</button></div>
    <div className="kanban">{Object.entries(stageMeta).map(([stage, meta]) => <section className="kanban-column" key={stage}><header><span style={{ background: meta.color }} />{meta.label}<em>{deals.filter((deal) => deal.stage === stage).length}</em></header><div>{deals.filter((deal) => deal.stage === stage).map((deal) => {
      return <article className="deal-card" key={deal.id}>
        <header className="deal-card-header">
          <span className="deal-glyph">{deal.campaign.slice(0, 1)}</span>
          <h3>{deal.campaign}</h3>
        </header>
        <div className="deal-value">
          <div><small>执行价</small><strong>{deal.price == null ? "金额待定" : `¥${deal.price.toLocaleString("zh-CN")}`}</strong></div>
        </div>
        {deal.category && <div className="deal-tags"><span>{deal.category}</span></div>}
        <label className="deal-stage-control">
          <span>更新状态</span>
          <select value={deal.stage} onChange={(event) => void move(deal, event.target.value)} aria-label={`更新 ${deal.campaign} 的进度`}>{Object.entries(stageMeta).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}</select>
        </label>
        <label className="deal-date-control">
          <span>发布日期</span>
          <input type="date" value={deal.deadline?.slice(0, 10) ?? ""} disabled={savingDate === deal.id} onChange={(event) => void updatePublishedAt(deal, event.target.value)} aria-label={`修改 ${deal.campaign} 的发布日期`} />
        </label>
        <footer><button type="button" className="danger-button" disabled={deletingId === deal.id} onClick={() => void remove(deal)}>{deletingId === deal.id ? "删除中…" : "删除商单"}</button></footer>
      </article>;
    })}</div></section>)}</div>
  </section>;
}

function ContentView({ contents, deals, refresh, openComposer, notify }: { contents: ContentItem[]; deals: Deal[]; refresh: () => Promise<void>; openComposer: () => void; notify: (message: string) => void }) {
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  async function remove(item: ContentItem) {
    setSavingStatus(item.id);
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "content", id: item.id }) });
      if (!response.ok) throw new Error("稿件删除失败");
      await refresh();
      notify(`已删除「${item.title}」`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "稿件删除失败");
    } finally {
      setSavingStatus(null);
    }
  }

  async function updateStatus(item: ContentItem, status: string) {
    setSavingStatus(item.id);
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "content", id: item.id, status }) });
      if (!response.ok) throw new Error("稿件状态保存失败");
      await refresh();
      notify(`「${item.title}」已更新为「${status}」`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "稿件状态保存失败");
    } finally {
      setSavingStatus(null);
    }
  }

  async function reconcileDeal(linkedDeal: string, itemCount: number) {
    setSavingStatus(`deal:${linkedDeal}`);
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "content", linkedDeal, status: "已发布" }) });
      if (!response.ok) throw new Error("批量更新失败");
      await refresh();
      notify(`已将「${linkedDeal}」下 ${itemCount} 篇内容标记为「已发布」`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "批量更新失败");
    } finally {
      setSavingStatus(null);
    }
  }

  const referenceKinds = new Set(["健康档案", "训练记录", "饮食记录", "冰箱库存"]);
  const queue = contents.filter((item) => !referenceKinds.has(item.kind));
  const completedContentStatuses = new Set(["已发布", "已归档"]);
  const mismatchGroups = Array.from(new Set(queue.map((item) => item.linkedDeal).filter((value): value is string => Boolean(value)))).map((linkedDeal) => {
    const deal = deals.find((item) => item.campaign === linkedDeal);
    const items = queue.filter((item) => item.linkedDeal === linkedDeal);
    return { linkedDeal, deal, items, openItems: items.filter((item) => !completedContentStatuses.has(item.status)) };
  }).filter((group) => group.deal && ["delivery", "paid"].includes(group.deal.stage) && group.openItems.length > 0);
  return <section>
    <div className="view-actions"><button className="primary-button" onClick={openComposer}>+　新建稿件</button></div>
    {mismatchGroups.length > 0 && <div className="workflow-alerts">{mismatchGroups.map((group) => <article className="workflow-alert" key={group.linkedDeal}><span className="workflow-alert-icon">!</span><div><strong>商单已完成，稿件状态待确认</strong><p>「{group.linkedDeal}」已进入完成阶段，但还有 {group.openItems.length} 篇内容未标记为已发布。请按真实发布情况确认。</p></div><button disabled={savingStatus === `deal:${group.linkedDeal}`} onClick={() => void reconcileDeal(group.linkedDeal, group.openItems.length)}>{savingStatus === `deal:${group.linkedDeal}` ? "更新中…" : `补齐 ${group.openItems.length} 篇为已发布`}</button></article>)}</div>}
    <div className="content-layout"><section className="panel content-list-panel"><div className="panel-heading"><h2>稿件队列</h2><span className="index-time">{queue.length} 篇</span></div><div className="content-list">{queue.length ? queue.map((item) => { const linkedDeal = deals.find((deal) => deal.campaign === item.linkedDeal); const mismatch = linkedDeal && ["delivery", "paid"].includes(linkedDeal.stage) && !completedContentStatuses.has(item.status); const options = contentStatusOptions.includes(item.status) ? contentStatusOptions : [item.status, ...contentStatusOptions]; const dealState = linkedDeal ? (stageMeta[linkedDeal.stage]?.label ?? linkedDeal.stage) : "未找到"; return <article className={`content-row${mismatch ? " has-mismatch" : ""}`} key={item.id}><span className="content-glyph">{item.kind.slice(0, 1)}</span><div className="content-main"><div><strong>{item.title}</strong>{mismatch && <span className="content-status mismatch">待确认</span>}</div><footer><span>{item.kind}</span><span>{item.wordCount.toLocaleString("zh-CN")} 字</span><span>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.modifiedAt))}</span></footer></div><div className="content-actions"><label><span>稿件状态</span><select value={item.status} disabled={savingStatus === item.id} onChange={(event) => void updateStatus(item, event.target.value)} aria-label={`更新 ${item.title} 的稿件状态`}>{options.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>{item.status !== "已发布" && <button className="publish-button" disabled={savingStatus === item.id} onClick={() => void updateStatus(item, "已发布")}>标记已发布</button>}</div><div className="content-link">{item.linkedDeal ? <><small>对应商单 · {dealState}</small><strong>{item.linkedDeal}</strong></> : <span>未关联</span>}<button onClick={() => void remove(item)}>删除</button></div></article>; }) : <div className="empty-health">暂无稿件</div>}</div></section></div>
  </section>;
}

function ConnectionsView({ assistant, meta, settings, saveModules, openSetup, demoBusy, onDemo, refresh, notify }: { assistant: AssistantState; meta: WorkspaceData["meta"]; settings: WorkspaceSettings; saveModules: (modules: ModuleId[], goals?: Goals, withDemo?: boolean, ai?: null) => Promise<string | null>; openSetup: () => void; demoBusy: boolean; onDemo: (kind: "demo_load" | "demo_clear") => Promise<void>; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [moduleBusy, setModuleBusy] = useState(false);
  const enabledModules = settings.enabledModules.length ? settings.enabledModules : [...MODULES.map((module) => module.id)];
  async function toggleModule(id: ModuleId) {
    setModuleBusy(true);
    try {
      const next = enabledModules.includes(id) ? enabledModules.filter((item) => item !== id) : [...enabledModules, id];
      await saveModules(next, settings.goals, false, null);
      await refresh();
    } finally {
      setModuleBusy(false);
    }
  }
  const [savingAssistant, setSavingAssistant] = useState(false);
  const [forgettingMemory, setForgettingMemory] = useState<string | null>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState(assistant.baseUrl);
  const [aiModel, setAiModel] = useState(assistant.model);
  const [aiKey, setAiKey] = useState("");
  const [reviewTime, setReviewTime] = useState(assistant.reviewTime);
  const [autoReview, setAutoReview] = useState(assistant.autoReview);
  const [backups, setBackups] = useState<DesktopBackup[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { void loadBackups(); }, []);

  async function loadBackups() {
    if (!window.workbenchDesktop) return;
    try {
      const result = await window.workbenchDesktop.backupList();
      if (result.ok && result.backups) setBackups(result.backups);
    } catch {}
  }

  async function createBackupNow() {
    if (!window.workbenchDesktop) { notify("备份功能仅在桌面端支持"); return; }
    setBackingUp(true);
    try {
      const result = await window.workbenchDesktop.backupNow();
      if (!result.ok) throw new Error(result.error || "备份失败");
      await loadBackups();
      notify("备份已创建");
    } catch (error) {
      notify(error instanceof Error ? error.message : "备份失败");
    } finally {
      setBackingUp(false);
    }
  }

  async function restoreBackupNow(backupId: string) {
    if (!window.workbenchDesktop) return;
    if (!window.confirm("恢复备份会覆盖当前所有数据，确定要继续吗？")) return;
    setRestoringId(backupId);
    try {
      const result = await window.workbenchDesktop.backupRestore(backupId);
      if (!result.ok) throw new Error(result.error || "恢复失败");
      notify("已恢复备份，正在刷新数据…");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setRestoringId(null);
    }
  }

  async function deleteBackupNow(backupId: string) {
    if (!window.workbenchDesktop) return;
    if (!window.confirm("确定要删除这个备份吗？")) return;
    setDeletingId(backupId);
    try {
      const result = await window.workbenchDesktop.backupDelete(backupId);
      if (!result.ok) throw new Error(result.error || "删除失败");
      await loadBackups();
      notify("备份已删除");
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function saveAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aiBaseUrl.trim() || !aiModel.trim() || (!assistant.configured && !aiKey.trim())) {
      notify("请填写 AI Base URL、模型和 API Key");
      return;
    }
    setSavingAssistant(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "assistant_config", baseUrl: aiBaseUrl.trim(), model: aiModel.trim(), apiKey: aiKey.trim(), reviewTime, autoReview }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "个人助理设置保存失败");
      setAiKey("");
      await refresh();
      notify("个人助理设置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : "个人助理设置保存失败");
    } finally {
      setSavingAssistant(false);
    }
  }

  async function forgetMemory(id: string) {
    setForgettingMemory(id);
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "assistant_memory_forget", id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "这条记忆没有删除成功");
      await refresh();
      notify("已删除这条助理记忆");
    } catch (error) {
      notify(error instanceof Error ? error.message : "这条记忆没有删除成功");
    } finally {
      setForgettingMemory(null);
    }
  }

  return <section className="settings-view">
    <section className="panel assistant-config-panel">
      <div className="panel-heading"><h2>个人助理</h2><span className={assistant.configured ? "connection-state on" : "connection-state"}>{assistant.configured ? "已接入" : "待配置"}</span></div>
      <form className="assistant-config-form" onSubmit={saveAssistant}>
        <label>API 地址<input value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} placeholder="https://.../v1" autoComplete="off" /></label>
        <label>对话模型<select value={aiModel} onChange={(event) => setAiModel(event.target.value)}>{!AI_MODEL_OPTIONS.some((option) => option.value === aiModel) && <option value={aiModel}>{aiModel}</option>}{AI_MODEL_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label>API Key<input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={assistant.configured ? "留空则继续使用已保存 Key" : "输入 API Key"} autoComplete="new-password" /></label>
        <label>每日复盘时间<input type="time" value={reviewTime} onChange={(event) => setReviewTime(event.target.value)} /></label>
        <label className="assistant-toggle"><input type="checkbox" checked={autoReview} onChange={(event) => setAutoReview(event.target.checked)} /><span><strong>开启主动复盘</strong></span></label>
        <button className="primary-button" disabled={savingAssistant}>{savingAssistant ? "正在保存…" : "保存助理设置"}</button>
      </form>
      <p className="settings-footnote">API Key 仅保存在本机；对话或生成复盘时会发送必要的工作台摘要。</p>
    </section>

    <section className="panel settings-data-panel">
      <div className="panel-heading"><h2>目标</h2><button className="connection-action" onClick={openSetup}>重新运行设置流程</button></div>
      <GoalsEditor goals={settings.goals} busy={moduleBusy} onSave={(next) => saveModules(enabledModules, next, false, null)} notify={notify} />
    </section>

    <section className="panel settings-data-panel">
      <div className="panel-heading"><h2>模块</h2></div>
      <p className="settings-footnote" style={{ padding: "0 20px 10px" }}>关掉用不到的模块，侧栏就不再显示它。今天、日历和设置常驻。</p>
      <div className="setup-modules" style={{ padding: "0 20px 18px" }}>
        {MODULES.map((module) => (
          <SetupOption key={module.id} kind="check" checked={enabledModules.includes(module.id)} title={module.label} blurb={module.blurb} onToggle={() => void toggleModule(module.id)} />
        ))}
      </div>
    </section>

    <section className="panel settings-data-panel">
      <div className="panel-heading"><h2>演示数据</h2></div>
      <div className="settings-source-list">
        <article className="settings-source-row">
          <span className="connection-logo base">◇</span>
          <div className="settings-source-main"><strong>{meta.demoInstalled ? "已载入演示数据" : "当前是空白工作台"}</strong><span>演示内容全部虚构，用来看每个视图跑起来是什么样子，随时可以一键清除。</span></div>
          <div className="settings-source-actions">{meta.demoInstalled
            ? <button className="connection-action" disabled={demoBusy} onClick={() => void onDemo("demo_clear")}>{demoBusy ? "正在清除…" : "清除演示数据"}</button>
            : <button className="connection-action" disabled={demoBusy} onClick={() => void onDemo("demo_load")}>{demoBusy ? "正在载入…" : "载入演示数据"}</button>}</div>
        </article>
      </div>
    </section>

    <section className="panel settings-data-panel">
      <div className="panel-heading"><h2>数据备份</h2>{window.workbenchDesktop && <button className="connection-action" disabled={backingUp} onClick={() => void createBackupNow()}>{backingUp ? "正在备份…" : "立即备份"}</button>}</div>
      <p className="settings-footnote" style={{ padding: "0 20px 12px" }}>每天自动备份一次，保留最近 7 天。备份保存在「文稿/{BRAND.backupDirName}」。</p>
      {!window.workbenchDesktop ? (
        <p style={{ padding: "20px", color: "#8a958f", fontSize: "11px" }}>备份功能仅在桌面端支持，请使用桌面客户端访问此功能。</p>
      ) : (
      <div className="settings-source-list">
        {backups.length ? backups.map((backup) => (
          <article className="settings-source-row" key={backup.id}>
            <span className="connection-logo base">💾</span>
            <div className="settings-source-main">
              <strong>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(backup.createdAt))}</strong>
              <span>{backup.sizeLabel} · 任务 {backup.recordCounts?.tasks ?? 0} · 支出 {backup.recordCounts?.expenses ?? 0} · 食材 {backup.recordCounts?.ingredients ?? 0} · 商单 {backup.recordCounts?.deals ?? 0}</span>
            </div>
            <div className="settings-source-actions">
              <button className="connection-action secondary" disabled={restoringId === backup.id} onClick={() => void restoreBackupNow(backup.id)}>{restoringId === backup.id ? "恢复中…" : "恢复"}</button>
              <button className="connection-action secondary" disabled={deletingId === backup.id} onClick={() => void deleteBackupNow(backup.id)} style={{ color: "#a06659" }}>{deletingId === backup.id ? "删除中…" : "删除"}</button>
            </div>
          </article>
        )) : <p style={{ padding: "20px", color: "#8a958f", fontSize: "11px" }}>还没有备份，点击右上角「立即备份」创建第一个备份。</p>}
      </div>
      )}
    </section>

    <section className="panel assistant-memory-panel">
      <div className="panel-heading"><h2>助理记忆</h2><span className="connection-state on">{assistant.memories.length} 条</span></div>
      <div className="assistant-memory-list">{assistant.memories.length ? assistant.memories.map((memory) => <article key={memory.id}><span>{({ preference: "偏好", routine: "习惯", constraint: "约束", goal: "目标", context: "背景", insight: "观察" } as Record<string, string>)[memory.category] ?? "记忆"}</span><strong>{memory.content}</strong><button disabled={forgettingMemory === memory.id} onClick={() => void forgetMemory(memory.id)}>{forgettingMemory === memory.id ? "删除中…" : "忘记"}</button></article>) : <p>暂无长期记忆</p>}</div>
    </section>
  </section>;
}


const reviewPeriodMeta: Record<ReviewPeriod, { tab: string; generate: string; empty: string; done: string; next: string; unit: string }> = {
  daily: { tab: "每日", generate: "生成今日复盘", empty: "暂无每日复盘", done: "今日完成", next: "明日优先", unit: "天" },
  weekly: { tab: "每周", generate: "生成本周复盘", empty: "暂无周度复盘", done: "本周完成", next: "下周优先", unit: "周" },
  monthly: { tab: "每月", generate: "生成本月复盘", empty: "暂无月度复盘", done: "本月完成", next: "下月优先", unit: "月" },
};

function reviewRangeLabel(review: DailyReview) {
  if (review.periodType === "monthly") {
    const [year, month] = review.periodKey.split("-");
    return `${year} 年 ${Number(month)} 月`;
  }
  const format = (value: string, weekday = false) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", ...(weekday ? { weekday: "short" as const } : {}) }).format(new Date(`${value}T12:00:00+08:00`));
  if (review.periodType === "weekly") return `${format(review.rangeStart)} – ${format(review.rangeEnd)}`;
  return format(review.reviewDate, true);
}

function DailyReviewDetail({ review }: { review: DailyReview }) {
  const meta = reviewPeriodMeta[review.periodType];
  return <section className="assistant-card ready review-log-detail">
    <header><div className="assistant-title"><div className="assistant-avatar">栗</div><h2>{reviewRangeLabel(review)}</h2></div><small>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(review.generatedAt))} · 第 {review.generationCount} 版</small></header>
    <p className="assistant-summary">{review.content.summary}</p>
    <div className="assistant-review-grid">
      <article><span>{meta.done}</span>{review.content.wins.length ? <ul>{review.content.wins.map((item) => <li key={item}>{item}</li>)}</ul> : <p>暂无</p>}</article>
      <article><span>待跟进</span>{review.content.unfinished.length ? <ul>{review.content.unfinished.map((item) => <li key={`${item.item}-${item.action}`}><strong>{item.item}</strong><small>{item.action}</small></li>)}</ul> : <p>暂无</p>}</article>
      <article className="tomorrow-list"><span>{meta.next}</span>{review.content.tomorrowTop3.length ? <ol>{review.content.tomorrowTop3.map((item, index) => <li key={`${item.title}-${index}`}><em>0{index + 1}</em><div><strong>{item.title}</strong><small>{item.why} · {item.minutes} 分钟</small></div></li>)}</ol> : <p>暂无</p>}</article>
    </div>
    {review.content.signals.length > 0 && <div className="assistant-signals"><span>助理观察</span><p>{review.content.signals.join(" · ")}</p></div>}
    <footer><blockquote>“{review.content.question}”</blockquote></footer>
  </section>;
}

function ReviewView({ tasks, events, focusSessions, assistant, generating, generate, openSettings }: { tasks: Task[]; events: Event[]; focusSessions: FocusSession[]; assistant: AssistantState; generating: boolean; generate: (periodType: ReviewPeriod) => Promise<void>; openSettings: () => void }) {
  const [periodType, setPeriodType] = useState<ReviewPeriod>("daily");
  const [selectedKey, setSelectedKey] = useState("");
  const meta = reviewPeriodMeta[periodType];
  const reviews = assistant.reviews.filter((review) => review.periodType === periodType);
  const selected = reviews.find((review) => `${review.periodType}:${review.periodKey}` === selectedKey) ?? reviews[0] ?? null;
  const currentPeriod = currentReviewPeriod(periodType);
  const rangeStart = selected?.rangeStart ?? currentPeriod.rangeStart;
  const rangeEnd = selected?.rangeEnd ?? currentPeriod.rangeEnd;
  const done = tasks.filter((task) => task.status === "done" && dateInRange(task.completedAt, rangeStart, rangeEnd)).length;
  const periodEvents = events.filter((event) => dateInRange(event.startAt, rangeStart, rangeEnd));
  const focus = focusTotal(focusSessions.filter((session) => session.status === "completed" && dateInRange(session.startedAt, rangeStart, rangeEnd)).reduce((sum, session) => sum + session.durationSeconds, 0));
  return <section>
    <div className="review-toolbar">
      <div className="review-period-tabs" role="tablist" aria-label="复盘周期">{(["daily", "weekly", "monthly"] as ReviewPeriod[]).map((item) => <button role="tab" aria-selected={periodType === item} className={periodType === item ? "active" : ""} key={item} onClick={() => { setPeriodType(item); setSelectedKey(""); }}>{reviewPeriodMeta[item].tab}</button>)}</div>
      {assistant.configured ? <button className="primary-button" disabled={generating} onClick={() => void generate(periodType)}>{generating ? "正在生成…" : meta.generate}</button> : <button className="primary-button" onClick={openSettings}>配置个人助理</button>}
    </div>
    <div className="metric-grid"><article><span>完成任务</span><strong>{done}</strong><small>件</small></article><article><span>专注用时</span><strong>{focus.value}</strong><small>{focus.unit}</small></article><article><span>日程</span><strong>{periodEvents.length}</strong><small>个</small></article><article><span>已记录</span><strong>{reviews.length}</strong><small>{meta.unit}</small></article></div>
    {reviews.length ? <div className="review-log-layout">
      <aside className="panel review-log-index"><div className="review-date-list">{reviews.map((review) => { const key = `${review.periodType}:${review.periodKey}`; return <button className={`${selected?.periodType}:${selected?.periodKey}` === key ? "active" : ""} key={key} onClick={() => setSelectedKey(key)}><span>{reviewRangeLabel(review)}</span>{review.generationCount > 1 && <small>{review.generationCount} 版</small>}</button>; })}</div></aside>
      <div>{selected && <DailyReviewDetail review={selected} />}</div>
    </div> : <div className="review-log-empty-state">{meta.empty}</div>}
  </section>;
}

function Composer({ kind, close, saved, editingTask, defaultDueDate, notify }: { kind: "task" | "event" | "deal" | "content"; close: () => void; saved: (message?: string) => Promise<void>; editingTask?: Task | null; defaultDueDate?: string | null; notify: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function removeTask() {
    if (!editingTask) return;
    if (!window.confirm(`删除任务「${editingTask.title}」？`)) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/workspace", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", id: editingTask.id }) });
      if (!response.ok) throw new Error("删除失败");
      await saved("任务已删除");
    } catch (error) {
      notify(error instanceof Error ? error.message : "删除失败");
      setDeleting(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    try {
      const form = new FormData(event.currentTarget); const payload: Record<string, FormDataEntryValue | string[] | boolean | number | null> = Object.fromEntries(form.entries());
      if (kind === "task") {
        const due = String(payload.dueDate ?? "").trim();
        const scheduledTime = String(payload.scheduledTime ?? "").trim();
        delete payload.scheduledTime;
        if (due) {
          payload.dueDate = due;
          if (scheduledTime) payload.scheduledStart = new Date(`${due}T${scheduledTime}:00`).toISOString();
          else if (editingTask) payload.scheduledStart = null;
          else payload.autoSchedule = true;
        } else {
          payload.dueDate = null;
          payload.scheduledStart = null;
        }
        if (editingTask) {
          const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, kind: "task", id: editingTask.id }) });
          if (!response.ok) throw new Error("保存失败");
          const result = await response.json() as { item?: Task };
          await saved(result.item?.scheduledStart ? `已安排到 ${shortDate(result.item.scheduledStart)} ${time(result.item.scheduledStart)}` : "已保存修改");
          return;
        }
      }
      if (kind === "event") { payload.startAt = new Date(String(payload.startAt)).toISOString(); payload.endAt = new Date(String(payload.endAt)).toISOString(); }
      if (kind === "content") {
        payload.wordCount = Number(payload.wordCount ?? 0) || 0;
        payload.pendingCount = Number(payload.pendingCount ?? 0) || 0;
      }
      if (kind === "deal") {
        const categories = form.getAll("categories").map(String);
        if (!categories.length) throw new Error("请选择商单类别");
        payload.categories = categories;
        const month = String(payload.month ?? "");
        const match = month.match(/^(\d{4})-(\d{2})$/);
        payload.month = match ? `${match[1]}年${Number(match[2])}月` : "";
      }
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, kind }) });
      if (!response.ok) throw new Error("保存失败");
      const result = await response.json() as { item?: Task };
      await saved(kind === "task" && result.item?.scheduledStart ? `已安排到 ${shortDate(result.item.scheduledStart)} ${time(result.item.scheduledStart)}` : undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "服务暂不可用，改动没有保存上");
    } finally {
      setSaving(false);
    }
  }
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const later = new Date(now.getTime() + 60 * 60000);
  const today = now.toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><form className="composer" onSubmit={submit}><header><h2>{kind === "task" ? (editingTask ? "编辑任务" : "新建任务") : kind === "event" ? "安排日程" : kind === "content" ? "新建稿件" : "新建商单"}</h2><button type="button" onClick={close} aria-label="关闭">×</button></header>{kind === "task" && <><label>任务名称<input name="title" autoFocus required defaultValue={editingTask?.title ?? ""} placeholder="例如：整理商单初稿" /></label><div className="form-row"><label>项目<input name="project" defaultValue={editingTask?.project ?? "收件箱"} /></label><label>任务时长（分钟）<input type="number" name="estimatedMinutes" min="15" max="720" step="15" required defaultValue={editingTask?.estimatedMinutes ?? 30} /></label></div><div className="form-row"><label>优先级<select name="priority" defaultValue={editingTask?.priority ?? "medium"}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label>任务日期<input type="date" name="dueDate" defaultValue={editingTask?.dueDate ? editingTask.dueDate.slice(0, 10) : defaultDueDate ?? ""} /></label></div><label>开始时间（可留空）<input type="time" name="scheduledTime" defaultValue={timeFieldValue(editingTask ? calendarStartForTask(editingTask) : null)} /></label></>}{kind === "event" && <><label>日程标题<input name="title" autoFocus required placeholder="例如：商单方案对齐" /></label><div className="form-row"><label>开始<input type="datetime-local" name="startAt" required defaultValue={now.toISOString().slice(0, 16)} /></label><label>结束<input type="datetime-local" name="endAt" required defaultValue={later.toISOString().slice(0, 16)} /></label></div><label>地点<input name="location" placeholder="线上会议 / 线下" /></label></>}{kind === "content" && <><label>稿件标题<input name="title" autoFocus required placeholder="例如：AI 客服实测脚本" /></label><div className="form-row"><label>类型<input name="type" placeholder="长视频脚本 / 公众号文章…" /></label><label>状态<select name="status"><option>构思中</option><option>写作中</option><option>初稿完成</option><option>待审核</option><option>待发布</option><option>已发布</option><option>已归档</option></select></label></div><div className="form-row"><label>字数<input type="number" name="wordCount" min="0" step="50" defaultValue="0" /></label><label>待补点<input type="number" name="pendingCount" min="0" step="1" defaultValue="0" /></label></div><label>关联商单<input name="linkedDeal" placeholder="留空表示不关联" /></label></>}{kind === "deal" && <><label>商单名称<input name="title" autoFocus required placeholder="例如：新品公众号合作" /></label><fieldset className="deal-category-field"><legend>商单类别</legend><div className="deal-category-options">{DEAL_CATEGORY_OPTIONS.map((category) => <label key={category}><input type="checkbox" name="categories" value={category} /><span>{category}</span></label>)}</div></fieldset><div className="form-row"><label>状态<select name="stage"><option value="lead">未开始</option><option value="execution">进行中</option><option value="delivery">已完成</option><option value="paid">已结算</option></select></label><label>归属月份<input type="month" name="month" defaultValue={thisMonth} /></label></div><div className="form-row"><label>执行价格<input type="number" name="price" min="0" step="1" inputMode="decimal" /></label><label>打款金额<input type="number" name="paidAmount" min="0" step="0.01" inputMode="decimal" /></label></div><div className="form-row"><label>接单日期<input type="date" name="receivedAt" defaultValue={today} /></label><label>发布日期<input type="date" name="publishedAt" /></label></div></>}<footer><span>按 Esc 关闭</span>{kind === "task" && editingTask && <button type="button" className="danger-button" disabled={deleting} onClick={() => void removeTask()}>{deleting ? "正在删除…" : "删除任务"}</button>}<button className="primary-button" disabled={saving}>{saving ? "正在保存…" : editingTask ? "保存修改" : "收入工作台"}</button></footer></form></div>;
}

function SetupOption({ checked, kind, name, title, blurb, onToggle }: { checked: boolean; kind: "check" | "radio"; name?: string; title: string; blurb: string; onToggle: () => void }) {
  return <label className={checked ? "setup-option on" : "setup-option"}>
    <input type={kind === "radio" ? "radio" : "checkbox"} name={name} checked={checked} onChange={onToggle} aria-label={title} />
    <span className="setup-option-text"><strong>{title}</strong><small>{blurb}</small></span>
  </label>;
}

function SetupWizard({ assistant, onClose, onFinish }: { assistant: AssistantState; onClose: () => void; onFinish: (modules: ModuleId[], goals: Goals, withDemo: boolean, ai: { baseUrl: string; model: string; apiKey: string } | null) => Promise<string | null | undefined> }) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<ModuleId[]>([...MODULES.map((module) => module.id)]);
  const [withDemo, setWithDemo] = useState(true);
  const [annual, setAnnual] = useState("");
  const [quarterly, setQuarterly] = useState("");
  const [baseUrl, setBaseUrl] = useState(assistant.baseUrl);
  const [model, setModel] = useState(assistant.model);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const steps = ["欢迎", "选择模块", "写下目标", "智能助理", "开始使用"];
  const last = steps.length - 1;

  function toggle(id: ModuleId) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }
  async function submit() {
    setSaving(true);
    setFailure(null);
    try {
      const error = await onFinish(picked, {
        annual: annual.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
        quarterly: quarterly.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
      }, withDemo, apiKey.trim() ? { baseUrl, model, apiKey } : null);
      if (error) setFailure(error);
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "本地服务没有响应");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop setup-backdrop"><div className="setup-card">
    <header className="setup-header">
      <p className="eyebrow">{`第 ${step + 1} 步 / 共 ${steps.length} 步`}</p>
      <h2>{steps[step]}</h2>
      <div className="setup-dots">{steps.map((label, index) => <span key={label} className={index === step ? "on" : ""} />)}</div>
    </header>

    {step === 0 && <div className="setup-body">
      <p>LifeOS 把日程、任务、商单、记账、饮食和训练收在同一个本地界面里。</p>
      <ul className="setup-facts">
        <li><strong>数据只在这台设备上</strong>没有账号，不上传，不同步到任何第三方。</li>
        <li><strong>助理用你自己的模型服务</strong>只有你填写的 API 地址会收到请求，Key 只存在本地。</li>
        <li><strong>用不到的模块可以关掉</strong>关掉后侧栏不再出现，之后随时能改。</li>
      </ul>
    </div>}

    {step === 1 && <div className="setup-body">
      <p className="setup-hint">点掉你暂时不需要的，默认全部开启。今天、日历和设置常驻。</p>
      <div className="setup-modules">{MODULES.map((module) => (
        <SetupOption key={module.id} kind="check" checked={picked.includes(module.id)} title={module.label} blurb={module.blurb} onToggle={() => toggle(module.id)} />
      ))}</div>
    </div>}

    {step === 2 && <div className="setup-body">
      <p className="setup-hint">一行一个，写下你今年和本季度想推进的事。留空也可以，之后在设置里补。</p>
      <label className="setup-field">年度计划
        <textarea rows={3} value={annual} onChange={(event) => setAnnual(event.target.value)} placeholder={"例如：跑通第二个收入来源\n例如：作品进入所在领域前 5%"} />
      </label>
      <label className="setup-field">本季度重点
        <textarea rows={3} value={quarterly} onChange={(event) => setQuarterly(event.target.value)} placeholder={"例如：上线第一个付费产品\n例如：完成 10 条长视频并保持周更"} />
      </label>
    </div>}

    {step === 3 && <div className="setup-body">
      <p className="setup-hint">这一步可以完全跳过，之后在设置页里填也一样。</p>
      <label className="setup-field">API 地址
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://.../v1" autoComplete="off" spellCheck={false} />
      </label>
      <label className="setup-field">对话模型
        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="glm-5.3-flash" autoComplete="off" spellCheck={false} />
      </label>
      <label className="setup-field">API Key
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空表示暂时不配置" autoComplete="new-password" />
      </label>
      <p className="settings-footnote">Key 只写入本机数据库，页面读取配置时不会把它回传给浏览器。</p>
    </div>}

    {step === 4 && <div className="setup-body">
      <p className="setup-hint">你可以从空白开始，也可以先载入一套虚构的演示数据，看看每个视图用起来是什么样子。</p>
      <div className="setup-modules single">
        <SetupOption kind="radio" name="setupdata" checked={withDemo} title="载入演示数据" blurb="虚构的商单、支出、食材与复盘，随时可以在设置里一键清除。" onToggle={() => setWithDemo(true)} />
        <SetupOption kind="radio" name="setupdata" checked={!withDemo} title="从空白开始" blurb="直接添加你自己的第一条任务和日程。" onToggle={() => setWithDemo(false)} />
      </div>
      <p className="settings-footnote">已选模块：{picked.length ? picked.map((id) => MODULES.find((module) => module.id === id)?.label).join("、") : "仅核心视图"}</p>
    </div>}

    {failure && <p className="setup-error">保存失败：{failure}。你的选择不会丢，可以直接再试一次。</p>}

    <footer className="setup-footer">
      {step > 0 && step < last ? <button type="button" className="setup-ghost" onClick={onClose}>稍后再说</button> : <span />}
      {step > 0 && <button type="button" className="setup-ghost" disabled={saving} onClick={() => setStep((current) => current - 1)}>上一步</button>}
      {step < last
        ? <button type="button" className="primary-button" onClick={() => setStep((current) => current + 1)}>下一步</button>
        : <button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? "正在准备…" : "进入 LifeOS"}</button>}
    </footer>
  </div></div>;
}
