import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, test } from 'bun:test';
import { Fragment, createElement, isValidElement } from 'react';
import { act, render } from '@testing-library/react';
import {
  MERGE_APPEND_ORDER,
  MERGE_DEFAULT_ORDER,
  MERGE_FIXTURE_ENTRIES,
  MERGE_FRAGMENT_KEY,
  MERGE_HIDDEN_B_ORDER,
  MERGE_LAST_WINS_LABEL,
  MERGE_PRESET_FALSE_ORDER,
} from '../../../scripts/test/merge-arrangement-fixtures.ts';
import { mergeArrangement, unwrapFragment } from '../src/editor/merge-arrangement';

function docxSlotOf(element: unknown): string | null {
  if (!isValidElement(element)) return null;
  const type = element.type as { docxSlot?: unknown };
  if (typeof type === 'function' && 'docxSlot' in type) {
    const slot = type.docxSlot;
    return typeof slot === 'string' ? slot : null;
  }
  return null;
}

function keyOfChild(child: unknown): string | null {
  const unwrapped = unwrapFragment(child as never, keyOfChild);
  if (unwrapped !== null) return unwrapped;
  return docxSlotOf(child);
}

function Part({ id, label, hidden }: { id: string; label: string; hidden?: boolean }) {
  if (hidden) return null;
  return createElement('span', { 'data-slot': id }, label);
}

function renderPart(id: string, label: string) {
  const C = (props: { hidden?: boolean }) => <Part id={id} label={label} hidden={props.hidden} />;
  (C as unknown as { docxSlot: string }).docxSlot = id;
  return C;
}

function runMerge(children: unknown[], preset = true): string[] {
  const parts = Object.fromEntries(
    MERGE_FIXTURE_ENTRIES.map((e) => [e.id, renderPart(e.id, e.label)])
  );
  const out = mergeArrangement({
    entries: MERGE_FIXTURE_ENTRIES,
    children,
    preset,
    keyOfEntry: (entry) => entry.id,
    keyOfChild: keyOfChild,
    renderEntry: (entry) => createElement(parts[entry.id]!, {}),
  });
  const container = document.createElement('div');
  act(() => {
    render(createElement('div', { className: 'merge-root' }, out), { container });
  });
  return [...container.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot')!);
}

describe('mergeArrangement (React)', () => {
  test('no children yields the packaged arrangement in order', () => {
    expect(runMerge([])).toEqual([...MERGE_DEFAULT_ORDER]);
  });

  test('hidden override removes its slot', () => {
    const B = renderPart('b', 'B');
    expect(runMerge([createElement(B, { hidden: true })])).toEqual([...MERGE_HIDDEN_B_ORDER]);
  });

  test('preset=false renders children verbatim', () => {
    expect(runMerge([createElement('span', { 'data-slot': 'host-only' }, 'host')], false)).toEqual([
      ...MERGE_PRESET_FALSE_ORDER,
    ]);
  });

  test('unknown children append after defaults', () => {
    expect(runMerge([createElement('span', { 'data-slot': 'extra' }, 'x')])).toEqual([
      ...MERGE_APPEND_ORDER,
    ]);
  });

  test('last override for the same slot wins', () => {
    const B1 = renderPart('b', 'B-override-1');
    const B2 = () => createElement('span', { 'data-slot': 'b' }, MERGE_LAST_WINS_LABEL);
    (B2 as unknown as { docxSlot: string }).docxSlot = 'b';
    const container = document.createElement('div');
    const out = mergeArrangement({
      entries: MERGE_FIXTURE_ENTRIES,
      children: [createElement(B1), createElement(B2)],
      preset: true,
      keyOfEntry: (entry) => entry.id,
      keyOfChild: keyOfChild,
      renderEntry: (entry) => createElement(renderPart(entry.id, entry.label), {}),
    });
    act(() => {
      render(createElement('div', null, out), { container });
    });
    expect(container.textContent).toContain(MERGE_LAST_WINS_LABEL);
  });

  test('single-child Fragment unwraps to its key', () => {
    const B = renderPart(MERGE_FRAGMENT_KEY, 'B');
    const wrapped = createElement(Fragment, null, createElement(B));
    expect(unwrapFragment(wrapped, keyOfChild)).toBe(MERGE_FRAGMENT_KEY);
  });
});
