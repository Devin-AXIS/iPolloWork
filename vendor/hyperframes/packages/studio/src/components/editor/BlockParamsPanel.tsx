import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  GripVertical,
  LoaderCircle,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  createVisualComponentDataRow,
  parseVisualComponentData,
  serializeVisualComponentData,
  fromJSON,
  toJSON,
  validateComponentVariables,
  parseComponentTextList,
} from "@hyperframes/core/registry";
import type {
  BlockParam,
  RegistryVisualComponentDataColumn,
  RegistryVisualComponentDataContract,
  VisualComponentDataDocument,
  VisualComponentDataRow,
  RegistryVariable,
  RegistryVisualComponent,
  ComponentContentModel,
  ComponentVariableValues,
} from "@hyperframes/core/registry";
import { DesignPanelInputProvider } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import { ColorField } from "./propertyPanelColor";
import { FlatRow, FlatSlider } from "./propertyPanelFlatPrimitives";
import { FlatSelectRow } from "./propertyPanelFlatSelectRow";
import { FlatToggle } from "./propertyPanelFlatToggle";
import { CommitField, PROPERTY_INPUT_DEBOUNCE_MS } from "./propertyPanelPrimitives";

type BlockVariableValue = string | number | boolean;
type SaveState = "saved" | "saving" | "error";

interface BlockParamsPanelProps {
  blockTitle: string;
  params: BlockParam[];
  variables: RegistryVariable[];
  variableValues: Record<string, BlockVariableValue>;
  visualComponent?: RegistryVisualComponent;
  onVariableChange: (variableId: string, value: BlockVariableValue) => Promise<void>;
  onVariablesChange?: (values: ComponentVariableValues, expected: ComponentVariableValues) => Promise<void>;
  onBack: () => void;
}

