"""Extract transactions from a PDF bank statement via Claude's native document understanding.

No text-extraction library or per-bank layout heuristics - the PDF is sent directly to Claude
as a document, which reads whatever layout/date-format the statement uses and returns the same
{date, description, amount, direction} row shape app/services/statement_parser.py's parse_csv
produces, so it rejoins the existing import pipeline unchanged.
"""
import base64
import json

from app.llm import PDF_EXTRACTION_MODEL, get_client

PDF_EXTRACTION_SYSTEM_PROMPT = """\
You extract every transaction line from a personal bank statement PDF. For each transaction:
- date: normalize to ISO format (YYYY-MM-DD), regardless of the format used in the statement.
- description: the transaction description/memo text as it appears.
- amount: a positive number (the magnitude, never negative).
- direction: "expense" for a debit/withdrawal/payment, "income" for a credit/deposit.
Extract every transaction row - do not skip any, and do not include running balances, headers,
or summary/total rows as transactions.
"""

_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "transactions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "date": {"type": "string"},
                    "description": {"type": "string"},
                    "amount": {"type": "number"},
                    "direction": {"type": "string", "enum": ["income", "expense"]},
                },
                "required": ["date", "description", "amount", "direction"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["transactions"],
    "additionalProperties": False,
}


def extract_transactions_from_pdf(content: bytes) -> list[dict]:
    b64 = base64.standard_b64encode(content).decode()

    response = get_client().messages.create(
        model=PDF_EXTRACTION_MODEL,
        max_tokens=16000,
        system=PDF_EXTRACTION_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
                {"type": "text", "text": "Extract every transaction from this bank statement."},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA}},
    )
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    return data["transactions"]
