import {
  resolveHyperframesEffectVariableValues,
  type HyperframesAnimationSelection,
  type HyperframesCatalogItem,
  type HyperframesEffectVariable,
  type HyperframesEffectVariableUpdate,
  type HyperframesEffectVariableValue,
  type HyperframesEffectVariableValues,
} from "@ipollowork/types/hyperframes";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function clampNumber(variable: Extract<HyperframesEffectVariable, { type: "number" }>, value: number): number {
  const finite = Number.isFinite(value) ? value : variable.default;
  return Math.min(variable.max ?? finite, Math.max(variable.min ?? finite, finite));
}

function normalizeValue(
  variable: HyperframesEffectVariable,
  value: HyperframesEffectVariableValue,
): HyperframesEffectVariableValue {
  if (variable.type === "number") {
    return clampNumber(variable, typeof value === "number" ? value : Number(value));
  }
  if (variable.type === "boolean") {
    return typeof value === "boolean" ? value : variable.default;
  }
  if (variable.type === "enum") {
    return typeof value === "string" && variable.options.some((option) => option.value === value)
      ? value
      : variable.default;
  }
  if (typeof value !== "string") return variable.default;
  if (variable.type === "color") {
    return HEX_COLOR_PATTERN.test(value) ? value : variable.default;
  }
  if (variable.type === "string" && variable.maxLength !== undefined) {
    return value.slice(0, variable.maxLength);
  }
  return value;
}

export function updateHyperframesEffectVariableOverride(
  item: Pick<HyperframesCatalogItem, "variables">,
  overrides: HyperframesEffectVariableValues,
  variableId: string,
  value: HyperframesEffectVariableValue,
): HyperframesEffectVariableValues {
  const variable = item.variables.find((candidate) => candidate.id === variableId);
  if (!variable) return overrides;
  const normalized = normalizeValue(variable, value);
  const next = { ...overrides };
  if (normalized === variable.default) {
    delete next[variable.id];
  } else {
    next[variable.id] = normalized;
  }
  return next;
}

export function hyperframesSelectionPayload(selection: HyperframesAnimationSelection) {
  return {
    registry: selection.item.name,
    version: selection.item.version ?? "bundled",
    engine: selection.item.engine,
    variables: resolveHyperframesEffectVariableValues(selection.item, selection.values),
  };
}

export function hyperframesSelectionUpdateMode(
  item: Pick<HyperframesCatalogItem, "variables">,
  variableId: string,
): HyperframesEffectVariableUpdate {
  return item.variables.find((variable) => variable.id === variableId)?.update ?? "live";
}