export const BlockParamsPanel = memo(function BlockParamsPanel({
  blockTitle,
  params,
  variables,
  variableValues,
  visualComponent,
  onVariableChange,
  onVariablesChange,
  onBack,
}: BlockParamsPanelProps) {
  const { locale } = useStudioI18n();
  const [legacyValues, setLegacyValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((param) => [param.key, param.default])),
  );
  const [savingVariable, setSavingVariable] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saveRequestIdRef = useRef(0);
  const [tab, setTab] = useState<"content" | "json">("content");
  const [saveError, setSaveError] = useState<string | null>(null);
  const model = visualComponent?.ai?.model;

  const handleVariableCommit = useCallback(
    (variableId: string, value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return Promise.resolve(false);
      }
      const requestId = saveRequestIdRef.current + 1;
      saveRequestIdRef.current = requestId;
      setSavingVariable(variableId);
      setSaveState("saving");
      setSaveError(null);
      if (model) {
        const result = validateComponentVariables(model, { ...model.defaults, ...variableValues, [variableId]: value });
        if (result.errors.length) {
          setSaveState("error"); setSavingVariable(null);
          setSaveError(result.errors.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
          return Promise.resolve(false);
        }
      }
      return onVariableChange(variableId, value)
        .then(() => {
          if (saveRequestIdRef.current === requestId) setSaveState("saved");
          return true;
        })
        .catch((error: unknown) => {
          if (saveRequestIdRef.current === requestId) { setSaveState("error"); setSaveError(error instanceof Error ? error.message : "Save failed"); }
          return false;
        })
        .finally(() => {
          if (saveRequestIdRef.current === requestId) setSavingVariable(null);
        });
    },
    [onVariableChange, model, variableValues],
  );

  return (
    <div className="flex h-full flex-col" data-testid="block-params-panel">
      <div className="border-b border-panel-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="grid size-7 flex-none place-items-center rounded-md text-panel-text-3 transition-colors hover:bg-panel-input hover:text-panel-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/40"
            aria-label={locale === "zh" ? "返回组件列表" : "Back to components"}
            title={locale === "zh" ? "返回组件列表" : "Back to components"}
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-panel-text-1">
            {blockTitle}
          </h2>
          <SaveStatus state={saveState} locale={locale} />
        </div>
      </div>

      {model && onVariablesChange ? (
        <div className="flex gap-1 border-b border-panel-border px-4 py-2" role="tablist" aria-label={locale === "zh" ? "组件编辑方式" : "Component editor"}>
          {(["content", "json"] as const).map(mode => (
            <button key={mode} data-testid={`component-${mode}-tab`} type="button" role="tab" aria-selected={tab === mode} onClick={() => setTab(mode)}
              className={`rounded-md px-3 py-1 text-[11px] ${tab === mode ? "bg-panel-input text-panel-text-1" : "text-panel-text-3"}`}>
              {mode === "json" ? "JSON" : locale === "zh" ? "内容" : "Content"}
            </button>
          ))}
        </div>
      ) : null}
      {saveError ? <pre role="alert" className="max-h-28 overflow-auto whitespace-pre-wrap border-b border-panel-border px-4 py-2 text-[10px] text-red-500">{saveError}</pre> : null}

      {model && onVariablesChange ? (
        <div className={tab === "json" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ComponentJsonField model={model} values={variableValues} locale={locale} onApply={onVariablesChange} />
        </div>
      ) : null}
      <div className={`${tab === "json" && model && onVariablesChange ? "hidden" : ""} min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3`}>
        <DesignPanelInputProvider ui="flat" section="component-variables">
          <div className="space-y-3">
            {variables.map((variable) => {
              const dataContract = visualComponent?.data;
              if (dataContract?.binding.variable === variable.id) {
                return (
                  <ComponentDataFormField
                    key={variable.id}
                    label={variable.label}
                    contract={dataContract}
                    value={String(variableValues[variable.id] ?? variable.default)}
                    liveCommit={variable.update === "live"}
                    saving={savingVariable === variable.id}
                    locale={locale}
                    jsonLists={!!model}
                    onCommit={(value) => handleVariableCommit(variable.id, value)}
                  />
                );
              }
              const dataValue = dataContract
                ? String(
                    variableValues[dataContract.binding.variable] ??
                      variables.find((candidate) => candidate.id === dataContract.binding.variable)
                        ?.default ??
                      "",
                  )
                : "";
              return (
                <VariableFormField
                  key={variable.id}
                  variable={createDataHighlightVariable(variable, dataContract, dataValue)}
                  value={variableValues[variable.id] ?? variable.default}
                  onCommit={(value) => handleVariableCommit(variable.id, value)}
                />
              );
            })}
          </div>
        </DesignPanelInputProvider>

        {params.length ? (
          <div className="space-y-3 border-t border-panel-border pt-3">
            <div className="text-[9px] font-medium uppercase tracking-wider text-panel-text-3">
              {locale === "zh" ? "兼容参数" : "Legacy parameters"}
            </div>
            <DesignPanelInputProvider ui="flat" section="component-legacy-parameters">
              <div className="space-y-3">
                {params.map((param) => {
                  const variable = legacyParamVariable(param);
                  const value = legacyParamValue(
                    variable,
                    legacyValues[param.key] ?? param.default,
                  );
                  return (
                    <VariableFormField
                      key={param.key}
                      variable={variable}
                      value={value}
                      onCommit={(nextValue) =>
                        setLegacyValues((current) => ({
                          ...current,
                          [param.key]: String(nextValue),
                        }))
                      }
                    />
                  );
                })}
              </div>
            </DesignPanelInputProvider>
          </div>
        ) : null}
      </div>
    </div>
  );
});

