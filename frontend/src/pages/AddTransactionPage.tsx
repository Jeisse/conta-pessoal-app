import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddTransactionPage() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createTransaction({
        date,
        description: description.trim(),
        amount: Number(amount),
        direction,
        category_name: category.trim(),
        account_id: accountId ? Number(accountId) : null,
      }),
    onSuccess: (tx) => {
      setSuccessMessage(`Added "${tx.description_raw}" for ${formatMoney(tx.amount)}.`);
      setError(null);
      setDescription("");
      setAmount("");
      setCategory("");
      setAccountId("");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: Error) => { setError(e.message); setSuccessMessage(null); },
  });

  const categoryNames = categoriesQuery.data?.map((c) => c.name) ?? [];
  const accounts = accountsQuery.data ?? [];
  const parsedAmount = Number(amount);
  const canSubmit = date && description.trim() && amount.trim() && parsedAmount > 0 && category.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || createMutation.isPending) return;
    createMutation.mutate();
  }

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <h1>Add Transaction</h1>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#b91c1c" }}>
          {error}
        </div>
      )}
      {successMessage && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#166534" }}>
          {successMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Field label="Date *">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} required />
        </Field>

        <Field label="Description *">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
            placeholder="e.g. Coffee with friends"
            required
          />
        </Field>

        <Field label="Direction *">
          <div style={{ display: "flex", gap: "1rem" }}>
            <label><input type="radio" checked={direction === "expense"} onChange={() => setDirection("expense")} /> Expense</label>
            <label><input type="radio" checked={direction === "income"} onChange={() => setDirection("income")} /> Income</label>
          </div>
        </Field>

        <Field label="Amount *">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inputStyle}
            placeholder="0.00"
            required
          />
        </Field>

        <Field label="Category *">
          <input list="new-tx-categories" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="e.g. Restaurantes" required />
          <datalist id="new-tx-categories">
            {categoryNames.map((name) => <option key={name} value={name} />)}
          </datalist>
        </Field>

        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inputStyle}>
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.nickname || a.bank_name}</option>
            ))}
          </select>
        </Field>

        <button type="submit" disabled={!canSubmit || createMutation.isPending} style={btnStyle}>
          {createMutation.isPending ? "Adding…" : "Add transaction"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151" }}>{label}</label>
      {children}
    </div>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

const inputStyle: React.CSSProperties = { padding: "0.5rem 0.7rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.95rem", boxSizing: "border-box" };
const btnStyle: React.CSSProperties = { padding: "0.6rem 1.2rem", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" };
