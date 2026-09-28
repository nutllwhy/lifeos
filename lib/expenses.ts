export const EXPENSE_CATEGORIES = [
  "生鲜食材",
  "餐饮",
  "熟食零食",
  "日用品",
  "交通出行",
  "健康医疗",
  "服饰美容",
  "居住物业",
  "娱乐学习",
  "人情往来",
  "其他",
] as const;

// 旧分类到新分类的映射，用于历史数据迁移和兼容
const CATEGORY_ALIASES: Record<string, string> = {
  "肉类食材": "生鲜食材",
  "食材调味": "生鲜食材",
  "蔬菜": "生鲜食材",
  "水果": "生鲜食材",
  "粮油调味": "生鲜食材",
  "熟食肉类": "熟食零食",
  "熟食面点": "熟食零食",
  "零食饮料": "熟食零食",
  "厨房用品": "日用品",
  "日用": "日用品",
  "保健品": "健康医疗",
  "交通": "交通出行",
  "购物": "其他",
  "居住": "居住物业",
  "健康": "健康医疗",
  "娱乐": "娱乐学习",
  "学习": "娱乐学习",
  "娱乐休闲": "娱乐学习",
  "学习成长": "娱乐学习",
  "人情": "人情往来",
  "工作": "其他",
  "旅行": "娱乐学习",
};

export function expenseAmountToCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null;
  return Math.round(amount * 100);
}

export function normalizeExpenseCategory(value: unknown) {
  const raw = typeof value === "string" ? value.trim().slice(0, 20) : "";
  if (!raw) return "其他";
  // 精确匹配预定义分类
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(raw)) return raw;
  // 匹配别名
  if (CATEGORY_ALIASES[raw]) return CATEGORY_ALIASES[raw];
  // 模糊匹配（顺序即优先级）
  if (/肉|鱼|虾|蟹|海鲜|蔬菜|水果|蛋|豆|生鲜|菌|菇|肠|腊味|火腿|培根/.test(raw)) return "生鲜食材";
  if (/外卖|餐厅|下馆子|堂食|聚餐|火锅|烧烤|奶茶|咖啡|早饭|午饭|晚饭|早餐|午餐|晚餐|夜宵|吃饭|炒饭|煲仔饭|盖浇饭|拌饭|盒饭|快餐|拉面/.test(raw)) return "餐饮";
  if (/熟食|面包|蛋糕|糕点|月饼|烘焙|饺子|馄饨|包子|馒头|烧饼|三明治|便当|白斩鸡|卤味/.test(raw)) return "熟食零食";
  if (/宠物|猫粮|猫罐头|狗粮/.test(raw)) return "其他";
  if (/油|盐|酱|醋|调料|调味|米|粮|坚果|干货|粉丝|意大利面|意面|冷面|挂面|乌冬/.test(raw)) return "生鲜食材";
  if (/零食|饮料|酒|苏打|矿泉水|酸奶/.test(raw)) return "熟食零食";
  if (/日用|清洁|洗衣|纸|洗漱/.test(raw)) return "日用品";
  if (/厨房|锅|碗|刀|铲|擦丝/.test(raw)) return "日用品";
  if (/交通|打车|地铁|公交|加油|停车|出行/.test(raw)) return "交通出行";
  if (/保健|药|医疗|医院|体检/.test(raw)) return "健康医疗";
  if (/衣服|鞋|护肤|化妆|美容|饰品|首饰|眼镜|镜片|浴袍|袍|面膜|口红|眼影|粉底|彩妆|洗面奶/.test(raw)) return "服饰美容";
  if (/房租|水电|物业|维修|居住/.test(raw)) return "居住物业";
  if (/电影|游戏|旅游|聚会|娱乐/.test(raw)) return "娱乐学习";
  if (/书|课程|培训|学习/.test(raw)) return "娱乐学习";
  if (/礼物|红包|请客|人情/.test(raw)) return "人情往来";
  return raw || "其他";
}

export function expenseDateTime(value: unknown, fallback = new Date()) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback.toISOString();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00+08:00` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
