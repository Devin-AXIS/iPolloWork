import type { InvalidTextFormFieldSession } from '../popup-sessions.ts';
import type { TextFormFieldDialogSession } from '../text-form-field-session.ts';
import { applyProtectedTextFormEdit } from '../../store/store/tree-op-field-results.ts';
import { textFormFieldForEdit } from '../../store/store/text-form-fields.ts';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  paragraphTextOf,
  applyTreeOp,
  textFormFieldsOf,
  type OoxmlParagraphNode,
} from '@docx-editor.dev/core/store';
import { createTextFormFieldInteraction } from '../surface-text-form-fields.ts';
import { createSurfaceHostListeners } from '../surface-host-listeners.ts';

function setup(
  protectedForm = false,
  emptyFirst = false,
  separator = ' and ',
  emptySecond = false,
  onRequest?: (session: TextFormFieldDialogSession) => boolean,
  onInvalidRequest?: (session: InvalidTextFormFieldSession) => boolean
) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const field = (name: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${emptyFirst ? field('InputA').replace('<w:t>Sample</w:t>', '') : field('InputA')}${separator ? `<w:r><w:t xml:space="preserve">${separator}</w:t></w:r>` : ''}${emptySecond ? field('InputB').replace('<w:t>Sample</w:t>', '') : field('InputB')}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  let part = parsed.part;
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('body');
  const paragraph = body.children[0] as OoxmlParagraphNode;
  let selection = {
    anchor: { paragraphId: paragraph.id, offset: 0 },
    head: { paragraphId: paragraph.id, offset: 6 },
  };
  const container = document.createElement('div');
  const pagesLayer = document.createElement('div');
  const span = document.createElement('span');
  span.dataset.fieldAtom = 'form';
  span.dataset.start = '0';
  span.dataset.paragraphId = paragraph.id;
  span.textContent = 'Sample';
  pagesLayer.append(span);
  container.append(pagesLayer);
  document.body.append(container);
  let locale = 'en-US';
  let commits = 0;
  let rejectDelete = false;
  /** Every position the interaction asked the surface to bring into view. */
  const reveals: { paragraphId: string; offset: number }[] = [];
  const interaction = createTextFormFieldInteraction({
    onRequest,
    onInvalidRequest,
    locale: () => locale,
    container,
    pagesLayer,
    listeners: createSurfaceHostListeners(() => pagesLayer),
    part: () => part,
    protected: () => protectedForm,
    selection: () => selection,
    select: (value) => {
      const next = interaction.beforeSelect(value);
      if (next) selection = next;
    },
    reveal: (position) => {
      reveals.push(position);
    },
    editable: () => true,
    apply(op) {
      if (rejectDelete && op.op === 'deleteText') return false;
      if (op.op === 'commitTextFormField') commits++;
      const field = protectedForm ? textFormFieldForEdit(part, op) : null;
      const result = field ? applyProtectedTextFormEdit(part, op, field) : applyTreeOp(part, op);
      if (result.ok) part = result.part;
      return result.ok;
    },
  });
  return {
    container,
    span,
    interaction,
    reveals,
    commits: () => commits,
    setProtected: (value: boolean) => {
      protectedForm = value;
    },
    deleteFirstField: () => {
      const result = applyTreeOp(part, {
        op: 'deleteText',
        paragraphId: paragraph.id,
        start: 0,
        end: 6,
      });
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    },
    pagesLayer,
    rejectDelete: () => {
      rejectDelete = true;
    },
    setLocale: (next: string) => {
      locale = next;
    },
    selection: () => selection,
    part: () => part,
    configure(
      options: NonNullable<Extract<TreeDocOp, { op: 'setTextFormFieldDefault' }>['options']>,
      text = 'Sample',
      index = 0
    ) {
      const field = textFormFieldsOf(
        (part.root.children[0] as typeof body).children[0] as OoxmlParagraphNode
      )[index]!;
      const result = applyTreeOp(part, {
        op: 'setTextFormFieldDefault',
        paragraphId: paragraph.id,
        fieldNodeId: field.fieldNodeId,
        text,
        options,
      });
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    },
    type(op: TreeDocOp) {
      const annotated = interaction.annotate([op])[0]!;
      const field = textFormFieldForEdit(part, annotated);
      const result = field
        ? applyProtectedTextFormEdit(part, annotated, field)
        : applyTreeOp(part, annotated);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    },
    select(start: number, end = start) {
      const next = interaction.beforeSelect({
        anchor: { paragraphId: paragraph.id, offset: start },
        head: { paragraphId: paragraph.id, offset: end },
      });
      if (next) selection = next;
      interaction.update();
    },
    cleanup() {
      interaction.destroy();
      container.remove();
    },
  };
}

