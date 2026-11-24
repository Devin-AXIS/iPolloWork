// `firstChangedParagraph`: the paragraph a preview's reveal scrolls to, found by node identity.

import { describe, expect, test } from 'bun:test';
import { openTreeSession } from '@docx-editor.dev/core/binding';
import { firstChangedParagraph } from '../editor-preview-display.ts';
import { docx, paragraph } from './paginated-surface-fixtures.ts';

function open(body: string) {
  const opened = openTreeSession(docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  return opened.session;
}

describe('firstChangedParagraph', () => {
  test('names the first edited body paragraph, not the first paragraph', () => {
    const session = open(paragraph('One.') + paragraph('Two.') + paragraph('Three.'));
    const before = session.currentPackage();
    const [, second, third] = session.paragraphIds();
    session.applyTreeOps([{ op: 'insertText', paragraphId: third!, offset: 0, text: 'x' }]);
    session.applyTreeOps([{ op: 'insertText', paragraphId: second!, offset: 0, text: 'y' }]);
    expect(firstChangedParagraph(before, session.currentPackage())).toBe(second!);
  });

  test('finds a paragraph inside a table cell', () => {
    const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
    const session = open(
      paragraph('Before.') + `<w:tbl><w:tr>${cell('A')}${cell('B')}</w:tr></w:tbl>`
    );
    const before = session.currentPackage();
    const ids = session.paragraphIdsIn();
    const inCell = ids[ids.length - 1]!;
    session.applyTreeOps([{ op: 'insertText', paragraphId: inCell, offset: 0, text: 'z' }]);
    expect(firstChangedParagraph(before, session.currentPackage())).toBe(inCell);
  });

  test('answers null for an unchanged body', () => {
    const session = open(paragraph('One.'));
    const before = session.currentPackage();
    expect(firstChangedParagraph(before, session.currentPackage())).toBeNull();
  });
});
