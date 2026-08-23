export type RegistryVisualComponentDataKind =
  | "category-value"
  | "region-value"
  | "point-value"
  | "route-value"
  | "series-value";

export type RegistryVisualComponentDataEncoding = "json" | "key-value-list" | "route-value-list";

export type RegistryVisualComponentDataColumnType = "string" | "number";

export type RegistryVisualComponentDataColumnRole = "id" | "label" | "value" | "source" | "target";

export interface RegistryVisualComponentDataColumn {
  id: string;
  label: string;
  labelZh?: string;
  type: RegistryVisualComponentDataColumnType;
  role: RegistryVisualComponentDataColumnRole;
  required?: boolean;
}

export interface RegistryVisualComponentDataBinding {
  variable: string;
  encoding: RegistryVisualComponentDataEncoding;
}

export interface RegistryVisualComponentValueFormat {
  unit?: string;
  precision?: number;
  notation?: "standard" | "compact" | "percent" | "currency";
  currency?: string;
}

/**
 * AI-facing semantic data contract for a visual component. The binding keeps
 * standalone registry compositions free to choose a compact storage encoding;
 * Studio and agents always receive the normalized row document below.
 */
export interface RegistryVisualComponentDataContract {
  version: 1;
  kind: RegistryVisualComponentDataKind;
  mode: "replace" | "override";
  rowId: string;
  binding: RegistryVisualComponentDataBinding;
  columns: RegistryVisualComponentDataColumn[];
  minRows?: number;
  maxRows?: number;
  highlightVariable?: string;
  valueFormat?: RegistryVisualComponentValueFormat;
}

export type VisualComponentDataCell = string | number;
export type VisualComponentDataRow = Record<string, VisualComponentDataCell>;

export interface VisualComponentDataDocument {
  version: 1;
  kind: RegistryVisualComponentDataKind;
  rows: VisualComponentDataRow[];
}

export interface VisualComponentDataIssue {
  path: string;
  message: string;
}

export interface ParsedVisualComponentData {
  document: VisualComponentDataDocument;
  issues: VisualComponentDataIssue[];
}

function readObjectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

function findColumn(
  contract: RegistryVisualComponentDataContract,
  roles: RegistryVisualComponentDataColumnRole[],
  fallbackIndex: number,
): RegistryVisualComponentDataColumn | undefined {
  return (
    contract.columns.find((column) => roles.includes(column.role)) ??
    contract.columns[fallbackIndex]
  );
}

