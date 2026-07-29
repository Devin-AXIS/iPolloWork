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

export function summarizeDesignSelection(
  primary: DesignSelection,
  selections: DesignSelection[],
  selectionRect: DesignRect,
): DesignSelectionSummary {
  const ordered = selections.some((selection) => selection.id === primary.id) ? selections : [...selections, primary];
  const mixedStyleFields = DESIGN_MULTI_SELECTION_STYLE_FIELDS.filter((field) => {
    const value = ordered[0]?.styles[field] ?? "";
    return ordered.some((selection) => selection.styles[field] !== value);
  });
  return {
    primary,
    selections: ordered,
    selectionIds: ordered.map((selection) => selection.id),
    selectionRect,
    selectionCount: ordered.length,
    isMultiSelection: ordered.length > 1,
    mixedStyleFields,
  };
}