function ComponentJsonField({ model, values, locale, onApply }: {
  model: ComponentContentModel; values: ComponentVariableValues; locale: "en" | "zh";
  onApply: (values: ComponentVariableValues, expected: ComponentVariableValues) => Promise<void>;
}) {
  const serialized = useMemo(() => {
    try { return JSON.stringify(toJSON(model, values), null, 2); }
    catch { return "{}"; }
  }, [model, values]);
  const [draft, setDraft] = useState(serialized);
  const [base, setBase] = useState({ serialized, values });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== base.serialized;
  const stale = dirty && serialized !== base.serialized;
  useEffect(() => {
    if (!dirty) { setDraft(serialized); setBase({ serialized, values }); }
  }, [dirty, serialized, values]);
  const result = useMemo(() => {
    try { return fromJSON(model, JSON.parse(draft), { ...model.defaults, ...base.values }); }
    catch (e) { return { values: base.values, errors: [{ path: "", message: e instanceof Error ? e.message : "Invalid JSON" }], warnings: [] }; }
  }, [model, draft, base.values]);
  const apply = async () => {
    if (stale || result.errors.length || saving || !dirty) return;
    setSaving(true); setError(null);
    try {
      await onApply(result.values, base.values);
      const next = JSON.stringify(toJSON(model, result.values), null, 2);
      setDraft(next); setBase({ serialized: next, values: result.values });
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };
  return <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
    <p className="text-[10px] text-panel-text-3">{locale === "zh" ? "与内容表单共用数据。省略字段保留原值，数组整组替换。应用前检查数量、引用、时间和排版。" : "Shared with the content form. Omitted fields retain their values; arrays replace the group. Apply checks capacity, references, timing and layout."}</p>
    <textarea aria-label={locale === "zh" ? "组件 JSON" : "Component JSON"} data-testid="component-json-editor" spellCheck={false} maxLength={65536}
      className="min-h-48 flex-1 resize-none rounded-md border border-panel-border bg-panel-input p-3 font-mono text-[11px] text-panel-text-1 focus:outline-none focus:ring-1 focus:ring-panel-accent"
      value={draft} onChange={event => { setDraft(event.target.value); setError(null); }} />
    {stale ? <p role="alert" className="text-[10px] text-red-500">{locale === "zh" ? "组件已被其他修改更新，请重新载入当前 JSON 后再编辑。" : "The component changed. Reload current JSON before editing."}</p> : null}
    {result.errors.length || error ? <pre role="alert" className="max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-red-500">{error ?? result.errors.map(issue => `${issue.path}: ${issue.message}`).join("\n")}</pre> : null}
    <div className="flex gap-2">
      <button type="button" data-testid="component-json-apply" disabled={!dirty || stale || saving || !!result.errors.length} onClick={() => void apply()}
        className="rounded-md bg-panel-accent px-3 py-1.5 text-[11px] text-white disabled:opacity-40">{saving ? locale === "zh" ? "应用中" : "Applying" : locale === "zh" ? "应用 JSON" : "Apply JSON"}</button>
      <button type="button" data-testid="component-json-reload" disabled={saving} onClick={() => { setDraft(serialized); setBase({ serialized, values }); setError(null); }} className="rounded-md border border-panel-border px-3 py-1.5 text-[11px] text-panel-text-2">{locale === "zh" ? "重新载入" : "Reload current"}</button>
    </div>
  </div>;
}

function SaveStatus({ state, locale }: { state: SaveState; locale: "en" | "zh" }) {
  const label =
    state === "saving"
      ? locale === "zh"
        ? "保存中"
        : "Saving"
      : state === "error"
        ? locale === "zh"
          ? "保存失败"
          : "Save failed"
        : locale === "zh"
          ? "已自动保存"
          : "Autosaved";
  const icon =
    state === "saving" ? (
      <LoaderCircle className="size-3 animate-spin" strokeWidth={1.75} aria-hidden="true" />
    ) : state === "error" ? (
      <CircleAlert className="size-3" strokeWidth={1.75} aria-hidden="true" />
    ) : (
      <Check className="size-3" strokeWidth={1.75} aria-hidden="true" />
    );

  return (
    <span
      className={`flex flex-none items-center gap-1 text-[9px] ${
        state === "error" ? "text-red-500" : "text-panel-text-3"
      }`}
      aria-live="polite"
      data-save-state={state}
    >
      {icon}
      {label}
    </span>
  );
}

function displayComponentTextList(value: string, separators: string): string {
  try { return parseComponentTextList(value, separators).join("\n"); }
  catch { return value; }
}

function ComponentDataFormField({
  label,
  contract,
  value,
  liveCommit,
  saving,
  locale,
  onCommit,
  jsonLists = false,
}: {
  label: string;
  contract: RegistryVisualComponentDataContract;
  value: string;
  liveCommit: boolean;
  saving: boolean;
  locale: "en" | "zh";
  onCommit: (value: string) => void | Promise<boolean>;
  jsonLists?: boolean;
}) {
  const { tx } = useStudioI18n();
  const parsed = useMemo(() => parseVisualComponentData(contract, value), [contract, value]);
  const [rows, setRows] = useState<VisualComponentDataRow[]>(parsed.document.rows);
  const [draggedRowIndex, setDraggedRowIndex] = useState<number | null>(null);
  const rowsRef = useRef(parsed.document.rows);
  const sectionRef = useRef<HTMLElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const lastSubmittedValueRef = useRef(value);

  valueRef.current = value;

  useEffect(() => {
    lastSubmittedValueRef.current = value;
    if (sectionRef.current?.contains(document.activeElement)) return;
    rowsRef.current = parsed.document.rows;
    setRows(parsed.document.rows);
  }, [parsed.document.rows]);

  useEffect(
    () => () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  const currentDocument: VisualComponentDataDocument = {
    version: 1,
    kind: contract.kind,
    rows,
  };
  const currentValue = serializeVisualComponentData(contract, currentDocument);
  const issues = parseVisualComponentData(contract, currentValue).issues;

  const serializeRows = (nextRows: VisualComponentDataRow[]) =>
    serializeVisualComponentData(contract, {
      version: 1,
      kind: contract.kind,
      rows: nextRows,
    });

  const submitRows = (nextRows: VisualComponentDataRow[]) => {
    commitTimerRef.current = null;
    const nextValue = serializeRows(nextRows);
    // Keep incomplete new rows in the shared form until required fields are
    // filled. A draft must not replace valid preview data or trigger a save.
    if (parseVisualComponentData(contract, nextValue).issues.length) return;
    if (nextValue === valueRef.current || nextValue === lastSubmittedValueRef.current) return;
    lastSubmittedValueRef.current = nextValue;
    void Promise.resolve(onCommit(nextValue)).then(saved => {
      if (saved === false && lastSubmittedValueRef.current === nextValue) lastSubmittedValueRef.current = valueRef.current;
    });
  };

  const commitRows = (nextRows: VisualComponentDataRow[]) => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    rowsRef.current = nextRows;
    setRows(nextRows);
    submitRows(nextRows);
  };

  const scheduleCommit = (nextRows: VisualComponentDataRow[]) => {
    if (!liveCommit) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      submitRows(nextRows);
    }, PROPERTY_INPUT_DEBOUNCE_MS);
  };

  const updateCell = (
    rowIndex: number,
    column: RegistryVisualComponentDataColumn,
    rawValue: string,
  ) => {
    setRows((currentRows) => {
      const nextRows = currentRows.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              [column.id]: column.list && jsonLists ? JSON.stringify(rawValue.split("\n").map(item => item.trim()).filter(Boolean)) :
                column.type === "number" && rawValue !== "" && Number.isFinite(Number(rawValue))
                  ? Number(rawValue)
                  : rawValue,
            }
          : row,
      );
      rowsRef.current = nextRows;
      scheduleCommit(nextRows);
      return nextRows;
    });
  };

  const reorderRow = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const nextRows = [...rowsRef.current];
    const movedRows = nextRows.splice(fromIndex, 1);
    const movedRow = movedRows[0];
    if (!movedRow) return;
    nextRows.splice(toIndex, 0, movedRow);
    commitRows(nextRows);
  };

  const displayLabel = tx(label.replace(/\s*\(.+\)\s*$/, ""));
  const richRows = contract.columns.some(column => column.options || column.format === "image");

  const numberRangeHints = contract.columns
    .filter(column => column.type === "number" && (column.min !== undefined || column.max !== undefined))
    .map(column => `${locale === "zh" ? (column.labelZh ?? column.label) : column.label}: ${column.min ?? "−∞"}–${column.max ?? "∞"}`);

  return (
    <section
      ref={sectionRef}
      className="space-y-2"
      data-component-data-contract={contract.kind}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        commitRows(rowsRef.current);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-normal text-panel-text-3">{displayLabel}</span>
        <span className="text-[9px] text-panel-text-3">
          {locale === "zh" ? `${rows.length} 项` : `${rows.length} items`}
          {contract.minRows !== undefined && contract.maxRows !== undefined
            ? ` · ${contract.minRows}–${contract.maxRows}` : ""}
        </span>
      </div>

      {numberRangeHints.length > 0 ? <p className="text-[10px] text-panel-text-3">{numberRangeHints.join(" · ")}</p> : null}

      {issues.length ? (
        <p className="text-[10px] leading-4 text-red-500" role="alert">
          {issues[0]?.message}
        </p>
      ) : null}

      <div className="space-y-1.5">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={`group ${richRows ? "flex flex-wrap gap-2" : "flex gap-1"} min-w-0 items-center rounded-[6px] bg-panel-input px-2 py-1.5 transition-opacity ${
              draggedRowIndex === rowIndex ? "opacity-50" : ""
            }`}
            data-component-data-row={rowIndex}
            onDragOver={(event) => {
              if (draggedRowIndex === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedRowIndex !== null) reorderRow(draggedRowIndex, rowIndex);
              setDraggedRowIndex(null);
            }}
          >
            {contract.columns.map((column, columnIndex) => column.format === "image" ? (
              <ComponentImageField key={column.id} label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                value={String(row[column.id] ?? "")} locale={locale} onChange={value => {
                  const nextRows = rowsRef.current.map((item, index) => index === rowIndex ? { ...item, [column.id]: value } : item);
                  commitRows(nextRows);
                }} />
            ) : column.options ? (
              <select key={column.id} aria-label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                value={row[column.id] ?? column.options[0]?.value ?? ""} disabled={saving && !liveCommit}
                onChange={event => commitRows(rowsRef.current.map((item, index) =>
                  index === rowIndex ? { ...item, [column.id]: event.target.value } : item))}
                className="h-7 min-w-0 flex-1 rounded bg-panel-bg px-2 text-[11px] text-panel-text-1 outline-none focus:ring-1 focus:ring-panel-accent/40">
                {column.options.map(option => <option key={option.value} value={option.value}>{tx(option.label)}</option>)}
              </select>
            ) : column.list && jsonLists ? (
              <textarea key={column.id} rows={Math.min(4, column.list.maxItems)}
                aria-label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                aria-invalid={issues.some(issue => issue.path === `rows.${rowIndex}.${column.id}`)}
                value={displayComponentTextList(String(row[column.id] ?? ""), column.list.separators)}
                placeholder={locale === "zh" ? "每行一个要点，标点会保留" : "One item per line; punctuation is preserved"}
                onChange={event => updateCell(rowIndex, column, event.target.value)}
                className="min-w-0 w-full resize-y rounded border border-panel-border bg-transparent p-1 text-[11px] text-panel-text-1 outline-none" />
            ) : (
              <input
                key={column.id}
                type={column.type === "number" ? "number" : "text"}
                min={column.type === "number" ? column.min : undefined}
                max={column.type === "number" ? column.max : undefined}
                step={column.type === "number" ? "any" : undefined}
                value={row[column.id] ?? ""}
                disabled={saving && !liveCommit}
                aria-label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                aria-invalid={issues.some(issue => issue.path === `rows.${rowIndex}.${column.id}`)}
                title={column.type === "number" && (column.min !== undefined || column.max !== undefined)
                  ? (locale === "zh" ? `范围：${column.min ?? "−∞"}–${column.max ?? "∞"}` : `Range: ${column.min ?? "−∞"}–${column.max ?? "∞"}`)
                  : column.list
                  ? (locale === "zh" ? `最多 ${column.list.maxItems} 项，每项 ${column.list.itemMaxLength} 字` : `Up to ${column.list.maxItems} items, ${column.list.itemMaxLength} characters each`)
                  : column.maxLength !== undefined
                    ? (locale === "zh" ? `最多 ${column.maxLength} 字` : `Up to ${column.maxLength} characters`) : undefined}
                onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                className={`h-6 min-w-0 bg-transparent px-1 text-[11px] text-panel-text-1 outline-none placeholder:text-panel-text-4 disabled:opacity-60 ${
                  richRows ? "w-full flex-auto border-b border-panel-border pb-1" : columnIndex === 0
                    ? "w-12 flex-none font-medium"
                    : "flex-1 border-l border-panel-border pl-2"
                }`}
                placeholder={locale === "zh" ? (column.labelZh ?? column.label) : column.label}
              />
            ))}
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                setDraggedRowIndex(rowIndex);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(rowIndex));
              }}
              onDragEnd={() => setDraggedRowIndex(null)}
              className="grid size-6 flex-none cursor-grab place-items-center rounded text-panel-text-4 transition-colors hover:bg-panel-hover hover:text-panel-text-2 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/40"
              aria-label={`${locale === "zh" ? "拖动排序" : "Drag to reorder"} ${rowIndex + 1}`}
              title={locale === "zh" ? "拖动排序" : "Drag to reorder"}
            >
              <GripVertical className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
            <div className="w-0 overflow-visible">
              <button
                type="button"
                disabled={saving || rows.length <= (contract.minRows ?? 0)}
                onClick={() => commitRows(rows.filter((_, index) => index !== rowIndex))}
                className="grid size-6 -translate-x-6 place-items-center rounded bg-panel-input text-panel-text-4 opacity-0 shadow-sm transition-[opacity,color,background-color] hover:bg-panel-hover hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/40 disabled:pointer-events-none group-hover:opacity-100"
                aria-label={`${locale === "zh" ? "删除数据行" : "Remove data row"} ${rowIndex + 1}`}
                title={locale === "zh" ? "删除条目" : "Remove item"}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={saving || (contract.maxRows !== undefined && rows.length >= contract.maxRows)}
        onClick={() => commitRows([...rows, createVisualComponentDataRow(contract)])}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-panel-border text-[10px] text-panel-text-3 transition-colors hover:border-panel-accent/45 hover:bg-panel-input hover:text-panel-text-1 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        {locale === "zh" ? "添加条目" : "Add item"}
      </button>

    </section>
  );
}

