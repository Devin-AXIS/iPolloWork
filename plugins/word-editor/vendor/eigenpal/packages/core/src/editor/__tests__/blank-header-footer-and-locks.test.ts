// A press on a blank header or footer band opens the variant the page displays, creating it
// first when it is missing; a control that layout has not placed yet refuses from its sdtPr.
import { describe, expect, test } from 'bun:test';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { treeLockRefusal } from '../content-control-locks.ts';
import { openBlankHeaderFooter } from '../surface-hf-editing.ts';

type Variant = 'default' | 'first' | 'even';

function section(options: {
  headers?: Partial<Record<Variant, string>>;
  evenAndOddHeaders?: boolean;
  titlePage?: boolean;
}) {
  const slots = (record: Partial<Record<Variant, string>> = {}) =>
    new Map(Object.entries(record).map(([variant, rId]) => [variant, { rId, partName: rId }]));
  return {
    headers: slots(options.headers),
    footers: slots(),
    evenAndOddHeaders: options.evenAndOddHeaders ?? false,
    titlePage: options.titlePage ?? false,
  };
}

function press(
  sections: ReturnType<typeof section>[],
  pageIndex: number,
  options: { sectionStart?: number; createdRId?: string } = {}
) {
  let current = sections;
  const created: unknown[] = [];
  const entered: unknown[] = [];
  let flushed = 0;
  openBlankHeaderFooter(
    {
      session: {
        headerFooterResolutionBySection: () => current,
      } as unknown as TreeDocxSessionView,
      layout: {
        pages: Array.from({ length: pageIndex + 1 }, () => ({})),
      } as unknown as SemanticLayout,
      sectionAtPage: () => ({ sectionIndex: 0, sectionStart: options.sectionStart ?? 0 }),
      create(op) {
        created.push(op);
        if (!options.createdRId) return { ok: false };
        current = [section({ ...current[0], headers: { [op.variant]: options.createdRId } })];
        return { ok: true };
      },
      flushLayout: () => {
        flushed += 1;
      },
      enter: (args) => {
        entered.push(args);
        return true;
      },
    },
    'header',
    pageIndex
  );
  return { created, entered, flushed };
}

describe('openBlankHeaderFooter', () => {
  test('opens the existing default header without creating one', () => {
    const result = press([section({ headers: { default: 'rId1' } })], 2);
    expect(result.created).toEqual([]);
    expect(result.entered).toEqual([
      { rId: 'rId1', pageIndex: 2, sectionIndex: 0, kind: 'header', variant: 'default' },
    ]);
  });

  test('creates the even header on an even page when the document separates them', () => {
    const result = press([section({ evenAndOddHeaders: true })], 1, { createdRId: 'rId9' });
    expect(result.created).toEqual([
      {
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'even',
        evenAndOddHeaders: true,
      },
    ]);
    expect(result.flushed).toBe(1);
    expect(result.entered).toEqual([
      { rId: 'rId9', pageIndex: 1, sectionIndex: 0, kind: 'header', variant: 'even' },
    ]);
  });

  test('creates the first-page header on a title page', () => {
    const result = press([section({ titlePage: true })], 0, { createdRId: 'rId5' });
    expect(result.created).toEqual([
      {
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'first',
        titlePage: true,
      },
    ]);
  });

  test('opens nothing when the create is refused', () => {
    const result = press([section({})], 0);
    expect(result.created).toHaveLength(1);
    expect(result.flushed).toBe(0);
    expect(result.entered).toEqual([]);
  });
});

describe('treeLockRefusal', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const element = (localName: string, children: unknown[] = [], val?: string) =>
    ({
      kind: 'generic',
      id: localName,
      namespaceUri: W,
      localName,
      attributes: val ? [{ namespaceUri: W, localName: 'val', value: val }] : [],
      children,
    }) as unknown as OoxmlElement;
  const control = (...props: OoxmlElement[]) => element('sdt', [element('sdtPr', props)]);

  test('refuses an edit of content-locked and bound controls, and allows their removal', () => {
    expect(treeLockRefusal(control(element('lock', [], 'contentLocked')), 'edit')).toBe('locked');
    expect(treeLockRefusal(control(element('lock', [], 'contentLocked')), 'remove')).toBeNull();
    expect(treeLockRefusal(control(element('dataBinding')), 'edit')).toBe('bound');
    expect(treeLockRefusal(control(element('dataBinding')), 'remove')).toBeNull();
  });

  test('refuses the removal of a control locked against deletion', () => {
    expect(treeLockRefusal(control(element('lock', [], 'sdtLocked')), 'remove')).toBe('locked');
    expect(treeLockRefusal(control(element('lock', [], 'sdtLocked')), 'edit')).toBeNull();
    expect(treeLockRefusal(control(element('lock', [], 'sdtContentLocked')), 'edit')).toBe(
      'locked'
    );
    expect(treeLockRefusal(control(), 'edit')).toBeNull();
  });
});
