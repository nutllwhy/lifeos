import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAL_CATEGORY_OPTIONS,
  DEAL_STAGES,
  normalizeDealCategories,
  normalizeDealStage,
  parseDealCategories,
  toDealView,
} from "../lib/deals.ts";

const base = {
  id: "deal-1",
  title: "星海科技 · AI 客服实测",
  stage: "execution",
  categories: JSON.stringify(["长视频", "图文"]),
  price: 18000,
  paidAmount: null,
  receivedAt: "2026-09-01T03:00:00.000Z",
  publishedAt: "2026-10-02T10:00:00.000Z",
  month: "2026-10",
  source: "demo",
};

test("derives the workbench deal view from a local row", () => {
  const view = toDealView(base);
  assert.equal(view.brand, "星海科技");
  assert.equal(view.campaign, base.title);
  assert.equal(view.stage, "execution");
  assert.equal(view.settled, false);
  assert.equal(view.category, "长视频 / 图文");
  assert.match(view.nextAction, /按计划推进/);
  assert.equal(view.amountLabel, "¥18,000 · 未结算");
  assert.equal(view.deadline, base.publishedAt);
});

test("only the paid stage counts as settled", () => {
  for (const stage of DEAL_STAGES) {
    assert.equal(toDealView({ ...base, stage }).settled, stage === "paid");
  }
  assert.match(toDealView({ ...base, stage: "paid", paidAmount: 18000 }).amountLabel, /已结算/);
});

test("falls back instead of trusting unknown stage values", () => {
  assert.equal(normalizeDealStage("lead"), "lead");
  assert.equal(normalizeDealStage("已结算"), "lead");
  assert.equal(normalizeDealStage(undefined), "lead");
});

test("drops categories the workspace does not offer", () => {
  assert.deepEqual(normalizeDealCategories(["公众号", "不存在"]), ["公众号"]);
  assert.deepEqual(normalizeDealCategories("公众号"), []);
  assert.deepEqual(normalizeDealCategories(undefined), []);
  assert.ok(DEAL_CATEGORY_OPTIONS.length > 0);
});

test("survives corrupted category JSON instead of throwing", () => {
  assert.deepEqual(parseDealCategories("{not json"), []);
  assert.deepEqual(parseDealCategories('["即刻"]'), ["即刻"]);
  assert.equal(toDealView({ ...base, categories: "{not json" }).category, "");
  assert.match(toDealView({ ...base, categories: "{not json", price: null }).amountLabel, /金额待定/);
});
