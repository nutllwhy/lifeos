// Fictional demo dataset. Every brand, name and amount here is invented; it
// exists so a fresh install can show what each view looks like when used.
import { DEAL_CATEGORY_OPTIONS } from "./deals";

function shiftDay(offset: number, hour = 9, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function at(offset: number, hour = 9, minute = 0) {
  return shiftDay(offset, hour, minute).toISOString();
}

function on(offset: number) {
  const date = shiftDay(offset, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(offset: number) {
  const date = shiftDay(offset, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const DEMO = "demo";

export const demoGoals = {
  annual: ["跑通第二个收入来源，摆脱单一平台依赖", "把作品做成所在领域可被点名的那一个"],
  quarterly: ["上线第一个有人付费的小工具", "完成 10 条长视频并保持周更不断档"],
};

export const demoTasks = [
  { title: "整理「AI 做客服」选题的证据链", project: "内容商单", priority: "high", estimatedMinutes: 90, dueOffset: 0, dueHour: 18 },
  { title: "写云梯智能公众号初稿", project: "内容商单", priority: "high", estimatedMinutes: 120, dueOffset: 1, dueHour: 17 },
  { title: "复核星海科技素材授权范围", project: "内容商单", priority: "medium", estimatedMinutes: 45, dueOffset: 2, dueHour: 11 },
  { title: "把长视频拆成 3 条短视频", project: "内容分发", priority: "medium", estimatedMinutes: 60, dueOffset: 2, dueHour: 15 },
  { title: "补齐工作台首次配置向导", project: "个人产品", priority: "medium", estimatedMinutes: 90, dueOffset: 3, dueHour: 20 },
  { title: "复盘上月商单利润率", project: "经营", priority: "low", estimatedMinutes: 40, dueOffset: 4, dueHour: 14 },
  { title: "预约牙洁牙", project: "生活", priority: "low", estimatedMinutes: 15, dueOffset: 5, dueHour: 10 },
  { title: "确认本月选题和发布节奏", project: "内容计划", priority: "medium", estimatedMinutes: 30, dueOffset: -1, dueHour: 18, done: true },
  { title: "录制南屿咖啡探店口播", project: "内容商单", priority: "high", estimatedMinutes: 60, dueOffset: -2, dueHour: 14, done: true },
];

export const demoEvents = [
  { title: "星海科技 · 需求对齐", startOffset: 0, startHour: 10, startMinute: 30, durationMinutes: 50, category: "deal", location: "线上会议" },
  { title: "深度写作时段", startOffset: 0, startHour: 14, startMinute: 0, durationMinutes: 120, category: "focus", location: "书房" },
  { title: "云梯智能 · 初稿评审", startOffset: 1, startHour: 15, startMinute: 30, durationMinutes: 60, category: "deal", location: "线上会议" },
  { title: "力量训练", startOffset: 1, startHour: 19, startMinute: 30, durationMinutes: 60, category: "health", location: "健身房" },
  { title: "内容排期会", startOffset: 2, startHour: 11, startMinute: 0, durationMinutes: 45, category: "meeting", location: "线上会议" },
  { title: "家庭日", startOffset: 5, startHour: 10, startMinute: 0, durationMinutes: 300, category: "personal", location: "" },
];

export const demoDeals = [
  { title: "星海科技 · AI 客服实测", stage: "execution", categories: ["长视频", "图文"], price: 18000, paidAmount: null, receivedOffset: -9, publishOffset: 6, settled: false },
  { title: "云梯智能 · 公众号深度合作", stage: "lead", categories: ["公众号"], price: 9000, paidAmount: null, receivedOffset: -2, publishOffset: 12, settled: false },
  { title: "南屿咖啡 · 探店短视频", stage: "delivery", categories: ["短视频"], price: 4500, paidAmount: null, receivedOffset: -18, publishOffset: -3, settled: false },
  { title: "拾光文化 · 读书会长图文", stage: "paid", categories: ["图文", "社群"], price: 6000, paidAmount: 6000, receivedOffset: -34, publishOffset: -20, settled: true },
  { title: "橙野出行 · 城市路线直播", stage: "paid", categories: ["直播"], price: 12000, paidAmount: 12000, receivedOffset: -41, publishOffset: -27, settled: true },
  { title: "蓝鲸数据 · 年度报告解读", stage: "lead", categories: ["公众号", "即刻"], price: 7500, paidAmount: null, receivedOffset: -1, publishOffset: 16, settled: false },
  { title: "未山设计 · 工具链使用分享", stage: "paid", categories: ["长视频"], price: 11000, paidAmount: 11000, receivedOffset: -55, publishOffset: -40, settled: true },
];

export const demoExpenses = [
  { title: "麦克风防喷罩", amountCents: 12800, category: "设备", offset: -1 },
  { title: "剪辑软件订阅", amountCents: 15800, category: "软件", offset: -2 },
  { title: "山姆采购", amountCents: 48650, category: "食品", offset: -3 },
  { title: "健身房月卡", amountCents: 39900, category: "健康", offset: -4 },
  { title: "打印脚本资料", amountCents: 3200, category: "办公", offset: -6 },
  { title: "打车去拍摄场地", amountCents: 6700, category: "交通", offset: -8 },
  { title: "VPS 续费", amountCents: 21600, category: "软件", offset: -11 },
];

export const demoContents = [
  { title: "AI 客服真的能替掉人工吗", kind: "长视频脚本", status: "写作中", wordCount: 3200, pending: 4, deal: "星海科技 · AI 客服实测" },
  { title: "云梯智能 · 公众号初稿", kind: "公众号文章", status: "初稿完成", wordCount: 2100, pending: 2, deal: "云梯智能 · 公众号深度合作" },
  { title: "南屿咖啡探店口播", kind: "短视频脚本", status: "待发布", wordCount: 680, pending: 0, deal: "南屿咖啡 · 探店短视频" },
  { title: "读书会长图文", kind: "图文", status: "已发布", wordCount: 1450, pending: 0, deal: "拾光文化 · 读书会长图文" },
  { title: "年度报告解读提纲", kind: "公众号文章", status: "构思中", wordCount: 240, pending: 6, deal: "蓝鲸数据 · 年度报告解读" },
  { title: "工具链使用分享成片备注", kind: "长视频脚本", status: "已归档", wordCount: 900, pending: 0, deal: "未山设计 · 工具链使用分享" },
];

export const demoIngredients = [
  { name: "鸡蛋", amount: "10 个", category: "蛋奶", storage: "冷藏", expiresIn: 12 },
  { name: "牛奶", amount: "1 L", category: "蛋奶", storage: "冷藏", expiresIn: 4 },
  { name: "鸡胸肉", amount: "600 g", category: "肉类", storage: "冷冻", expiresIn: 30 },
  { name: "三文鱼", amount: "200 g", category: "海鲜", storage: "冷藏", expiresIn: 1 },
  { name: "西兰花", amount: "1 颗", category: "蔬菜", storage: "冷藏", expiresIn: 3 },
  { name: "番茄", amount: "5 个", category: "蔬菜", storage: "冷藏", expiresIn: 6 },
  { name: "冷冻蓝莓", amount: "500 g", category: "水果", storage: "冷冻", expiresIn: 60 },
  { name: "全麦面包", amount: "1 袋", category: "主食", storage: "常温", expiresIn: 5 },
  { name: "意面", amount: "400 g", category: "主食", storage: "常温", expiresIn: 120 },
  { name: "希腊酸奶", amount: "4 杯", category: "蛋奶", storage: "冷藏", expiresIn: 9 },
];

export const demoWorkouts = [
  { type: "力量训练", offset: -1, hour: 19, durationMinutes: 62, intensity: "较高", notes: "深蹲 5×5，重量比上周加 5 kg" },
  { type: "跑步", offset: -3, hour: 7, durationMinutes: 41, intensity: "中等", notes: "8 km，配速 5'10\"" },
  { type: "力量训练", offset: -4, hour: 20, durationMinutes: 55, intensity: "中等", notes: "上肢推拉" },
  { type: "拉伸", offset: -6, hour: 22, durationMinutes: 20, intensity: "低", notes: "睡前放松" },
  { type: "跑步", offset: -7, hour: 7, durationMinutes: 35, intensity: "中等", notes: "6 km" },
];

export const demoPromotions = [
  { platform: "视频号", topic: "AI 工具实测月", startOffset: -5, endOffset: 9, rules: "带话题发布满 4 条可进流量池", note: "本周先发 2 条", status: "active" },
  { platform: "公众号", topic: "读书季征稿", startOffset: -12, endOffset: 3, rules: "原创长文，阅读量前 20 给推荐位", note: "投稿已提交", status: "active" },
  { platform: "小红书", topic: "夏日探店", startOffset: 2, endOffset: 24, rules: "图文满 3 张 + 定位", note: "等南屿咖啡素材回传", status: "planned" },
];

export const demoProducts = [
  { name: "个人工作台", path: "workspace", stage: "开发中", note: "开源整理进行中，先做隐私清理与安装包" },
  { name: "素材库管理器", path: "media-library", stage: "开发中", note: "本地索引已跑通，待做批量打标" },
  { name: "写作选题库", path: "ideas", stage: "计划中", note: "想清楚是独立产品还是工作台的一个模块" },
  { name: "复盘模板集", path: "review-templates", stage: "已上线", note: "每月更新一次" },
];

export const demoReviews = [
  {
    offset: -1,
    payload: {
      summary: "任务完成 3/5，深度工作 2.4 小时，训练一次。商单推进集中在星海科技，云梯智能初稿仍未开始。",
      wins: ["星海科技素材清单提前交付", "完成 62 分钟力量训练", "记账连续 5 天没有断"],
      unfinished: [{ item: "云梯智能公众号初稿", action: "明天上午安排 90 分钟专注时段写完初稿" }],
      signals: ["高优先级任务集中在 18 点后，与深度工作时段错位", "本周 4 条任务落在「内容商单」，其他项目几乎没有推进"],
      tomorrowTop3: [
        { title: "云梯智能公众号初稿", why: "发布日只剩 3 天，且依赖初稿才能进入评审", minutes: 90 },
        { title: "整理星海科技实测证据", why: "决定长视频能否按期开拍", minutes: 45 },
        { title: "清理冰箱临期食材", why: "三文鱼明天到期", minutes: 20 },
      ],
      question: "要不要把「内容商单」拆成准备、制作、发布三个阶段来排期？",
    },
  },
  {
    offset: -7,
    payload: {
      summary: "本周完成 12 件任务，深度工作 9.6 小时，训练 3 次，支出 ¥1,064。两条商单进入结算。",
      wins: ["南屿咖啡探店片交付", "拾光文化尾款到账", "恢复每周 3 次训练"],
      unfinished: [{ item: "工作台首次配置向导", action: "下周拆成两个下午的独立任务" }],
      signals: ["周三、周四是产出最高的两天", "周末任务完成率明显低于工作日"],
      tomorrowTop3: [
        { title: "确定下周商单排期", why: "两条新合作在等档期", minutes: 40 },
        { title: "补齐工作台文档", why: "开源前必须完成", minutes: 90 },
        { title: "整理素材库命名规则", why: "减少重复找素材的时间", minutes: 30 },
      ],
      question: "下周要不要把训练固定到周二和周四？",
    },
  },
];

let counter = 0;
function demoId(group: string) {
  counter += 1;
  return `demo-${group}-${counter}`;
}

export function buildDemoRows() {
  counter = 0;
  const currentMonth = monthKey(0);
  return {
    tasks: demoTasks.map((item) => ({
      id: demoId("task"),
      title: item.title,
      project: item.project,
      status: item.done ? "done" : "todo",
      priority: item.priority,
      estimatedMinutes: item.estimatedMinutes,
      dueDate: at(item.dueOffset, item.dueHour),
      completedAt: item.done ? at(item.dueOffset, item.dueHour + 2) : null,
      source: DEMO,
    })),
    events: demoEvents.map((item) => ({
      id: demoId("event"),
      title: item.title,
      startAt: at(item.startOffset, item.startHour, item.startMinute),
      endAt: new Date(shiftDay(item.startOffset, item.startHour, item.startMinute).getTime() + item.durationMinutes * 60000).toISOString(),
      category: item.category,
      location: item.location,
      source: DEMO,
      status: "confirmed",
    })),
    deals: demoDeals.map((item) => ({
      id: demoId("deal"),
      title: item.title,
      stage: item.stage,
      categories: JSON.stringify(item.categories.filter((category): category is (typeof DEAL_CATEGORY_OPTIONS)[number] =>
        DEAL_CATEGORY_OPTIONS.includes(category as (typeof DEAL_CATEGORY_OPTIONS)[number])
      )),
      price: item.price,
      paidAmount: item.paidAmount,
      receivedAt: at(item.receivedOffset, 11),
      publishedAt: at(item.publishOffset, 18),
      month: monthKey(item.publishOffset),
      source: DEMO,
    })),
    expenses: demoExpenses.map((item) => ({
      id: demoId("expense"),
      title: item.title,
      amountCents: item.amountCents,
      category: item.category,
      spentAt: at(item.offset, 13),
      note: "",
      source: DEMO,
    })),
    contents: demoContents.map((item) => ({
      id: demoId("content"),
      title: item.title,
      kind: item.kind,
      status: item.status,
      wordCount: item.wordCount,
      pendingCount: item.pending,
      linkedDeal: item.deal,
      modifiedAt: at(-1, 21),
      createdAt: at(-3, 10),
    })),
    ingredients: demoIngredients.map((item) => ({
      id: demoId("ingredient"),
      name: item.name,
      amount: item.amount,
      category: item.category,
      storage: item.storage,
      expiresAt: on(item.expiresIn),
      note: "",
    })),
    workouts: demoWorkouts.map((item) => ({
      id: demoId("workout"),
      type: item.type,
      startedAt: at(item.offset, item.hour),
      durationMinutes: item.durationMinutes,
      intensity: item.intensity,
      notes: item.notes,
      source: DEMO,
    })),
    promotions: demoPromotions.map((item) => ({
      id: demoId("promotion"),
      platform: item.platform,
      topic: item.topic,
      startDate: on(item.startOffset),
      endDate: on(item.endOffset),
      rules: item.rules,
      note: item.note,
      status: item.status,
    })),
    products: demoProducts.map((item) => ({
      id: demoId("product"),
      name: item.name,
      path: item.path,
      stage: item.stage,
      note: item.note,
    })),
    reviews: demoReviews.map((item) => ({
      id: demoId("review"),
      reviewDate: on(item.offset),
      periodType: "daily",
      periodKey: on(item.offset),
      rangeStart: on(item.offset),
      rangeEnd: on(item.offset),
      content: JSON.stringify(item.payload),
      generationCount: 1,
      generatedAt: at(item.offset, 21, 30),
    })),
    currentMonth,
  };
}
