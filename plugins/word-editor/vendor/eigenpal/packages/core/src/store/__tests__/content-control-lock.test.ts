// ST_Lock enforcement at the store: nested lock union, atomic crossing refusal, bound.
// Also covers deleteBlock descendant protection and hyperlink / page-field restriction gates.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';
import { findContentControl } from '../store/tree-op-nodes.ts';
import {
  contentControlLockAt,
  enclosingContentControls,
} from '../store/tree-op-content-controls.ts';
import { MAX_CONTENT_CONTROLS_PER_PART } from '../package/content-control-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const X = 'urn:hostile';

function load(body: string, extra = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"${extra}><w:body>${body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType: 'app/xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

function reject(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a rejection');
  return result.reason;
}

function firstSdt(part: OoxmlPart): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'sdt') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no sdt');
  return found;
}

function firstOfKind(part: OoxmlPart, kind: OoxmlNode['kind']): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === kind) return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error(`no ${kind}`);
  return found;
}

function firstHyperlink(part: OoxmlPart): string {
  return firstOfKind(part, 'hyperlink');
}

function firstNamed(part: OoxmlPart, localName: string): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === localName) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textUnder).join('');
}

function allNamed(node: OoxmlNode, localName: string): OoxmlNode[] {
  if (node.kind === 'textValue') return [];
  const found = node.localName === localName ? [node] : [];
  return found.concat(node.children.flatMap((child) => allNamed(child, localName)));
}

const PARAGRAPH = '/word/document.xml#0.0.0';

const TABLE_WITH = (inner: string) =>
  `<w:tbl><w:tr><w:tc><w:p>${inner}</w:p><w:p/></w:tc></w:tr></w:tbl>`;