test('double click edits the field default through shared core UI', () => {
  const host = setup();
  try {
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const panel = host.container.querySelector('dialog');
    expect(panel).not.toBeNull();
    const input = panel!.querySelector('input')!;
    expect(input.value).toBe('Sample');
    input.value = 'Updated';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.container.querySelector('dialog')).toBeNull();
    const body = host.part().root.children[0]!;
    if (body.kind === 'textValue') throw new Error('body');
    expect(textFormFieldsOf(body.children[0] as OoxmlParagraphNode)[0]?.defaultText).toBe(
      'Updated'
    );
  } finally {
    host.cleanup();
  }
});

test('double click on pages that are not editable selects nothing and opens no dialog', () => {
  const host = setup();
  try {
    // Viewing: the surface marks the pages not editable.
    host.pagesLayer.contentEditable = 'false';
    const before = host.selection();
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.container.querySelector('dialog')).toBeNull();
    expect(host.selection()).toEqual(before);
  } finally {
    host.cleanup();
  }
});

test('protected Tab selects the next field and double click does not expose defaults', () => {
  const host = setup(true);
  try {
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.container.querySelector('dialog')).toBeNull();
    expect(
      host.interaction.keydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    ).toBe(true);
    expect(host.selection().anchor.offset).toBe(11);
    expect(host.selection().head.offset).toBe(17);
  } finally {
    host.cleanup();
  }
});

test('double click skips an earlier empty field', () => {
  const host = setup(false, true);
  try {
    host.span.dataset.start = '5';
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.selection().anchor.offset).toBe(5);
    expect(host.selection().head.offset).toBe(11);
    expect(host.container.querySelector('dialog')).not.toBeNull();
  } finally {
    host.cleanup();
  }
});

test('modified double click retains the ordinary selection gesture', () => {
  const host = setup();
  try {
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, shiftKey: true }));
    expect(host.container.querySelector('dialog')).toBeNull();
  } finally {
    host.cleanup();
  }
});

test('protected field identity survives successive typing operations', () => {
  const host = setup(true);
  try {
    host.span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const paragraphId = host.selection().head.paragraphId;
    const first = host.interaction.annotate([
      { op: 'insertText', paragraphId, offset: 6, text: 'A' },
    ])[0]!;
    expect(first).toHaveProperty('textFormFieldId');
    const second = host.interaction.annotate([
      { op: 'insertText', paragraphId, offset: 6, text: 'B' },
    ])[0]!;
    expect(second).toHaveProperty(
      'textFormFieldId',
      (first as { textFormFieldId: string }).textFormFieldId
    );
  } finally {
    host.cleanup();
  }
});

test('a visible field beside an empty field keeps its own options identity', () => {
  const host = setup(false, true, '');
  try {
    host.span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.selection().head.offset).toBe(6);
  } finally {
    host.cleanup();
  }
});

test('Tab cycles distinct adjacent empty fields by identity', () => {
  const host = setup(true, true, '', true);
  try {
    const identities: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      host.interaction.keydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
      const paragraphId = host.selection().head.paragraphId;
      const op = host.interaction.annotate([
        { op: 'insertText', paragraphId, offset: 0, text: 'X' },
      ])[0] as { textFormFieldId?: string };
      identities.push(op.textFormFieldId);
    }
    expect(identities[0]).toBeDefined();
    expect(identities[0]).not.toBe(identities[1]);
    expect(identities[0]).toBe(identities[2]);
  } finally {
    host.cleanup();
  }
});

