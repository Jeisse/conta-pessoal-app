"""Translate a free-text question about transactions into a structured query.

The LLM only ever produces this constrained struct - it never generates SQL. The
backend (query_builder.py) maps the struct onto a parameterized, allow-listed query.
"""
import json
from datetime import date

from app.llm import QUERY_MODEL, get_client

QUERY_SYSTEM_PROMPT_TEMPLATE = """\
You translate a user's natural-language question about their personal bank transactions
into a structured query. Today's date is {today}. Resolve relative date phrases
("last month", "this year", "in March") into absolute start_date/end_date (YYYY-MM-DD,
inclusive range) relative to today. Leave start_date/end_date null if the question has no
date constraint. `category` should be a short keyword to fuzzy-match against category names
(e.g. "restaurant" for "how much on restaurants"), or null if the question isn't about a
specific category. `direction` is "expense", "income", or null if unspecified (most spending
questions imply "expense"). `aggregation`: "sum" for totals, "count" for how many, "avg" for
average, "max"/"min" for a single largest/smallest transaction, or "none" to return matching
rows directly (e.g. for "what was my most expensive purchase" use aggregation "none" with
sort_by "amount", sort_dir "desc", limit 1 - so the actual transaction row is returned).
"""

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "start_date": {"type": ["string", "null"]},
        "end_date": {"type": ["string", "null"]},
        "category": {"type": ["string", "null"]},
        "direction": {"anyOf": [{"type": "string", "enum": ["expense", "income"]}, {"type": "null"}]},
        "aggregation": {"type": "string", "enum": ["sum", "count", "avg", "max", "min", "none"]},
        "sort_by": {"anyOf": [{"type": "string", "enum": ["amount", "date"]}, {"type": "null"}]},
        "sort_dir": {"type": "string", "enum": ["asc", "desc"]},
        "limit": {"type": ["integer", "null"]},
    },
    "required": [
        "start_date", "end_date", "category", "direction",
        "aggregation", "sort_by", "sort_dir", "limit",
    ],
    "additionalProperties": False,
}


def translate_question(question: str, today: date | None = None) -> dict:
    today = today or date.today()
    response = get_client().messages.create(
        model=QUERY_MODEL,
        max_tokens=1024,
        system=QUERY_SYSTEM_PROMPT_TEMPLATE.format(today=today.isoformat()),
        messages=[{"role": "user", "content": question}],
        output_config={"format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
    )
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
