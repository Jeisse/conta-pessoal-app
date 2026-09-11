"""Parse bank statement CSV files into structured transaction rows."""
import csv
import hashlib
import io
import re
from datetime import datetime


def preview_csv(
    content: bytes,
    *,
    encoding: str = "utf-8",
    delimiter: str = ",",
    header_row_index: int = 0,
    preview_rows: int = 5,
) -> dict:
    """Return column headers and first N data rows for the column-mapping UI."""
    text = content.decode(encoding, errors="replace")
    lines = text.splitlines()
    if header_row_index >= len(lines):
        return {"columns": [], "rows": []}
    sliced = "\n".join(lines[header_row_index:])
    reader = csv.reader(io.StringIO(sliced), delimiter=delimiter, skipinitialspace=True)
    all_rows = list(reader)
    if not all_rows:
        return {"columns": [], "rows": []}
    return {"columns": all_rows[0], "rows": all_rows[1 : preview_rows + 1]}


def _parse_amount(value: str, decimal_separator: str = ".") -> float:
    v = value.strip()
    if not v:
        raise ValueError("empty amount")
    if decimal_separator == ",":
        # Brazilian format: "1.234,56" -> remove thousands dot, comma becomes decimal point
        v = v.replace(".", "").replace(",", ".")
    else:
        v = v.replace(",", "")
    v = re.sub(r"[^\d.\-]", "", v)
    if not v:
        raise ValueError("no numeric content")
    return float(v)


def _parse_date(value: str, date_format: str) -> str:
    return datetime.strptime(value.strip(), date_format).strftime("%Y-%m-%d")


def normalize_description(description: str) -> str:
    return " ".join(description.strip().lower().split())


_CURRENCY_PREFIX_RE = re.compile(r"^(?:[A-Z]{3}|[$€£¥])\s*")


def _looks_like_amount(raw: str) -> bool:
    """
    Stricter sanity check than _parse_amount, which strips any non-digit character
    and so happily "parses" free text (e.g. it'll pull "12026" out of a description like
    "...for Aug 1, 2026"). A real amount value is never mostly letters, so flag anything
    containing alphabetic characters (beyond an optional leading currency code/symbol)
    as very likely the wrong column, even though _parse_amount wouldn't raise on it.
    """
    stripped = _CURRENCY_PREFIX_RE.sub("", raw.strip())
    return not re.search(r"[A-Za-z]", stripped)


def validate_mapping_sample(rows: list[dict[str, str]], profile: dict) -> dict:
    """
    Test-parse a small sample of raw CSV rows (column-name -> value dicts) against a
    proposed mapping, without touching the DB. Lets the mapping UI warn about an
    obviously wrong column choice (e.g. amount column pointing at free text) before import,
    instead of the user only finding out via a "0 rows imported" result afterward.
    """
    date_col = profile.get("date_column")
    desc_col = profile.get("description_column")
    amount_col = profile.get("amount_column")
    debit_col = profile.get("debit_column")
    credit_col = profile.get("credit_column")
    date_format = profile.get("date_format") or "%Y-%m-%d"
    decimal_separator = profile.get("decimal_separator") or "."

    results = []
    for row in rows:
        issues = []
        if date_col:
            raw = row.get(date_col, "")
            try:
                _parse_date(raw, date_format)
            except ValueError:
                issues.append(f"Date column \"{date_col}\" value \"{raw}\" doesn't match format {date_format}")
        if desc_col and not row.get(desc_col, "").strip():
            issues.append(f"Description column \"{desc_col}\" is empty")
        if amount_col:
            raw = row.get(amount_col, "")
            if not _looks_like_amount(raw):
                issues.append(f"Amount column \"{amount_col}\" value \"{raw}\" doesn't look like a number")
            else:
                try:
                    _parse_amount(raw, decimal_separator)
                except ValueError:
                    issues.append(f"Amount column \"{amount_col}\" value \"{raw}\" isn't a valid number")
        elif debit_col or credit_col:
            zero_values = {"", "0", "0.00", "0,00"}
            debit_raw = row.get(debit_col, "").strip() if debit_col else ""
            credit_raw = row.get(credit_col, "").strip() if credit_col else ""
            active_col, active_raw = (debit_col, debit_raw) if debit_raw not in zero_values else (credit_col, credit_raw)
            if active_raw not in zero_values:
                if not _looks_like_amount(active_raw):
                    issues.append(f"Column \"{active_col}\" value \"{active_raw}\" doesn't look like a number")
                else:
                    try:
                        _parse_amount(active_raw, decimal_separator)
                    except ValueError:
                        issues.append(f"Column \"{active_col}\" value \"{active_raw}\" isn't a valid number")

        results.append({"issues": issues})

    valid_count = sum(1 for r in results if not r["issues"])
    return {"valid_count": valid_count, "total": len(rows), "rows": results}


