"""Execute a structured query (produced by query_translator.py) as parameterized SQL.

Every SQL fragment here is a fixed, allow-listed string picked by branching on the
structured fields - no LLM-produced text is ever interpolated into a query.
"""
import sqlite3

_AGGREGATION_SQL = {
    "sum": "SUM(t.amount)",
    "count": "COUNT(*)",
    "avg": "AVG(t.amount)",
    "max": "MAX(t.amount)",
    "min": "MIN(t.amount)",
}
_SORT_COLUMNS = {"amount": "t.amount", "date": "t.date"}
_DEFAULT_ROW_LIMIT = 50
_MAX_ROW_LIMIT = 200


def _where_clause(structured: dict) -> tuple[str, list]:
    clauses = ["t.review_status = 'committed'"]
    params: list = []

    if structured.get("start_date"):
        clauses.append("t.date >= ?")
        params.append(structured["start_date"])
    if structured.get("end_date"):
        clauses.append("t.date <= ?")
        params.append(structured["end_date"])
    if structured.get("category"):
        clauses.append("c.name LIKE ?")
        params.append(f"%{structured['category']}%")
    if structured.get("direction"):
        clauses.append("t.direction = ?")
        params.append(structured["direction"])

    return " AND ".join(clauses), params


def execute_query(conn: sqlite3.Connection, structured: dict) -> dict:
    """Returns {"type": "aggregate", "value": float, "matched_count": int} or
    {"type": "rows", "rows": [...]}."""
    where_sql, params = _where_clause(structured)
    aggregation = structured.get("aggregation", "none")

    if aggregation in _AGGREGATION_SQL:
        agg_sql = _AGGREGATION_SQL[aggregation]
        row = conn.execute(
            f"""
            SELECT {agg_sql} AS value, COUNT(*) AS matched_count
            FROM transactions t JOIN categories c ON c.id = t.category_id
            WHERE {where_sql}
            """,
            params,
        ).fetchone()
        return {
            "type": "aggregate",
            "value": row["value"] if row["value"] is not None else 0,
            "matched_count": row["matched_count"],
        }

    sort_col = _SORT_COLUMNS.get(structured.get("sort_by"), "t.date")
    sort_dir = "ASC" if structured.get("sort_dir") == "asc" else "DESC"
    limit = structured.get("limit") or _DEFAULT_ROW_LIMIT
    limit = min(max(int(limit), 1), _MAX_ROW_LIMIT)

    rows = conn.execute(
        f"""
        SELECT t.id, t.date, t.description_raw, t.amount, t.direction, c.name AS category_name
        FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE {where_sql}
        ORDER BY {sort_col} {sort_dir}
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return {"type": "rows", "rows": [dict(r) for r in rows]}
