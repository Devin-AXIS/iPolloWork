import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlParagraphNode } from '../../store/index.ts';
import type { SemanticSelection } from '../../layout/index.ts';
import { createTextFormFieldInteraction } from '../surface-text-form-fields.ts';
import { createSurfaceHostListeners } from '../surface-host-listeners.ts';

function setup(protectedForm = false) {
  const result = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>Z</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  const container = document.createElement('div');
  const pages = document.createElement('div');
  const span = document.createElement('span');
  span.dataset.fieldAtom = 'form';
  span.dataset.start = '1';
  span.dataset.paragraphId = paragraph.id;
  span.textContent = 'Sample';
  pages.append(span);
  container.append(pages);
  document.body.append(container);
  let selection: SemanticSelection = {
    anchor: { paragraphId: paragraph.id, offset: 3 },
    head: { paragraphId: paragraph.id, offset: 3 },
  };
  const interaction = createTextFormFieldInteraction({
    pagesLayer: pages,
    container,
    listeners: createSurfaceHostListeners(() => pages),
    part: () => result.part,
    protected: () => protectedForm,
    selection: () => selection,
    select: (next) => {
      selection = next;
    },
    editable: () => true,
    apply: () => false,
  });
  const click = (options: MouseEventInit = {}) => {
    span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, ...options })
    );
    span.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10, ...options })
    );
  };
  return {
    span,
    pointerUp: interaction.pointerUp,
    click,
    selection: () => selection,
    selectRange: () => {
      selection = {
        anchor: { paragraphId: paragraph.id, offset: 2 },
        head: { paragraphId: paragraph.id, offset: 5 },
      };
    },
    cleanup() {
      interaction.destroy();
      container.remove();
    },
  };
}

test('unprotected field single-click selects the entire result on repeated clicks', () => {
  const h = setup();
  try {
    h.click();
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([1, 7]);
    h.click();
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([1, 7]);
  } finally {
    h.cleanup();
  }
});
test('protected field single-click preserves the interior caret', () => {
  const h = setup(true);
  try {
    h.click();
    expect(h.selection().head.offset).toBe(3);
    expect(h.selection().anchor.offset).toBe(3);
  } finally {
    h.cleanup();
  }
});
for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
  test(`${modifier} click does not replace selection`, () => {
    const h = setup();
    try {
      h.click({ [modifier]: true });
      expect(h.selection().head.offset).toBe(3);
    } finally {
      h.cleanup();
    }
  });
}
test('dragging away and back does not become whole-field selection', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
    );
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: 10 }));
    h.span.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 })
    );
    expect(h.selection().head.offset).toBe(3);
  } finally {
    h.cleanup();
  }
});
test('a short text drag preserves its noncollapsed range', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
    );
    h.selectRange();
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 11, clientY: 10 }));
    h.pointerUp(new PointerEvent('pointerup', { clientX: 11, clientY: 10 }));
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([2, 5]);
  } finally {
    h.cleanup();
  }
});
test('pointer cancellation does not select a field', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointercancel'));
    h.span.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(h.selection().head.offset).toBe(3);
  } finally {
    h.cleanup();
  }
});

test('first click replaces a stale semantic range from the preceding selection', () => {
  const h = setup();
  try {
    h.selectRange();
    h.click();
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([1, 7]);
  } finally {
    h.cleanup();
  }
});

test('pointer capture retargeting click to the pages layer still selects the field', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
    );
    h.span.parentElement!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 })
    );
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([1, 7]);
  } finally {
    h.cleanup();
  }
});
test('release at a different coordinate does not use a recorded field', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })
    );
    h.span.parentElement!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 20, clientY: 10 })
    );
    expect(h.selection().head.offset).toBe(3);
  } finally {
    h.cleanup();
  }
});

test('fractional pointer coordinates tolerate rounded native click coordinates', () => {
  const h = setup();
  try {
    h.span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10.4, clientY: 10.4 })
    );
    h.span.parentElement!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 })
    );
    expect([h.selection().anchor.offset, h.selection().head.offset]).toEqual([1, 7]);
  } finally {
    h.cleanup();
  }
});