describe('ST_Lock content edits', () => {
  const insertInlineControl = (paragraphId: string): TreeDocOp => ({
    op: 'insertInlineContentControl',
    paragraphId,
    offset: 2,
    tag: 'new',
    text: 'X',
  });

  const inlineControlAtOffset = (properties: string): OoxmlPart =>
    load(
      '<w:p><w:r><w:t>A</w:t></w:r><w:sdt><w:sdtPr>' +
        properties +
        '</w:sdtPr><w:sdtContent><w:r><w:t>BC</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>D</w:t></w:r></w:p>'
    );

  test('inserting an inline control cannot split a content-locked control', () => {
    const part = inlineControlAtOffset('<w:lock w:val="sdtContentLocked"/>');
    expect(reject(part, insertInlineControl(firstOfKind(part, 'paragraph')))).toBe('locked');
  });

  test('inserting an inline control cannot split a data-bound control', () => {
    const part = inlineControlAtOffset(
      '<w:dataBinding w:xpath="/a" w:storeItemID="{G}" w:prefixMappings=""/>'
    );
    expect(reject(part, insertInlineControl(firstOfKind(part, 'paragraph')))).toBe('bound');
  });

  test('inserting an inline control splits an ordinary enclosing control', () => {
    const part = inlineControlAtOffset('<w:tag w:val="old"/>');
    const paragraphId = firstOfKind(part, 'paragraph');
    const next = apply(part, insertInlineControl(paragraphId));
    expect(paragraphTextOf(next, paragraphId)).toBe('ABXCD');
    expect(allNamed(next.root, 'sdt').map(textUnder)).toEqual(['B', 'X', 'C']);
  });

  test('inserting an inline control outside existing controls is unchanged', () => {
    const part = load('<w:p><w:r><w:t>ABCD</w:t></w:r></w:p>');
    const paragraphId = firstOfKind(part, 'paragraph');
    const next = apply(part, insertInlineControl(paragraphId));
    expect(paragraphTextOf(next, paragraphId)).toBe('ABXCD');
    expect(allNamed(next.root, 'sdt').map(textUnder)).toEqual(['X']);
  });

  const wrapperUnderControl = (properties: string): OoxmlPart =>
    load(
      `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent><w:p>` +
        '<w:smartTag><w:r><w:t>word</w:t></w:r></w:smartTag>' +
        '</w:p></w:sdtContent></w:sdt>'
    );

  const wrapperOps = (part: OoxmlPart): readonly TreeDocOp[] => {
    const paragraphId = firstOfKind(part, 'paragraph');
    return [
      {
        op: 'insertText',
        paragraphId,
        offset: 2,
        text: 'X',
      },
      { op: 'deleteText', paragraphId, start: 1, end: 3 },
      {
        op: 'setRunProperties',
        paragraphId,
        start: 1,
        end: 3,
        properties: [{ localName: 'b' }],
      },
    ];
  };

  test('an inline wrapper edit inherits its enclosing content lock', () => {
    const part = wrapperUnderControl('<w:lock w:val="sdtContentLocked"/>');
    expect(wrapperOps(part).map((op) => reject(part, op))).toEqual(['locked', 'locked', 'locked']);
  });

  test('an inline wrapper edit inherits its enclosing data binding', () => {
    const part = wrapperUnderControl('<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>');
    expect(wrapperOps(part).map((op) => reject(part, op))).toEqual(['bound', 'bound', 'bound']);
  });

  test('the same wrapper edits succeed under an unlocked control', () => {
    const part = wrapperUnderControl('');
    for (const op of wrapperOps(part)) expect(applyTreeOp(part, op).ok).toBe(true);
  });

  const trailingWrapperControl = (properties: string): OoxmlPart =>
    load(
      '<w:p><w:sdt><w:sdtPr>' +
        properties +
        '</w:sdtPr><w:sdtContent>' +
        '<w:smartTag><w:r><w:t>word</w:t></w:r></w:smartTag>' +
        '</w:sdtContent></w:sdt></w:p>'
    );

  test('an unscoped trailing wrapper insertion lands beside its locked control', () => {
    const part = trailingWrapperControl('<w:lock w:val="sdtContentLocked"/>');
    const paragraphId = firstOfKind(part, 'paragraph');
    const next = apply(part, { op: 'insertText', paragraphId, offset: 4, text: 'X' });
    expect(paragraphTextOf(next, paragraphId)).toBe('wordX');
    expect(textUnder(firstSdt(next))).toBe('word');
    expect(reject(part, { op: 'insertText', paragraphId, offset: 2, text: 'X' })).toBe('locked');
  });

  test('the same unlocked insertion exits the wrapper but stays in the control', () => {
    const part = trailingWrapperControl('');
    const paragraphId = firstOfKind(part, 'paragraph');
    const next = apply(part, { op: 'insertText', paragraphId, offset: 4, text: 'X' });
    expect(textUnder(firstNamed(next, 'smartTag'))).toBe('word');
    expect(textUnder(firstSdt(next))).toBe('wordX');
    expect(paragraphTextOf(next, paragraphId)).toBe('wordX');
  });

  test('a tracked trailing insertion uses the same control landing site', () => {
    const part = trailingWrapperControl('');
    const paragraphId = firstOfKind(part, 'paragraph');
    const next = apply(part, {
      op: 'insertText',
      paragraphId,
      offset: 4,
      text: 'X',
      revision: { author: 'Ada' },
    });
    const wrapper = firstNamed(next, 'smartTag');
    expect(textUnder(wrapper)).toBe('word');
    expect(textUnder(firstSdt(next))).toBe('wordX');
    expect(paragraphTextOf(next, paragraphId)).toBe('wordX');
  });

  test('contentLocked refuses insert/delete inside the control', () => {
    const part = load(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>LOCK</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>zz</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 3, text: 'x' })).toBe(
      'locked'
    );
    expect(reject(part, { op: 'deleteText', paragraphId: PARAGRAPH, start: 2, end: 4 })).toBe(
      'locked'
    );
    expect(paragraphTextOf(part, PARAGRAPH)).toBe('aaLOCKzz');
  });

  test('sdtLocked allows content edits but refuses removeContentControl', () => {
    const part = load(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>ok</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>zz</w:t></w:r></w:p>'
    );
    const control = firstSdt(part);
    const next = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 2,
      text: 'X',
    });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('aaXokzz');
    expect(reject(next, { op: 'removeContentControl', controlId: control.id })).toBe('locked');
  });

  test('sdtContentLocked refuses both content edits and removal', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>xy</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = firstSdt(part);
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'y' })).toBe(
      'locked'
    );
    expect(reject(part, { op: 'removeContentControl', controlId: control.id })).toBe('locked');
  });

  test('foreign-namespace lock before w:lock cannot shadow contentLocked', () => {
    // Hostile x:lock@unlocked must not win over a later real w:lock.
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        `<x:lock xmlns:x="${X}" x:val="unlocked"/>` +
        '<w:lock w:val="contentLocked"/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>LOCK</w:t></w:r></w:sdtContent></w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'X' })).toBe(
      'locked'
    );
    expect(paragraphTextOf(part, PARAGRAPH)).toBe('LOCK');
  });

  test('foreign x:val on w:lock cannot unlock a real w:val', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        `<w:lock xmlns:x="${X}" x:val="unlocked" w:val="contentLocked"/>` +
        '</w:sdtPr><w:sdtContent><w:r><w:t>LOCK</w:t></w:r></w:sdtContent></w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'X' })).toBe(
      'locked'
    );
  });

  test('a range spanning unlocked text into a locked control fails atomically', () => {
    const part = load(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>BB</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>cc</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteText', paragraphId: PARAGRAPH, start: 1, end: 4 })).toBe(
      'locked'
    );
    expect(paragraphTextOf(part, PARAGRAPH)).toBe('aaBBcc');
  });

  test('nested locks union — outer contentLocked blocks edits in an unlocked inner', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>in</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:sdtContent></w:sdt></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'x' })).toBe(
      'locked'
    );
  });

  test('contentLocked refuses setContentControlValue', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(
      reject(part, {
        op: 'setContentControlValue',
        controlId: firstSdt(part).id,
        value: 'y',
      })
    ).toBe('locked');
  });

  test('bound refuses content edits inside the control', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>xy</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'y' })).toBe(
      'bound'
    );
  });

  test('unlocked control can be removed', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const id = firstSdt(part).id;
    const next = apply(part, { op: 'removeContentControl', controlId: id });
    expect(findContentControl(next, id)).toBeNull();
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('x');
  });

  test('temporary + sdtLocked refuses content edit (cannot unwrap)', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:temporary/><w:lock w:val="sdtLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 0, text: 'y' })).toBe(
      'locked'
    );
    expect(paragraphTextOf(part, PARAGRAPH)).toBe('x');
    expect(findContentControl(part, firstSdt(part).id)).toBeTruthy();
  });

  test('empty contentLocked control refuses the first insertion', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p/></w:sdtContent></w:sdt>'
    );
    const emptyParagraph = firstOfKind(part, 'paragraph');
    expect(
      reject(part, { op: 'insertText', paragraphId: emptyParagraph, offset: 0, text: 'x' })
    ).toBe('locked');
    expect(paragraphTextOf(part, emptyParagraph)).toBe('');
  });

  test('empty sdtContentLocked control refuses the first insertion', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:p/></w:sdtContent></w:sdt>'
    );
    expect(
      reject(part, {
        op: 'insertText',
        paragraphId: firstOfKind(part, 'paragraph'),
        offset: 0,
        text: 'x',
      })
    ).toBe('locked');
  });

  test('setSectionMark refuses inside contentLocked', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>sec</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>'
    );
    expect(
      reject(part, { op: 'setSectionMark', paragraphId: firstOfKind(part, 'paragraph') })
    ).toBe('locked');
  });

  test('setSectionMark refuses inside a bound control', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:dataBinding w:xpath="/a" w:storeItemID="{G}"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>sec</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>'
    );
    expect(
      reject(part, { op: 'setSectionMark', paragraphId: firstOfKind(part, 'paragraph') })
    ).toBe('bound');
  });

  test('joinParagraphs unwraps a temporary block control', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:temporary/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>'
    );
    const controlId = firstSdt(part).id;
    const paragraphs: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') paragraphs.push(node.id);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(paragraphs.length).toBe(2);
    const result = applyTreeOp(part, {
      op: 'joinParagraphs',
      firstId: paragraphs[0]!,
      secondId: paragraphs[1]!,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(findContentControl(result.part, controlId)).toBeNull();
    expect(paragraphTextOf(result.part, paragraphs[0]!)).toBe('onetwo');
    expect(result.effect.impact).toBe('flow-structural');
  });

  test('joinParagraphs refuses temporary + sdtLocked (cannot unwrap)', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:temporary/><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>'
    );
    const paragraphs: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') paragraphs.push(node.id);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(
      reject(part, {
        op: 'joinParagraphs',
        firstId: paragraphs[0]!,
        secondId: paragraphs[1]!,
      })
    ).toBe('locked');
    expect(findContentControl(part, firstSdt(part).id)).toBeTruthy();
  });

  test('bound refuses before a temporary unwrap transition', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:temporary/>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>xy</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 1, text: 'y' })).toBe(
      'bound'
    );
  });
});

