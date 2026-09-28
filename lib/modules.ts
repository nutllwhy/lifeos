export const MODULES = [
  { id: "deals", label: "商单", blurb: "跟踪合作从接洽到结款的四个阶段" },
  { id: "contents", label: "稿件", blurb: "内容队列的状态、字数与待补点" },
  { id: "expenses", label: "记账", blurb: "按分类看钱花在了哪里" },
  { id: "health", label: "饮食与训练", blurb: "冰箱库存、临期提醒和训练记录" },
  { id: "platforms", label: "平台活动", blurb: "各平台活动档期与参与规则" },
  { id: "products", label: "个人产品", blurb: "自己项目的推进阶段" },
  { id: "review", label: "复盘", blurb: "日、周、月复盘归档" },
  { id: "assistant", label: "智能助理", blurb: "接入自己的模型服务，对话并可执行操作" },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export const DEFAULT_MODULES: readonly ModuleId[] = MODULES.map((module) => module.id);

export function normalizeModules(value: unknown): ModuleId[] {
  if (!Array.isArray(value)) return [...DEFAULT_MODULES];
  const known = new Set<string>(MODULES.map((module) => module.id));
  const picked = value.filter((item): item is ModuleId => typeof item === "string" && known.has(item));
  return picked;
}

export function moduleEnabled(enabled: readonly string[], id: ModuleId) {
  return enabled.includes(id);
}
