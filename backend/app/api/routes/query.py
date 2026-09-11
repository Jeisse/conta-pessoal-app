from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_connection
from app.services.query_builder import execute_query
from app.services.query_translator import translate_question

router = APIRouter(tags=["query"])


def _conn():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


class QuestionRequest(BaseModel):
    question: str


def _format_amount(value: float) -> str:
    return f"{value:,.2f}"


def _date_range_label(structured: dict) -> str:
    start, end = structured.get("start_date"), structured.get("end_date")
    if start and end:
        return f"between {start} and {end}"
    if start:
        return f"since {start}"
    if end:
        return f"through {end}"
    return "overall"


_AGGREGATE_VERB = {"sum": "spent", "count": "had", "avg": "averaged", "max": "your largest was", "min": "your smallest was"}


def _build_answer(structured: dict, result: dict) -> str:
    category_label = f"on {structured['category']}" if structured.get("category") else ""
    date_label = _date_range_label(structured)

    if result["type"] == "aggregate":
        aggregation = structured["aggregation"]
        if result["matched_count"] == 0:
            return f"No matching transactions found {date_label} {category_label}.".replace("  ", " ").strip()
        if aggregation == "count":
            return f"You had {int(result['value'])} matching transactions {date_label} {category_label}.".replace("  ", " ").strip()
        verb = _AGGREGATE_VERB.get(aggregation, "totaled")
        return f"You {verb} {_format_amount(result['value'])} {category_label} {date_label}.".replace("  ", " ").strip()

    rows = result["rows"]
    if not rows:
        return f"No matching transactions found {date_label} {category_label}.".replace("  ", " ").strip()
    if structured.get("limit") == 1 and len(rows) == 1:
        r = rows[0]
        return f"{r['description_raw']} ({r['category_name']}) for {_format_amount(r['amount'])} on {r['date']}."
    return f"Found {len(rows)} matching transactions {date_label} {category_label}.".replace("  ", " ").strip()


@router.post("/query")
def ask_question(body: QuestionRequest, conn=Depends(_conn)):
    structured = translate_question(body.question)
    result = execute_query(conn, structured)
    answer = _build_answer(structured, result)
    return {"answer": answer, "structured_query": structured, "result": result}
