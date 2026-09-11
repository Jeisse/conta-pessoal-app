import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, type Account, type ImportProfile, type PreviewResult } from "../api/client";

interface Props {
  onImported: (statementId: number) => void;
}

type AmountMode = "single" | "split";

interface Mapping {
  dateColumn: string;
  descriptionColumn: string;
  amountMode: AmountMode;
  amountColumn: string;
  debitColumn: string;
  creditColumn: string;
  dateFormat: string;
  delimiter: string;
  encoding: string;
  headerRowIndex: number;
  decimalSeparator: string;
}

const DEFAULT_MAPPING: Mapping = {
  dateColumn: "",
  descriptionColumn: "",
  amountMode: "single",
  amountColumn: "",
  debitColumn: "",
  creditColumn: "",
  dateFormat: "%d/%m/%Y",
  delimiter: ",",
  encoding: "utf-8",
  headerRowIndex: 0,
  decimalSeparator: ",",
};

function profileToMapping(p: ImportProfile): Mapping {
  return {
    dateColumn: p.date_column ?? "",
    descriptionColumn: p.description_column ?? "",
    amountMode: p.debit_column ? "split" : "single",
    amountColumn: p.amount_column ?? "",
    debitColumn: p.debit_column ?? "",
    creditColumn: p.credit_column ?? "",
    dateFormat: p.date_format ?? "%d/%m/%Y",
    delimiter: p.delimiter,
    encoding: p.encoding,
    headerRowIndex: p.header_row_index,
    decimalSeparator: p.decimal_separator,
  };
}

type Step = "account" | "upload" | "map" | "extracting" | "done";

