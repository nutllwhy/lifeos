import { env } from "cloudflare:workers";

const statements = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT NOT NULL DEFAULT '收件箱',
    status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium',
    estimated_minutes INTEGER NOT NULL DEFAULT 30, due_date TEXT, scheduled_start TEXT,
    completed_at TEXT, assistant_rank INTEGER, assistant_rank_date TEXT,
    assistant_reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'local',
    external_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'meeting', location TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'local', external_id TEXT, status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY, planned_minutes INTEGER NOT NULL DEFAULT 30,
    started_at TEXT NOT NULL, ended_at TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS expense_entries (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT '其他', spent_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'workspace', external_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'lead',
    categories TEXT NOT NULL DEFAULT '[]', price INTEGER, paid_amount INTEGER,
    received_at TEXT, published_at TEXT, month TEXT, source TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS content_items (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '笔记',
    status TEXT NOT NULL DEFAULT '写作中', word_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0, linked_deal TEXT, modified_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ingredients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, amount TEXT NOT NULL DEFAULT '适量',
    category TEXT NOT NULL DEFAULT '其他', storage TEXT NOT NULL DEFAULT '冷藏', expires_at TEXT,
    note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, started_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30, intensity TEXT NOT NULL DEFAULT '中等',
    notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'workspace',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cleaning_marks (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'missed', start_minutes INTEGER, end_minutes INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS platform_promotions (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL, topic TEXT NOT NULL,
    start_date TEXT, end_date TEXT, rules TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS personal_products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT '计划中', note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_settings (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT NOT NULL, api_key TEXT NOT NULL, model TEXT NOT NULL,
    review_time TEXT NOT NULL DEFAULT '21:30', auto_review INTEGER NOT NULL DEFAULT 1,
    last_call_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS daily_reviews (
    id TEXT PRIMARY KEY, review_date TEXT NOT NULL,
    period_type TEXT NOT NULL DEFAULT 'daily', period_key TEXT NOT NULL DEFAULT '',
    range_start TEXT NOT NULL DEFAULT '', range_end TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
    generation_count INTEGER NOT NULL DEFAULT 1, generated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
    actions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_memories (
    id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'preference', content TEXT NOT NULL,
    source_message_id TEXT, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_operations (
    id TEXT PRIMARY KEY, action_type TEXT NOT NULL, entity_type TEXT NOT NULL,
    entity_ids TEXT NOT NULL DEFAULT '[]', before_state TEXT NOT NULL DEFAULT '[]',
    after_state TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'applied',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, undone_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_tasks_status_due_date ON tasks(status, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at)",
  "CREATE INDEX IF NOT EXISTS idx_focus_sessions_status_started ON focus_sessions(status, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_expense_entries_spent_at ON expense_entries(spent_at)",
  "CREATE INDEX IF NOT EXISTS idx_expense_entries_category_spent ON expense_entries(category, spent_at)",
  "CREATE INDEX IF NOT EXISTS idx_deals_stage_published ON deals(stage, published_at)",
  "CREATE INDEX IF NOT EXISTS idx_content_items_modified_at ON content_items(modified_at)",
  "CREATE INDEX IF NOT EXISTS idx_content_items_linked_deal ON content_items(linked_deal)",
  "CREATE INDEX IF NOT EXISTS idx_ingredients_expires_at ON ingredients(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_workouts_started_at ON workouts(started_at)",
  "CREATE INDEX IF NOT EXISTS idx_cleaning_marks_date ON cleaning_marks(date)",
  "CREATE INDEX IF NOT EXISTS idx_platform_promotions_platform ON platform_promotions(platform)",
  "CREATE INDEX IF NOT EXISTS idx_personal_products_stage ON personal_products(stage)",
  "CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews(review_date)",
  "CREATE INDEX IF NOT EXISTS idx_daily_reviews_period ON daily_reviews(period_type, period_key)",
  "CREATE INDEX IF NOT EXISTS idx_assistant_messages_created_at ON assistant_messages(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_assistant_memories_status_updated ON assistant_memories(status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_assistant_operations_status_created ON assistant_operations(status, created_at)",
];

function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_(?:BUSY|LOCKED)|database is locked|internal error|temporar|network/i.test(message);
}

function waitForDatabase(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

let databaseInitialized = false;

async function initializeDatabase(database: D1Database) {
  // Miniflare/D1 can abort an entire request when one large schema batch hits a
  // transient local SQLite failure. These statements are idempotent, so run
  // them independently and let the retry wrapper repeat only after a real
  // transport/lock failure.
  for (const statement of statements) {
    await database.prepare(statement).run();
  }
  return database;
}

async function initializeDatabaseWithRetry(database: D1Database) {
  if (databaseInitialized) return database;
  try {
    const initialized = await initializeDatabase(database);
    databaseInitialized = true;
    return initialized;
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await waitForDatabase(80);
    const initialized = await initializeDatabase(database);
    databaseInitialized = true;
    return initialized;
  }
}

export async function ensureDatabase() {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) throw new Error("Database binding is unavailable");
  return initializeDatabaseWithRetry(bindings.DB);
}
