CREATE TABLE `assistant_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text DEFAULT 'preference' NOT NULL,
	`content` text NOT NULL,
	`source_message_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_memories_status_updated` ON `assistant_memories` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_messages_created_at` ON `assistant_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`action_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_ids` text DEFAULT '[]' NOT NULL,
	`before_state` text DEFAULT '[]' NOT NULL,
	`after_state` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`undone_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_operations_status_created` ON `assistant_operations` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `assistant_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'openai-compatible' NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`model` text NOT NULL,
	`review_time` text DEFAULT '21:30' NOT NULL,
	`auto_review` integer DEFAULT true NOT NULL,
	`last_call_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT '笔记' NOT NULL,
	`status` text DEFAULT '写作中' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`pending_count` integer DEFAULT 0 NOT NULL,
	`linked_deal` text,
	`modified_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_content_items_modified_at` ON `content_items` (`modified_at`);--> statement-breakpoint
CREATE INDEX `idx_content_items_linked_deal` ON `content_items` (`linked_deal`);--> statement-breakpoint
CREATE TABLE `daily_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`review_date` text NOT NULL,
	`period_type` text DEFAULT 'daily' NOT NULL,
	`period_key` text DEFAULT '' NOT NULL,
	`range_start` text DEFAULT '' NOT NULL,
	`range_end` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`generation_count` integer DEFAULT 1 NOT NULL,
	`generated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_daily_reviews_date` ON `daily_reviews` (`review_date`);--> statement-breakpoint
CREATE INDEX `idx_daily_reviews_period` ON `daily_reviews` (`period_type`,`period_key`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`stage` text DEFAULT 'lead' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`price` integer,
	`paid_amount` integer,
	`received_at` text,
	`published_at` text,
	`month` text,
	`source` text DEFAULT 'local' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deals_stage_published` ON `deals` (`stage`,`published_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`category` text DEFAULT 'meeting' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_start_at` ON `events` (`start_at`);--> statement-breakpoint
CREATE TABLE `expense_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category` text DEFAULT '其他' NOT NULL,
	`spent_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'workspace' NOT NULL,
	`external_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_expense_entries_spent_at` ON `expense_entries` (`spent_at`);--> statement-breakpoint
CREATE INDEX `idx_expense_entries_category_spent` ON `expense_entries` (`category`,`spent_at`);--> statement-breakpoint
CREATE TABLE `focus_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`planned_minutes` integer DEFAULT 30 NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_focus_sessions_status_started` ON `focus_sessions` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount` text DEFAULT '适量' NOT NULL,
	`category` text DEFAULT '其他' NOT NULL,
	`storage` text DEFAULT '冷藏' NOT NULL,
	`expires_at` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ingredients_expires_at` ON `ingredients` (`expires_at`);--> statement-breakpoint
CREATE TABLE `personal_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`stage` text DEFAULT '计划中' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_personal_products_stage` ON `personal_products` (`stage`);--> statement-breakpoint
CREATE TABLE `platform_promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`topic` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`rules` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_platform_promotions_platform` ON `platform_promotions` (`platform`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project` text DEFAULT '收件箱' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`estimated_minutes` integer DEFAULT 30 NOT NULL,
	`due_date` text,
	`scheduled_start` text,
	`completed_at` text,
	`assistant_rank` integer,
	`assistant_rank_date` text,
	`assistant_reason` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`external_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status_due_date` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`started_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`intensity` text DEFAULT '中等' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'workspace' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workouts_started_at` ON `workouts` (`started_at`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled_modules` text DEFAULT '[]' NOT NULL,
	`goals` text DEFAULT '{"annual":[],"quarterly":[]}' NOT NULL,
	`onboarded_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
