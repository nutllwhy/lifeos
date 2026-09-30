import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  project: text("project").notNull().default("收件箱"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(30),
  dueDate: text("due_date"),
  scheduledStart: text("scheduled_start"),
  completedAt: text("completed_at"),
  assistantRank: integer("assistant_rank"),
  assistantRankDate: text("assistant_rank_date"),
  assistantReason: text("assistant_reason").notNull().default(""),
  source: text("source").notNull().default("local"),
  externalId: text("external_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_tasks_status_due_date").on(table.status, table.dueDate)]);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  category: text("category").notNull().default("meeting"),
  location: text("location").notNull().default(""),
  source: text("source").notNull().default("local"),
  externalId: text("external_id"),
  status: text("status").notNull().default("confirmed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_events_start_at").on(table.startAt)]);

export const focusSessions = sqliteTable("focus_sessions", {
  id: text("id").primaryKey(),
  plannedMinutes: integer("planned_minutes").notNull().default(30),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_focus_sessions_status_started").on(table.status, table.startedAt),
]);

export const expenseEntries = sqliteTable("expense_entries", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull().default("其他"),
  spentAt: text("spent_at").notNull(),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("workspace"),
  externalId: text("external_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_expense_entries_spent_at").on(table.spentAt),
  index("idx_expense_entries_category_spent").on(table.category, table.spentAt),
]);

export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("lead"),
  categories: text("categories").notNull().default("[]"),
  price: integer("price"),
  paidAmount: integer("paid_amount"),
  receivedAt: text("received_at"),
  publishedAt: text("published_at"),
  month: text("month"),
  source: text("source").notNull().default("local"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_deals_stage_published").on(table.stage, table.publishedAt)]);

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("笔记"),
  status: text("status").notNull().default("写作中"),
  wordCount: integer("word_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  linkedDeal: text("linked_deal"),
  modifiedAt: text("modified_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_content_items_modified_at").on(table.modifiedAt),
  index("idx_content_items_linked_deal").on(table.linkedDeal),
]);

export const ingredients = sqliteTable("ingredients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  amount: text("amount").notNull().default("适量"),
  category: text("category").notNull().default("其他"),
  storage: text("storage").notNull().default("冷藏"),
  expiresAt: text("expires_at"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_ingredients_expires_at").on(table.expiresAt)]);

export const workouts = sqliteTable("workouts", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  startedAt: text("started_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  intensity: text("intensity").notNull().default("中等"),
  notes: text("notes").notNull().default(""),
  source: text("source").notNull().default("workspace"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_workouts_started_at").on(table.startedAt)]);

export const platformPromotions = sqliteTable("platform_promotions", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  topic: text("topic").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  rules: text("rules").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_platform_promotions_platform").on(table.platform)]);

export const personalProducts = sqliteTable("personal_products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  stage: text("stage").notNull().default("计划中"),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_personal_products_stage").on(table.stage)]);

export const workspaceSettings = sqliteTable("workspace_settings", {
  id: text("id").primaryKey(),
  enabledModules: text("enabled_modules").notNull().default("[]"),
  goals: text("goals").notNull().default('{"annual":[],"quarterly":[]}'),
  onboardedAt: text("onboarded_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assistantSettings = sqliteTable("assistant_settings", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("openai-compatible"),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  reviewTime: text("review_time").notNull().default("21:30"),
  autoReview: integer("auto_review", { mode: "boolean" }).notNull().default(true),
  lastCallAt: text("last_call_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailyReviews = sqliteTable("daily_reviews", {
  id: text("id").primaryKey(),
  reviewDate: text("review_date").notNull(),
  periodType: text("period_type").notNull().default("daily"),
  periodKey: text("period_key").notNull().default(""),
  rangeStart: text("range_start").notNull().default(""),
  rangeEnd: text("range_end").notNull().default(""),
  content: text("content").notNull(),
  generationCount: integer("generation_count").notNull().default(1),
  generatedAt: text("generated_at").notNull(),
}, (table) => [
  index("idx_daily_reviews_date").on(table.reviewDate),
  index("idx_daily_reviews_period").on(table.periodType, table.periodKey),
]);

export const assistantMessages = sqliteTable("assistant_messages", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  actions: text("actions").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_assistant_messages_created_at").on(table.createdAt)]);

export const assistantMemories = sqliteTable("assistant_memories", {
  id: text("id").primaryKey(),
  category: text("category").notNull().default("preference"),
  content: text("content").notNull(),
  sourceMessageId: text("source_message_id"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_assistant_memories_status_updated").on(table.status, table.updatedAt)]);

export const assistantOperations = sqliteTable("assistant_operations", {
  id: text("id").primaryKey(),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityIds: text("entity_ids").notNull().default("[]"),
  beforeState: text("before_state").notNull().default("[]"),
  afterState: text("after_state").notNull().default("[]"),
  status: text("status").notNull().default("applied"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  undoneAt: text("undone_at"),
}, (table) => [index("idx_assistant_operations_status_created").on(table.status, table.createdAt)]);
