import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

type BlockVariableValue = string | number | boolean;

interface BlockParamsPanelProps {
  blockTitle: string;
  params: BlockParam[];
  variables: RegistryVariable[];
  variableValues: Record<string, BlockVariableValue>;
  visualComponent?: RegistryVisualComponent;
  onVariableChange: (variableId: string, value: BlockVariableValue) => Promise<void>;
  onClose: () => void;
}

export const BlockParamsPanel = memo(function BlockParamsPanel({
  blockTitle,
  params,
  variables,
  variableValues,
  visualComponent,
  onVariableChange,
  onClose,
}: BlockParamsPanelProps) {
  const { locale } = useStudioI18n();
  const [legacyValues, setLegacyValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((param) => [param.key, param.default])),
  );
  const [savingVariable, setSavingVariable] = useState<string | null>(null);

  const handleVariableCommit = useCallback(
    (variableId: string, value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return;
      }
      setSavingVariable(variableId);
      void onVariableChange(variableId, value).finally(() => setSavingVariable(null));
    },
    [onVariableChange],
  );

  return (
    <div className="flex h-full flex-col" data-testid="block-params-panel">
      <div className="border-b border-panel-border px-4 pb-3 pt-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-panel-text-1">{blockTitle}</div>
            <div className="mt-1 text-[9px] text-panel-text-3">
              {visualComponent
                ? locale === "zh"
                  ? "组件变量"
                  : "Component variables"
                : locale === "zh"
                  ? "片段参数"
                  : "Clip parameters"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-6 flex-none place-items-center rounded-md text-panel-text-3 transition-colors hover:bg-panel-input hover:text-panel-text-1"
            aria-label={locale === "zh" ? "关闭参数" : "Close parameters"}
          >
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
          </button>
        </div>

        {visualComponent ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-[#1FBAC0]/12 px-2 py-1 text-[9px] font-medium text-[#2abec3]">
              {locale === "zh" ? "跟随主题" : "Theme linked"}
            </span>
            <span className="rounded-full bg-panel-input px-2 py-1 text-[9px] font-medium text-panel-text-3">
              {visualComponent.surfaces.map((surface) => surface.toUpperCase()).join(" · ")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {visualComponent?.ai?.slots.length ? (
          <div className="rounded-lg border border-[#1FBAC0]/15 bg-[#1FBAC0]/[0.06] px-3 py-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#2abec3]">
              {locale === "zh" ? "AI 可编辑区域" : "AI-editable slots"}
            </div>
            <div className="mt-1.5 text-[10px] leading-4 text-panel-text-3">
              {visualComponent.ai.slots.join(" · ")}
            </div>
          </div>
        ) : null}

        <DesignPanelInputProvider ui="flat" section="component-variables">
          <div className="space-y-3">
            {variables.map((variable) => {
              const dataContract = visualComponent?.data;
              if (dataContract?.binding.variable === variable.id) {
                return (
                  <ComponentDataFormField
                    key={variable.id}
                    contract={dataContract}
                    value={String(variableValues[variable.id] ?? variable.default)}
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
                  saving={savingVariable === variable.id}
                  locale={locale}
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
                      saving={false}
                      locale={locale}
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

function ComponentDataFormField({
  contract,
  value,
  saving,
  locale,
  onCommit,
}: {
  contract: RegistryVisualComponentDataContract;
  value: string;
  saving: boolean;
  locale: "en" | "zh";
  onCommit: (value: string) => void;
}) {
  const parsed = useMemo(() => parseVisualComponentData(contract, value), [contract, value]);
  const [rows, setRows] = useState<VisualComponentDataRow[]>(parsed.document.rows);
  const rowsRef = useRef(parsed.document.rows);

  useEffect(() => {
    rowsRef.current = parsed.document.rows;
    setRows(parsed.document.rows);
  }, [parsed.document.rows]);

  const currentDocument: VisualComponentDataDocument = {
    version: 1,
    kind: contract.kind,
    rows,
  };
  const currentValue = serializeVisualComponentData(contract, currentDocument);
  const issues = parseVisualComponentData(contract, currentValue).issues;

  const commitRows = (nextRows: VisualComponentDataRow[]) => {
    rowsRef.current = nextRows;
    setRows(nextRows);
    onCommit(
      serializeVisualComponentData(contract, {
        version: 1,
        kind: contract.kind,
        rows: nextRows,
      }),
    );
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
      return nextRows;
    });
  };

  return (
    <section
      className="space-y-2 rounded-lg border border-panel-border bg-panel-input/35 p-2.5"
      data-component-data-contract={contract.kind}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold text-panel-text-1">
            {locale === "zh"
              ? contract.mode === "override"
                ? "数据覆盖"
                : "结构化数据"
              : contract.mode === "override"
                ? "Data overrides"
                : "Structured data"}
          </div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.1em] text-[#2abec3]">
            {locale === "zh" ? "AI 可读取 · 实时校验" : "AI-readable · validated"}
          </div>
        </div>
        <span className="rounded-full bg-panel-bg px-2 py-1 text-[8px] text-panel-text-3">
          {rows.length} {locale === "zh" ? "行" : "rows"}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((row, rowIndex) => (
          <div
            key={`${String(row[contract.rowId] ?? "row")}-${rowIndex}`}
            className="rounded-md border border-panel-border bg-panel-bg/75 p-2"
            data-component-data-row={rowIndex}
          >
            <div className="grid gap-2">
              {contract.columns.map((column) => (
                <label key={column.id} className="grid gap-1">
                  <span className="text-[8px] font-medium text-panel-text-3">
                    {locale === "zh" ? (column.labelZh ?? column.label) : column.label}
                  </span>
                  <input
                    type={column.type === "number" ? "number" : "text"}
                    value={row[column.id] ?? ""}
                    disabled={saving}
                    aria-label={`${locale === "zh" ? (column.labelZh ?? column.label) : column.label} ${rowIndex + 1}`}
                    onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                    onBlur={() => commitRows(rowsRef.current)}
                    className="h-7 min-w-0 rounded-md border border-panel-border bg-panel-input px-2 text-[10px] text-panel-text-1 outline-none transition-colors focus:border-[#1FBAC0]/60 disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={saving || rows.length <= (contract.minRows ?? 0)}
                onClick={() => commitRows(rows.filter((_, index) => index !== rowIndex))}
                className="rounded px-1.5 py-1 text-[8px] text-panel-text-3 transition-colors hover:bg-panel-input hover:text-panel-text-1 disabled:opacity-35"
                aria-label={`${locale === "zh" ? "删除数据行" : "Remove data row"} ${rowIndex + 1}`}
              >
                {locale === "zh" ? "删除" : "Remove"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={saving || (contract.maxRows !== undefined && rows.length >= contract.maxRows)}
        onClick={() => commitRows([...rows, createVisualComponentDataRow(contract)])}
        className="h-7 w-full rounded-md border border-dashed border-panel-border text-[9px] font-medium text-panel-text-3 transition-colors hover:border-[#1FBAC0]/45 hover:text-[#2abec3] disabled:opacity-35"
      >
        + {locale === "zh" ? "添加数据行" : "Add data row"}
      </button>

      {issues.length ? (
        <p className="text-[8px] leading-4 text-red-500" role="alert">
          {issues[0]?.message}
        </p>
      ) : null}
      <div className="text-right text-[8px] uppercase text-panel-text-4">
        {saving ? (locale === "zh" ? "保存中" : "Saving") : contract.kind}
      </div>
    </section>
  );
}

function createDataHighlightVariable(
  variable: RegistryVariable,
  contract: RegistryVisualComponentDataContract | undefined,
  value: string,
): RegistryVariable {
  if (!contract?.highlightVariable || variable.id !== contract.highlightVariable) return variable;
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
  saving,
  locale,
  onCommit,
}: {
  variable: RegistryVariable;
  value: BlockVariableValue;
  saving: boolean;
  locale: "en" | "zh";
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
        <FlatRow
          label={variable.label}
          value={String(current)}
          tier={tier}
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
      <div className="flex min-h-4 items-start gap-2 px-1">
        {variable.description ? (
          <p className="min-w-0 flex-1 text-[9px] leading-4 text-panel-text-3">
            {variable.description}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        <span className="flex-none text-[8px] uppercase text-panel-text-4">
          {saving ? (locale === "zh" ? "保存中" : "Saving") : (variable.update ?? "live")}
        </span>
      </div>
    </div>
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
