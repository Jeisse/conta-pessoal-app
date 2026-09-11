const BASE = "/api";

export const EXPENSE_GROUPS = ["Fixas", "Variáveis", "Adicionais", "Extras"] as const;
export const INCOME_GROUP = "Receitas" as const;
export const ALL_GROUPS = [...EXPENSE_GROUPS, INCOME_GROUP] as const;

export interface Account {
  id: number;
  bank_name: string;
  nickname: string | null;
  active: number;
}

export interface ImportProfile {
  account_id: number;
  date_column: string | null;
  description_column: string | null;
  amount_column: string | null;
  debit_column: string | null;
  credit_column: string | null;
  date_format: string;
  decimal_separator: string;
  delimiter: string;
  encoding: string;
  header_row_index: number;
}

export interface PreviewResult {
  columns: string[];
  rows: string[][];
}

export interface MappingValidationResult {
  valid_count: number;
  total: number;
  rows: { issues: string[] }[];
}

export interface ImportResult {
  statement_id: number;
  imported: number;
  duplicates_skipped: number;
}

export interface Statement {
  id: number;
  filename: string;
  uploaded_at: string;
  status: "processing" | "ready_for_review" | "committed" | "error";
  row_count: number;
  format: "csv" | "pdf";
  bank_name: string | null;
  nickname: string | null;
}

export interface StatementTransaction {
  id: number;
  date: string;
  description_raw: string;
  amount: number;
  direction: "income" | "expense";
  review_status: "pending" | "excluded" | "committed";
  category_id: number;
  category_name: string;
}

export interface Category {
  id: number;
  name: string;
  direction: "income" | "expense";
  group_name: string | null;
}

export interface TransactionRow {
  id: number;
  date: string;
  description_raw: string;
  amount: number;
  direction: "income" | "expense";
  category_id: number;
  category_name: string;
  category_group: string | null;
  account_nickname: string | null;
  account_bank_name: string | null;
}

export interface TransactionListResult {
  total: number;
  page: number;
  page_size: number;
  expense_total: number;
  income_total: number;
  results: TransactionRow[];
}

export interface QueryResponse {
  answer: string;
  structured_query: Record<string, unknown>;
  result:
    | { type: "aggregate"; value: number; matched_count: number }
    | { type: "rows"; rows: TransactionRow[] };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {
      // ignore body parse failure, fall back to statusText
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  accounts: () => fetch(`${BASE}/accounts`).then((r) => handle<Account[]>(r)),

  createAccount: (body: { bank_name: string; nickname?: string }) =>
    fetch(`${BASE}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<Account>(r)),

  getImportProfile: (accountId: number) =>
    fetch(`${BASE}/accounts/${accountId}/import-profile`).then((r) => handle<ImportProfile | null>(r)),

  previewStatement: (file: File, delimiter: string, encoding: string, headerRowIndex: number) => {
    const form = new FormData();
    form.append("file", file);
    form.append("delimiter", delimiter);
    form.append("encoding", encoding);
    form.append("header_row_index", String(headerRowIndex));
    return fetch(`${BASE}/statements/preview`, { method: "POST", body: form }).then((r) =>
      handle<PreviewResult>(r),
    );
  },

  validateMapping: (params: {
    columns: string[];
    rows: string[][];
    date_column?: string;
    description_column?: string;
    amount_column?: string;
    debit_column?: string;
    credit_column?: string;
    date_format: string;
    decimal_separator: string;
  }) =>
    fetch(`${BASE}/statements/validate-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).then((r) => handle<MappingValidationResult>(r)),

  importStatement: (params: {
    file: File;
    account_id: number;
    date_column: string;
    description_column: string;
    amount_column?: string;
    debit_column?: string;
    credit_column?: string;
    date_format: string;
    delimiter: string;
    encoding: string;
    header_row_index: number;
    decimal_separator: string;
  }) => {
    const form = new FormData();
    form.append("file", params.file);
    form.append("account_id", String(params.account_id));
    form.append("date_column", params.date_column);
    form.append("description_column", params.description_column);
    if (params.amount_column) form.append("amount_column", params.amount_column);
    if (params.debit_column) form.append("debit_column", params.debit_column);
    if (params.credit_column) form.append("credit_column", params.credit_column);
    form.append("date_format", params.date_format);
    form.append("delimiter", params.delimiter);
    form.append("encoding", params.encoding);
    form.append("header_row_index", String(params.header_row_index));
    form.append("decimal_separator", params.decimal_separator);
    return fetch(`${BASE}/statements/import`, { method: "POST", body: form }).then((r) =>
      handle<ImportResult>(r),
    );
  },

  importPdfStatement: (params: { file: File; account_id: number }) => {
    const form = new FormData();
    form.append("file", params.file);
    form.append("account_id", String(params.account_id));
    return fetch(`${BASE}/statements/import-pdf`, { method: "POST", body: form }).then((r) =>
      handle<ImportResult>(r),
    );
  },

  statements: () => fetch(`${BASE}/statements`).then((r) => handle<Statement[]>(r)),

  statementTransactions: (statementId: number) =>
    fetch(`${BASE}/statements/${statementId}/transactions`).then((r) => handle<StatementTransaction[]>(r)),

  commitStatement: (statementId: number) =>
    fetch(`${BASE}/statements/${statementId}/commit`, { method: "POST" }).then((r) =>
      handle<{ committed: number }>(r),
    ),

  discardStatement: (statementId: number) =>
    fetch(`${BASE}/statements/${statementId}`, { method: "DELETE" }).then((r) => handle<void>(r)),

  updateTransactionCategory: (txId: number, categoryName: string) =>
    fetch(`${BASE}/transactions/${txId}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_name: categoryName }),
    }).then((r) => handle<{ id: number; category_id: number }>(r)),

  toggleExcludeTransaction: (txId: number) =>
    fetch(`${BASE}/transactions/${txId}/toggle-exclude`, { method: "POST" }).then((r) =>
      handle<{ id: number; review_status: string }>(r),
    ),

  deleteTransaction: (txId: number) =>
    fetch(`${BASE}/transactions/${txId}`, { method: "DELETE" }).then((r) => handle<void>(r)),

  categories: () => fetch(`${BASE}/categories`).then((r) => handle<Category[]>(r)),

  updateCategoryGroup: (categoryId: number, groupName: string | null) =>
    fetch(`${BASE}/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_name: groupName }),
    }).then((r) => handle<{ id: number; group_name: string | null }>(r)),

  backfillCategoryGroups: () =>
    fetch(`${BASE}/categories/backfill-groups`, { method: "POST" }).then((r) => handle<{ updated: number }>(r)),

  mergeCategory: (categoryId: number, targetId: number) =>
    fetch(`${BASE}/categories/${categoryId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId }),
    }).then((r) => handle<{ merged_into: number }>(r)),

  createTransaction: (body: { date: string; description: string; amount: number; direction: string; category_name: string; account_id?: number | null }) =>
    fetch(`${BASE}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<TransactionRow>(r)),

  transactions: (params: {
    start?: string;
    end?: string;
    category?: string;
    group?: string;
    direction?: string;
    search?: string;
    sort?: string;
    sort_dir?: string;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return fetch(`${BASE}/transactions?${query.toString()}`).then((r) => handle<TransactionListResult>(r));
  },

  ask: (question: string) =>
    fetch(`${BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }).then((r) => handle<QueryResponse>(r)),
};
