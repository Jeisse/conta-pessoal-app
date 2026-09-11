import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.constants import ALL_GROUPS, EXPENSE_GROUPS, INCOME_GROUP
from app.db import get_connection, get_or_create_category
from app.llm import CATEGORIZE_MODEL, get_client
from app.services.statement_parser import normalize_description

router = APIRouter(tags=["transactions"])


def _conn():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


_SORT_COLUMNS = {"date": "t.date", "amount": "t.amount", "category": "c.name"}


class ManualTransactionCreate(BaseModel):
    date: str
    description: str
    amount: float
    direction: str  # "income" | "expense"
    category_name: str
    account_id: int | None = None


@router.post("/transactions", status_code=201)
def create_manual_transaction(body: ManualTransactionCreate, conn=Depends(_conn)):
    try:
        datetime.strptime(body.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be in YYYY-MM-DD format")
    if body.direction not in ("income", "expense"):
        raise HTTPException(400, "direction must be 'income' or 'expense'")
    if body.amount <= 0:
        raise HTTPException(400, "amount must be positive")
    if not body.description.strip():
        raise HTTPException(400, "description must not be empty")
    if body.account_id is not None and not conn.execute(
        "SELECT id FROM accounts WHERE id = ?", (body.account_id,)
    ).fetchone():
        raise HTTPException(404, "account not found")

    category_id = get_or_create_category(conn, body.category_name, body.direction)
    # Manual entries have no source file to dedupe against - a random hash just satisfies
    # the column's uniqueness constraint.
    dedupe_hash = f"manual-{uuid4().hex}"
    cur = conn.execute(
        "INSERT INTO transactions "
        "(account_id, category_id, date, description_raw, description_normalized, "
        "amount, direction, statement_file_id, dedupe_hash, review_status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'committed')",
        (body.account_id, category_id, body.date, body.description.strip(),
         normalize_description(body.description), body.amount, body.direction, dedupe_hash),
    )
    conn.commit()
    row = conn.execute(
        """
        SELECT t.id, t.date, t.description_raw, t.amount, t.direction,
               c.id AS category_id, c.name AS category_name, c.group_name AS category_group,
               a.nickname AS account_nickname, a.bank_name AS account_bank_name
        FROM transactions t JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.id = ?
        """,
        (cur.lastrowid,),
    ).fetchone()
    return dict(row)


@router.get("/transactions")
def list_transactions(
    start: str | None = None,
    end: str | None = None,
    category: str | None = None,
    group: str | None = None,
    direction: str | None = Query(None, pattern="^(income|expense)$"),
    search: str | None = None,
    sort: str = Query("date", pattern="^(date|amount|category)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    conn=Depends(_conn),
):
    clauses = ["t.review_status = 'committed'"]
    params: list = []
    if start:
        clauses.append("t.date >= ?")
        params.append(start)
    if end:
        clauses.append("t.date <= ?")
        params.append(end)
    if category:
        clauses.append("c.name = ?")
        params.append(category)
    if group:
        clauses.append("c.group_name = ?")
        params.append(group)
    if direction:
        clauses.append("t.direction = ?")
        params.append(direction)
    if search:
        clauses.append("t.description_raw LIKE ?")
        params.append(f"%{search}%")
    where_sql = " AND ".join(clauses)

    total = conn.execute(
        f"SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id = t.category_id WHERE {where_sql}",
        params,
    ).fetchone()[0]

    # Totals across every matching row (not just the current page) - amounts are stored as
    # positive magnitudes with a separate direction, so expense/income are summed separately
    # rather than as one conflated figure.
    totals = conn.execute(
        f"""
        SELECT
            COALESCE(SUM(CASE WHEN t.direction = 'expense' THEN t.amount END), 0) AS expense_total,
            COALESCE(SUM(CASE WHEN t.direction = 'income' THEN t.amount END), 0) AS income_total
        FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()

    sort_col = _SORT_COLUMNS[sort]
    sort_sql = "ASC" if sort_dir == "asc" else "DESC"
    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""
        SELECT t.id, t.date, t.description_raw, t.amount, t.direction,
               c.id AS category_id, c.name AS category_name, c.group_name AS category_group,
               a.nickname AS account_nickname, a.bank_name AS account_bank_name
        FROM transactions t JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE {where_sql}
        ORDER BY {sort_col} {sort_sql}
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, offset],
    ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "expense_total": totals["expense_total"],
        "income_total": totals["income_total"],
        "results": [dict(r) for r in rows],
    }


class CategoryGroupUpdate(BaseModel):
    group_name: str | None = None


class CategoryMergeRequest(BaseModel):
    target_id: int


_GROUP_BACKFILL_SYSTEM_PROMPT = """\
You assign a higher-level budget group to personal-finance spending category names.
For each category, assign one of: "Fixas" (recurring every month, same amount - rent,
subscriptions, insurance), "Variáveis" (recurring every month, amount varies, reducible -
groceries, restaurants, transport), "Adicionais" (not monthly, but planned/expected - annual
renewals, gifts), or "Extras" (unplanned/one-off - emergencies, unexpected repairs). These are
all expense categories - none of them are income.
"""

_GROUP_BACKFILL_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "group": {"type": "string", "enum": EXPENSE_GROUPS},
                },
                "required": ["index", "group"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}


@router.get("/categories")
def list_categories(conn=Depends(_conn)):
    rows = conn.execute("SELECT id, name, direction, group_name FROM categories ORDER BY name").fetchall()
    return [dict(r) for r in rows]


@router.patch("/categories/{category_id}")
def update_category_group(category_id: int, body: CategoryGroupUpdate, conn=Depends(_conn)):
    if not conn.execute("SELECT id FROM categories WHERE id = ?", (category_id,)).fetchone():
        raise HTTPException(404, "category not found")
    if body.group_name is not None and body.group_name not in ALL_GROUPS:
        raise HTTPException(400, f"group_name must be one of {ALL_GROUPS} or null")
    conn.execute("UPDATE categories SET group_name = ? WHERE id = ?", (body.group_name, category_id))
    conn.commit()
    return {"id": category_id, "group_name": body.group_name}


@router.post("/categories/{category_id}/merge")
def merge_category(category_id: int, body: CategoryMergeRequest, conn=Depends(_conn)):
    """Merges category_id into body.target_id: every transaction and cached categorization
    decision pointing at category_id is repointed at target_id, then category_id is deleted.
    No undo - the caller (UI) is responsible for confirming this with the user first."""
    if category_id == body.target_id:
        raise HTTPException(400, "cannot merge a category into itself")
    source = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    target = conn.execute("SELECT * FROM categories WHERE id = ?", (body.target_id,)).fetchone()
    if not source:
        raise HTTPException(404, "source category not found")
    if not target:
        raise HTTPException(404, "target category not found")
    if source["direction"] != target["direction"]:
        raise HTTPException(400, "cannot merge categories with different directions (income vs expense)")

    conn.execute("UPDATE transactions SET category_id = ? WHERE category_id = ?", (body.target_id, category_id))
    conn.execute("UPDATE category_cache SET category_id = ? WHERE category_id = ?", (body.target_id, category_id))
    conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    conn.commit()
    return {"merged_into": body.target_id}


@router.post("/categories/backfill-groups")
def backfill_category_groups(conn=Depends(_conn)):
    ungrouped = conn.execute(
        "SELECT id, name, direction FROM categories WHERE group_name IS NULL"
    ).fetchall()

    updated = 0
    for row in ungrouped:
        if row["direction"] == "income":
            conn.execute("UPDATE categories SET group_name = ? WHERE id = ?", (INCOME_GROUP, row["id"]))
            updated += 1

    expense_rows = [r for r in ungrouped if r["direction"] == "expense"]
    if expense_rows:
        items = [{"index": i, "name": r["name"]} for i, r in enumerate(expense_rows)]
        max_tokens = min(16000, max(1024, len(expense_rows) * 20))
        response = get_client().messages.create(
            model=CATEGORIZE_MODEL,
            max_tokens=max_tokens,
            system=_GROUP_BACKFILL_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(items, ensure_ascii=False)}],
            output_config={"format": {"type": "json_schema", "schema": _GROUP_BACKFILL_SCHEMA}},
        )
        text = next(b.text for b in response.content if b.type == "text")
        data = json.loads(text)
        group_by_index = {r["index"]: r["group"] for r in data["results"]}
        for i, row in enumerate(expense_rows):
            group = group_by_index.get(i)
            if group is None:
                continue
            conn.execute("UPDATE categories SET group_name = ? WHERE id = ?", (group, row["id"]))
            updated += 1

    conn.commit()
    return {"updated": updated}
