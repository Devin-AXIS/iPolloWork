import { memo, useCallback, useState, type ReactNode } from "react";
import type {
  BlockParam,
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
            {variables.map((variable) => (
              <VariableFormField
                key={variable.id}
                variable={variable}
                value={variableValues[variable.id] ?? variable.default}
                saving={savingVariable === variable.id}
                locale={locale}
                onCommit={(value) => handleVariableCommit(variable.id, value)}
              />
            ))}
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
