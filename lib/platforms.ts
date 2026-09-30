export type PlatformPromotionLike = {
  id: string;
  platform: string;
  topic: string;
  startDate: string | null;
  endDate: string | null;
};

export type PlatformGroup<T> = { platform: string; items: T[] };

const DAY_MS = 86_400_000;

// "YYYY-MM-DD" names a calendar day, not an instant: Date.parse reads it as UTC
// midnight, which lands on the previous day anywhere west of Greenwich. Both the
// expiry comparison and the printed label need the same local-midnight anchor.
function localDay(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

export function localToday(date = new Date()): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function daysLeft(promotion: PlatformPromotionLike, today = localToday()): number | null {
  if (!promotion.endDate) return null;
  const end = localDay(promotion.endDate);
  if (end === null) return null;
  return Math.round((end - today) / DAY_MS);
}

export function isExpired(promotion: PlatformPromotionLike, today = localToday()): boolean {
  const left = daysLeft(promotion, today);
  return left !== null && left < 0;
}

export function isExpiringSoon(promotion: PlatformPromotionLike, today = localToday()): boolean {
  const left = daysLeft(promotion, today);
  return left !== null && left >= 0 && left <= 7;
}

export function formatPlatformRange(promotion: PlatformPromotionLike): string {
  const { startDate, endDate } = promotion;
  if (!startDate && !endDate) return "";
  const fmt = (value: string) => {
    const stamp = localDay(value);
    if (stamp === null) return value;
    const day = new Date(stamp);
    return `${day.getMonth() + 1}月${day.getDate()}日`;
  };
  if (startDate && endDate) return `${fmt(startDate)} – ${fmt(endDate)}`;
  if (startDate) return `从 ${fmt(startDate)} 起`;
  return endDate ? `到 ${fmt(endDate)} 止` : "";
}

export function groupPromotions<T extends PlatformPromotionLike>(
  promotions: T[],
  today = localToday(),
): { grouped: PlatformGroup<T>[]; expired: T[] } {
  const active = promotions.filter((item) => !isExpired(item, today));
  const expired = promotions.filter((item) => isExpired(item, today));
  // Group by whatever platform the user typed. There is no curated shortlist, so
  // every platform is a peer instead of the odd ones out landing in a catch-all.
  const byPlatform = new Map<string, T[]>();
  for (const item of active) {
    const key = item.platform.trim() || "未命名平台";
    const bucket = byPlatform.get(key);
    if (bucket) bucket.push(item);
    else byPlatform.set(key, [item]);
  }
  const grouped = [...byPlatform.entries()]
    .map(([platform, items]) => ({ platform, items }))
    .sort((a, b) => b.items.length - a.items.length || a.platform.localeCompare(b.platform, "zh-CN"));
  return { grouped, expired };
}

export function knownPlatforms(promotions: PlatformPromotionLike[]): string[] {
  return [...new Set(promotions.map((item) => item.platform.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}
