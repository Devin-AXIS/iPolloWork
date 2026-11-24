// The autofit context a table flow builds once per deps object, and the scope carry over it.
// Split from `table-autofit-widths.ts`, which measures with the context this builds.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { carryAutofitScope } from './autofit-context-reuse.ts';
import { currentFieldResultsMode } from '../store/package/field-result-mode.ts';
import { valueDigest } from './autofit-value-token.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { listItemToken } from './list-marker-reuse.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { AutofitFieldContext, TableAutofitContext } from './table-autofit-widths.ts';

/** What a table flow carries that autofit reads. */
export interface AutofitFlowDeps extends AutofitFieldContext {
  readonly measurer: TextMeasurer;
  /** The tables read with these deps sit in a fixed-layout table's cell. */
  readonly parentTableFixed?: true | undefined;
  readonly listItems?: ReadonlyMap<string, ResolvedListItem>;
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  readonly drawingTokenForParagraph?: (paragraph: OoxmlElement) => string;
  readonly projectionTokenForParagraph?: (paragraph: OoxmlElement) => string;
  readonly drawingLayoutToken?: string;
  /** The pass producer the break cache keys on: note marks, display mode, author filter. */
  readonly producer?: string;
  readonly defaultTabStopPt?: number;
  readonly compatibilityMode?: number;
}

/** One context per flow deps object, so every reader in a pass shares it. */
const flowContexts = new WeakMap<object, TableAutofitContext>();

/** The autofit inputs a table flow already carries, so every reader widens alike. */
export function autofitContextOf(deps: AutofitFlowDeps): TableAutofitContext {
  const known = flowContexts.get(deps);
  if (known) return known;
  const fields: AutofitFieldContext = {
    ...(deps.pageContext ? { pageContext: deps.pageContext } : {}),
    ...(deps.noteMarks ? { noteMarks: deps.noteMarks } : {}),
    ...(deps.documentProperties ? { documentProperties: deps.documentProperties } : {}),
    ...(deps.bodyPageFields ? { bodyPageFields: deps.bodyPageFields } : {}),
    ...(deps.refFields ? { refFields: deps.refFields } : {}),
    ...(deps.showFieldCodes ? { showFieldCodes: true } : {}),
    ...(deps.fieldCodeRanges ? { fieldCodeRanges: deps.fieldCodeRanges } : {}),
    ...(deps.tocLinkStyleRanges ? { tocLinkStyleRanges: deps.tocLinkStyleRanges } : {}),
  };
  // Values, not identities: a pass builds these objects afresh and the cache must survive it.
  // Every part is compact: the producer is a digest, the value objects are digested.
  const passToken = [
    deps.producer ?? '',
    deps.bodyPageFields ? `body:${deps.bodyPageFields.format ?? ''}` : '',
    valueDigest(deps.pageContext),
    valueDigest(deps.documentProperties),
    deps.showFieldCodes === true ? 'codes' : '',
    // Not the story-wide REF values token: each paragraph's own REF outputs are in its
    // `paragraphToken`, and the story token moved with every slice of an opening, so every
    // table measured early missed its cache on the first layout after it.
    deps.drawingLayoutToken ?? '',
    deps.inlineDrawingLayout ? 'drawings' : '',
    `tab:${deps.defaultTabStopPt ?? ''}`,
    `mode:${deps.compatibilityMode ?? ''}`,
    // Saved field results break as text in the editable mode and stay whole in the default.
    `fields:${currentFieldResultsMode()}`,
  ].join('\0');
  const paragraphTokens = new WeakMap<OoxmlElement, string>();
  const context: TableAutofitContext = {
    measurer: deps.measurer,
    ...(deps.listItems ? { listItems: deps.listItems } : {}),
    ...(deps.inlineDrawingLayout ? { inlineDrawingLayout: deps.inlineDrawingLayout } : {}),
    fields,
    ...(deps.defaultTabStopPt !== undefined ? { defaultTabStopPt: deps.defaultTabStopPt } : {}),
    ...(deps.compatibilityMode !== undefined ? { compatibilityMode: deps.compatibilityMode } : {}),
    passToken,
    ...(deps.parentTableFixed ? { parentTableFixed: true as const } : {}),
    paragraphToken: (paragraph) => {
      const known = paragraphTokens.get(paragraph);
      if (known !== undefined) return known;
      const token = [
        deps.projectionTokenForParagraph?.(paragraph) ?? '',
        deps.drawingTokenForParagraph?.(paragraph) ?? '',
        deps.refFields?.tokenForParagraph(paragraph.id) ?? '',
        listItemToken(deps.listItems?.get(paragraph.id)),
      ].join('\0');
      paragraphTokens.set(paragraph, token);
      return token;
    },
  };
  flowContexts.set(deps, context);
  return context;
}

/** Share width measurements only after the section validates all dynamic projections. */
export function carryTableAutofitScope(
  previous: object | null | undefined,
  next: object,
  inputsEqual: boolean,
  deps: AutofitFlowDeps,
  onlyListsDiffer = false
): boolean {
  const context = autofitContextOf(deps);
  return carryAutofitScope(
    previous,
    next,
    inputsEqual,
    context,
    [
      valueDigest(deps.fieldCodeRanges),
      valueDigest(deps.tocLinkStyleRanges),
      valueDigest(deps.noteMarks),
    ].join('\0'),
    onlyListsDiffer
  );
}