describe('deleteBlock refuses protected descendant content controls', () => {
  test('table with nested contentLocked inline SDT may be deleted', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>L</w:t></w:r></w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    // `contentLocked` protects what the control holds and lets the whole control go.
    const next = apply(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') });
    expect(() => firstOfKind(next, 'table')).toThrow();
  });

  test('table with nested sdtLocked inline SDT refuses deleteBlock (wrapper removal)', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>W</w:t></w:r></w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') })).toBe('locked');
  });

  test('table with nested sdtContentLocked SDT refuses deleteBlock', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>X</w:t></w:r></w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') })).toBe('locked');
  });

  test('table with nested bound SDT refuses deleteBlock with bound', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr><w:dataBinding w:xpath="/a" w:storeItemID="{G}"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>B</w:t></w:r></w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') })).toBe('bound');
  });

  test('table with unlocked nested SDT may be deleted', () => {
    const part = load(
      TABLE_WITH('<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>ok</w:t></w:r></w:sdtContent></w:sdt>') +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    const tableId = firstOfKind(part, 'table');
    const next = apply(part, { op: 'deleteBlock', blockId: tableId });
    expect(applyTreeOp(next, { op: 'deleteBlock', blockId: tableId }).ok).toBe(false);
    expect(paragraphTextOf(next, firstOfKind(next, 'paragraph'))).toBe('keep');
  });

  test('block-level contentLocked SDT nested inside a table cell may be deleted', () => {
    const part = load(
      '<w:tbl><w:tr><w:tc>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:p/></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    const next = apply(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') });
    expect(() => firstOfKind(next, 'table')).toThrow();
  });

  test('deeply nested contentLocked SDT under unlocked outer inside a table may be deleted', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr/><w:sdtContent>' +
          '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>in</w:t></w:r></w:sdtContent></w:sdt>' +
          '</w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    const next = apply(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') });
    expect(() => firstOfKind(next, 'table')).toThrow();
  });

  test('paragraph with inline contentLocked SDT may be deleted', () => {
    const part = load(
      '<w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>L</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    const next = apply(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'paragraph') });
    expect(paragraphTextOf(next, firstOfKind(next, 'paragraph'))).toBe('keep');
  });

  test('paragraph with inline sdtLocked SDT refuses deleteBlock', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:lock w:val="sdtLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>W</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'paragraph') })).toBe(
      'locked'
    );
  });

  test('paragraph with inline bound SDT refuses deleteBlock with bound', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:dataBinding w:xpath="/a" w:storeItemID="{G}"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>B</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'paragraph') })).toBe(
      'bound'
    );
  });

  test('table row containing a contentLocked SDT may be deleted', () => {
    const part = load(
      '<w:tbl>' +
        '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>L</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:p><w:p/></w:tc></w:tr>' +
        '</w:tbl>' +
        '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    // Second row holds the locked control.
    const table = (() => {
      const walk = (node: OoxmlNode): OoxmlNode | null => {
        if (node.kind === 'textValue') return null;
        if (node.kind === 'table') return node;
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(part.root)!;
    })();
    const rows = table.children.filter((child) => child.kind === 'tableRow');
    expect(rows.length).toBe(2);
    const after = apply(part, { op: 'deleteBlock', blockId: rows[1]!.id });
    expect(firstOfKind(after, 'table')).toBeTruthy();
  });

  test('bound wins over lock when a nested bound+locked SDT is under a table', () => {
    const part = load(
      TABLE_WITH(
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/>' +
          '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/></w:sdtPr>' +
          '<w:sdtContent><w:r><w:t>X</w:t></w:r></w:sdtContent></w:sdt>'
      ) + '<w:p><w:r><w:t>keep</w:t></w:r></w:p>'
    );
    expect(reject(part, { op: 'deleteBlock', blockId: firstOfKind(part, 'table') })).toBe('bound');
  });
});

