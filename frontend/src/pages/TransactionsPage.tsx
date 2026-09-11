import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ALL_GROUPS, api } from "../api/client";

export default function TransactionsPage() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState("");
  const [group, setGroup] = useState("");
  const [direction, setDirection] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const transactionsQuery = useQuery({
    queryKey: ["transactions", start, end, category, group, direction, search, sort, sortDir, page],
    queryFn: () =>
      api.transactions({
        start: start || undefined,
        end: end || undefined,
        category: category || undefined,
        group: group || undefined,
        direction: direction || undefined,
        search: search || undefined,
        sort,
        sort_dir: sortDir,
        page,
      }),
  });

  const results = transactionsQuery.data?.results ?? [];
  const total = transactionsQuery.data?.total ?? 0;
  const pageSize = transactionsQuery.data?.page_size ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSort(col: string) {
    if (sort === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(col); setSortDir("desc"); }
    setPage(1);
  }

  function resetToFirstPage<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <h1>Transactions</h1>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem", alignItems: "flex-end" }}>
        <Field label="From">
          <input type="date" value={start} onChange={(e) => resetToFirstPage(setStart)(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="To">
          <input type="date" value={end} onChange={(e) => resetToFirstPage(setEnd)(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Category">
          <input
            list="tx-categories"
            value={category}
            onChange={(e) => resetToFirstPage(setCategory)(e.target.value)}
            style={inputStyle}
            placeholder="Any category"
          />
          <datalist id="tx-categories">
            {categoriesQuery.data?.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Group">
          <select value={group} onChange={(e) => resetToFirstPage(setGroup)(e.target.value)} style={inputStyle}>
            <option value="">Any</option>
            {ALL_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={direction} onChange={(e) => resetToFirstPage(setDirection)(e.target.value)} style={inputStyle}>
            <option value="">Any</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>
        <Field label="Search description">
          <input value={search} onChange={(e) => resetToFirstPage(setSearch)(e.target.value)} style={inputStyle} placeholder="e.g. Netflix" />
        </Field>
      </div>

      <div style={{ marginBottom: "0.75rem", color: "#6b7280", fontSize: "0.85rem" }}>
        {total} matching transaction{total === 1 ? "" : "s"}
      </div>

      {transactionsQuery.data && total > 0 && (
        <TotalsSummary
          direction={direction}
          expenseTotal={transactionsQuery.data.expense_total}
          incomeTotal={transactionsQuery.data.income_total}
        />
      )}

      {transactionsQuery.isLoading && <p style={{ color: "#9ca3af" }}>Loading…</p>}

      {results.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <SortableTh label="Date" col="date" sort={sort} sortDir={sortDir} onClick={toggleSort} />
              <th style={thStyle}>Description</th>
              <SortableTh label="Amount" col="amount" sort={sort} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th style={thStyle}>Direction</th>
              <SortableTh label="Category" col="category" sort={sort} sortDir={sortDir} onClick={toggleSort} />
              <th style={thStyle}>Group</th>
              <th style={thStyle}>Account</th>
            </tr>
          </thead>
          <tbody>
            {results.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={tdStyle}>{t.date}</td>
                <td style={{ ...tdStyle, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description_raw}>
                  {t.description_raw}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(t.amount)}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 99,
                      background: t.direction === "expense" ? "#fef2f2" : "#f0fdf4",
                      color: t.direction === "expense" ? "#dc2626" : "#16a34a",
                    }}
                  >
                    {t.direction}
                  </span>
                </td>
                <td style={tdStyle}>{t.category_name}</td>
                <td style={{ ...tdStyle, color: t.category_group ? undefined : "#d97706" }}>{t.category_group ?? "—"}</td>
                <td style={{ ...tdStyle, color: t.account_nickname || t.account_bank_name ? undefined : "#9ca3af" }}>
                  {t.account_nickname || t.account_bank_name || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results.length === 0 && !transactionsQuery.isLoading && (
        <p style={{ color: "#9ca3af" }}>No transactions match these filters.</p>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={secondaryBtnStyle}>← Prev</button>
          <span style={{ fontSize: "0.85rem", color: "#374151" }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={secondaryBtnStyle}>Next →</button>
        </div>
      )}
    </div>
  );
}

function TotalsSummary({ direction, expenseTotal, incomeTotal }: { direction: string; expenseTotal: number; incomeTotal: number }) {
  const cards: { label: string; value: number; color: string }[] = [];
  if (direction === "expense") cards.push({ label: "Total expenses", value: expenseTotal, color: "#dc2626" });
  else if (direction === "income") cards.push({ label: "Total income", value: incomeTotal, color: "#16a34a" });
  else {
    cards.push({ label: "Total expenses", value: expenseTotal, color: "#dc2626" });
    cards.push({ label: "Total income", value: incomeTotal, color: "#16a34a" });
    cards.push({ label: "Net", value: incomeTotal - expenseTotal, color: "#111827" });
  }

  return (
    <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", padding: "0.75rem 1rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
      {cards.map((c) => (
        <div key={c.label}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{c.label}</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: c.color }}>{formatMoney(c.value)}</div>
        </div>
      ))}
    </div>
  );
}

function SortableTh({
  label, col, sort, sortDir, onClick, align,
}: { label: string; col: string; sort: string; sortDir: string; onClick: (col: string) => void; align?: "right" }) {
  const active = sort === col;
  return (
    <th style={{ ...thStyle, textAlign: align ?? "left", cursor: "pointer", userSelect: "none" }} onClick={() => onClick(col)}>
      {label} {active && (sortDir === "asc" ? "↑" : "↓")}
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

const inputStyle: React.CSSProperties = { padding: "0.4rem 0.6rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.9rem" };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.4rem 0.9rem", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" };
const thStyle: React.CSSProperties = { padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 600, fontSize: "0.8rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" };
const tdStyle: React.CSSProperties = { padding: "0.45rem 0.6rem", verticalAlign: "middle" };