function ComponentImageField({ label, value, locale, onChange }: { label: string; value: string; locale: "en" | "zh"; onChange: (value: string) => void }) {
  const [error, setError] = useState("");
  return <div className="flex min-w-0 items-center gap-2">
    <label className="flex h-7 cursor-pointer items-center gap-1 rounded border border-panel-border px-2 text-[10px] text-panel-text-2 hover:bg-panel-hover">
      {value && <img src={value} alt="" className="size-5 object-contain" />}
      {locale === "zh" ? "自定义图标" : "Custom icon"}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={label} className="hidden" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ""; setError("");
        if (!file) return;
        if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) || file.size > 2 * 1024 * 1024) { setError(locale === "zh" ? "请选择小于 2 MB 的图标图片" : "Choose an icon image smaller than 2 MB"); return; }
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === "string") onChange(reader.result); };
        reader.onerror = () => setError(locale === "zh" ? "图片读取失败" : "Unable to read image");
        reader.readAsDataURL(file);
      }} />
    </label>
    {value && <button type="button" aria-label={locale === "zh" ? `恢复内置图标 ${label}` : `Restore built-in icon ${label}`} onClick={() => onChange("")} className="text-panel-text-3"><RotateCcw size={12} /></button>}
    {error && <span role="alert" className="text-[10px] text-red-500">{error}</span>}
  </div>;
}