def parse_csv(content: bytes, profile: dict) -> list[dict]:
    """
    Parse a CSV bank statement using the given import profile.

    Profile keys (all optional except date_column, description_column):
      encoding, delimiter, header_row_index, decimal_separator,
      date_column, description_column, date_format,
      amount_column  - single signed column (negative = expense, positive = income)
      debit_column + credit_column  - separate columns (debit = expense, credit = income)

    Returns list of {date, description, amount, direction} where amount is always positive.
    Rows that fail to parse are silently skipped.
    """
    encoding = profile.get("encoding") or "utf-8"
    delimiter = profile.get("delimiter") or ","
    header_row_index = int(profile.get("header_row_index") or 0)
    decimal_separator = profile.get("decimal_separator") or "."
    date_format = profile.get("date_format") or "%Y-%m-%d"
    date_col = profile["date_column"]
    desc_col = profile["description_column"]
    amount_col = profile.get("amount_column")
    debit_col = profile.get("debit_column")
    credit_col = profile.get("credit_column")

    text = content.decode(encoding, errors="replace")
    lines = text.splitlines()
    if header_row_index > 0:
        text = "\n".join(lines[header_row_index:])

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter, skipinitialspace=True)
    results = []
    for row in reader:
        try:
            date_str = _parse_date(row[date_col], date_format)
            description = row[desc_col].strip()
            if not description:
                continue

            if amount_col:
                raw = row[amount_col].strip()
                if not raw:
                    continue
                val = _parse_amount(raw, decimal_separator)
                direction = "expense" if val < 0 else "income"
                amount = abs(val)
            elif debit_col and credit_col:
                debit_raw = row.get(debit_col, "").strip()
                credit_raw = row.get(credit_col, "").strip()
                zero_values = {"", "0", "0.00", "0,00"}
                if debit_raw and debit_raw not in zero_values:
                    amount = abs(_parse_amount(debit_raw, decimal_separator))
                    direction = "expense"
                elif credit_raw and credit_raw not in zero_values:
                    amount = abs(_parse_amount(credit_raw, decimal_separator))
                    direction = "income"
                else:
                    continue
            else:
                continue  # profile misconfigured

            if amount == 0:
                continue

            results.append({"date": date_str, "description": description, "amount": amount, "direction": direction})
        except (KeyError, ValueError):
            continue  # skip malformed rows

    return results


def make_dedupe_hash(account_id: int, date: str, description: str, amount: float, occurrence_index: int = 0) -> str:
    """
    occurrence_index disambiguates legitimate repeated transactions (e.g. two identical
    same-day, same-amount transit fares) - it's the count of prior rows in the same parse
    with the same (date, description, amount), so re-parsing the same file deterministically
    reproduces the same hashes (true duplicates), while distinct repeats within one file don't collide.
    """
    key = f"stmt|{account_id}|{date}|{description}|{amount:.4f}|{occurrence_index}"
    return hashlib.sha256(key.encode()).hexdigest()