describe('hyperlink and page-field ops respect content-control restrictions', () => {
  const linkedInside = (sdtPr: string) =>
    '<w:p><w:sdt><w:sdtPr>' +
    sdtPr +
    '</w:sdtPr><w:sdtContent>' +
    '<w:hyperlink r:id="rId9"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
    '</w:sdtContent></w:sdt></w:p>';

  test('contentLocked refuses setHyperlinkTarget and removeHyperlink', () => {
    const part = load(linkedInside('<w:lock w:val="contentLocked"/>'));
    const linkId = firstHyperlink(part);
    expect(reject(part, { op: 'setHyperlinkTarget', linkId, anchor: 'elsewhere' })).toBe('locked');
    expect(reject(part, { op: 'removeHyperlink', linkId })).toBe('locked');
  });

  test('sdtContentLocked refuses setHyperlinkTarget and removeHyperlink', () => {
    const part = load(linkedInside('<w:lock w:val="sdtContentLocked"/>'));
    const linkId = firstHyperlink(part);
    expect(reject(part, { op: 'setHyperlinkTarget', linkId, relationshipId: 'rId1' })).toBe(
      'locked'
    );
    expect(reject(part, { op: 'removeHyperlink', linkId })).toBe('locked');
  });

  test('bound refuses setHyperlinkTarget and removeHyperlink', () => {
    const part = load(linkedInside('<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>'));
    const linkId = firstHyperlink(part);
    expect(reject(part, { op: 'setHyperlinkTarget', linkId, anchor: 'x' })).toBe('bound');
    expect(reject(part, { op: 'removeHyperlink', linkId })).toBe('bound');
  });

  test('temporary + sdtLocked refuses setHyperlinkTarget and removeHyperlink', () => {
    const part = load(linkedInside('<w:temporary/><w:lock w:val="sdtLocked"/>'));
    const linkId = firstHyperlink(part);
    expect(reject(part, { op: 'setHyperlinkTarget', linkId, anchor: 'x' })).toBe('locked');
    expect(reject(part, { op: 'removeHyperlink', linkId })).toBe('locked');
  });

  test('sdtLocked alone still allows hyperlink retarget and removal', () => {
    const part = load(linkedInside('<w:lock w:val="sdtLocked"/>'));
    const linkId = firstHyperlink(part);
    const retargeted = apply(part, { op: 'setHyperlinkTarget', linkId, anchor: 'section2' });
    expect(firstHyperlink(retargeted)).toBe(linkId);
    const removed = apply(retargeted, { op: 'removeHyperlink', linkId });
    expect(paragraphTextOf(removed, PARAGRAPH)).toBe('link');
  });

  test('unlocked control allows hyperlink retarget and removal', () => {
    const part = load(linkedInside(''));
    const linkId = firstHyperlink(part);
    const retargeted = apply(part, {
      op: 'setHyperlinkTarget',
      linkId,
      relationshipId: 'rId7',
    });
    const removed = apply(retargeted, { op: 'removeHyperlink', linkId });
    expect(paragraphTextOf(removed, PARAGRAPH)).toBe('link');
  });

  test('contentLocked refuses insertPageField at the caret', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>xy</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(
      reject(part, { op: 'insertPageField', paragraphId: PARAGRAPH, offset: 1, field: 'PAGE' })
    ).toBe('locked');
  });

  test('bound refuses insertPageField at the caret', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:dataBinding w:xpath="/a" w:storeItemID="{G}"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>xy</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(
      reject(part, {
        op: 'insertPageField',
        paragraphId: PARAGRAPH,
        offset: 1,
        field: 'NUMPAGES',
      })
    ).toBe('bound');
  });

  test('temporary + sdtLocked refuses insertPageField', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:temporary/><w:lock w:val="sdtLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(
      reject(part, {
        op: 'insertPageField',
        paragraphId: PARAGRAPH,
        offset: 0,
        field: 'SECTIONPAGES',
      })
    ).toBe('locked');
  });

  test('unlocked control allows insertPageField', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const next = apply(part, {
      op: 'insertPageField',
      paragraphId: PARAGRAPH,
      offset: 0,
      field: 'PAGE',
    });
    expect(paragraphTextOf(next, PARAGRAPH).length).toBeGreaterThan(0);
  });

  test('insertPageField outside a locked control still succeeds', () => {
    const part = load(
      '<w:p><w:r><w:t>aa</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>LL</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>zz</w:t></w:r></w:p>'
    );
    const next = apply(part, {
      op: 'insertPageField',
      paragraphId: PARAGRAPH,
      offset: 0,
      field: 'PAGE_X_OF_Y',
    });
    expect(paragraphTextOf(next, PARAGRAPH).endsWith('aaLLzz')).toBe(true);
  });
});

