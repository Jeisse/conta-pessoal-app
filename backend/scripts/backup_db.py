"""Create a timestamped, consistent snapshot of the ledger database.

Uses SQLite's online backup API instead of copying the file directly, so the
snapshot is safe even if the app is running and writing to the database at
the same time.

Usage:
    python scripts/backup_db.py
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db import DB_PATH

BACKUP_DIR = Path(__file__).parent.parent / "backups"
KEEP_LAST = 10


def backup_db() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"ledger_{timestamp}.db"

    source = sqlite3.connect(DB_PATH)
    dest = sqlite3.connect(backup_path)
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()

    _prune_old_backups()
    return backup_path


def _prune_old_backups() -> None:
    backups = sorted(BACKUP_DIR.glob("ledger_*.db"), key=lambda p: p.name)
    for old in backups[:-KEEP_LAST]:
        old.unlink()


if __name__ == "__main__":
    path = backup_db()
    print(f"Backup created: {path}")
    print("Copy this file (or the whole backups/ folder) to your Google Drive.")
