import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Statement, type StatementTransaction } from "../api/client";

interface Props {
  initialStatementId?: number;
}

export default function ReviewPage({ initialStatementId }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | undefined>(initialStatementId);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);

  const statementsQuery = useQuery({ queryKey: ["statements"], queryFn: api.statements });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const transactionsQuery = useQuery({
    queryKey: ["statement-transactions", selectedId],
    queryFn: () => api.statementTransactions(selectedId!),
    enabled: selectedId !== undefined,
  });

  useEffect(() => {
    if (initialStatementId) setSelectedId(initialStatementId);
  }, [initialStatementId]);

  const commitMutation = useMutation({
    mutationFn: () => api.commitStatement(selectedId!),
    onSuccess: (data) => {
      setCommitSuccess(`${data.committed} transactions committed.`);
      setCommitError(null);
      qc.invalidateQueries({ queryKey: ["statements"] });
      qc.invalidateQueries({ queryKey: ["statement-transactions", selectedId] });
    },
    onError: (e: Error) => setCommitError(e.message),
  });

  const discardMutation = useMutation({
    mutationFn: () => api.discardStatement(selectedId!),
    onSuccess: () => {
      setSelectedId(undefined);
      qc.invalidateQueries({ queryKey: ["statements"] });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ txId, categoryName }: { txId: number; categoryName: string }) =>
      api.updateTransactionCategory(txId, categoryName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statement-transactions", selectedId] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const toggleExcludeMutation = useMutation({
    mutationFn: (txId: number) => api.toggleExcludeTransaction(txId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["statement-transactions", selectedId] }),
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: (txId: number) => api.deleteTransaction(txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["statement-transactions", selectedId] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const selectedStatement = statementsQuery.data?.find((s) => s.id === selectedId);
  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const transactions = transactionsQuery.data ?? [];

  const pendingCount = transactions.filter((t) => t.review_status === "pending").length;
  const excludedCount = transactions.filter((t) => t.review_status === "excluded").length;
  const uncategorizedCount = transactions.filter((t) => t.category_name === "Uncategorized").length;

  const isCommitted = selectedStatement?.status === "committed";

  return (
    <div style={{ display: "flex", height: "calc(100vh - 50px)", fontFamily: "sans-serif" }}>
      <aside style={{ width: 260, borderRight: "1px solid #e5e7eb", overflowY: "auto", padding: "1rem 0" }}>
        <div style={{ padding: "0 1rem 0.75rem", fontWeight: 700, fontSize: "0.9rem", color: "#374151" }}>Statements</div>
        {statementsQuery.isLoading && <p style={{ padding: "0 1rem", color: "#9ca3af" }}>Loading…</p>}
        {statementsQuery.data?.length === 0 && (
          <p style={{ padding: "0 1rem", color: "#9ca3af", fontSize: "0.85rem" }}>No statements yet.</p>
        )}
        {statementsQuery.data?.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSelectedId(s.id); setCommitSuccess(null); setCommitError(null); }}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "0.6rem 1rem",
              background: selectedId === s.id ? "#eff6ff" : "none",
              border: "none", borderLeft: selectedId === s.id ? "3px solid #2563eb" : "3px solid transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#111827" }}>{s.nickname || s.bank_name || s.filename}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{s.filename}</div>
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
              <StatusBadge status={s.status} />
              <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>{s.row_count} rows</span>
            </div>
          </button>
        ))}
      </aside>

      <main style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
        {!selectedId && (
          <div style={{ color: "#9ca3af", marginTop: "4rem", textAlign: "center" }}>
            Select a statement from the sidebar to review its transactions.
          </div>
        )}

        {selectedId && selectedStatement && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ margin: 0 }}>{selectedStatement.nickname || selectedStatement.bank_name || selectedStatement.filename}</h2>
                <div style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                  {selectedStatement.filename} · uploaded {formatDate(selectedStatement.uploaded_at)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {!isCommitted && (
                  <>
                    <button
                      onClick={() => { if (confirm("Discard this import and all its transactions?")) discardMutation.mutate(); }}
                      disabled={discardMutation.isPending}
                      style={dangerBtnStyle}
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => { setCommitSuccess(null); setCommitError(null); commitMutation.mutate(); }}
                      disabled={commitMutation.isPending || pendingCount === 0}
                      style={btnStyle}
                    >
                      {commitMutation.isPending ? "Committing…" : `Commit ${pendingCount} transactions`}
                    </button>
                  </>
                )}
                {isCommitted && (
                  <>
                    <StatusBadge status="committed" />
                    <button
                      onClick={() => {
                        if (confirm(`Permanently delete this committed statement and all ${transactions.length} of its transactions? This cannot be undone.`)) {
                          discardMutation.mutate();
                        }
                      }}
                      disabled={discardMutation.isPending}
                      style={dangerBtnStyle}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            {commitError && <div style={errorStyle}>{commitError}</div>}
            {commitSuccess && <div style={successStyle}>{commitSuccess}</div>}

            <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.85rem", color: "#374151" }}>
                {transactions.length} total · {pendingCount} will be committed
                {excludedCount > 0 && <span style={{ color: "#9ca3af" }}> · {excludedCount} excluded</span>}
                {uncategorizedCount > 0 && <span style={{ color: "#d97706" }}> · {uncategorizedCount} uncategorized</span>}
              </span>
            </div>

            {transactionsQuery.isLoading && <p style={{ color: "#9ca3af" }}>Loading transactions…</p>}
            {transactions.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={thStyle}>{isCommitted ? "Remove" : "Include"}</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Description</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                    <th style={thStyle}>Direction</th>
                    <th style={thStyle}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      categoryNames={categoryNames}
                      isCommitted={isCommitted}
                      onCategoryChange={(name) => updateCategoryMutation.mutate({ txId: tx.id, categoryName: name })}
                      onToggleExclude={() => toggleExcludeMutation.mutate(tx.id)}
                      onDelete={() => deleteTransactionMutation.mutate(tx.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TransactionRow({
  tx,
  categoryNames,
  isCommitted,
  onCategoryChange,
  onToggleExclude,
  onDelete,
}: {
  tx: StatementTransaction;
  categoryNames: string[];
  isCommitted: boolean;
  onCategoryChange: (name: string) => void;
  onToggleExclude: () => void;
  onDelete: () => void;
}) {
  const [categoryDraft, setCategoryDraft] = useState(tx.category_name);
  useEffect(() => setCategoryDraft(tx.category_name), [tx.category_name]);

  const isUncategorized = tx.category_name === "Uncategorized";
  const isExcluded = tx.review_status === "excluded";
  const listId = `categories-${tx.id}`;

  function handleDelete() {
    if (confirm(`Permanently remove "${tx.description_raw}" (${formatMoney(tx.amount)})? This cannot be undone.`)) {
      onDelete();
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6", background: isExcluded ? "#f9fafb" : isUncategorized ? "#fffbeb" : undefined, opacity: isExcluded ? 0.55 : 1 }}>
      <td style={tdStyle}>
        {isCommitted ? (
          <button onClick={handleDelete} style={smallDangerBtnStyle} title="Permanently remove this transaction">Remove</button>
        ) : (
          <input type="checkbox" checked={!isExcluded} onChange={onToggleExclude} title={isExcluded ? "Excluded — click to include" : "Included — click to exclude"} />
        )}
      </td>
      <td style={tdStyle}>{tx.date}</td>
      <td style={{ ...tdStyle, maxWidth: 280 }}>
        <span title={tx.description_raw} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tx.description_raw}
        </span>
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMoney(tx.amount)}</td>
      <td style={tdStyle}>
        <span
          style={{
            fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 99,
            background: tx.direction === "expense" ? "#fef2f2" : "#f0fdf4",
            color: tx.direction === "expense" ? "#dc2626" : "#16a34a",
          }}
        >
          {tx.direction}
        </span>
      </td>
      <td style={{ ...tdStyle, minWidth: 200 }}>
        <input
          list={listId}
          value={categoryDraft}
          onChange={(e) => setCategoryDraft(e.target.value)}
          onBlur={() => { if (categoryDraft.trim() && categoryDraft !== tx.category_name) onCategoryChange(categoryDraft.trim()); }}
          disabled={isExcluded}
          style={{
            padding: "0.25rem 0.4rem", border: isUncategorized ? "1px solid #f59e0b" : "1px solid #e5e7eb",
            borderRadius: 4, fontSize: "0.82rem", width: "100%", background: isUncategorized ? "#fffbeb" : undefined,
          }}
        />
        <datalist id={listId}>
          {categoryNames.map((name) => <option key={name} value={name} />)}
        </datalist>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Statement["status"] }) {
  const colors: Record<string, { bg: string; color: string }> = {
    processing: { bg: "#f3f4f6", color: "#6b7280" },
    ready_for_review: { bg: "#fef3c7", color: "#92400e" },
    committed: { bg: "#d1fae5", color: "#065f46" },
    error: { bg: "#fee2e2", color: "#991b1b" },
  };
  const s = colors[status] ?? colors.processing;
  return (
    <span style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem", borderRadius: 99, background: s.bg, color: s.color }}>
      {status.replace("_", " ")}
    </span>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" });
}

const thStyle: React.CSSProperties = { padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 600, fontSize: "0.8rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" };
const tdStyle: React.CSSProperties = { padding: "0.45rem 0.6rem", verticalAlign: "middle" };
const btnStyle: React.CSSProperties = { padding: "0.45rem 1rem", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const dangerBtnStyle: React.CSSProperties = { padding: "0.45rem 1rem", background: "white", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer" };
const smallDangerBtnStyle: React.CSSProperties = { padding: "0.2rem 0.5rem", background: "white", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 4, cursor: "pointer", fontSize: "0.75rem" };
const errorStyle: React.CSSProperties = { background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#b91c1c" };
const successStyle: React.CSSProperties = { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#166534" };