test('selection feedback distinguishes a whole reversed field from a caret', () => {
  const host = setup();
  try {
    host.select(6, 0);
    expect(host.span.dataset.textFormSelection).toBe('whole');
    host.select(2);
    expect(host.span.dataset.textFormSelection).toBe('caret');
    host.select(8);
    expect(host.span.dataset.textFormSelection).toBeUndefined();
  } finally {
    host.cleanup();
  }
});

test('leaving a dirty protected field formats its result and remaps the next selection', () => {
  const host = setup(true, false, '');
  try {
    host.configure({ type: 'regular', format: 'Uppercase', maxLength: 0, enabled: true });
    const paragraphId = host.selection().head.paragraphId;
    host.select(6);
    host.type({ op: 'insertText', paragraphId, offset: 6, text: 'ß' });
    host.select(7);
    host.interaction.keydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    const p = (host.part().root.children[0] as { children: OoxmlParagraphNode[] }).children[0]!;
    const fields = textFormFieldsOf(p);
    expect(fields[0]!.end).toBe(8);
    expect(host.selection().anchor.offset).toBe(8);
    expect(host.selection().head.offset).toBe(14);
  } finally {
    host.cleanup();
  }
});

test('unchanged imported values do not trap protected navigation', () => {
  const host = setup(true);
  try {
    host.select(8);
    expect(host.selection().head.offset).toBe(8);
  } finally {
    host.cleanup();
  }
});

test('keyboard movement transfers dirty field ownership to the next field', () => {
  const host = setup(true);
  try {
    host.configure(
      { type: 'regular', format: 'Uppercase', maxLength: 0, enabled: true },
      'Sample',
      1
    );
    const paragraphId = host.selection().head.paragraphId;
    host.select(1);
    host.type({ op: 'insertText', paragraphId, offset: 1, text: 'x' });
    host.select(13);
    host.type({ op: 'insertText', paragraphId, offset: 13, text: 'z' });
    host.select(0);
    const p = (host.part().root.children[0] as { children: OoxmlParagraphNode[] }).children[0]!;
    expect(textFormFieldsOf(p)[1]?.end).toBe(19);
    expect(paragraphTextOf(host.part(), paragraphId)).toBe('Sxample and SZAMPLE');
    const { head } = host.selection();
    expect(head.offset).toBe(0);
    // A second visit starts with the freshly formatted result.
    host.select(13);
    host.interaction.update();
  } finally {
    host.cleanup();
  }
});

test('visiting existing dates after a locale change preserves their value and history', () => {
  const host = setup(true);
  try {
    host.configure({ type: 'date', format: 'MM/dd/yyyy', maxLength: 0, enabled: true }, '1/2/2030');
    host.setLocale('en-GB');
    const paragraphId = host.selection().head.paragraphId;
    for (let visit = 0; visit < 3; visit++) {
      host.select(0);
      host.select(20);
      expect(paragraphTextOf(host.part(), paragraphId)).toBe('01/02/2030 and Sample');
      expect(host.commits()).toBe(0);
    }
  } finally {
    host.cleanup();
  }
});

for (const [locale, input, output] of [
  ['en-GB', '1/2/2030', '02/01/2030'],
  ['pl-PL', '01.02.2030', '02/01/2030'],
  ['ja-JP', '2030/2/1', '02/01/2030'],
] as const) {
  test(`protected date input follows ${locale} and keeps the authored output picture`, () => {
    const host = setup(true);
    try {
      host.configure(
        { type: 'date', format: 'MM/dd/yyyy', maxLength: 0, enabled: true },
        '2030-01-02'
      );
      host.setLocale(locale);
      host.select(0, 10);
      const paragraphId = host.selection().head.paragraphId;
      host.type({ op: 'deleteText', paragraphId, start: 0, end: 10 });
      host.select(0);
      host.type({ op: 'insertText', paragraphId, offset: 0, text: input });
      // A live locale change must not reinterpret input already being edited.
      host.setLocale('en-US');
      host.select(30);
      expect(paragraphTextOf(host.part(), paragraphId)).toBe(`${output} and Sample`);
      expect(host.commits()).toBe(1);
      host.select(0);
      host.select(30);
      expect(paragraphTextOf(host.part(), paragraphId)).toBe(`${output} and Sample`);
      expect(host.commits()).toBe(1);
      // The next edit adopts the updated locale.
      host.select(0, 10);
      host.type({ op: 'deleteText', paragraphId, start: 0, end: 10 });
      host.select(0);
      host.type({ op: 'insertText', paragraphId, offset: 0, text: '1/2/2030' });
      host.select(30);
      expect(paragraphTextOf(host.part(), paragraphId)).toBe('01/02/2030 and Sample');
    } finally {
      host.cleanup();
    }
  });
}

