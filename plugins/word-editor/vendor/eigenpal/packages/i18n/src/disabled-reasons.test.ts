import { describe, expect, test } from 'bun:test';
import { createT, en, localizeDisabledReason } from './index';

describe('localizeDisabledReason', () => {
  test.each([
    'the drop target is stale; drop the image again',
    'the drop target story is no longer active',
    'the drop target is no longer attached',
  ])('localizes the drop refusal: %s', (reason) => {
    expect(localizeDisabledReason(reason, createT(en))).toBe(en.imageInsert.errors.staleTarget);
  });
  test('translates known chrome refusals', () => {
    const t = createT({
      ...en,
      disabledReason: {
        ...en.disabledReason,
        editorNotReady: 'Localized editor state',
      },
    });

    expect(localizeDisabledReason('editor is not ready', t)).toBe('Localized editor state');
  });

  test('preserves unknown engine diagnostics', () => {
    expect(localizeDisabledReason('custom refusal detail', createT(en))).toBe(
      'custom refusal detail'
    );
  });

  // The table is a plain object, so it answers these from its PROTOTYPE — with a function,
  // which the lookup then handed to `t()`. This is a `@public` entry point and the reason
  // reaching it comes from the engine, so the guard is cheap insurance rather than a live
  // bug; without it these throw rather than passing through.
  test.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'passes %s through as an unknown diagnostic',
    (reason) => {
      expect(localizeDisabledReason(reason, createT(en))).toBe(reason);
    }
  );
});

describe('every refusal the section-break lane publishes is translatable', () => {
  // An engine `disabledReason` is text a user reads. English-in-the-engine is the pattern
  // here, but only paired with a `DISABLED_REASON_KEYS` entry — without one the string
  // reaches every locale raw, and nothing else catches that.
  const t = createT(en);

  test.each([
    'a section break can only be inserted in the editable document body',
    'a section break that changes where the next section starts cannot be suggested; turn off suggesting to insert it',
    'a section break cannot be inserted inside a table cell',
    'a section break cannot change a section that a locked or linked content control holds',
    'a section break cannot be inserted in locked or linked content',
  ])('%s', (reason) => {
    const localized = localizeDisabledReason(reason, t);
    expect(localized).not.toBe(reason);
    expect(localized?.length ?? 0).toBeGreaterThan(0);
  });
});

test.each([
  'this content is locked; only alignment, indents, spacing, and line and page breaks can change',
  'this content is bound to data and cannot change',
])('the paragraph format refusal "%s" is translatable', (reason) => {
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});

test('the empty reviewer roster refusal is translatable', () => {
  const reason = 'the document has no review authors';
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});

test.each([
  'this drawing is a chart; only delete applies, and it removes the whole chart',
  'a chart can be copied, cut or pasted only on its own, not with other content',
  'the copied chart is no longer available; copy the chart again',
])('the chart refusal %s is translatable', (reason) => {
  expect(localizeDisabledReason(reason, createT(en))).toBe(
    reason.startsWith('a chart can')
      ? en.disabledReason.chartClipboard
      : reason.startsWith('the copied')
        ? en.disabledReason.chartClipboardStale
        : en.disabledReason.chartDrawing
  );
});

test('the picture-selected insert refusal is translatable', () => {
  const reason = 'a picture is selected; place the caret in text to insert a picture';
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});

test.each([
  'compact linear editing cannot preserve this equation source formatting',
  'compact linear text cannot spell this equation',
  'equation replacement is not supported in suggesting mode',
  'in suggesting mode, remove the whole equation block rather than one equation',
])('the equation popover refusal %s is translatable', (reason) => {
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});

test('the content-lock formatting refusal is translatable', () => {
  const reason = 'this content is locked';
  expect(localizeDisabledReason(reason, createT(en))).not.toBe(reason);
});

test.each([
  [
    'suggesting cannot delete a whole table; stop suggesting to delete it, or delete its rows one at a time',
    'tableDeleteSuggesting',
  ],
  ['suggesting cannot move a table; stop suggesting to move it', 'tableMoveSuggesting'],
  ['selecting a table row is not supported yet', 'selectTableRowUnsupported'],
  ['selecting a table column is not supported yet', 'selectTableColumnUnsupported'],
] as const)('the table refusal %s is translatable', (reason, key) => {
  expect(localizeDisabledReason(reason, createT(en))).toBe(en.disabledReason[key]);
});

// The undo and indent buttons and the Go To and Bookmark rows show these when disabled. Without an
// entry, a localized editor showed them in English.
test.each([
  ['nothing to undo', 'nothingToUndo'],
  ['nothing to redo', 'nothingToRedo'],
  ['the selection is already at the outermost level', 'outermostLevel'],
  ['the selection cannot indent any further', 'cannotIndentFurther'],
  ['no Go To view is registered', 'noGoToView'],
  ['no bookmark dialog is registered', 'noBookmarkDialog'],
] as const)('the chrome refusal "%s" is translatable', (reason, key) => {
  expect(localizeDisabledReason(reason, createT(en))).toBe(en.disabledReason[key]);
});

test('the compare documents collaboration refusal is translatable', () => {
  const reason = 'documents cannot be compared while a collaboration session is attached';
  expect(localizeDisabledReason(reason, createT(en))).toBe(
    'Compare documents is not available in a shared editing session.'
  );
});

describe('the Format shape refusals are translatable', () => {
  const t = createT(en);
  test.each([
    ['this drawing has no fill or outline to set', en.shape.errors.noShape],
    ['the shape has no solid fill to change; set a color', en.shape.errors.noSolidFill],
    [
      'the shapes in this group have different fills; pick a color to set them all',
      en.shape.errors.mixedFill,
    ],
    ['a legacy shape has no transparency', en.shape.errors.legacyTransparency],
    ['the fill or outline value is out of range', en.shape.errors.outOfRange],
    ['stale drawing selection', en.shape.errors.staleSelection],
    ['shape.pane.errors.width', en.shape.pane.errors.width],
  ])('%s', (reason, expected) => {
    expect(localizeDisabledReason(reason, t)).toBe(expected);
  });
});
