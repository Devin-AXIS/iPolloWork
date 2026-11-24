import { describe, expect, test } from 'bun:test';
import type { ReviewModuleContribution } from '../../contracts/modules.ts';
import type { OoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { registerRevisionSiteNodeIds, type ReviewItem } from '../../store/store/review-items.ts';
import {
  hiddenReviewSitesOf,
  reviewItemFiltering,
  withReviewItemFilter,
} from '../review-item-filter.ts';

const model = () =>
  ({
    displayModes: [],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  }) as unknown as ReviewModuleContribution;
const pkg = {} as OoxmlPackage;
const styles = { root: {} } as OoxmlPart;
const numbering = {} as OoxmlElement;
const items = [
  { kind: 'comment', id: 'a' },
  { kind: 'comment', id: 'b' },
] as unknown as ReviewItem[];

describe('reviewItemFiltering', () => {
  test('hands the list back when the model has no filter', () => {
    const { filtered } = reviewItemFiltering(
      model(),
      pkg,
      { stylesPart: styles, numberingRoot: null },
      null
    );
    expect(filtered(items)).toBe(items);
  });

  test('runs the attached filter with the current inputs', () => {
    const seen: unknown[] = [];
    const filtering = reviewItemFiltering(
      withReviewItemFilter(model(), (list, inputs) => {
        seen.push(inputs);
        return list.slice(1);
      }),
      pkg,
      { stylesPart: styles, numberingRoot: numbering },
      null
    );
    expect(filtering.filtered(items)).toEqual([items[1]!]);
    expect(seen).toEqual([{ pkg, stylesRoot: styles.root, numberingRoot: numbering }]);
  });

  test('reuse holds only while the styles and numbering stay the same', () => {
    const current = { stylesPart: styles, numberingRoot: numbering };
    const format = [
      { kind: 'revision', id: 'f', revisionKind: 'format', formattingKind: 'pPrChange' },
    ] as unknown as ReviewItem[];
    const same = (previous: (typeof current & { items: readonly ReviewItem[] }) | null) =>
      reviewItemFiltering(model(), pkg, current, previous).sameFilter;
    expect(same(null)).toBe(false);
    expect(same({ stylesPart: styles, numberingRoot: numbering, items })).toBe(true);
    expect(same({ stylesPart: { root: {} } as OoxmlPart, numberingRoot: numbering, items })).toBe(
      false
    );
    // A numbering change alone keeps reuse unless a property change could decide differently.
    const otherNumbering = {} as OoxmlElement;
    expect(same({ stylesPart: styles, numberingRoot: otherNumbering, items })).toBe(true);
    expect(same({ stylesPart: styles, numberingRoot: otherNumbering, items: format })).toBe(false);
  });

  test('publish keeps one hidden-site set while its contents stay the same', () => {
    const hiding = withReviewItemFilter(model(), (list) => list.filter((item) => item.id !== 'a'));
    const site = (id: string) =>
      registerRevisionSiteNodeIds(
        {
          kind: 'revision',
          id,
          revisionKind: 'format',
          formattingKind: 'pPrChange',
          ranges: [],
        } as never,
        [`node-${id}`]
      ) as ReviewItem;
    const first = [site('a'), site('b')];
    const inputs = { stylesPart: styles, numberingRoot: numbering };
    const one = reviewItemFiltering(hiding, pkg, inputs, null);
    const published = one.publish(one.filtered(first));
    const two = reviewItemFiltering(hiding, pkg, inputs, { ...inputs, items: published });
    const again = two.publish(two.filtered([site('a'), site('b')]));
    expect(again).not.toBe(published);
    expect([...hiddenReviewSitesOf(published).sites]).toEqual(['node-a']);
    expect(hiddenReviewSitesOf(again)).toBe(hiddenReviewSitesOf(published));
  });

  describe('publish after a patch', () => {
    const hidesFormat = withReviewItemFilter(model(), (list) =>
      list.filter((item) => item.kind !== 'revision' || item.revisionKind !== 'format')
    );
    const inputs = { stylesPart: styles, numberingRoot: numbering };
    const revision = (id: string, paragraphId: string, revisionKind: string) =>
      registerRevisionSiteNodeIds(
        {
          kind: 'revision',
          id,
          revisionKind,
          formattingKind: 'rPrChange',
          ranges: [{ start: { paragraphId, offset: 0 }, end: { paragraphId, offset: 1 } }],
        } as never,
        [`node-${id}`]
      ) as ReviewItem;
    const start = () => {
      const one = reviewItemFiltering(hidesFormat, pkg, inputs, null);
      return one.publish(one.filtered([revision('i1', 'p1', 'insertion')]));
    };

    test('records what every patched paragraph leaves out', () => {
      const published = start();
      const two = reviewItemFiltering(hidesFormat, pkg, inputs, { ...inputs, items: published });
      two.filtered([revision('f1', 'p1', 'format')]);
      two.filtered([revision('f2', 'p2', 'format')]);
      const patched = two.publish([...published]);
      expect([...hiddenReviewSitesOf(patched).sites].sort()).toEqual(['node-f1', 'node-f2']);
      expect([...hiddenReviewSitesOf(patched).paragraphs.keys()].sort()).toEqual(['p1', 'p2']);
    });

    test('records a new left-out record when no card changed', () => {
      const published = start();
      const two = reviewItemFiltering(hidesFormat, pkg, inputs, { ...inputs, items: published });
      two.filtered([revision('f1', 'p2', 'format')]);
      expect(two.publish(published)).toBe(published);
      expect([...hiddenReviewSitesOf(published).sites]).toEqual(['node-f1']);
    });

    test('leaves an earlier queue its own record when a memo hands it back', () => {
      const earlier = start();
      const record = hiddenReviewSitesOf(earlier);
      const two = reviewItemFiltering(hidesFormat, pkg, inputs, { ...inputs, items: earlier });
      two.filtered([revision('f1', 'p2', 'format')]);
      const later = two.publish([...earlier]);
      // A patch filtered one paragraph, failed, and the memo answered with the earlier queue.
      const three = reviewItemFiltering(hidesFormat, pkg, inputs, { ...inputs, items: later });
      three.filtered([revision('f2', 'p3', 'format')]);
      expect(three.publish(earlier)).toBe(earlier);
      expect(hiddenReviewSitesOf(earlier)).toBe(record);
    });
  });
});