for (const scenario of ['changed type', 'refused deletion'] as const) {
  test(`invalid fill acknowledgement preserves content after ${scenario}`, () => {
    const host = setup(true);
    try {
      host.pagesLayer.tabIndex = 0;
      host.configure({ type: 'number', format: '0.00', maxLength: 0, enabled: true }, '1');
      const paragraphId = host.selection().head.paragraphId;
      host.select(0);
      host.type({ op: 'insertText', paragraphId, offset: 0, text: '--' });
      host.select(20);
      const alert = host.container.querySelector<HTMLDialogElement>('[role="alertdialog"]')!;
      expect(alert.open).toBe(true);
      if (scenario === 'changed type')
        host.configure({ type: 'regular', format: '', maxLength: 0, enabled: true }, '--1.00');
      else host.rejectDelete();
      const before = paragraphTextOf(host.part(), paragraphId);
      alert.querySelector('button')!.click();
      expect(paragraphTextOf(host.part(), paragraphId)).toBe(before);
      expect(host.container.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(host.pagesLayer);
      expect(host.selection().head).toEqual({ paragraphId, offset: 0 });
    } finally {
      host.cleanup();
    }
  });
}

// A lane that TRAVELS to a field asks the surface to bring it into view. A press does not:
// the reader aimed at a spot on screen, and moving the paper under them breaks the gesture.
test('the edit command reveals the field it travels to', () => {
  const host = setup();
  try {
    expect(host.interaction.edit()).toBe(true);
    expect(host.reveals).toEqual([{ paragraphId: host.selection().head.paragraphId, offset: 0 }]);
  } finally {
    host.cleanup();
  }
});

test('a refused selection reveals nothing, so the pinned field stays on screen', () => {
  const host = setup(true);
  try {
    host.pagesLayer.tabIndex = 0;
    host.configure({ type: 'number', format: '0.00', maxLength: 0, enabled: true }, '1');
    const paragraphId = host.selection().head.paragraphId;
    host.select(0);
    host.type({ op: 'insertText', paragraphId, offset: 0, text: '--' });
    // Leaving an invalid value pins the caret in the field the reader has to fix.
    host.select(20);
    expect(host.container.querySelector<HTMLDialogElement>('[role="alertdialog"]')?.open).toBe(
      true
    );
    host.reveals.length = 0;

    host.interaction.keydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));

    // The write was refused, so the viewport must not travel to a field holding no caret.
    expect(host.reveals).toEqual([]);
  } finally {
    host.cleanup();
  }
});

test('host Field Options session owns accepted and refused writes without native UI', () => {
  const sessions: TextFormFieldDialogSession[] = [];
  const host = setup(false, false, ' and ', false, (session) => {
    sessions.push(session);
    return true;
  });
  try {
    expect(host.interaction.edit()).toBe(true);
    const session = sessions[0]!;
    expect(host.container.querySelector('dialog')).toBeNull();
    const options = { type: 'regular' as const, maxLength: 0, format: '', enabled: true };
    expect(session.apply('bad\nvalue', options)).toBe(false);
    expect(session.signal.aborted).toBe(false);
    expect(session.apply('Changed', options)).toBe(true);
    expect(session.signal.aborted).toBe(true);
    expect(session.canApply()).toBe(false);
    expect(session.apply('Stale', options)).toBe(false);
    expect(paragraphTextOf(host.part(), host.selection().head.paragraphId)).toContain('Changed');
  } finally {
    host.interaction.destroy();
    host.container.remove();
  }
});

