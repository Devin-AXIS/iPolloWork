import { afterEach, describe, expect, test } from 'bun:test';
import { docx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';
import { ISSUE_ANNOUNCE_DELAY_MS } from '../highlight-accessibility.ts';
import { EDITOR_ANNOUNCER_CLASS } from '../editor-announcer.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(bytes = docx(p('Teh cat sat.') + p('A dog barkd loud.'))) {
  const mounted = mountAnchorEditor(bytes);
  cleanups.push(mounted.destroy);
  const invalid = () =>
    [...mounted.host.querySelectorAll<HTMLElement>('[aria-invalid]')].map((span) => ({
      text: span.textContent,
      value: span.getAttribute('aria-invalid'),
    }));
  return { ...mounted, invalid };
}

describe('highlight sets with a kind', () => {
  test('mark the covered text spans with aria-invalid and a description', () => {
    const { editor, host, invalid } = mount();
    const [teh] = editor.findMatches('Teh');
    const result = editor.setHighlights(
      'spelling',
      [{ ...teh!, description: 'Possible spelling mistake' }],
      { kind: 'spelling' }
    );
    expect(result).toEqual({ applied: 1, unavailable: 0 });
    // The painter writes one span per word, so only the misspelled word reports.
    expect(invalid()).toEqual([{ text: 'Teh ', value: 'spelling' }]);
    const span = host.querySelector<HTMLElement>('[aria-invalid]')!;
    const description = host.ownerDocument.getElementById(span.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Possible spelling mistake');
    expect(host.contains(description)).toBe(true);

    editor.clearHighlights('spelling');
    expect(invalid()).toEqual([]);
    expect(span.hasAttribute('aria-describedby')).toBe(false);
    expect(host.ownerDocument.getElementById(description!.id)).toBeNull();
  });

  test('a span under spelling and grammar marks reports spelling', () => {
    const { editor, invalid } = mount();
    editor.setHighlights('grammar', editor.findMatches('dog barkd'), { kind: 'grammar' });
    expect(invalid()).toEqual([
      { text: 'dog ', value: 'grammar' },
      { text: 'barkd ', value: 'grammar' },
    ]);
    editor.setHighlights('spelling', editor.findMatches('barkd'), { kind: 'spelling' });
    expect(invalid()).toEqual([
      { text: 'dog ', value: 'grammar' },
      { text: 'barkd ', value: 'spelling' },
    ]);
  });

  test('sets without a kind add no meaning, and kind is validated', () => {
    const { editor, invalid } = mount();
    editor.setHighlights('search', editor.findMatches('cat'));
    expect(invalid()).toEqual([]);
    expect(() =>
      editor.setHighlights('bad', editor.findMatches('cat'), { kind: 'style' as never })
    ).toThrow(TypeError);
  });

  test('a mark that an edit breaks loses its meaning', () => {
    const { editor, invalid } = mount();
    const [teh] = editor.findMatches('Teh');
    editor.setHighlights('spelling', [teh!], { kind: 'spelling' });
    const caret = { paragraphId: teh!.blockId, offset: 1 };
    editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    expect(editor.exec({ type: 'insertText', text: 'h' }).ok).toBe(true);
    editor.surface!.layout();
    editor.surface!.repaintHighlights();
    expect(invalid()).toEqual([]);
  });

  test('joins a shared CSS highlight where the browser has the API', () => {
    // happy-dom has no CSS Custom Highlight API: stand one in on the window.
    const view = window as unknown as { CSS: CSSNamespace; Highlight?: unknown };
    type CSSNamespace = { supports(property: string, value?: string): boolean };
    const registry = new Map<string, Set<Range> & { type: string }>();
    class FakeHighlight extends Set<Range> {
      type = 'highlight';
    }
    const css = view.CSS;
    const own = Object.getOwnPropertyDescriptor(window, 'CSS');
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { supports: css.supports.bind(css), highlights: registry },
    });
    view.Highlight = FakeHighlight;
    cleanups.push(() => {
      if (own) Object.defineProperty(window, 'CSS', own);
      else delete (window as { CSS?: unknown }).CSS;
      delete view.Highlight;
    });
    const { editor } = mount();
    editor.setHighlights('spelling', editor.findMatches('Teh'), { kind: 'spelling' });
    editor.setHighlights('grammar', editor.findMatches('barkd'), { kind: 'grammar' });
    const spelling = registry.get('docx-spelling-error')!;
    expect(spelling.type).toBe('spelling-error');
    expect([...spelling].map((range) => range.toString())).toEqual(['Teh']);
    const grammar = registry.get('docx-grammar-error')!;
    expect(grammar.type).toBe('grammar-error');
    expect([...grammar].map((range) => range.toString())).toEqual(['barkd']);
    editor.clearHighlights();
    expect(spelling.size + grammar.size).toBe(0);
  });

  test('announces the issue count once it settles', async () => {
    const { editor, host } = mount();
    const region = () => host.querySelector(`.${EDITOR_ANNOUNCER_CLASS}`)?.textContent ?? null;
    editor.setHighlights('spelling', editor.findMatches('Teh'), { kind: 'spelling' });
    editor.setHighlights(
      'spelling',
      [...editor.findMatches('Teh'), ...editor.findMatches('barkd')],
      {
        kind: 'spelling',
      }
    );
    await wait(ISSUE_ANNOUNCE_DELAY_MS / 2);
    expect(region()).toBeNull();
    await wait(ISSUE_ANNOUNCE_DELAY_MS / 2 + 150);
    expect(region()).toBe('2 spelling issues.');
    // The same count again says nothing new.
    editor.setHighlights(
      'spelling',
      [...editor.findMatches('Teh'), ...editor.findMatches('barkd')],
      {
        kind: 'spelling',
      }
    );
    await wait(ISSUE_ANNOUNCE_DELAY_MS + 150);
    expect(region()).toBe('2 spelling issues.');
    editor.setHighlights('search', editor.findMatches('cat'));
    await wait(ISSUE_ANNOUNCE_DELAY_MS + 150);
    expect(region()).toBe('2 spelling issues.');
  });

  test('a repaint with the same count keeps the announcement timer', async () => {
    const { editor, host } = mount();
    const region = () => host.querySelector(`.${EDITOR_ANNOUNCER_CLASS}`)?.textContent ?? null;
    editor.setHighlights('spelling', editor.findMatches('Teh'), { kind: 'spelling' });
    await wait(ISSUE_ANNOUNCE_DELAY_MS - 400);
    editor.surface!.repaintHighlights();
    await wait(600);
    expect(region()).toBe('1 spelling issue.');
  });

  test('a repaint that changes nothing queries no painted spans', () => {
    const { editor, host } = mount();
    editor.setHighlights('spelling', editor.findMatches('Teh'), { kind: 'spelling' });
    const real = Element.prototype.querySelectorAll;
    let queries = 0;
    Element.prototype.querySelectorAll = function (this: Element, selector: string) {
      if (selector.includes('data-paragraph-id')) queries += 1;
      return real.call(this, selector);
    } as Element['querySelectorAll'];
    cleanups.push(() => {
      Element.prototype.querySelectorAll = real;
    });
    editor.surface!.repaintHighlights();
    editor.setHighlights('search', editor.findMatches('cat'));
    expect(queries).toBe(0);
    expect(host.querySelectorAll('[aria-invalid]')).toHaveLength(1);
  });
});

