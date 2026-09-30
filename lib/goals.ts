export type Goals = { annual: string[]; quarterly: string[] };

export const EMPTY_GOALS: Goals = { annual: [], quarterly: [] };

export function parseGoals(value: unknown): Goals {
  const source = typeof value === "string" ? safeJson(value) : value;
  if (!source || typeof source !== "object") return { ...EMPTY_GOALS };
  const record = source as Record<string, unknown>;
  return {
    annual: textList(record.annual),
    quarterly: textList(record.quarterly),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 6);
}

export function currentQuarterLabel(date = new Date()) {
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
}