function createDataHighlightVariable(
  variable: RegistryVariable,
  contract: RegistryVisualComponentDataContract | undefined,
  value: string,
): RegistryVariable {
  if (!contract?.highlightVariable || variable.id !== contract.highlightVariable) return variable;
  if (variable.type === "number") return variable;
  const rows = parseVisualComponentData(contract, value).document.rows;
  const sourceColumn = contract.columns.find((column) => column.role === "source");
  const targetColumn = contract.columns.find((column) => column.role === "target");
  const labelColumn = contract.columns.find((column) => ["label", "id"].includes(column.role));
  const options = rows.flatMap((row) => {
    const rowId = row[contract.rowId];
    if (rowId === undefined || rowId === "") return [];
    const label =
      sourceColumn && targetColumn
        ? `${row[sourceColumn.id] ?? ""} → ${row[targetColumn.id] ?? ""}`
        : String(labelColumn ? (row[labelColumn.id] ?? rowId) : rowId);
    return [{ label, value: String(rowId) }];
  });
  if (!options.length) return variable;
  return {
    id: variable.id,
    label: variable.label,
    type: "enum",
    default: String(variable.default),
    options,
  };
}

function VariableFormField({
  variable,
  value,
  onCommit,
}: {
  variable: RegistryVariable;
  value: BlockVariableValue;
  onCommit: (value: BlockVariableValue) => void;
}) {
  const current = value ?? variable.default;
  const custom = current !== variable.default;
  const tier = custom ? "explicitCustom" : "explicitDefault";
  const reset = custom ? () => onCommit(variable.default) : undefined;
  let control: ReactNode;

  switch (variable.type) {
    case "boolean":
      control = (
        <FlatToggle label={variable.label} checked={current === true} onChange={onCommit} />
      );
      break;
    case "enum":
      control = (
        <FlatSelectRow
          label={variable.label}
          value={String(current)}
          options={variable.options}
          tier={tier}
          onChange={onCommit}
          onReset={reset}
        />
      );
      break;
    case "color":
      control = (
        <ColorField label={variable.label} value={String(current)} flat onCommit={onCommit} />
      );
      break;
    case "number": {
      const numberValue = typeof current === "number" ? current : Number(current) || 0;
      control =
        variable.min !== undefined && variable.max !== undefined ? (
          <FlatSlider
            label={variable.label}
            value={numberValue}
            min={variable.min}
            max={variable.max}
            step={variable.step ?? 1}
            tier={custom ? "explicitCustom" : "default"}
            displayValue={`${numberValue}${variable.unit ?? ""}`}
            commitMode={variable.update === "live" ? "live" : "release"}
            onCommit={onCommit}
            onReset={reset}
          />
        ) : (
          <FlatRow
            label={variable.label}
            value={String(numberValue)}
            tier={tier}
            inputType="number"
            min={variable.min}
            max={variable.max}
            step={variable.step}
            suffix={
              variable.unit ? (
                <span className="text-[10px] text-panel-text-3">{variable.unit}</span>
              ) : undefined
            }
            onCommit={(nextValue) => {
              const nextNumber = Number(nextValue);
              onCommit(Number.isFinite(nextNumber) ? nextNumber : variable.default);
            }}
            onReset={reset}
          />
        );
      break;
    }
    default:
      control = (
        <BlockTextField
          label={variable.label}
          value={String(current)}
          liveCommit={variable.update === "live"}
          placeholder={variable.type === "string" ? variable.placeholder : undefined}
          maxLength={variable.type === "string" ? variable.maxLength : undefined}
          onCommit={onCommit}
          onReset={reset}
        />
      );
  }

  return (
    <div data-variable-id={variable.id} className="space-y-1.5">
      {control}
      {variable.description ? (
        <p className="px-1 text-[9px] leading-4 text-panel-text-3">{variable.description}</p>
      ) : null}
    </div>
  );
}

