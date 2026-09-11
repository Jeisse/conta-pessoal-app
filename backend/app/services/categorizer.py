"""Categorize transaction descriptions via a cache-first, batched LLM call.

Categories are free-form (no fixed taxonomy) - the LLM names them, `category_cache`
memoizes the decision per normalized description so repeat merchants (across imports)
skip the LLM entirely and stay consistently named.

Direction (income/expense) is a fact taken from the parsed CSV row (amount sign or
debit/credit column) - the LLM is only asked to name a category, never to guess direction.
"""
import json
import sqlite3

from app.constants import ALL_GROUPS, INCOME_GROUP
from app.db import get_or_create_category
from app.llm import CATEGORIZE_MODEL, get_client
from app.services.statement_parser import normalize_description

CATEGORIZE_SYSTEM_PROMPT = """\
You categorize personal bank transaction descriptions for a household budgeting app.
For each transaction, assign:
- a short, free-form spending category name (e.g. "Restaurantes", "Supermercado", "Transporte",
  "Salario", "Assinaturas", "Saude"). Reuse common, general category names rather than inventing
  a new one per merchant - group similar merchants under the same category. Descriptions are in
  Portuguese (Brazilian) bank statement format; keep category names in Portuguese.
- a higher-level budget group, one of: "Fixas" (recurring every month, same amount - rent,
  subscriptions, insurance), "Variáveis" (recurring every month, amount varies, reducible -
  groceries, restaurants, transport), "Adicionais" (not monthly, but planned/expected - annual
  renewals, gifts), "Extras" (unplanned/one-off - emergencies, unexpected repairs), or "Receitas"
  for any income transaction.
"""

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "category": {"type": "string"},
                    "group": {"type": "string", "enum": ALL_GROUPS},
                },
                "required": ["index", "category", "group"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["results"],
    "additionalProperties": False,
}


def _call_llm(descriptions: list[str]) -> dict[int, dict]:
    """Batch-categorize a list of descriptions in a single LLM call. Returns {index: {category, group}}."""
    items = [{"index": i, "description": d} for i, d in enumerate(descriptions)]
    max_tokens = min(16000, max(1024, len(descriptions) * 40))

    response = get_client().messages.create(
        model=CATEGORIZE_MODEL,
        max_tokens=max_tokens,
        system=CATEGORIZE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(items, ensure_ascii=False)}],
        output_config={"format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
    )
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    return {r["index"]: {"category": r["category"], "group": r["group"]} for r in data["results"]}


def categorize_batch(conn: sqlite3.Connection, rows: list[dict]) -> list[int]:
    """
    Categorize a batch of parsed transaction rows (each a {"description": str, "direction": str}
    dict, duplicates allowed and preserved in order).

    Returns a list (same length/order as `rows`) of category_id.
    """
    normalized = [normalize_description(r["description"]) for r in rows]

    # description_normalized -> category_id, resolved either from cache or a fresh LLM call
    resolved: dict[str, int] = {}
    uncached_norms: list[str] = []
    for norm in normalized:
        if norm in resolved or norm in uncached_norms:
            continue
        row = conn.execute(
            "SELECT category_id FROM category_cache WHERE description_normalized = ?", (norm,)
        ).fetchone()
        if row:
            resolved[norm] = row["category_id"]
        else:
            uncached_norms.append(norm)

    if uncached_norms:
        # direction for each uncached description, taken from the first row it appears in
        direction_by_norm = {}
        for r, norm in zip(rows, normalized):
            if norm in uncached_norms and norm not in direction_by_norm:
                direction_by_norm[norm] = r["direction"]

        llm_results = _call_llm(uncached_norms)
        for i, norm in enumerate(uncached_norms):
            result = llm_results.get(i)
            if result is None:
                continue  # LLM dropped this index; row falls back to "Uncategorized" below
            direction = direction_by_norm[norm]
            # direction is ground truth from CSV parsing - group-for-income should be equally
            # deterministic, not LLM-guessed, so override regardless of what the LLM returned.
            group_name = INCOME_GROUP if direction == "income" else result["group"]
            category_id = get_or_create_category(conn, result["category"], direction, group_name)
            conn.execute(
                "INSERT OR IGNORE INTO category_cache (description_normalized, category_id) VALUES (?, ?)",
                (norm, category_id),
            )
            resolved[norm] = category_id

    uncategorized_cache: dict[str, int] = {}

    def _uncategorized(direction: str) -> int:
        if direction not in uncategorized_cache:
            uncategorized_cache[direction] = get_or_create_category(conn, "Uncategorized", direction)
        return uncategorized_cache[direction]

    output = []
    for r, norm in zip(rows, normalized):
        category_id = resolved.get(norm)
        output.append(category_id if category_id is not None else _uncategorized(r["direction"]))
    return output
