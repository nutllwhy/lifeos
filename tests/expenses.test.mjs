import assert from "node:assert/strict";
import test from "node:test";
import { EXPENSE_CATEGORIES, expenseAmountToCents, expenseDateTime, normalizeExpenseCategory } from "../lib/expenses.ts";
import { findRetryableExpenseRequest, hasExplicitMutationIntent, inferEventDeletionAction, isAssistantRetryRequest, isExpenseCaptureRequest, isInventoryPurchaseRequest, parseAssistantConversationContent, parseExpenseCapture, runAssistantConversation, runExpenseCapture } from "../lib/personal-assistant.ts";

const emptyConversationContext = {
  now: "2026-08-30T23:55:00+08:00",
  timezone: "Asia/Shanghai",
  upcomingEvents: [],
  openTasks: [],
  recentWorkouts: [],
  ingredients: [],
  activeDeals: [],
  contentItems: [],
  personalProducts: [],
  recentExpenses: [],
  todayFocusMinutes: 0,
  activeFocus: null,
  memories: [],
};

test("conversation lane repairs one malformed model response instead of giving up", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let repairMessages;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const content = calls === 1
      ? "好的，我已经帮你把这个日程加上去了。"
      : JSON.stringify({ reply: "已重新整理这个请求。", actions: [], memories: [] });
    if (calls === 2) repairMessages = JSON.parse(String(init?.body)).messages;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runAssistantConversation({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我增加个日程，9月19日去北京", emptyConversationContext, []);
    assert.equal(calls, 2);
    assert.equal(result.reply, "已重新整理这个请求。");
    assert.equal(repairMessages[repairMessages.length - 1].role, "user");
    assert.match(repairMessages[repairMessages.length - 1].content, /JSON/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conversation lane returns structured fallback when both attempts miss the format", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "直接聊天，没有 JSON。" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runAssistantConversation({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我增加个日程，9月19日去北京", emptyConversationContext, []);
    assert.equal(calls, 2);
    assert.match(result.reply, /没有拿到可执行的数据/);
    assert.equal(result.actions.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recognizes common spoken mutation verbs so assistant actions are not dropped", () => {
  assert.equal(hasExplicitMutationIntent("帮我增加个日程，9月19日我要去北京，早上9点42的高铁"), true);
  assert.equal(hasExplicitMutationIntent("帮我加个日程，明天下午三点开会"), true);
  assert.equal(hasExplicitMutationIntent("帮我加条日程，周五体检"), true);
  assert.equal(hasExplicitMutationIntent("帮我添加个日程，9月19日去北京"), true);
  assert.equal(hasExplicitMutationIntent("帮我新增一个日程"), true);
  assert.equal(hasExplicitMutationIntent("把这些假任务直接删掉"), true);
  assert.equal(hasExplicitMutationIntent("鸡蛋吃完了，帮我移除"), true);
  assert.equal(hasExplicitMutationIntent("开始专注 30 分钟"), true);
  assert.equal(hasExplicitMutationIntent("忘掉我刚才说的偏好"), true);
  assert.equal(hasExplicitMutationIntent("今天去北京的路线怎么安排？"), false);
});

test("recovers an explicit event deletion when the model only replies in prose", () => {
  const events = [{ title: "周复盘" }, { title: "企业培训方案对齐" }, { title: "周复盘" }];
  assert.deepEqual(inferEventDeletionAction("周复盘也是假的，去掉吧", events), { type: "delete_event", targetTitle: "周复盘" });
  assert.deepEqual(inferEventDeletionAction("这个周复盘一直去不掉", events), { type: "delete_event", targetTitle: "周复盘" });
  assert.equal(inferEventDeletionAction("周复盘一般怎么做？", events), null);
});

test("parses business-admin actions without dropping update or delete requests", () => {
  const parsed = parseAssistantConversationContent(JSON.stringify({
    reply: "收到",
    actions: [
      { type: "update_task", taskId: "task-1", title: "真实任务", estimatedMinutes: 60 },
      { type: "delete_tasks", taskIds: ["task-demo-1", "task-demo-2"] },
      { type: "consume_ingredient", ingredientId: "ingredient-1" },
      { type: "update_expense", expenseId: "expense-1", amount: 29.9, category: "餐饮" },
      { type: "focus_start", plannedMinutes: 30 },
      { type: "update_deal", dealId: "deal-1", stage: "delivery", publishedAt: "2026-09-10" },
      { type: "forget_memory", memoryId: "memory:abc" },
    ],
    memories: [],
  }), true);
  assert.deepEqual(parsed.actions.map((action) => action.type), [
    "update_task", "delete_tasks", "consume_ingredient", "update_expense", "focus_start", "update_deal", "forget_memory",
  ]);
  assert.equal(parsed.actions.find((action) => action.type === "delete_tasks")?.taskIds.length, 2);
  assert.equal(parsed.actions.find((action) => action.type === "update_deal")?.publishedAt, "2026-09-10");
});

test("stores expense amounts as integer cents", () => {
  assert.equal(expenseAmountToCents("38.6"), 3860);
  assert.equal(expenseAmountToCents(0.01), 1);
  assert.equal(expenseAmountToCents(0), null);
  assert.equal(expenseAmountToCents("not-a-number"), null);
});

test("keeps AI categories flexible while providing useful defaults", () => {
  assert.ok(EXPENSE_CATEGORIES.includes("餐饮"));
  assert.equal(normalizeExpenseCategory("  咖啡  "), "餐饮");
  assert.equal(normalizeExpenseCategory("  未知事物  "), "未知事物");
  assert.equal(normalizeExpenseCategory(""), "其他");
});

test("normalizes date-only expense input in Shanghai time", () => {
  assert.equal(expenseDateTime("2026-08-30"), "2026-08-30T04:00:00.000Z");
  assert.equal(expenseDateTime("bad"), null);
});

test("routes only explicit bookkeeping instructions to the expense fast path", () => {
  assert.equal(isExpenseCaptureRequest("帮我记个账，今天买菜花了 69.9"), true);
  assert.equal(isExpenseCaptureRequest("记一下：咖啡 28 元"), true);
  assert.equal(isExpenseCaptureRequest("今天咖啡 28 块，帮我记下"), true);
  assert.equal(isExpenseCaptureRequest("帮我记个帐，午饭 36 元"), true);
  assert.equal(isExpenseCaptureRequest("这个月的支出主要花在哪？"), false);
  assert.equal(isExpenseCaptureRequest("我今天买了一杯咖啡"), false);
});

test("only inventory-like purchases may add food stock", () => {
  assert.equal(isInventoryPurchaseRequest("帮我记账，今天在山姆采购了三文鱼和洗洁精"), true);
  assert.equal(isInventoryPurchaseRequest("帮我记账，买菜买了鸡蛋和芦笋"), true);
  assert.equal(isInventoryPurchaseRequest("记一下，午饭外卖 36 元"), false);
  assert.equal(isInventoryPurchaseRequest("记一下，买了一杯现喝咖啡 28 元"), false);
});

test("recognizes retry language and recovers the nearest failed expense instruction", () => {
  assert.equal(isAssistantRetryRequest("刚刚你没有加成功，再重试一次"), true);
  assert.equal(isAssistantRetryRequest("再分析一次这个问题"), false);
  assert.equal(isAssistantRetryRequest("再来一份咖啡"), false);
  assert.equal(isAssistantRetryRequest("重新做一下任务"), false);
  const createdAt = "2026-08-30T14:50:02.303Z";
  const rows = [
    { id: "assistant-reply:retry-1", role: "assistant", content: "我再试一次", actions: "[]", createdAt: "2026-08-30T15:20:00.460Z" },
    { id: "retry-1", role: "user", content: "刚刚你没有加成功，再重试一次", actions: "[]", createdAt: "2026-08-30T15:20:00.459Z" },
    { id: "assistant-reply:expense-1", role: "assistant", content: "6 笔都记好了", actions: "[]", createdAt: "2026-08-30T14:50:02.304Z" },
    { id: "expense-1", role: "user", content: "帮我记个账，咖啡 28 元", actions: "[]", createdAt },
  ];
  assert.deepEqual(findRetryableExpenseRequest(rows, new Date("2026-08-30T15:30:00Z").getTime()), {
    id: "expense-1",
    message: "帮我记个账，咖啡 28 元",
    createdAt,
  });
});

test("does not resurrect an old expense across unrelated conversation or completed receipts", () => {
  const failedExpense = [
    { id: "assistant-reply:expense-old", role: "assistant", content: "没写入", actions: "[]", createdAt: "2026-08-30T14:00:00Z" },
    { id: "expense-old", role: "user", content: "帮我记账，咖啡 28 元", actions: "[]", createdAt: "2026-08-30T13:59:59Z" },
  ];
  const unrelated = [
    { id: "assistant-reply:chat-1", role: "assistant", content: "回答", actions: "[]", createdAt: "2026-08-30T15:00:01Z" },
    { id: "chat-1", role: "user", content: "今天吃什么？", actions: "[]", createdAt: "2026-08-30T15:00:00Z" },
    ...failedExpense,
  ];
  assert.equal(findRetryableExpenseRequest(unrelated, new Date("2026-08-30T15:10:00Z").getTime()), null);

  const completed = [
    { id: "assistant-reply:expense-done", role: "assistant", content: "完成", actions: JSON.stringify([{ kind: "add_expense", state: "done", ok: true }]), createdAt: "2026-08-30T15:00:01Z" },
    { id: "expense-done", role: "user", content: "帮我记账，咖啡 28 元", actions: "[]", createdAt: "2026-08-30T15:00:00Z" },
  ];
  assert.equal(findRetryableExpenseRequest(completed, new Date("2026-08-30T15:10:00Z").getTime()), null);

  const partialInventory = [
    { id: "assistant-reply:expense-food", role: "assistant", content: "部分完成", actions: JSON.stringify([
      { kind: "add_expense", state: "done", ok: true },
      { kind: "add_ingredient", state: "failed", ok: false },
    ]), createdAt: "2026-08-30T15:00:01Z" },
    { id: "expense-food", role: "user", content: "帮我记账，山姆采购鸡蛋 28 元", actions: "[]", createdAt: "2026-08-30T15:00:00Z" },
  ];
  assert.equal(findRetryableExpenseRequest(partialInventory, new Date("2026-08-30T15:10:00Z").getTime())?.id, "expense-food");
});

test("does not rerun a pending expense confirmation", () => {
  const rows = [
    { id: "assistant-reply:expense-pending", role: "assistant", content: "待确认", actions: JSON.stringify([{ kind: "add_expense", state: "pending", ok: false }]), createdAt: "2026-08-30T15:00:01Z" },
    { id: "expense-pending", role: "user", content: "帮我记账，咖啡 28 元", actions: "[]", createdAt: "2026-08-30T15:00:00Z" },
  ];
  assert.equal(findRetryableExpenseRequest(rows, new Date("2026-08-30T15:10:00Z").getTime()), null);
});

test("assistant conversation accepts JSON wrapped in model prose and keeps plain answers readable", () => {
  const wrapped = parseAssistantConversationContent("我整理好了：\n{\"reply\":\"可以\",\"actions\":[],\"memories\":[]}\n以上。", false);
  assert.equal(wrapped.reply, "可以");
  const plain = parseAssistantConversationContent("今天适合吃清淡一点。", false);
  assert.equal(plain.reply, "今天适合吃清淡一点。");
  const unsafeMutation = parseAssistantConversationContent("已经帮你记好了。", true);
  assert.equal(unsafeMutation.actions.length, 0);
  assert.match(unsafeMutation.reply, /没有修改工作台/);
});

test("strictly parses all six expenses without silently truncating", () => {
  const actions = parseExpenseCapture(JSON.stringify({ expenses: [
    { title: "罗马奶油面包", amount: 69.9, category: "餐饮" },
    { title: "洗洁精", amount: 39.8, category: "居家" },
    { title: "菌菇芝士怡巴塔 5 个", amount: 39.9, category: "餐饮" },
    { title: "冷冻三文鱼 1 公斤", amount: 125.9, category: "餐饮" },
    { title: "牛油果油 1 升", amount: 62.9, category: "餐饮" },
    { title: "烘烤混合坚果仁 1.1 公斤", amount: 105.9, category: "餐饮" },
  ], ingredients: [
    { name: "罗马奶油面包", amount: "1 份", category: "主食", storage: "常温" },
    { name: "菌菇芝士恰巴塔", amount: "5 个", category: "主食", storage: "冷冻" },
    { name: "三文鱼", amount: "1 公斤", category: "蛋白质", storage: "冷冻" },
    { name: "牛油果油", amount: "1 升", category: "调味料", storage: "常温" },
    { name: "烘烤混合坚果仁", amount: "1.1 公斤", category: "其他", storage: "常温" },
  ] }));
  const expenses = actions.filter((action) => action.type === "add_expense");
  const ingredients = actions.filter((action) => action.type === "add_ingredient");
  assert.equal(expenses.length, 6);
  assert.equal(ingredients.length, 5);
  assert.equal(expenses.reduce((sum, action) => sum + expenseAmountToCents(action.amount), 0), 44430);
  assert.equal(ingredients.some((action) => action.name.includes("洗洁精")), false);
  assert.equal(ingredients.find((action) => action.name === "三文鱼")?.storage, "冷冻");
  assert.equal(ingredients.find((action) => action.name === "牛油果油")?.storage, "常温");
});

test("discards model-proposed inventory outside a stock purchase", () => {
  const actions = parseExpenseCapture(JSON.stringify({
    expenses: [{ title: "外卖午饭", amount: 36, category: "餐饮" }],
    ingredients: [{ name: "鸡蛋", amount: "6 个", category: "蛋白质", storage: "冷藏" }],
  }), false);
  assert.deepEqual(actions.map((action) => action.type), ["add_expense"]);
});

test("rejects natural-language completion claims and invalid partial batches", () => {
  assert.throws(() => parseExpenseCapture("6 笔都记好了"), /结构化结果/);
  assert.throws(() => parseExpenseCapture(JSON.stringify({ expenses: [{ title: "咖啡", amount: 28 }, { title: "漏金额" }] })), /第 2 笔/);
});

test("expense fast path uses low reasoning and requests structured JSON", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ expenses: [{ title: "咖啡", amount: 28, category: "餐饮" }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runExpenseCapture({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我记账，咖啡 28 元");
    assert.equal(result.actions.length, 1);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.thinking, undefined);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.messages.length, 2);
    assert.match(body.messages[0].content, /ingredients/);
    assert.match(body.messages[0].content, /不要加入洗洁精等非食品/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expense fast path repairs one malformed model response", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1 ? "已经记好了" : JSON.stringify({ expenses: [{ title: "午饭", amount: 36, category: "餐饮" }] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runExpenseCapture({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我记个账，午饭 36 元");
    assert.equal(calls, 2);
    assert.equal(result.actions.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expense fast path retries a transient GLM network error before any write", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: "1234", message: "网络错误，请稍后重试" } }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ expenses: [{ title: "咖啡", amount: 28, category: "餐饮" }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runExpenseCapture({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我记账，咖啡 28 元");
    assert.equal(calls, 2);
    assert.equal(result.actions.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persistent GLM network errors stop after three attempts and stay user-friendly", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "1234", message: "网络错误，错误id secret-provider-id，请稍后重试" } }), { status: 500, headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(
      runExpenseCapture({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我记账，咖啡 28 元"),
      (error) => {
        assert.match(error.message, /已自动重试仍未恢复/);
        assert.doesNotMatch(error.message, /secret-provider-id|\{"error"/);
        return true;
      },
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("permanent model request errors are not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: "1214", message: "参数错误" } }), { status: 400, headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(
      runExpenseCapture({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "帮我记账，咖啡 28 元"),
      /AI 请求失败（400）：参数错误/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordinary assistant conversation also recovers from one GLM 1234 error", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: "1234", message: "网络错误" } }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "已经恢复。", actions: [], memories: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const context = {
    now: "2026-08-30T23:55:00+08:00",
    timezone: "Asia/Shanghai",
    upcomingEvents: [],
    openTasks: [],
    recentWorkouts: [],
    ingredients: [],
    activeDeals: [],
    contentItems: [],
    personalProducts: [],
    recentExpenses: [],
    todayFocusMinutes: 0,
    memories: [],
  };
  try {
    const result = await runAssistantConversation({ baseUrl: "https://example.com/v4", apiKey: "test-key", model: "glm-5.3-flash" }, "给我一个简单建议", context, []);
    assert.equal(calls, 2);
    assert.equal(result.reply, "已经恢复。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
