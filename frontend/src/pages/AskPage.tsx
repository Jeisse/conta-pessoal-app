import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, type QueryResponse } from "../api/client";

const EXAMPLES = [
  "How much did I spend on restaurants last month?",
  "What was my most expensive purchase last month?",
  "How much did I earn this year?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ question: string; response: QueryResponse }[]>([]);

  const askMutation = useMutation({
    mutationFn: (q: string) => api.ask(q),
    onSuccess: (response, q) => setHistory((h) => [{ question: q, response }, ...h]),
  });

  function submit(q: string) {
    if (!q.trim() || askMutation.isPending) return;
    askMutation.mutate(q.trim());
    setQuestion("");
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <h1>Ask about your spending</h1>

      <form onSubmit={(e) => { e.preventDefault(); submit(question); }} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How much did I spend on restaurants last month?"
          style={{ flex: 1, padding: "0.6rem 0.8rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.95rem" }}
        />
        <button type="submit" disabled={askMutation.isPending} style={btnStyle}>
          {askMutation.isPending ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => submit(ex)} style={chipStyle}>{ex}</button>
        ))}
      </div>

      {askMutation.isError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#b91c1c" }}>
          {(askMutation.error as Error).message}
        </div>
      )}

      {history.map((h, i) => (
        <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{h.question}</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.75rem" }}>{h.response.answer}</div>
          {h.response.result.type === "rows" && h.response.result.rows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <tbody>
                {h.response.result.rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "0.3rem 0" }}>{r.date}</td>
                    <td style={{ padding: "0.3rem 0.6rem" }}>{r.description_raw}</td>
                    <td style={{ padding: "0.3rem 0.6rem", color: "#6b7280" }}>{r.category_name}</td>
                    <td style={{ padding: "0.3rem 0", textAlign: "right" }}>{formatMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

const btnStyle: React.CSSProperties = { padding: "0.6rem 1.2rem", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const chipStyle: React.CSSProperties = { padding: "0.35rem 0.7rem", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 99, cursor: "pointer", fontSize: "0.8rem" };
