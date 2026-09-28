export const DEAL_STAGES = ["lead", "execution", "delivery", "paid"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_CATEGORY_OPTIONS = ["公众号", "长视频", "短视频", "图文", "社群", "即刻", "直播"] as const;
export type DealCategory = (typeof DEAL_CATEGORY_OPTIONS)[number];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  lead: "未开始",
  execution: "进行中",
  delivery: "已完成",
  paid: "已结算",
};

export type DealRow = {
  id: string;
  title: string;
  stage: string;
  categories: string;
  price: number | null;
  paidAmount: number | null;
  receivedAt: string | null;
  publishedAt: string | null;
  month: string | null;
  source: string;
};

export type DealView = {
  id: string;
  brand: string;
  campaign: string;
  stage: DealStage;
  nextAction: string;
  deadline: string | null;
  month: string | null;
  amountLabel: string;
  source: string;
  category: string;
  categories: DealCategory[];
  settled: boolean;
  price: number | null;
  paidAmount: number | null;
  receivedAt: string | null;
};

const NEXT_ACTION: Record<DealStage, string> = {
  lead: "确认排期",
  execution: "按计划推进",
  delivery: "跟进结算",
  paid: "已归档",
};

export function normalizeDealStage(value: unknown): DealStage {
  return DEAL_STAGES.includes(value as DealStage) ? (value as DealStage) : "lead";
}

export function normalizeDealCategories(value: unknown): DealCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DealCategory =>
    DEAL_CATEGORY_OPTIONS.includes(item as DealCategory)
  );
}

export function parseDealCategories(value: string): DealCategory[] {
  try {
    return normalizeDealCategories(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function toDealView(row: DealRow): DealView {
  const stage = normalizeDealStage(row.stage);
  const categories = parseDealCategories(row.categories);
  const category = categories.join(" / ");
  const settled = stage === "paid";
  return {
    id: row.id,
    brand: row.title.split(/[ ·]/)[0],
    campaign: row.title,
    stage,
    nextAction: category ? `${NEXT_ACTION[stage]} · ${category}` : NEXT_ACTION[stage],
    deadline: row.publishedAt,
    month: row.month,
    amountLabel: `${row.price ? `¥${row.price.toLocaleString("zh-CN")}` : "金额待定"} · ${settled ? "已结算" : "未结算"}`,
    source: row.source,
    category,
    categories,
    settled,
    price: row.price,
    paidAmount: row.paidAmount,
    receivedAt: row.receivedAt,
  };
}
