// Text typed at the outer edge of a control that typing cannot enter lands beside the control,
// and takes the formatting of the text outside it, not the control's own. The caret formatting
// the toolbar reports agrees with what the store writes.

import { expect, test } from 'bun:test';
import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { formattingRunAt } from '../store/direct-properties.ts';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const LOCK = '<w:lock w:val="contentLocked"/>';
const pill = (lock = LOCK) =>
  `<w:sdt><w:sdtPr><w:tag w:val="acme:citation"/>${lock}</w:sdtPr><w:sdtContent>` +
  `<w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>[1]</w:t></w:r></w:sdtContent></w:sdt>`;
const italic = (text: string) =>
  `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

function typed(body: string, offset: number, tracked = false): string {
  const before = part(`<w:p>${body}</w:p>`);
  return xml(
    apply(before, {
      op: 'insertText',
      paragraphId: paragraphId(before),
      offset,
      text: 'X',
      ...(tracked ? { revision: ADA } : {}),
    })
  );
}

/** The properties of the run holding the typed `X`, and whether it sits in the control. */
function typedRun(saved: string): { properties: string; inControl: boolean } {
  const at = saved.indexOf('>X');
  const runStart = saved.lastIndexOf('<w:r>', at);
  const run = saved.slice(runStart, saved.indexOf('</w:r>', at));
  const properties = run.startsWith('<w:r><w:rPr>') ? run.slice(12, run.indexOf('</w:rPr>')) : '';
  const lastOpen = saved.lastIndexOf('<w:sdtContent>', at);
  return { properties, inControl: lastOpen > saved.lastIndexOf('</w:sdtContent>', at) };
}

/** Whether the run whose formatting the caret reports is bold or italic. */
function caretFormatting(source: OoxmlPart, offset: number): string {
  const paragraph = findNode(source, paragraphId(source))!;
  const run = formattingRunAt(paragraph, offset);
  const names = new Set<string>();
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if ('localName' in node) names.add(node.localName);
    node.children.forEach(walk);
  };
  if (run) walk(run);
  return names.has('b') ? 'bold' : names.has('i') ? 'italic' : 'plain';
}

test('typing after a locked control at the end of a paragraph takes the text formatting', () => {
  for (const tracked of [false, true]) {
    const run = typedRun(typed(italic('see ') + pill(), 7, tracked));
    expect(run).toEqual({ properties: '<w:i/>', inControl: false });
  }
});

test('typing before a locked control at the start of a paragraph takes the text formatting', () => {
  for (const tracked of [false, true]) {
    const run = typedRun(typed(pill() + italic(' more'), 0, tracked));
    expect(run).toEqual({ properties: '<w:i/>', inControl: false });
  }
});

test('typing after a locked control mid-paragraph keeps the text formatting', () => {
  const run = typedRun(typed(italic('see ') + pill() + italic(' more'), 7));
  expect(run).toEqual({ properties: '<w:i/>', inControl: false });
});

test('typing beside two adjacent locked controls skips both', () => {
  for (const tracked of [false, true]) {
    const end = typedRun(typed(italic('see ') + pill() + pill(), 10, tracked));
    expect(end).toEqual({ properties: '<w:i/>', inControl: false });
    const start = typedRun(typed(pill() + pill() + italic(' more'), 0, tracked));
    expect(start).toEqual({ properties: '<w:i/>', inControl: false });
  }
  const between = part(`<w:p>${italic('see ')}${pill()}${pill()}</w:p>`);
  expect(caretFormatting(between, 10)).toBe('italic');
});

test('struck text and atoms beside a locked control are never the source', () => {
  const struck =
    '<w:del w:id="9" w:author="Bo" w:date="2026-01-01T00:00:00Z"><w:r><w:rPr><w:b/></w:rPr>' +
    '<w:delText>old</w:delText></w:r></w:del>';
  const note =
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>';
  for (const tracked of [false, true]) {
    // "see " [0,4) "old" [4,7) pill [7,10)
    expect(typedRun(typed(italic('see ') + struck + pill(), 10, tracked))).toEqual({
      properties: '<w:i/>',
      inControl: false,
    });
    // "see " [0,4) note [4,5) pill [5,8)
    expect(typedRun(typed(italic('see ') + note + pill(), 8, tracked))).toEqual({
      properties: '<w:i/>',
      inControl: false,
    });
  }
  const shown = part(`<w:p>${italic('see ')}${struck}${pill()}</w:p>`);
  expect(caretFormatting(shown, 10)).toBe('italic');
});

test('typing beside a locked control that is the only text takes no control formatting', () => {
  for (const tracked of [false, true]) {
    expect(typedRun(typed(pill(), 3, tracked))).toEqual({ properties: '', inControl: false });
    expect(typedRun(typed(pill(), 0, tracked))).toEqual({ properties: '', inControl: false });
  }
});

test('typing beside an unlocked control keeps the ordinary rule', () => {
  // The editor types into an unlocked control at its edge; an unowned write keeps the left run.
  const run = typedRun(typed(italic('see ') + pill(''), 7));
  expect(run.properties).toContain('<w:b/>');
});

test('the caret formatting beside a locked control is the text formatting', () => {
  const end = part(`<w:p>${italic('see ')}${pill()}</w:p>`);
  expect(caretFormatting(end, 7)).toBe('italic');
  const start = part(`<w:p>${pill()}${italic(' more')}</w:p>`);
  expect(caretFormatting(start, 0)).toBe('italic');
  const alone = part(`<w:p>${pill()}</w:p>`);
  expect(caretFormatting(alone, 3)).toBe('plain');
  // Typing at the end of an unlocked control fills it, so its formatting is the caret's.
  const unlocked = part(`<w:p>${italic('see ')}${pill('')}</w:p>`);
  expect(caretFormatting(unlocked, 7)).toBe('bold');
});
