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
const HYPERFRAMES_ANIMATION_DISPLAY_PREFIX = "HyperFrames animation display:";

export type HyperframesAnimationDisplayReference = {
  name: string;
  label: string;
};

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

export function hyperframesAnimationDisplayMetadata(
  selections: readonly { item: Pick<HyperframesCatalogItem, "name" | "title"> }[],
) {
  return `${HYPERFRAMES_ANIMATION_DISPLAY_PREFIX}${JSON.stringify({
    items: selections.map(({ item }) => ({ name: item.name, label: item.title })),
  })}`;
}

export function parseHyperframesAnimationDisplayMetadata(text: string) {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(HYPERFRAMES_ANIMATION_DISPLAY_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(HYPERFRAMES_ANIMATION_DISPLAY_PREFIX.length)) as unknown;
    const items = parsed && typeof parsed === "object" && "items" in parsed
      ? (parsed as { items?: unknown }).items
      : null;
    if (!Array.isArray(items)) return null;
    const references = items.slice(0, 20).flatMap<HyperframesAnimationDisplayReference>((item) => {
      if (!item || typeof item !== "object") return [];
      const name = "name" in item ? (item as { name?: unknown }).name : null;
      const label = "label" in item ? (item as { label?: unknown }).label : null;
      if (typeof name !== "string" || !name.trim() || typeof label !== "string" || !label.trim()) return [];
      return [{ name: name.trim(), label: label.trim() }];
    });
    return references.length > 0 ? references : null;
  } catch {
    return null;
  }
}

export function hyperframesSelectionUpdateMode(
  item: Pick<HyperframesCatalogItem, "variables">,
  variableId: string,
): HyperframesEffectVariableUpdate {
  return item.variables.find((variable) => variable.id === variableId)?.update ?? "live";
}
