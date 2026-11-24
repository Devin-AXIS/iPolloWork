// The run direction of typed text: letters typed in a right-to-left script start a `w:rtl`
// run. Other text keeps the direction of the run it joins.
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import { runDirectionFormattingContext } from '../layout/complex-script-formatting.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from '../layout/revision-projection.ts';
import type { OoxmlProperty, TreeDocOp } from '../store/store/tree-op-types.ts';
import { complexScriptAt } from '../store/store/direct-properties.ts';
import { partOfNodeId } from './surface-scope.ts';
import { authoredRunPropertiesAt } from './surface-formatting.ts';
import { RIGHT_TO_LEFT_LETTER } from '../layout/rtl-letter.ts';

const LETTER = /\p{L}/u;

/**
 * The direction the first letter of `text` asks for, or null when it has no letter. Digits,
 * spaces, and punctuation decide nothing: they take the direction of the run they join.
 */
export function typedTextDirection(text: string): 'rtl' | 'ltr' | null {
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    return RIGHT_TO_LEFT_LETTER.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * The format writes for typed text: `formatOps` (the armed caret format, possibly none) with
 * `w:rtl` added when right-to-left letters join a run that is not right-to-left. Latin letters
 * typed into a right-to-left run keep that run's direction.
 *
 * A keyboard in a right-to-left language marks what it types as right-to-left text
 * (`w:rtl`). The browser does not report the keyboard, so the first letter of the typed text
 * stands for it. The write rides the insert's own transaction: one undo step, and refused
 * together with the other caret formats.
 *
 * `setRunProperties` replaces a run's writable properties, so the direction never travels
 * alone: it joins the armed caret format's write, or else carries the authored properties of
 * the run the text joins, which keeps that run's bold, size, and fonts on the typed text.
 */
export function createTypedDirectionOps(
  session: Pick<
    TreeDocxSessionView,
    'currentPackage' | 'part' | 'storyParts' | 'stylesRoot' | 'settingsRoot'
  >,
  displayMode: () => RevisionDisplayMode,
  authorFilter: () => RevisionAuthorFilter | undefined
) {
  /** `target` is the caret before the insert; `landing` is the caret after the typed text. */
  return (
    target: { readonly paragraphId: string; readonly offset: number },
    landing: number,
    text: string,
    formatOps: readonly TreeDocOp[]
  ): TreeDocOp[] => {
    const { paragraphId, offset: caretOffset } = target;
    const landingStart = landing - text.length;
    if (typedTextDirection(text) !== 'rtl') return [...formatOps];
    const mode = displayMode();
    const filter = authorFilter();
    const part = partOfNodeId(session, paragraphId) ?? session.part();
    const rtl = complexScriptAt(
      part,
      paragraphId,
      caretOffset,
      runDirectionFormattingContext(session.stylesRoot(), session.settingsRoot(), mode, filter),
      mode,
      filter
    );
    if (rtl) return [...formatOps];
    const withRtl = (properties: readonly OoxmlProperty[]): OoxmlProperty[] => [
      ...properties.filter((property) => property.localName !== 'rtl'),
      { localName: 'rtl' },
    ];
    const armed = formatOps.findIndex(
      (op) =>
        op.op === 'setRunProperties' &&
        op.paragraphId === paragraphId &&
        op.start === landingStart &&
        op.end === landingStart + text.length
    );
    if (armed >= 0) {
      return formatOps.map((op, index) =>
        index === armed && op.op === 'setRunProperties'
          ? { ...op, properties: withRtl(op.properties) }
          : op
      );
    }
    return [
      ...formatOps,
      {
        op: 'setRunProperties',
        paragraphId,
        start: landingStart,
        end: landingStart + text.length,
        properties: withRtl(authoredRunPropertiesAt(part, paragraphId, caretOffset, mode, filter)),
      },
    ];
  };
}
