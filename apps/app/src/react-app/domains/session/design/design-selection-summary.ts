import {
  DESIGN_MULTI_SELECTION_STYLE_FIELDS,
  type DesignRect,
  type DesignSelection,
  type DesignStyleField,
} from "./design-html-runtime";

export type DesignSelectionSummary = {
  primary: DesignSelection;
  selections: DesignSelection[];
  selectionIds: string[];
  selectionRect: DesignRect;
  selectionCount: number;
  isMultiSelection: boolean;
  mixedStyleFields: DesignStyleField[];
};

export function isDesignSelectionMember(value: unknown): value is DesignSelection {
  if (!value || typeof value !== "object") return false;
  const styles = Reflect.get(value, "styles");
  return typeof Reflect.get(value, "id") === "string"
    && Boolean(styles)
    && typeof styles === "object";
}

function selectionStyleValue(selection: unknown, field: DesignStyleField) {
  if (!selection || typeof selection !== "object") return "";
  const styles = Reflect.get(selection, "styles");
  if (!styles || typeof styles !== "object") return "";
  const value = Reflect.get(styles, field);
  return typeof value === "string" ? value : "";
}

export function summarizeDesignSelection(
  primary: DesignSelection,
  selections?: readonly unknown[],
  selectionRect?: DesignRect,
): DesignSelectionSummary {
  const members = selections?.filter(isDesignSelectionMember) ?? [];
  const ordered = members.some((selection) => selection.id === primary.id) ? members : [...members, primary];
  const mixedStyleFields = DESIGN_MULTI_SELECTION_STYLE_FIELDS.filter((field) => {
    const value = selectionStyleValue(ordered[0], field);
    return ordered.some((selection) => selectionStyleValue(selection, field) !== value);
  });
  return {
    primary,
    selections: ordered,
    selectionIds: ordered.map((selection) => selection.id),
    selectionRect: selectionRect ?? primary.rect,
    selectionCount: ordered.length,
    isMultiSelection: ordered.length > 1,
    mixedStyleFields,
  };
}
