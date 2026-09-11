import sqlite3
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "ledger.db"
SCHEMA_PATH = DATA_DIR / "schema.sql"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive schema changes for existing databases - schema.sql's CREATE TABLE IF NOT
    EXISTS only applies to brand-new tables, so already-existing tables need explicit
    ALTER TABLE steps here when a column is added later."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(categories)").fetchall()}
    if "group_name" not in cols:
        conn.execute("ALTER TABLE categories ADD COLUMN group_name TEXT")

    cols = {r["name"] for r in conn.execute("PRAGMA table_info(statement_files)").fetchall()}
    if "format" not in cols:
        conn.execute("ALTER TABLE statement_files ADD COLUMN format TEXT NOT NULL DEFAULT 'csv'")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()


def normalize_category_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def get_or_create_category(conn: sqlite3.Connection, name: str, direction: str, group_name: str | None = None) -> int:
    """Find-or-create a category by name (case/whitespace-insensitive), returning its id.
    group_name (like direction) is only stored when the category is first created - an
    existing category's group is left alone regardless of what's passed here."""
    name_norm = normalize_category_name(name)
    row = conn.execute(
        "SELECT id FROM categories WHERE name_normalized = ?", (name_norm,)
    ).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO categories (name, name_normalized, direction, group_name) VALUES (?, ?, ?, ?)",
        (name.strip(), name_norm, direction, group_name),
    )
    return cur.lastrowid
