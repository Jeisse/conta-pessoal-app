from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_connection

router = APIRouter(tags=["accounts"])


def _conn():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


class AccountCreate(BaseModel):
    bank_name: str
    nickname: str | None = None
    active: bool


@router.get("/accounts")
def list_accounts(conn=Depends(_conn)):
    rows = conn.execute("SELECT * FROM accounts WHERE active = 1 ORDER BY bank_name").fetchall()
    return [dict(r) for r in rows]


@router.post("/accounts", status_code=201)
def create_account(body: AccountCreate, conn=Depends(_conn)):
    cur = conn.execute(
        "INSERT INTO accounts (bank_name, nickname) VALUES (?, ?)",
        (body.bank_name, body.nickname),
    )
    conn.commit()
    return {"id": cur.lastrowid, "bank_name": body.bank_name, "nickname": body.nickname}


@router.get("/accounts/{account_id}/import-profile")
def get_import_profile(account_id: int, conn=Depends(_conn)):
    if not conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone():
        raise HTTPException(404, "account not found")
    profile = conn.execute(
        "SELECT * FROM bank_import_profiles WHERE account_id = ?", (account_id,)
    ).fetchone()
    return dict(profile) if profile else None


@router.patch("/accounts/{account_id}")
def update_accounts(account_id: int, body: AccountCreate, conn=Depends(_conn)):
    if not conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone():
        raise HTTPException(404, "account not found")
    conn.execute("UPDATE accounts SET bank_name = ? , nickname = ? , active =? WHERE id = ?", (body.bank_name,body.nickname,body.active, account_id))
    conn.commit()
    return {"id": account_id, "bank_name": body.bank_name, "nickname": body.nickname, "active": body.active}


@router.delete("/accounts/{account_id}", status_code=204)
def discard_account(account_id: int, conn=Depends(_conn)):
    """Deletes an account and all its transactions, regardless of review status -
    including already-committed ones. There's no undo; the caller (UI) is responsible
    for confirming this with the user first."""
    if not conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone():
        raise HTTPException(404, "account not found")
    conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    conn.commit()