test('reopening and destruction invalidate retained host Field Options callbacks', () => {
  const sessions: TextFormFieldDialogSession[] = [];
  const host = setup(false, false, ' and ', false, (session) => {
    sessions.push(session);
    return true;
  });
  const options = { type: 'regular' as const, maxLength: 0, format: '', enabled: true };
  try {
    host.interaction.edit();
    host.interaction.edit();
    expect(sessions[0]!.signal.aborted).toBe(true);
    sessions[0]!.cancel();
    expect(sessions[1]!.signal.aborted).toBe(false);
    host.interaction.destroy();
    expect(sessions[1]!.signal.aborted).toBe(true);
    expect(sessions[1]!.apply('Stale', options)).toBe(false);
    expect(paragraphTextOf(host.part(), host.selection().head.paragraphId)).toBe(
      'Sample and Sample'
    );
  } finally {
    host.container.remove();
  }
});

test('host Field Options rechecks protection and deleted targets at apply time', () => {
  const sessions: TextFormFieldDialogSession[] = [];
  const host = setup(false, false, ' and ', false, (session) => {
    sessions.push(session);
    return true;
  });
  const options = { type: 'regular' as const, maxLength: 0, format: '', enabled: true };
  try {
    host.interaction.edit();
    expect(sessions[0]!.canApply()).toBe(true);
    host.setProtected(true);
    expect(sessions[0]!.canApply()).toBe(false);
    expect(sessions[0]!.apply('Refused', options)).toBe(false);
    expect(sessions[0]!.signal.aborted).toBe(false);
    host.setProtected(false);
    expect(sessions[0]!.canApply()).toBe(true);
    host.deleteFirstField();
    expect(sessions[0]!.canApply()).toBe(false);
    expect(sessions[0]!.apply('Deleted', options)).toBe(false);
    expect(paragraphTextOf(host.part(), host.selection().head.paragraphId)).toBe(' and Sample');
  } finally {
    host.interaction.destroy();
    host.container.remove();
  }
});

for (const action of ['acknowledge', 'cancel', 'destroy'] as const) {
  test(`custom invalid-field ${action} preserves acknowledgement ownership`, () => {
    const requests: InvalidTextFormFieldSession[] = [];
    const host = setup(true, false, ' and ', false, undefined, (request) => {
      requests.push(request);
      return true;
    });
    try {
      host.configure({ type: 'number', format: '0.00', maxLength: 0, enabled: true }, '1');
      const paragraphId = host.selection().head.paragraphId;
      host.select(0);
      host.type({ op: 'insertText', paragraphId, offset: 0, text: '--' });
      host.select(20);
      expect(requests).toHaveLength(1);
      expect(host.container.querySelector('dialog')).toBeNull();
      const before = paragraphTextOf(host.part(), paragraphId);
      const request = requests[0]!;
      if (action === 'destroy') host.interaction.destroy();
      else request[action]();
      expect(request.signal.aborted).toBe(true);
      if (action === 'acknowledge')
        expect(paragraphTextOf(host.part(), paragraphId)).toBe(' and Sample');
      else expect(paragraphTextOf(host.part(), paragraphId)).toBe(before);
      request.acknowledge();
      request.cancel();
      expect(paragraphTextOf(host.part(), paragraphId)).toBe(
        action === 'acknowledge' ? ' and Sample' : before
      );
    } finally {
      host.cleanup();
    }
  });
}

test('custom Field Options retains the opening regional date locale', () => {
  const requests: TextFormFieldDialogSession[] = [];
  const host = setup(false, false, ' and ', false, (request) => {
    requests.push(request);
    return true;
  });
  try {
    host.setLocale('en-GB');
    host.interaction.edit();
    host.setLocale('en-US');
    expect(
      requests[0]!.apply('1/2/2030', {
        type: 'date',
        format: 'yyyy-MM-dd',
        maxLength: 0,
        enabled: true,
      })
    ).toBe(true);
    expect(paragraphTextOf(host.part(), host.selection().head.paragraphId)).toBe(
      '2030-02-01 and Sample'
    );
  } finally {
    host.cleanup();
  }
});

test('an unprotected empty field keeps its keyboard options action', () => {
  const host = setup(false, true);
  try {
    host.select(0);
    expect(host.interaction.canEdit()).toBe(true);
    expect(host.interaction.edit()).toBe(true);
    expect(host.container.querySelector('dialog')).not.toBeNull();
  } finally {
    host.cleanup();
  }
});
