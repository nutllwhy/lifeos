import assert from "node:assert/strict";
import test from "node:test";
import {
  daysLeft,
  formatPlatformRange,
  groupPromotions,
  isExpired,
  isExpiringSoon,
  knownPlatforms,
  localToday,
} from "../lib/platforms.ts";

const row = (id, platform, endDate, startDate = null) => ({
  id,
  platform,
  topic: `话题${id}`,
  startDate,
  endDate,
});

// 2026-09-30 local midnight, so the fixtures stay stable whatever day is run on.
const TODAY = localToday(new Date(2026, 8, 30));

test("every platform the user typed becomes a peer card", () => {
  const { grouped } = groupPromotions(
    [
      row("1", "视频号", "2026-10-09"),
      row("2", "公众号", "2026-10-03"),
      row("3", "小红书", "2026-10-24"),
      row("4", "公众号", null),
    ],
    TODAY,
  );
  assert.deepEqual(grouped.map((group) => group.platform).slice(0, 1), ["公众号"]);
  assert.deepEqual(grouped.map((group) => group.platform).sort(), ["公众号", "小红书", "视频号"].sort());
  assert.deepEqual(grouped[0].items.map((item) => item.id), ["2", "4"]);
  assert.ok(!grouped.some((group) => group.platform.includes("其他")));
});

test("unnamed platforms are kept rather than dropped", () => {
  const { grouped } = groupPromotions([row("1", "   ", null)], TODAY);
  assert.deepEqual(grouped.map((group) => group.platform), ["未命名平台"]);
});

test("expiry comes from the end date, not a stored status", () => {
  const ended = row("1", "B站", "2026-09-29");
  const lastDay = row("2", "B站", "2026-09-30");
  const openEnded = row("3", "B站", null);
  assert.equal(isExpired(ended, TODAY), true);
  assert.equal(isExpired(lastDay, TODAY), false);
  assert.equal(isExpired(openEnded, TODAY), false);
  const { grouped, expired } = groupPromotions([ended, lastDay, openEnded], TODAY);
  assert.deepEqual(expired.map((item) => item.id), ["1"]);
  assert.deepEqual(grouped[0].items.map((item) => item.id), ["2", "3"]);
});

test("the final week of a campaign is flagged, an expired one is not", () => {
  assert.equal(daysLeft(row("1", "小红书", "2026-10-07"), TODAY), 7);
  assert.equal(isExpiringSoon(row("1", "小红书", "2026-10-07"), TODAY), true);
  assert.equal(isExpiringSoon(row("2", "小红书", "2026-10-08"), TODAY), false);
  assert.equal(isExpiringSoon(row("3", "小红书", "2026-09-01"), TODAY), false);
  assert.equal(daysLeft(row("4", "小红书", null), TODAY), null);
});

test("a calendar day reads as the same day it was entered as", () => {
  assert.equal(formatPlatformRange(row("1", "小红书", "2026-10-24", "2026-10-02")), "10月2日 – 10月24日");
  assert.equal(formatPlatformRange(row("2", "小红书", null, "2026-10-02")), "从 10月2日 起");
  assert.equal(formatPlatformRange(row("3", "小红书", "2026-10-24")), "到 10月24日 止");
  assert.equal(formatPlatformRange(row("4", "小红书", null)), "");
});

test("suggestions come from real records and stay deduplicated", () => {
  assert.deepEqual(knownPlatforms([row("1", " 小红书 ", null), row("2", "小红书", null), row("3", "", null)]), ["小红书"]);
});
