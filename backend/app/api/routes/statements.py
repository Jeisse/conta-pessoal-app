import hashlib
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.db import get_connection, get_or_create_category
from app.services.categorizer import categorize_batch
from app.services.pdf_parser import extract_transactions_from_pdf
from app.services.statement_parser import (
    make_dedupe_hash,
    normalize_description,
    parse_csv,
    preview_csv,
    validate_mapping_sample,
)

router = APIRouter(tags=["statements"])


def _conn():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


class TransactionCategoryUpdate(BaseModel):
    category_name: str


class MappingValidationRequest(BaseModel):
    columns: list[str]
    rows: list[list[str]]
    date_column: str | None = None
    description_column: str | None = None
    amount_column: str | None = None
    debit_column: str | None = None
    credit_column: str | None = None
    date_format: str = "%Y-%m-%d"
    decimal_separator: str = "."


@router.post("/statements/preview")
async def preview_statement(
    file: UploadFile = File(...),
    delimiter: str = Form(","),
    encoding: str = Form("utf-8"),
    header_row_index: int = Form(0),
):
    content = await file.read()
    try:
        return preview_csv(content, encoding=encoding, delimiter=delimiter, header_row_index=header_row_index)
    except Exception as e:
        raise HTTPException(422, f"Could not read file: {e}")


@router.post("/statements/validate-mapping")
def validate_mapping(body: MappingValidationRequest):
    row_dicts = [dict(zip(body.columns, row)) for row in body.rows]
    profile = {
        "date_column": body.date_column,
        "description_column": body.description_column,
        "amount_column": body.amount_column,
        "debit_column": body.debit_column,
        "credit_column": body.credit_column,
        "date_format": body.date_format,
        "decimal_separator": body.decimal_separator,
    }
    return validate_mapping_sample(row_dicts, profile)


def _ingest_rows(conn: sqlite3.Connection, rows: list[dict], account_id: int, statement_id: int) -> dict:
    """Shared by CSV and PDF import: row-level dedupe (occurrence-index disambiguates
    legitimate repeated same-day/amount transactions within one file), batched LLM
    categorization, insert as pending, update the statement_files row count/status."""
    fresh_rows = []
    occurrence_counts: dict[tuple[str, str, float], int] = {}
    for row in rows:
        key = (row["date"], row["description"], row["amount"])
        occurrence_index = occurrence_counts.get(key, 0)
        occurrence_counts[key] = occurrence_index + 1

        dedupe_hash = make_dedupe_hash(account_id, row["date"], row["description"], row["amount"], occurrence_index)
        if conn.execute("SELECT id FROM transactions WHERE dedupe_hash = ?", (dedupe_hash,)).fetchone():
            continue
        row["dedupe_hash"] = dedupe_hash
        fresh_rows.append(row)

    duplicates_skipped = len(rows) - len(fresh_rows)

    category_ids = categorize_batch(conn, fresh_rows) if fresh_rows else []

    for row, category_id in zip(fresh_rows, category_ids):
        conn.execute(
            "INSERT INTO transactions "
            "(account_id, category_id, date, description_raw, description_normalized, "
            "amount, direction, statement_file_id, dedupe_hash, review_status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
            (account_id, category_id, row["date"], row["description"],
             normalize_description(row["description"]), row["amount"], row["direction"],
             statement_id, row["dedupe_hash"]),
        )

    conn.execute(
        "UPDATE statement_files SET status = 'ready_for_review', row_count = ? WHERE id = ?",
        (len(fresh_rows), statement_id),
    )
    conn.commit()

    return {"imported": len(fresh_rows), "duplicates_skipped": duplicates_skipped}


@router.post("/statements/import", status_code=201)
async def import_statement(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    date_column: str = Form(...),
    description_column: str = Form(...),
    amount_column: str | None = Form(None),
    debit_column: str | None = Form(None),
    credit_column: str | None = Form(None),
    date_format: str = Form("%Y-%m-%d"),
    delimiter: str = Form(","),
    encoding: str = Form("utf-8"),
    header_row_index: int = Form(0),
    decimal_separator: str = Form("."),
    conn=Depends(_conn),
):
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    if conn.execute("SELECT id FROM statement_files WHERE file_hash = ?", (file_hash,)).fetchone():
        raise HTTPException(409, "This file has already been imported")

    account = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not account:
        raise HTTPException(404, "account not found")

    profile = {
        "date_column": date_column,
        "description_column": description_column,
        "amount_column": amount_column,
        "debit_column": debit_column,
        "credit_column": credit_column,
        "date_format": date_format,
        "delimiter": delimiter,
        "encoding": encoding,
        "header_row_index": header_row_index,
        "decimal_separator": decimal_separator,
    }

    try:
        rows = parse_csv(content, profile)
    except Exception as e:
        raise HTTPException(422, f"Failed to parse CSV: {e}")

    if not rows:
        raise HTTPException(422, "No valid rows found - check the column mapping")

    cur = conn.execute(
        "INSERT INTO statement_files (filename, file_hash, account_id, status, row_count, format) "
        "VALUES (?, ?, ?, 'processing', 0, 'csv')",
        (file.filename, file_hash, account_id),
    )
    statement_id = cur.lastrowid

    existing_profile = conn.execute(
        "SELECT id FROM bank_import_profiles WHERE account_id = ?", (account_id,)
    ).fetchone()
    if existing_profile:
        conn.execute(
            "UPDATE bank_import_profiles SET date_column=?, description_column=?, amount_column=?, "
            "debit_column=?, credit_column=?, date_format=?, decimal_separator=?, delimiter=?, "
            "encoding=?, header_row_index=? WHERE account_id=?",
            (date_column, description_column, amount_column, debit_column, credit_column,
             date_format, decimal_separator, delimiter, encoding, header_row_index, account_id),
        )
    else:
        conn.execute(
            "INSERT INTO bank_import_profiles "
            "(account_id, date_column, description_column, amount_column, debit_column, credit_column, "
            "date_format, decimal_separator, delimiter, encoding, header_row_index) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (account_id, date_column, description_column, amount_column, debit_column, credit_column,
             date_format, decimal_separator, delimiter, encoding, header_row_index),
        )

    result = _ingest_rows(conn, rows, account_id, statement_id)
    return {"statement_id": statement_id, **result}