function BlockTextField({
  label,
  value,
  liveCommit,
  placeholder,
  maxLength,
  onCommit,
  onReset,
}: {
  label: string;
  value: string;
  liveCommit: boolean;
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string) => void;
  onReset?: () => void;
}) {
  const { tx } = useStudioI18n();
  const translatedLabel = tx(label);

  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[10px] font-normal text-panel-text-3">{translatedLabel}</span>
      <span className="group flex h-[34px] min-w-0 items-center rounded-[6px] border border-transparent bg-panel-input px-2.5 transition-colors focus-within:border-panel-accent/50">
        <span className="min-w-0 flex-1 text-[13px] text-panel-text-1">
          <CommitField
            value={value}
            liveCommit={liveCommit}
            align="left"
            placeholder={placeholder}
            maxLength={maxLength}
            ariaLabel={translatedLabel}
            onCommit={onCommit}
          />
        </span>
        {onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="grid size-6 flex-none place-items-center rounded text-panel-text-4 opacity-0 transition-[opacity,color,background-color] hover:bg-panel-hover hover:text-panel-text-1 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/40 group-hover:opacity-100"
            aria-label={tx(`Reset ${label}`)}
            title={tx("Reset")}
          >
            <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </label>
  );
}

function legacyParamVariable(param: BlockParam): RegistryVariable {
  if (param.type === "color") {
    return { id: param.key, label: param.label, type: "color", default: param.default };
  }
  if (param.type === "number") {
    return {
      id: param.key,
      label: param.label,
      type: "number",
      default: Number(param.default) || 0,
      min: param.min,
      max: param.max,
      step: param.step,
    };
  }
  if (param.type === "select") {
    return {
      id: param.key,
      label: param.label,
      type: "enum",
      default: param.default,
      options: param.options ?? [{ label: param.default, value: param.default }],
    };
  }
  return { id: param.key, label: param.label, type: "string", default: param.default };
}

function legacyParamValue(variable: RegistryVariable, value: string): BlockVariableValue {
  return variable.type === "number" ? Number(value) || variable.default : value;
}
