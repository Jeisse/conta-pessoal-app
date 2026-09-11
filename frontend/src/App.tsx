import { useState } from "react";
import ImportPage from "./pages/ImportPage";
import ReviewPage from "./pages/ReviewPage";
import TransactionsPage from "./pages/TransactionsPage";
import AskPage from "./pages/AskPage";
import AddTransactionPage from "./pages/AddTransactionPage";
import CategoriesPage from "./pages/CategoriesPage";

type Tab = "import" | "review" | "transactions" | "ask" | "add" | "categories";

export default function App() {
  const [tab, setTab] = useState<Tab>("import");
  const [reviewStatementId, setReviewStatementId] = useState<number | undefined>(undefined);

  function goToReview(statementId: number) {
    setReviewStatementId(statementId);
    setTab("review");
  }

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <nav style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid #e5e7eb", padding: "0 1rem" }}>
        {([
          ["import", "Import"],
          ["review", "Review"],
          ["transactions", "Transactions"],
          ["add", "Add Transaction"],
          ["categories", "Categories"],
          ["ask", "Ask"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "0.75rem 1rem", border: "none", background: "none", cursor: "pointer",
              fontWeight: 600, fontSize: "0.9rem",
              color: tab === key ? "#2563eb" : "#6b7280",
              borderBottom: tab === key ? "2px solid #2563eb" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "import" && <ImportPage onImported={goToReview} />}
      {tab === "review" && <ReviewPage initialStatementId={reviewStatementId} />}
      {tab === "transactions" && <TransactionsPage />}
      {tab === "add" && <AddTransactionPage />}
      {tab === "categories" && <CategoriesPage />}
      {tab === "ask" && <AskPage />}
    </div>
  );
}
