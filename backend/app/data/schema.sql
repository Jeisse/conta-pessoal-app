-- Bank accounts. Each account has its own saved import profile (column mapping).
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    bank_name TEXT NOT NULL,
    nickname TEXT,
    active BOOLEAN NOT NULL DEFAULT 1
);

-- Per-account CSV column mapping, learned once and reused on future uploads.
CREATE TABLE IF NOT EXISTS bank_import_profiles (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
    date_column TEXT,
    description_column TEXT,
    amount_column TEXT,
    debit_column TEXT,
    credit_column TEXT,
    date_format TEXT NOT NULL DEFAULT '%Y-%m-%d',
    decimal_separator TEXT NOT NULL DEFAULT '.',
    delimiter TEXT NOT NULL DEFAULT ',',
    encoding TEXT NOT NULL DEFAULT 'utf-8',
    header_row_index INTEGER NOT NULL DEFAULT 0
);

-- Record of every uploaded statement file, for audit + duplicate-file prevention.
CREATE TABLE IF NOT EXISTS statement_files (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    file_hash TEXT UNIQUE NOT NULL,
    account_id INTEGER REFERENCES accounts(id),
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL CHECK(status IN ('processing', 'ready_for_review', 'committed', 'error')),
    row_count INTEGER,
    error_message TEXT,
    format TEXT NOT NULL DEFAULT 'csv'
);

-- Free-form categories: created on the fly by the LLM (or the user), no fixed taxonomy.
-- group_name is a higher-level budget group (Fixas/Variáveis/Adicionais/Extras/Receitas,
-- see app/constants.py) - a property of the category itself, not validated here since
-- SQLite can't cheaply add a CHECK to an existing column; validated at the app layer.
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT UNIQUE NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
    group_name TEXT
);

-- Memoizes LLM categorization decisions so repeat merchants skip the LLM call
-- next time and stay consistently named across imports.
CREATE TABLE IF NOT EXISTS category_cache (
    description_normalized TEXT PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The ledger.
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    date TEXT NOT NULL,
    description_raw TEXT NOT NULL,
    description_normalized TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
    statement_file_id INTEGER REFERENCES statement_files(id),
    dedupe_hash TEXT UNIQUE NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending', 'excluded', 'committed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_review ON transactions(review_status);