export default function ImportPage({ onImported }: Props) {
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("account");
  const [fileKind, setFileKind] = useState<"csv" | "pdf" | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Mapping>(DEFAULT_MAPPING);
  const [importResult, setImportResult] = useState<{ statement_id: number; imported: number; duplicates_skipped: number } | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ bank_name: "", nickname: "" });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stepSequence: Step[] = fileKind === "pdf" ? ["account", "upload", "extracting", "done"] : ["account", "upload", "map", "done"];
  const stepLabel: Record<Step, string> = { account: "Account", upload: "Upload", map: "Map columns", extracting: "Extracting", done: "Done" };

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

  const hasRequiredMapping =
    !!mapping.dateColumn &&
    !!mapping.descriptionColumn &&
    (mapping.amountMode === "single" ? !!mapping.amountColumn : !!mapping.debitColumn || !!mapping.creditColumn);

  const validationQuery = useQuery({
    queryKey: ["validate-mapping", preview?.columns, preview?.rows, mapping],
    queryFn: () =>
      api.validateMapping({
        columns: preview!.columns,
        rows: preview!.rows,
        date_column: mapping.dateColumn,
        description_column: mapping.descriptionColumn,
        amount_column: mapping.amountMode === "single" ? mapping.amountColumn : undefined,
        debit_column: mapping.amountMode === "split" ? mapping.debitColumn : undefined,
        credit_column: mapping.amountMode === "split" ? mapping.creditColumn : undefined,
        date_format: mapping.dateFormat,
        decimal_separator: mapping.decimalSeparator,
      }),
    enabled: step === "map" && !!preview && preview.rows.length > 0 && hasRequiredMapping,
  });

  const createAccountMutation = useMutation({
    mutationFn: () => api.createAccount({ bank_name: newAccount.bank_name, nickname: newAccount.nickname || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowNewAccount(false);
      setNewAccount({ bank_name: "", nickname: "" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: (f: File) => api.previewStatement(f, mapping.delimiter, mapping.encoding, mapping.headerRowIndex),
    onSuccess: (data) => setPreview(data),
    onError: (e: Error) => setError(e.message),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      api.importStatement({
        file: file!,
        account_id: selectedAccount!.id,
        date_column: mapping.dateColumn,
        description_column: mapping.descriptionColumn,
        amount_column: mapping.amountMode === "single" ? mapping.amountColumn : undefined,
        debit_column: mapping.amountMode === "split" ? mapping.debitColumn : undefined,
        credit_column: mapping.amountMode === "split" ? mapping.creditColumn : undefined,
        date_format: mapping.dateFormat,
        delimiter: mapping.delimiter,
        encoding: mapping.encoding,
        header_row_index: mapping.headerRowIndex,
        decimal_separator: mapping.decimalSeparator,
      }),
    onSuccess: (result) => {
      setImportResult(result);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["statements"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const pdfImportMutation = useMutation({
    mutationFn: (f: File) => api.importPdfStatement({ file: f, account_id: selectedAccount!.id }),
    onSuccess: (result) => {
      setImportResult(result);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["statements"] });
    },
    onError: (e: Error) => { setError(e.message); setStep("upload"); },
  });

  async function handleSelectAccount(account: Account) {
    setSelectedAccount(account);
    setError(null);
    const profile = await api.getImportProfile(account.id);
    if (profile) setMapping(profileToMapping(profile));
    else setMapping(DEFAULT_MAPPING);
    setStep("upload");
  }

  async function handleFileChange(f: File) {
    setFile(f);
    setError(null);

    if (f.name.toLowerCase().endsWith(".pdf")) {
      setFileKind("pdf");
      setStep("extracting");
      pdfImportMutation.mutate(f);
      return;
    }

    setFileKind("csv");
    try {
      const result = await api.previewStatement(f, mapping.delimiter, mapping.encoding, mapping.headerRowIndex);
      setPreview(result);
      setStep("map");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleRePreview() {
    if (file) previewMutation.mutate(file);
  }

  function setField<K extends keyof Mapping>(key: K, value: Mapping[K]) {
    setMapping((m) => ({ ...m, [key]: value }));
  }

  const cols = preview?.columns ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
      <h1>Import Bank Statement</h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
        {stepSequence.map((s, i) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                width: 28, height: 28, borderRadius: "50%", display: "inline-flex",
                alignItems: "center", justifyContent: "center", fontSize: "0.8rem",
                background: step === s ? "#2563eb" : stepSequence.indexOf(step) > i ? "#d1fae5" : "#f3f4f6",
                color: step === s ? "white" : "#374151",
                fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: "0.85rem", color: step === s ? "#2563eb" : "#6b7280" }}>
              {stepLabel[s]}
            </span>
            {i < stepSequence.length - 1 && <span style={{ color: "#d1d5db" }}>{"›"}</span>}
          </span>
        ))}
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {step === "account" && (
        <section>
          <h2 style={{ marginTop: 0 }}>Select account</h2>
          {accountsQuery.isLoading && <p>Loading accounts…</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
            {accountsQuery.data?.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 1rem", border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <div style={{ flex: 1 }}>
                  <strong>{a.nickname || a.bank_name}</strong>
                  {a.nickname && <span style={{ color: "#6b7280", marginLeft: "0.5rem" }}>{a.bank_name}</span>}
                </div>
                <button onClick={() => handleSelectAccount(a)} style={btnStyle}>Select</button>
              </div>
            ))}
            {accountsQuery.data?.length === 0 && <p style={{ color: "#9ca3af" }}>No accounts yet — create one below.</p>}
          </div>

          {!showNewAccount ? (
            <button onClick={() => setShowNewAccount(true)} style={secondaryBtnStyle}>+ New account</button>
          ) : (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", marginTop: "0.5rem" }}>
              <h3 style={{ marginTop: 0 }}>New account</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <Field label="Bank name *">
                  <input value={newAccount.bank_name} onChange={(e) => setNewAccount((a) => ({ ...a, bank_name: e.target.value }))} style={inputStyle} placeholder="e.g. Nubank" />
                </Field>
                <Field label="Nickname">
                  <input value={newAccount.nickname} onChange={(e) => setNewAccount((a) => ({ ...a, nickname: e.target.value }))} style={inputStyle} placeholder="e.g. Main card" />
                </Field>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                <button onClick={() => createAccountMutation.mutate()} disabled={!newAccount.bank_name || createAccountMutation.isPending} style={btnStyle}>
                  {createAccountMutation.isPending ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowNewAccount(false)} style={secondaryBtnStyle}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      {step === "upload" && (
        <section>
          <p style={{ color: "#374151" }}>
            Account: <strong>{selectedAccount?.nickname || selectedAccount?.bank_name}</strong>
            <button onClick={() => setStep("account")} style={{ marginLeft: "0.75rem", ...linkBtnStyle }}>Change</button>
          </p>
          <h2 style={{ marginTop: 0 }}>Upload statement (CSV or PDF)</h2>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
            <Field label="Delimiter">
              <input value={mapping.delimiter} onChange={(e) => setField("delimiter", e.target.value)} style={{ ...inputStyle, width: 60 }} />
            </Field>
            <Field label="Encoding">
              <input value={mapping.encoding} onChange={(e) => setField("encoding", e.target.value)} style={{ ...inputStyle, width: 100 }} />
            </Field>
            <Field label="Header row (0-indexed)">
              <input type="number" min={0} value={mapping.headerRowIndex} onChange={(e) => setField("headerRowIndex", Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
            </Field>
          </div>
          <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: "-0.5rem" }}>
            (The options above only apply to CSV files — PDF statements are read directly, no column mapping needed.)
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            style={{ border: "2px dashed #d1d5db", borderRadius: 12, padding: "3rem", textAlign: "center", cursor: "pointer", color: "#6b7280", background: "#f9fafb" }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📄</div>
            <div>Click to choose a CSV or PDF file, or drag and drop</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
          />
        </section>
      )}

      {step === "extracting" && (
        <section style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔎</div>
          <h2>Reading PDF and extracting transactions…</h2>
          <p style={{ color: "#6b7280" }}>{file?.name} — this can take a bit longer than a CSV import.</p>
        </section>
      )}

      {step === "map" && preview && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: "#374151", margin: 0 }}>
              Account: <strong>{selectedAccount?.nickname || selectedAccount?.bank_name}</strong>
              {" · "}File: <strong>{file?.name}</strong>
              <button onClick={() => setStep("upload")} style={{ marginLeft: "0.75rem", ...linkBtnStyle }}>Change</button>
            </p>
          </div>

          <h3>File preview</h3>
          <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", width: "100%" }}>
              <thead>
                <tr>
                  {preview.columns.map((c, i) => (
                    <th key={i} style={{ padding: "0.35rem 0.6rem", background: "#f3f4f6", border: "1px solid #e5e7eb", textAlign: "left", whiteSpace: "nowrap" }}>
                      {c || `col_${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ padding: "0.3rem 0.6rem", border: "1px solid #e5e7eb", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <Field label="Delimiter">
              <input value={mapping.delimiter} onChange={(e) => setField("delimiter", e.target.value)} style={{ ...inputStyle, width: 60 }} />
            </Field>
            <Field label="Header row">
              <input type="number" min={0} value={mapping.headerRowIndex} onChange={(e) => setField("headerRowIndex", Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
            </Field>
            <Field label="Decimal separator">
              <select value={mapping.decimalSeparator} onChange={(e) => setField("decimalSeparator", e.target.value)} style={inputStyle}>
                <option value=".">. (dot)</option>
                <option value=",">, (comma)</option>
              </select>
            </Field>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button onClick={handleRePreview} disabled={previewMutation.isPending} style={secondaryBtnStyle}>Re-preview</button>
            </div>
          </div>

          <h3>Map columns</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
            <Field label="Date column *">
              <ColSelect cols={cols} value={mapping.dateColumn} onChange={(v) => setField("dateColumn", v)} />
            </Field>
            <Field label="Date format *">
              <input value={mapping.dateFormat} onChange={(e) => setField("dateFormat", e.target.value)} style={inputStyle} placeholder="%d/%m/%Y" />
              <small style={{ color: "#6b7280" }}>Common: %d/%m/%Y · %Y-%m-%d · %m/%d/%Y</small>
            </Field>
            <Field label="Description column *">
              <ColSelect cols={cols} value={mapping.descriptionColumn} onChange={(v) => setField("descriptionColumn", v)} />
            </Field>
            <Field label="Amount type">
              <div style={{ display: "flex", gap: "1rem" }}>
                <label><input type="radio" checked={mapping.amountMode === "single"} onChange={() => setField("amountMode", "single")} /> Single column</label>
                <label><input type="radio" checked={mapping.amountMode === "split"} onChange={() => setField("amountMode", "split")} /> Debit / Credit</label>
              </div>
            </Field>
            {mapping.amountMode === "single" ? (
              <Field label="Amount column *">
                <ColSelect cols={cols} value={mapping.amountColumn} onChange={(v) => setField("amountColumn", v)} />
                <small style={{ color: "#6b7280" }}>Negative = expense, positive = income</small>
              </Field>
            ) : (
              <>
                <Field label="Debit column (expense)">
                  <ColSelect cols={cols} value={mapping.debitColumn} onChange={(v) => setField("debitColumn", v)} />
                </Field>
                <Field label="Credit column (income)">
                  <ColSelect cols={cols} value={mapping.creditColumn} onChange={(v) => setField("creditColumn", v)} />
                </Field>
              </>
            )}
          </div>

          {hasRequiredMapping && validationQuery.data && (
            <MappingValidationBanner result={validationQuery.data} />
          )}

          <button
            onClick={() => importMutation.mutate()}
            disabled={
              importMutation.isPending ||
              !mapping.dateColumn || !mapping.descriptionColumn ||
              (mapping.amountMode === "single" ? !mapping.amountColumn : !mapping.debitColumn && !mapping.creditColumn)
            }
            style={{ ...btnStyle, fontSize: "1rem", padding: "0.6rem 1.5rem" }}
          >
            {importMutation.isPending ? "Importing (categorizing with AI)…" : "Import"}
          </button>
        </section>
      )}

      {step === "done" && importResult && (
        <section style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
          <h2>Import complete</h2>
          <p><strong>{importResult.imported}</strong> transactions imported and auto-categorized</p>
          {importResult.duplicates_skipped > 0 && (
            <p style={{ color: "#6b7280" }}>{importResult.duplicates_skipped} duplicates skipped</p>
          )}
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "1.5rem" }}>
            <button onClick={() => onImported(importResult.statement_id)} style={{ ...btnStyle, fontSize: "1rem", padding: "0.6rem 1.5rem" }}>
              Review transactions →
            </button>
            <button
              onClick={() => { setStep("account"); setFile(null); setFileKind(null); setPreview(null); setImportResult(null); setError(null); }}
              style={secondaryBtnStyle}
            >
              Import another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function MappingValidationBanner({ result }: { result: import("../api/client").MappingValidationResult }) {
  if (result.total === 0) return null;

  if (result.valid_count === result.total) {
    return (
      <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#166534", fontSize: "0.85rem" }}>
        ✓ All {result.total} previewed rows parse correctly with this mapping.
      </div>
    );
  }

  const firstIssues = result.rows.flatMap((r) => r.issues).slice(0, 3);
  const severe = result.valid_count === 0;

  return (
    <div
      style={{
        background: severe ? "#fef2f2" : "#fffbeb",
        border: `1px solid ${severe ? "#fca5a5" : "#fde68a"}`,
        borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem",
        color: severe ? "#b91c1c" : "#92400e", fontSize: "0.85rem",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
        {severe
          ? `None of the ${result.total} previewed rows match this mapping — it's very likely a wrong column.`
          : `Only ${result.valid_count} of ${result.total} previewed rows parse correctly with this mapping.`}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
        {firstIssues.map((issue, i) => <li key={i}>{issue}</li>)}
      </ul>
    </div>
  );
}

function ColSelect({ cols, value, onChange }: { cols: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">— select column —</option>
      {cols.map((c, i) => (
        <option key={i} value={c}>{c || `col_${i}`}</option>
      ))}
    </select>
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

const inputStyle: React.CSSProperties = { padding: "0.4rem 0.6rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: "0.9rem", width: "100%", boxSizing: "border-box" };
const btnStyle: React.CSSProperties = { padding: "0.45rem 1rem", background: "#2563eb", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const secondaryBtnStyle: React.CSSProperties = { padding: "0.45rem 1rem", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" };
const linkBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "inherit" };
