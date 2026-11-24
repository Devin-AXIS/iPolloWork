import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(math = '<m:r><m:t>x</m:t></m:r>'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        `<m:oMath>${math}</m:oMath>` +
        '<w:r><w:t>Z</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    ),
  });
}

function mounted(author?: string, math?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(math),
    ...(author ? { author } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const paragraphId = '/word/document.xml#0.0.0';
  editor.surface.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  return { editor, paragraphId, container };
}

describe('atomic equation editing', () => {
  test('discovers and replaces the equation at the caret', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret();
    expect(equation).toMatchObject({ start: 1, end: 2, linear: 'x' });
    expect(editor.surface!.equations.applyEquation(equation!.id, '{a+b}/{2}')).toBe(true);
    expect(editor.surface!.session.bodyText()).toBe('A\uFFFCZ');
    expect(editor.surface!.equations.equationById(equation!.id)?.linear).toBe('{a+b}/{2}');
  });

  test('replace and remove are each one undo step', () => {
    const { editor, paragraphId } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    editor.surface!.equations.applyEquation(equation.id, 'x^2');
    editor.exec({ type: 'undo' });
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
    expect(editor.surface!.equations.equationAtCaret()?.linear).toBe('x');

    expect(editor.surface!.equations.removeEquation(equation.id)).toBe(true);
    expect(editor.surface!.session.bodyText()).toBe('AZ');
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.bodyText()).toBe('A\uFFFCZ');
  });

  test('refuses to replace an equation that compact text cannot spell, and says why', () => {
    const limits =
      '<m:sub><m:r><m:t>a</m:t></m:r></m:sub><m:sup><m:r><m:t>b</m:t></m:r></m:sup>' +
      '<m:e><m:r><m:t>y</m:t></m:r></m:e>';
    const reason = 'compact linear text cannot spell this equation';
    // Without m:chr the operator is an integral; the compact syntax spells only the sum.
    for (const properties of ['<m:naryPr/>', '<m:naryPr><m:limLoc m:val="undOvr"/></m:naryPr>']) {
      const { editor, container } = mounted(undefined, `<m:nary>${properties}${limits}</m:nary>`);
      const surface = editor.surface!;
      const equation = surface.equations.equationAtCaret()!;
      expect(equation).toMatchObject({ linear: '', fallbackText: '∫aby', supported: true });
      const revision = surface.session.packageRevision();
      expect(surface.equations.can(equation.id, 'replace')).toEqual({
        ok: false,
        code: 'unsupported',
        reason,
      });
      expect(surface.equations.applyEquation(equation.id, 'x')).toBe(false);
      expect(surface.session.packageRevision()).toBe(revision);
      expect(surface.state().lastRejection).toBe(reason);
      // Removal stays available.
      expect(surface.equations.can(equation.id, 'remove')).toEqual({ ok: true });
      editor.destroy();
      container.remove();
    }
    // A sum has a compact spelling, so it stays replaceable.
    const { editor, container } = mounted(
      undefined,
      `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>${limits}</m:nary>`
    );
    const sum = editor.surface!.equations.equationAtCaret()!;
    expect(sum.linear).toBe('∑[a]^[b]{y}');
    expect(editor.surface!.equations.can(sum.id, 'replace')).toEqual({ ok: true });
    editor.destroy();
    container.remove();
  });

  test('refuses malformed input without changing the equation', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    expect(editor.surface!.equations.applyEquation(equation.id, 'x^')).toBe(false);
    expect(editor.surface!.equations.equationById(equation.id)?.linear).toBe('x');
  });

  test('while suggesting, refuses replace and proposes remove as a tracked deletion', async () => {
    const { editor } = mounted('Revision Author');
    const surface = editor.surface!;
    const equation = surface.equations.equationAtCaret()!;
    const reason = 'equation replacement is not supported in suggesting mode';
    const revision = surface.session.packageRevision();
    surface.setEditingMode('suggest');

    expect(surface.equations.can(equation.id, 'replace')).toEqual({
      ok: false,
      code: 'unsupported',
      reason,
    });
    expect(surface.equations.applyEquation(equation.id, 'x^2')).toBe(false);
    expect(surface.session.packageRevision()).toBe(revision);
    expect(surface.state().lastRejection).toBe(reason);

    expect(surface.equations.can(equation.id, 'remove')).toEqual({ ok: true });
    expect(surface.equations.removeEquation(equation.id)).toBe(true);
    // The equation stays until the proposal is decided.
    expect(surface.session.bodyText()).toBe('A\uFFFCZ');
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toMatch(/<w:del w:author="Revision Author"[^>]*>.*<m:oMath>.*<\/w:del>/);
  });

  test('while suggesting, Backspace over a selected equation proposes deleting it', async () => {
    const { editor, paragraphId } = mounted('Revision Author');
    const surface = editor.surface!;
    surface.setEditingMode('suggest');
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 3 },
    });
    surface.deleteBackward();
    expect(surface.state().lastRejection ?? null).toBeNull();
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    expect(xml).toMatch(/<w:del w:author="Revision Author"[^>]*>.*<m:oMath>.*<\/w:del>/);
    expect(xml).not.toContain('<w:t>A</w:t>');
  });

  test('does not invalidate layout for unchanged supported math', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    const revision = editor.surface!.session.packageRevision();
    expect(editor.surface!.equations.applyEquation(equation.id, equation.linear)).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(revision);
  });

  test('reuses equation metadata without exposing the cached paragraph array', () => {
    const { editor } = mounted();
    const first = editor.surface!.equations.equationsInCaretParagraph();
    const second = editor.surface!.equations.equationsInCaretParagraph();

    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    first.splice(0);
    expect(editor.surface!.equations.equationsInCaretParagraph()).toHaveLength(1);
  });

  test('a painted equation click selects its atom and requests chrome', () => {
    const { editor, paragraphId, container } = mounted();
    const seen: string[] = [];
    editor.setEquationChrome({
      onPopover: (activation) => seen.push(activation.equation.id),
    });
    const equation = editor.surface!.equations.equationAtCaret()!;
    const painted = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    painted.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen).toEqual([equation.id]);
    expect(editor.surface!.state().selection).toEqual({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 2 },
    });
  });

  // A press in viewing places the reader's selection like any press, but the equation is not
  // selected whole, because nothing there can edit it.
  test('a painted equation click in viewing requests chrome and does not select it', () => {
    const { editor, container } = mounted();
    const seen: string[] = [];
    editor.setEquationChrome({
      onPopover: (activation) => seen.push(activation.equation.id),
    });
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    const painted = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    painted.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    painted.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen).toHaveLength(1);
    const { anchor, head } = editor.surface!.state().selection;
    expect(anchor).toEqual(head);
  });

  test('a press survives the selection repaint before click activation', () => {
    const { editor, container } = mounted();
    const seen: string[] = [];
    editor.setEquationChrome({
      onPopover: (activation) => seen.push(activation.equation.id),
    });
    const equation = editor.surface!.equations.equationAtCaret()!;
    const painted = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;

    painted.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    painted.remove();
    pages.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen).toEqual([equation.id]);
  });
});