describe('navigateHighlight', () => {
  test('walks the marks of one set in reading order and wraps', () => {
    const { editor } = mount();
    const marks = [...editor.findMatches('barkd'), ...editor.findMatches('Teh')];
    editor.setHighlights('spelling', marks, { kind: 'spelling' });
    const selected = () => {
      const range = editor.getSelectionRange()!;
      return editor
        .getParagraphText(range.head.blockId)!
        .text.slice(
          Math.min(range.anchor.offset, range.head.offset),
          Math.max(range.anchor.offset, range.head.offset)
        );
    };
    const next = { type: 'navigateHighlight', name: 'spelling', direction: 'next' } as const;
    const previous = { ...next, direction: 'previous' } as const;
    expect(editor.can(next)).toEqual({ ok: true });
    expect(editor.exec(next).ok).toBe(true);
    expect(selected()).toBe('Teh');
    expect(editor.exec(next).ok).toBe(true);
    expect(selected()).toBe('barkd');
    expect(editor.exec(next).ok).toBe(true);
    expect(selected()).toBe('Teh');
    expect(editor.exec(previous).ok).toBe(true);
    expect(selected()).toBe('barkd');
  });

  test('refuses an unknown set and bad arguments', () => {
    const { editor } = mount();
    expect(
      editor.exec({ type: 'navigateHighlight', name: 'none', direction: 'next' })
    ).toMatchObject({ ok: false, code: 'notFound' });
    expect(
      editor.exec({ type: 'navigateHighlight', name: 'none', direction: 'up' as never })
    ).toMatchObject({ ok: false, code: 'invalidArgs' });
  });
});