function parseCell(
  raw: unknown,
  column: RegistryVisualComponentDataColumn,
): VisualComponentDataCell | undefined {
  if (column.type === "number") {
    const numberValue = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  return typeof raw === "string" ? raw.trim() : undefined;
}

function normalizeRows(
  rawRows: unknown[],
  contract: RegistryVisualComponentDataContract,
): ParsedVisualComponentData {
  const rows: VisualComponentDataRow[] = [];
  const issues: VisualComponentDataIssue[] = [];

  for (const [rowIndex, rawRow] of rawRows.entries()) {
    const row: VisualComponentDataRow = {};
    for (const column of contract.columns) {
      const cell = parseCell(readObjectValue(rawRow, column.id), column);
      if (cell === undefined || cell === "") {
        if (column.required) {
          issues.push({
            path: `rows.${rowIndex}.${column.id}`,
            message: `${column.label} is required`,
          });
        }
        continue;
      }
      row[column.id] = cell;
    }
    const hiddenRowId = readObjectValue(rawRow, contract.rowId);
    if (
      row[contract.rowId] === undefined &&
      (typeof hiddenRowId === "string" || typeof hiddenRowId === "number")
    ) {
      row[contract.rowId] = hiddenRowId;
    }
    rows.push(row);
  }

  const minRows = contract.minRows ?? 0;
  if (rows.length < minRows) {
    issues.push({ path: "rows", message: `At least ${minRows} rows are required` });
  }
  if (contract.maxRows !== undefined && rows.length > contract.maxRows) {
    issues.push({ path: "rows", message: `At most ${contract.maxRows} rows are allowed` });
  }

  const seenIds = new Set<VisualComponentDataCell>();
  for (const [rowIndex, row] of rows.entries()) {
    const rowId = row[contract.rowId];
    if (rowId === undefined) continue;
    if (seenIds.has(rowId)) {
      issues.push({ path: `rows.${rowIndex}.${contract.rowId}`, message: "Row id must be unique" });
    }
    seenIds.add(rowId);
  }

  return { document: { version: 1, kind: contract.kind, rows }, issues };
}

function parseJsonRows(
  value: string,
  contract: RegistryVisualComponentDataContract,
): ParsedVisualComponentData {
  try {
    const parsed: unknown = JSON.parse(value);
    const version = readObjectValue(parsed, "version");
    const kind = readObjectValue(parsed, "kind");
    const rows = readObjectValue(parsed, "rows");
    if (version !== 1 || kind !== contract.kind || !Array.isArray(rows)) {
      return {
        document: { version: 1, kind: contract.kind, rows: [] },
        issues: [{ path: "data", message: "Data document does not match this component contract" }],
      };
    }
    return normalizeRows(rows, contract);
  } catch {
    return {
      document: { version: 1, kind: contract.kind, rows: [] },
      issues: [{ path: "data", message: "Data document is not valid JSON" }],
    };
  }
}

function parseKeyValueRows(
  value: string,
  contract: RegistryVisualComponentDataContract,
): ParsedVisualComponentData {
  const keyColumn = findColumn(contract, ["id", "label"], 0);
  const valueColumn = findColumn(contract, ["value"], 1);
  if (!keyColumn || !valueColumn) {
    return {
      document: { version: 1, kind: contract.kind, rows: [] },
      issues: [{ path: "columns", message: "Key-value data needs two columns" }],
    };
  }

  const rows = value
    .split(",")
    .map((entry) => {
      const separator = entry.lastIndexOf(":");
      return {
        [keyColumn.id]: entry.slice(0, separator).trim(),
        [valueColumn.id]: separator >= 0 ? entry.slice(separator + 1).trim() : "",
      };
    })
    .filter((row) => row[keyColumn.id] !== "");
  return normalizeRows(rows, contract);
}

function parseRouteRows(
  value: string,
  contract: RegistryVisualComponentDataContract,
): ParsedVisualComponentData {
  const sourceColumn = findColumn(contract, ["source"], 0);
  const targetColumn = findColumn(contract, ["target"], 1);
  const valueColumn = findColumn(contract, ["value"], 2);
  if (!sourceColumn || !targetColumn || !valueColumn) {
    return {
      document: { version: 1, kind: contract.kind, rows: [] },
      issues: [{ path: "columns", message: "Route data needs source, target, and value columns" }],
    };
  }

  const rows = value
    .split(",")
    .map((entry) => {
      const valueSeparator = entry.lastIndexOf(":");
      const route = entry.slice(0, valueSeparator).split(">");
      return {
        [sourceColumn.id]: (route[0] ?? "").trim(),
        [targetColumn.id]: (route[1] ?? "").trim(),
        [valueColumn.id]: valueSeparator >= 0 ? entry.slice(valueSeparator + 1).trim() : "",
        [contract.rowId]: `${(route[0] ?? "").trim()}>${(route[1] ?? "").trim()}`,
      };
    })
    .filter((row) => row[sourceColumn.id] !== "" || row[targetColumn.id] !== "");
  return normalizeRows(rows, contract);
}

export function parseVisualComponentData(
  contract: RegistryVisualComponentDataContract,
  value: string,
): ParsedVisualComponentData {
  if (contract.binding.encoding === "json") return parseJsonRows(value, contract);
  if (contract.binding.encoding === "route-value-list") return parseRouteRows(value, contract);
  return parseKeyValueRows(value, contract);
}

export function serializeVisualComponentData(
  contract: RegistryVisualComponentDataContract,
  document: VisualComponentDataDocument,
): string {
  if (contract.binding.encoding === "json") return JSON.stringify(document);

  if (contract.binding.encoding === "route-value-list") {
    const sourceColumn = findColumn(contract, ["source"], 0);
    const targetColumn = findColumn(contract, ["target"], 1);
    const valueColumn = findColumn(contract, ["value"], 2);
    if (!sourceColumn || !targetColumn || !valueColumn) return "";
    return document.rows
      .map(
        (row) =>
          `${row[sourceColumn.id] ?? ""}>${row[targetColumn.id] ?? ""}:${row[valueColumn.id] ?? ""}`,
      )
      .join(",");
  }

  const keyColumn = findColumn(contract, ["id", "label"], 0);
  const valueColumn = findColumn(contract, ["value"], 1);
  if (!keyColumn || !valueColumn) return "";
  return document.rows
    .map((row) => `${row[keyColumn.id] ?? ""}:${row[valueColumn.id] ?? ""}`)
    .join(",");
}

export function createVisualComponentDataRow(
  contract: RegistryVisualComponentDataContract,
): VisualComponentDataRow {
  const row: VisualComponentDataRow = {};
  for (const column of contract.columns) row[column.id] = column.type === "number" ? 0 : "";
  return row;
}

export function formatVisualComponentDataForAi(
  contract: RegistryVisualComponentDataContract,
  value: string,
): string {
  const parsed = parseVisualComponentData(contract, value);
  return JSON.stringify(
    {
      contractVersion: 1,
      kind: contract.kind,
      mode: contract.mode,
      rowId: contract.rowId,
      columns: contract.columns,
      valueFormat: contract.valueFormat,
      allowedOperations: [
        "set",
        "upsertRows",
        "removeRows",
        ...(contract.highlightVariable ? ["setHighlight"] : []),
      ],
      data: parsed.document,
      validation: { valid: parsed.issues.length === 0, issues: parsed.issues },
    },
    null,
    2,
  );
}