describe('a control keeps its own lock past the enumeration bounds', () => {
  // The enclosing-control chain feeds lock resolution, and both bounds — nesting depth and
  // per-part control count — are attacker-reachable in a crafted file. The chain must
  // include the target control ITSELF either way, or its own `w:lock` silently vanishes.
  const lockedSdt = (inner: string): string =>
    `<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

  const controlsOf = (part: OoxmlPart): OoxmlNode[] => {
    const found: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'contentControl') found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return found;
  };

  test('a control nested past the depth bound still reports its own lock', () => {
    let body = lockedSdt('<w:p><w:r><w:t>deep</w:t></w:r></w:p>');
    for (let level = 0; level < 40; level += 1) body = lockedSdt(body);
    const part = load(body);
    // The innermost sdt sits deeper than MAX_CONTENT_CONTROL_NESTING, so the bounded
    // control enumeration cannot see it.
    const controls = controlsOf(part);
    const innermost = controls[controls.length - 1]!;
    const chain = enclosingContentControls(part, innermost.id);
    expect(chain[chain.length - 1]).toBe(innermost);
    expect(contentControlLockAt(part, innermost.id)).toBe('sdtContentLocked');
  });

  test('a control past the per-part count bound still reports its own lock', () => {
    const filler = Array.from(
      { length: MAX_CONTENT_CONTROLS_PER_PART },
      () => '<w:sdt><w:sdtPr/><w:sdtContent><w:p/></w:sdtContent></w:sdt>'
    ).join('');
    const part = load(filler + lockedSdt('<w:p><w:r><w:t>last</w:t></w:r></w:p>'));
    const controls = controlsOf(part);
    const last = controls[controls.length - 1]!;
    const chain = enclosingContentControls(part, last.id);
    expect(chain).toEqual([last]);
    expect(contentControlLockAt(part, last.id)).toBe('sdtContentLocked');
  });
});
