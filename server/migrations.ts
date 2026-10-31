import { sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

// Storage rules: every table is STRICT, booleans are 0/1, dates are text (YYYY-MM-DD, months
// YYYY-MM). Money columns end in `_cents` (integer cents); unit and price columns end in `_scaled`
// (integer, scaled by 10^6). Fractions (rates, weights, expected return, volatility) are REAL.
const DOMAIN_TABLES = [
  sql`CREATE TABLE import_batch (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('transactions', 'prices', 'products', 'goals')),
    source_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rows_read INTEGER NOT NULL,
    rows_imported INTEGER NOT NULL,
    rows_skipped INTEGER NOT NULL,
    undone_at TEXT,
    prior_prices TEXT CHECK (prior_prices IS NULL OR json_valid(prior_prices))
  ) STRICT`,
  sql`CREATE TABLE import_mapping (
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('transactions', 'prices', 'products', 'goals')),
    column_map TEXT NOT NULL CHECK (json_valid(column_map)),
    delimiter TEXT NOT NULL,
    decimal_format TEXT NOT NULL,
    date_format TEXT NOT NULL,
    PRIMARY KEY (kind, name)
  ) STRICT`,
  sql`CREATE TABLE product (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    isin TEXT NOT NULL DEFAULT '',
    asset_class TEXT NOT NULL CHECK (asset_class IN
      ('Equity', 'Govt bonds', 'Corp bonds', 'Multi-asset', 'Cash', 'Gold/Commodities')),
    regime TEXT NOT NULL CHECK (regime IN ('etf', 'direct', 'govt', 'cash', 'pension')),
    white_list_share REAL NOT NULL DEFAULT 0,
    exp_return REAL NOT NULL,
    volatility REAL NOT NULL,
    ter REAL NOT NULL,
    maturity TEXT,
    coupon_rate REAL NOT NULL DEFAULT 0,
    zero_commission INTEGER NOT NULL DEFAULT 0 CHECK (zero_commission IN (0, 1)),
    price_source TEXT NOT NULL CHECK (price_source IN ('provider', 'csv', 'manual')),
    ticker TEXT NOT NULL DEFAULT '',
    broker_units_scaled INTEGER,
    broker_units_date TEXT
  ) STRICT`,
  sql`CREATE TABLE price_point (
    product_id TEXT NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    price_scaled INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('provider', 'csv', 'manual')),
    fetched_at TEXT NOT NULL,
    import_batch_id TEXT REFERENCES import_batch (id),
    PRIMARY KEY (product_id, month)
  ) STRICT`,
  sql`CREATE TABLE goal (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('Need', 'Want', 'Wish')),
    target_cents INTEGER NOT NULL,
    target_year INTEGER NOT NULL,
    contribution_growth REAL NOT NULL,
    min_prob REAL,
    counts_toward_fi INTEGER NOT NULL DEFAULT 0 CHECK (counts_toward_fi IN (0, 1))
  ) STRICT`,
  sql`CREATE TABLE contribution_plan (
    goal_id TEXT NOT NULL REFERENCES goal (id) ON DELETE CASCADE,
    from_month TEXT NOT NULL,
    monthly_cents INTEGER NOT NULL,
    PRIMARY KEY (goal_id, from_month)
  ) STRICT`,
  sql`CREATE TABLE allocation_weight (
    goal_id TEXT NOT NULL REFERENCES goal (id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES product (id),
    weight REAL NOT NULL,
    PRIMARY KEY (goal_id, product_id)
  ) STRICT`,
  sql`CREATE TABLE "transaction" (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    goal_id TEXT NOT NULL REFERENCES goal (id),
    product_id TEXT NOT NULL REFERENCES product (id),
    type TEXT NOT NULL CHECK (type IN ('opening', 'buy', 'sell', 'pensionContribution', 'coupon')),
    qty_scaled INTEGER NOT NULL,
    price_scaled INTEGER NOT NULL,
    commission_cents INTEGER,
    amount_cents INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    import_batch_id TEXT REFERENCES import_batch (id)
  ) STRICT`,
  sql`CREATE TABLE snapshot (
    month TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('saved', 'recomputed')),
    assumptions_hash TEXT NOT NULL,
    results TEXT NOT NULL CHECK (json_valid(results)),
    PRIMARY KEY (month, source)
  ) STRICT`,
  sql`CREATE TABLE dismissal (
    rule_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('goal', 'product', 'none')),
    key TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (rule_id, scope, key)
  ) STRICT`,
  sql`CREATE TABLE document (
    kind TEXT PRIMARY KEY CHECK (kind IN
      ('settings', 'commission', 'fiSettings', 'correlations', 'pensionPlan', 'cashFlow',
       'openingDate')),
    value TEXT NOT NULL CHECK (json_valid(value))
  ) STRICT`,
];

// Forward-only: a migration has no `down`. Keys sort in application order.
const migrations: Record<string, Migration> = {
  "001-baseline": {
    async up(db) {
      await sql`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`.execute(db);
    },
  },
  "002-domain": {
    async up(db) {
      for (const statement of DOMAIN_TABLES) await statement.execute(db);
    },
  },
  "003-batch-created-ids": {
    async up(db) {
      await sql`ALTER TABLE import_batch ADD COLUMN created_ids TEXT
        CHECK (created_ids IS NULL OR json_valid(created_ids))`.execute(db);
    },
  },
};

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => migrations,
};
