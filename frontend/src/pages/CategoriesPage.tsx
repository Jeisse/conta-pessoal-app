import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ALL_GROUPS, api, type Category } from "../api/client";

export default function CategoriesPage() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, groupName }: { id: number; groupName: string | null }) => api.updateCategoryGroup(id, groupName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  const backfillMutation = useMutation({
    mutationFn: () => api.backfillCategoryGroups(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });

  const mergeMutation = useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number }) => api.mergeCategory(id, targetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  const categories = categoriesQuery.data ?? [];
  const ungroupedCount = categories.filter((c) => c.group_name === null).length;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <h1>Categories</h1>

      {ungroupedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem" }}>
          <span style={{ color: "#92400e", fontSize: "0.9rem" }}>
            {ungroupedCount} categor{ungroupedCount === 1 ? "y has" : "ies have"} no group yet.
          </span>
          <button onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} style={btnStyle}>
            {backfillMutation.isPending ? "Assigning…" : `Backfill ${ungroupedCount} ungrouped categories`}
          </button>
        </div>
      )}

      {backfillMutation.isError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#b91c1c" }}>
          {(backfillMutation.error as Error).message}
        </div>
      )}

      {mergeMutation.isError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#b91c1c" }}>
          {(mergeMutation.error as Error).message}
        </div>
      )}

      {categoriesQuery.isLoading && <p style={{ color: "#9ca3af" }}>Loading…</p>}

      {categories.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Direction</th>
              <th style={thStyle}>Group</th>
              <th style={thStyle}>Merge into</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                allCategories={categories}
                onGroupChange={(groupName) => updateGroupMutation.mutate({ id: c.id, groupName })}
                onMerge={(targetId) => mergeMutation.mutate({ id: c.id, targetId })}
                mergePending={mergeMutation.isPending}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CategoryRow({
  category, allCategories, onGroupChange, onMerge, mergePending,
}: {
  category: Category;
  allCategories: Category[];
  onGroupChange: (groupName: string | null) => void;
  onMerge: (targetId: number) => void;
  mergePending: boolean;
}) {
  const [mergeTarget, setMergeTarget] = useState("");
  const mergeCandidates = allCategories.filter((other) => other.id !== category.id && other.direction === category.direction);

  function handleMerge() {
    if (!mergeTarget) return;
    const target = allCategories.find((c) => c.id === Number(mergeTarget));
    if (!target) return;
    if (confirm(`Merge "${category.name}" into "${target.name}"? All its transactions move to "${target.name}" and "${category.name}" is deleted permanently.`)) {
      onMerge(Number(mergeTarget));
      setMergeTarget("");
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={tdStyle}>{category.name}</td>
      <td style={tdStyle}>
        <span
          style={{
            fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 99,
            background: category.direction === "expense" ? "#fef2f2" : "#f0fdf4",
            color: category.direction === "expense" ? "#dc2626" : "#16a34a",
          }}
        >
          {category.direction}
        </span>
      </td>
      <td style={tdStyle}>
        <select
          value={category.group_name ?? ""}
          onChange={(e) => onGroupChange(e.target.value || null)}
          style={{
            padding: "0.3rem 0.5rem", borderRadius: 4, fontSize: "0.85rem",
            border: category.group_name === null ? "1px solid #f59e0b" : "1px solid #e5e7eb",
            background: category.group_name === null ? "#fffbeb" : undefined,
          }}
        >
          <option value="">— ungrouped —</option>
          {ALL_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ padding: "0.3rem 0.5rem", borderRadius: 4, fontSize: "0.85rem", border: "1px solid #e5e7eb" }}>
            <option value="">— select —</option>
            {mergeCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={handleMerge} disabled={!mergeTarget || mergePending} style={secondaryBtnStyle}>Merge</button>
        </div>
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = { padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 600, fontSize: "0.8rem", color: "#6b7280", borderBottom: "1px solid #e5e7eb" };
const tdStyle: React.CSSProperties = { padding: "0.45rem 0.6rem", verticalAlign: "middle" };
const btnStyle: React.CSSProperties = { padding: "0.4rem 0.9rem", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.3rem 0.7rem", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" };
