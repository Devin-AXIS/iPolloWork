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
} from "@hyperframes/core/registry";
import type {
  BlockParam,
  RegistryVisualComponentDataColumn,
  RegistryVisualComponentDataContract,
  VisualComponentDataDocument,
  VisualComponentDataRow,
  RegistryVariable,
  RegistryVisualComponent,
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
  onBack: () => void;
}

export const BlockParamsPanel = memo(function BlockParamsPanel({
  blockTitle,
  params,
  variables,
  variableValues,
  visualComponent,
  onVariableChange,
  onBack,
}: BlockParamsPanelProps) {
  const { locale } = useStudioI18n();
  const [legacyValues, setLegacyValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((param) => [param.key, param.default])),
  );
  const [savingVariable, setSavingVariable] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saveRequestIdRef = useRef(0);

  const handleVariableCommit = useCallback(
    (variableId: string, value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return;
      }
      const requestId = saveRequestIdRef.current + 1;
      saveRequestIdRef.current = requestId;
      setSavingVariable(variableId);
      setSaveState("saving");
      void onVariableChange(variableId, value)
        .then(() => {
          if (saveRequestIdRef.current === requestId) setSaveState("saved");
        })
        .catch(() => {
          if (saveRequestIdRef.current === requestId) setSaveState("error");
        })
        .finally(() => {
          if (saveRequestIdRef.current === requestId) setSavingVariable(null);
        });
    },
    [onVariableChange],
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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
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

function ComponentDataFormField({
  label,
  contract,
  value,
  liveCommit,
  saving,
  locale,
  onCommit,
}: {
  label: string;
  contract: RegistryVisualComponentDataContract;
  value: string;
  liveCommit: boolean;
  saving: boolean;
  locale: "en" | "zh";
  onCommit: (value: string) => void;
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
    if (nextValue === valueRef.current || nextValue === lastSubmittedValueRef.current) return;
    lastSubmittedValueRef.current = nextValue;
    onCommit(nextValue);
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
              [column.id]:
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
        </span>
      </div>

      <div className="space-y-1.5">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={`group flex min-w-0 items-center gap-1 rounded-[6px] bg-panel-input px-2 py-1.5 transition-opacity ${
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
            {contract.columns.map((column, columnIndex) => (
              <input
                key={column.id}
                type={column.type === "number" ? "number" : "text"}
                value={row[column.id] ?? ""}
                disabled={saving && !liveCommit}
                aria-label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                className={`h-6 min-w-0 bg-transparent px-1 text-[11px] text-panel-text-1 outline-none placeholder:text-panel-text-4 disabled:opacity-60 ${
                  columnIndex === 0
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

      {issues.length ? (
        <p className="text-[8px] leading-4 text-red-500" role="alert">
          {issues[0]?.message}
        </p>
      ) : null}
    </section>
  );
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
            commitMode="release"
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