@router.post("/statements/import-pdf", status_code=201)
async def import_pdf_statement(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    conn=Depends(_conn),
):
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    if conn.execute("SELECT id FROM statement_files WHERE file_hash = ?", (file_hash,)).fetchone():
        raise HTTPException(409, "This file has already been imported")

    if not conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone():
        raise HTTPException(404, "account not found")

    try:
        rows = extract_transactions_from_pdf(content)
    except Exception as e:
        raise HTTPException(422, f"Failed to extract transactions from PDF: {e}")

    if not rows:
        raise HTTPException(422, "No transactions found in this PDF")

    cur = conn.execute(
        "INSERT INTO statement_files (filename, file_hash, account_id, status, row_count, format) "
        "VALUES (?, ?, ?, 'processing', 0, 'pdf')",
        (file.filename, file_hash, account_id),
    )
    statement_id = cur.lastrowid

    result = _ingest_rows(conn, rows, account_id, statement_id)
    return {"statement_id": statement_id, **result}


@router.get("/statements")
def list_statements(conn=Depends(_conn)):
    rows = conn.execute(
        """
        SELECT sf.id, sf.filename, sf.uploaded_at, sf.status, sf.row_count, sf.format,
               a.bank_name, a.nickname
        FROM statement_files sf
        LEFT JOIN accounts a ON a.id = sf.account_id
        ORDER BY sf.uploaded_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/statements/{statement_id}/transactions")
def list_statement_transactions(statement_id: int, conn=Depends(_conn)):
    if not conn.execute("SELECT id FROM statement_files WHERE id = ?", (statement_id,)).fetchone():
        raise HTTPException(404, "statement not found")
    rows = conn.execute(
        """
        SELECT t.id, t.date, t.description_raw, t.amount, t.direction, t.review_status,
               c.id as category_id, c.name as category_name
        FROM transactions t
        JOIN categories c ON c.id = t.category_id
        WHERE t.statement_file_id = ?
        ORDER BY t.date, t.description_raw
        """,
        (statement_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/statements/{statement_id}/commit")
def commit_statement(statement_id: int, conn=Depends(_conn)):
    stmt = conn.execute("SELECT status FROM statement_files WHERE id = ?", (statement_id,)).fetchone()
    if not stmt:
        raise HTTPException(404, "statement not found")
    if stmt["status"] == "committed":
        raise HTTPException(400, "Already committed")
    conn.execute(
        "UPDATE transactions SET review_status = 'committed', updated_at = datetime('now') "
        "WHERE statement_file_id = ? AND review_status = 'pending'",
        (statement_id,),
    )
    conn.execute("UPDATE statement_files SET status = 'committed' WHERE id = ?", (statement_id,))
    conn.commit()
    count = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE statement_file_id = ? AND review_status = 'committed'",
        (statement_id,),
    ).fetchone()[0]
    return {"committed": count}


@router.delete("/statements/{statement_id}", status_code=204)
def discard_statement(statement_id: int, conn=Depends(_conn)):
    """Deletes a statement and all its transactions, regardless of review status -
    including already-committed ones. There's no undo; the caller (UI) is responsible
    for confirming this with the user first."""
    if not conn.execute("SELECT id FROM statement_files WHERE id = ?", (statement_id,)).fetchone():
        raise HTTPException(404, "statement not found")
    conn.execute("DELETE FROM transactions WHERE statement_file_id = ?", (statement_id,))
    conn.execute("DELETE FROM statement_files WHERE id = ?", (statement_id,))
    conn.commit()


@router.patch("/transactions/{tx_id}/category")
def update_transaction_category(tx_id: int, body: TransactionCategoryUpdate, conn=Depends(_conn)):
    tx = conn.execute("SELECT direction FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not tx:
        raise HTTPException(404, "transaction not found")
    category_id = get_or_create_category(conn, body.category_name, tx["direction"])
    conn.execute(
        "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ?",
        (category_id, tx_id),
    )
    conn.commit()
    return {"id": tx_id, "category_id": category_id}


@router.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, conn=Depends(_conn)):
    """Permanently removes a single transaction, regardless of review status - including
    already-committed ones. No undo; the caller (UI) is responsible for confirming first."""
    if not conn.execute("SELECT id FROM transactions WHERE id = ?", (tx_id,)).fetchone():
        raise HTTPException(404, "transaction not found")
    conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    conn.commit()


@router.post("/transactions/{tx_id}/toggle-exclude")
def toggle_exclude_transaction(tx_id: int, conn=Depends(_conn)):
    tx = conn.execute("SELECT review_status FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not tx:
        raise HTTPException(404, "transaction not found")
    if tx["review_status"] not in ("pending", "excluded"):
        raise HTTPException(400, "Cannot change a committed transaction's status here")
    new_status = "excluded" if tx["review_status"] == "pending" else "pending"
    conn.execute(
        "UPDATE transactions SET review_status = ?, updated_at = datetime('now') WHERE id = ?",
        (new_status, tx_id),
    )
    conn.commit()
    return {"id": tx_id, "review_status": new_status}
