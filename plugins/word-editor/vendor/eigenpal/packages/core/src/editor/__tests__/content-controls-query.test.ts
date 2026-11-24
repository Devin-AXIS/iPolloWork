// Content-control query derivation — `contentControls` and `contentControlAt`.
//
// Generic `w:sdt` nodes stand in for typed `contentControl` until the canonical model
// lands; unit tests also cover typed-shaped mock nodes directly.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { contentControlSummaryOf, inlineContentControlsAt } from '../content-controls.ts';
import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  paragraphOffsetIndex,
} from '../../store/store/tree-op-segments.ts';

const W = WML_NAMESPACE_URI;
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const pMixed = (content: string) => `<w:p>${content}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const sdt = (sdtPr: string, content: string) =>
  `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const inlineSdt = (sdtPr: string, content: string) => sdt(sdtPr, content);

function mount(body: string) {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function caretAt(
  surface: NonNullable<ReturnType<typeof createDocxEditor>['surface']>,
  offset: number,
  paragraphIndex = 0
) {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

describe('contentControls query', () => {
  test('enumerates controls with alias, tag, type, and locked state', () => {
    const body =
      p('before') +
      sdt(
        `<w:alias w:val="Status"/><w:tag w:val="status"/><w:dropDownList w:lastValue="1">` +
          `<w:listItem w:displayText="Draft" w:value="1"/></w:dropDownList>`,
        p('Draft')
      ) +
      sdt(
        `<w:alias w:val="Agree"/><w:tag w:val="agree"/><w:lock w:val="sdtContentLocked"/>` +
          `<w14:checkbox><w14:checked w14:val="0"/></w14:checkbox>`,
        p('☐')
      ) +
      sdt(`<w:alias w:val="Title"/>`, p('plain'));
    const editor = mount(body);

    const all = editor.query({ type: 'contentControls' });
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      alias: 'Status',
      tag: 'status',
      controlType: 'dropdown',
    });
    expect(all[1]).toMatchObject({
      alias: 'Agree',
      tag: 'agree',
      controlType: 'checkbox',
      locked: true,
    });
    expect(all[2]).toMatchObject({
      alias: 'Title',
      controlType: 'richText',
    });
    expect(all[2]?.locked).toBeUndefined();

    expect(editor.query({ type: 'contentControls', filter: { tag: 'status' } })).toHaveLength(1);
    expect(
      editor.query({ type: 'contentControls', filter: { controlType: 'checkbox' } })
    ).toHaveLength(1);
    expect(editor.query({ type: 'contentControls', filter: { alias: 'Missing' } })).toHaveLength(0);
  });

  test('contentControlAt returns the innermost matching block ancestor', () => {
    const body = sdt(
      `<w:alias w:val="outer"/><w:tag w:val="outer-tag"/>`,
      sdt(`<w:alias w:val="inner"/><w:tag w:val="inner-tag"/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
      tag: 'inner-tag',
    });
    expect(editor.query({ type: 'contentControlAt', filter: { tag: 'outer-tag' } })).toMatchObject({
      alias: 'outer',
    });
    expect(editor.query({ type: 'contentControlAt', filter: { tag: 'missing' } })).toBeNull();
  });

  test('nested summaries report effective inherited content locks', () => {
    const body = sdt(
      `<w:alias w:val="outer"/><w:tag w:val="outer-tag"/><w:lock w:val="contentLocked"/>`,
      sdt(`<w:alias w:val="inner"/><w:tag w:val="inner-tag"/><w:text/>`, p('nested'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const all = editor.query({ type: 'contentControls' });
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ alias: 'outer', locked: true });
    // Inner declares no lock, but the nested union still forbids content edits.
    expect(all[1]).toMatchObject({ alias: 'inner', locked: true });

    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'inner',
      locked: true,
    });
  });

  test('sdtLocked ancestor does not mark nested content as locked', () => {
    const body = sdt(
      `<w:alias w:val="outer"/><w:lock w:val="sdtLocked"/>`,
      sdt(`<w:alias w:val="inner"/><w:text/>`, p('editable'))
    );
    const editor = mount(body);
    caretAt(editor.surface!, 0);

    const inner = editor.query({ type: 'contentControlAt' });
    expect(inner).toMatchObject({ alias: 'inner' });
    expect(inner?.locked).toBeUndefined();

    const outer = editor.query({ type: 'contentControls' }).find((c) => c.alias === 'outer');
    expect(outer?.locked).toBeUndefined();
  });

  test('contentControlAt is null outside any block control', () => {
    const editor = mount(p('plain'));
    caretAt(editor.surface!, 0);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
  });

  test('sdtLocked does not mark content as locked', () => {
    const editor = mount(
      sdt(`<w:alias w:val="Shell"/><w:lock w:val="sdtLocked"/><w:richText/>`, p('editable'))
    );
    caretAt(editor.surface!, 0);
    const summary = editor.query({ type: 'contentControlAt' });
    expect(summary?.locked).toBeUndefined();
  });

  test('contentControlAt resolves a mid-paragraph inline control by UTF-16 offset', () => {
    const body = pMixed(
      run('Name: ') +
        inlineSdt(`<w:alias w:val="Name"/><w:tag w:val="name-tag"/>`, run('Ada')) +
        run('!')
    );
    const editor = mount(body);
    const surface = editor.surface!;

    caretAt(surface, 2);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();

    caretAt(surface, 6);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({
      alias: 'Name',
      tag: 'name-tag',
    });

    caretAt(surface, 9);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();
  });

  test('nested inline controls use half-open affinity: inner yields at its exclusive end', () => {
    const body = pMixed(
      run('a') +
        inlineSdt(
          `<w:alias w:val="outer"/><w:tag w:val="outer-tag"/>`,
          run('b') +
            inlineSdt(`<w:alias w:val="inner"/><w:tag w:val="inner-tag"/>`, run('c')) +
            run('d')
        ) +
        run('e')
    );
    const editor = mount(body);
    const surface = editor.surface!;

    caretAt(surface, 1);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'outer-tag' });

    caretAt(surface, 2);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'inner-tag' });

    caretAt(surface, 3);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'outer-tag' });

    caretAt(surface, 4);
    expect(editor.query({ type: 'contentControlAt' })).toBeNull();

    caretAt(surface, 2);
    expect(editor.query({ type: 'contentControlAt', filter: { tag: 'outer-tag' } })).toMatchObject({
      tag: 'outer-tag',
    });
    expect(editor.query({ type: 'contentControlAt', filter: { tag: 'inner-tag' } })).toMatchObject({
      tag: 'inner-tag',
    });
  });

  test('inline control wins over a block wrapper at the same offset', () => {
    const body = sdt(
      `<w:alias w:val="Block"/><w:tag w:val="block-tag"/>`,
      pMixed(
        run('before ') +
          inlineSdt(`<w:alias w:val="Inline"/><w:tag w:val="inline-tag"/>`, run('mid')) +
          run(' after')
      )
    );
    const editor = mount(body);
    const surface = editor.surface!;

    caretAt(surface, 7);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'inline-tag' });

    caretAt(surface, 3);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'block-tag' });

    caretAt(surface, 11);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'block-tag' });
  });

  test('foreign-namespace sdt is not enumerated as a Word control', () => {
    const X = 'http://example.com/foreign';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:x="${X}"><w:body>` +
          p('before') +
          `<x:sdt><x:sdtPr><x:alias x:val="Nope"/></x:sdtPr>` +
          `<x:sdtContent>${p('foreign')}</x:sdtContent></x:sdt>` +
          sdt(`<w:alias w:val="Real"/><w:tag w:val="real"/><w:text/>`, p('word')) +
          p('after') +
          `</w:body></w:document>`
      ),
    });
    const container = document.createElement('div');
    const editor = createDocxEditor({ container, document: bytes });
    if (!editor.surface) throw new Error('surface failed to mount');

    const all = editor.query({ type: 'contentControls' });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ alias: 'Real', tag: 'real' });
    expect(all.some((c) => c.alias === 'Nope')).toBe(false);
  });
});

describe('contentControlSummaryOf (typed-shaped nodes)', () => {
  const wmlVal = (value: string) =>
    ({
      kind: 'wmlVal',
      namespaceUri: W,
      localName: 'val',
      value,
    }) as const;

  let nextId = 0;
  const element = (
    kind: string,
    localName: string,
    children: OoxmlNode[] = [],
    attributes: OoxmlNode[] = []
  ): OoxmlElement =>
    ({
      id: `/mock#${nextId++}`,
      kind,
      namespaceUri: W,
      localName,
      namespaceBindings: [],
      attributes,
      children,
    }) as unknown as OoxmlElement;

  const runElement = (text: string): OoxmlElement =>
    ({
      id: `/mock#${nextId++}`,
      kind: 'run',
      namespaceUri: W,
      localName: 'r',
      namespaceBindings: [],
      attributes: [],
      children: [
        {
          id: `/mock#${nextId++}`,
          kind: 'text',
          namespaceUri: W,
          localName: 't',
          namespaceBindings: [],
          attributes: [],
          children: [
            {
              id: `/mock#${nextId++}`,
              kind: 'textValue',
              value: text,
            },
          ],
        },
      ],
    }) as OoxmlElement;

  test('inline affinity lists deepest control first at a shared nested offset', () => {
    const paragraph = element('paragraph', 'p', [
      runElement('a'),
      element('contentControl', 'sdt', [
        element('contentControlProperties', 'sdtPr', [
          element('alias', 'alias', [], [wmlVal('outer')]),
          element('tag', 'tag', [], [wmlVal('outer-tag')]),
        ]),
        element('contentControlContent', 'sdtContent', [
          runElement('b'),
          element('contentControl', 'sdt', [
            element('contentControlProperties', 'sdtPr', [
              element('alias', 'alias', [], [wmlVal('inner')]),
              element('tag', 'tag', [], [wmlVal('inner-tag')]),
            ]),
            element('contentControlContent', 'sdtContent', [runElement('c')]),
          ]),
          runElement('d'),
        ]),
      ]),
      runElement('e'),
    ]);

    expect(inlineContentControlsAt(paragraph, 2).map((summary) => summary.tag)).toEqual([
      'inner-tag',
      'outer-tag',
    ]);
    expect(inlineContentControlsAt(paragraph, 3).map((summary) => summary.tag)).toEqual([
      'outer-tag',
    ]);
    expect(inlineContentControlsAt(paragraph, 4)).toEqual([]);
  });

  test('a capped control contributes no offset before a visible control', () => {
    const control = (tag: string, text: string): OoxmlElement =>
      element('contentControl', 'sdt', [
        element('contentControlProperties', 'sdtPr', [element('tag', 'tag', [], [wmlVal(tag)])]),
        element('contentControlContent', 'sdtContent', [runElement(text)]),
      ]);
    let capped: OoxmlElement = control('capped', 'hidden');
    for (let depth = 0; depth < MAX_INLINE_CONTAINER_DEPTH; depth += 1) {
      capped = element('generic', 'smartTag', [capped]);
    }
    const visible = control('visible', 'shown');
    const paragraph = element('paragraph', 'p', [capped, visible]);
    const span = paragraphOffsetIndex(paragraph as never).spanOf(visible);

    expect(span).toEqual({ start: 0, end: 5 });
    expect(inlineContentControlsAt(paragraph, span!.start).map((summary) => summary.tag)).toEqual([
      'visible',
    ]);

    let cappedXml = inlineSdt('<w:tag w:val="capped"/>', run('hidden'));
    for (let depth = 0; depth < MAX_INLINE_CONTAINER_DEPTH; depth += 1) {
      cappedXml = `<w:smartTag>${cappedXml}</w:smartTag>`;
    }
    const editor = mount(pMixed(cappedXml + inlineSdt('<w:tag w:val="visible"/>', run('shown'))));
    caretAt(editor.surface!, span!.start);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'visible' });
  });

  test('contentControlAt ignores a misplaced wrapper inside a run', () => {
    const editor = mount(
      pMixed(
        '<w:r><w:t>A</w:t><w:smartTag><w:r><w:t>hidden</w:t></w:r></w:smartTag>' +
          '<w:t>B</w:t></w:r>' +
          inlineSdt('<w:tag w:val="visible"/>', run('shown'))
      )
    );
    caretAt(editor.surface!, 2);
    expect(editor.query({ type: 'contentControlAt' })).toMatchObject({ tag: 'visible' });
  });

  test('maps typed contentControlProperties to summary fields', () => {
    const control = element('contentControl', 'sdt', [
      element('contentControlProperties', 'sdtPr', [
        element('alias', 'alias', [], [wmlVal('Customer')]),
        element('tag', 'tag', [], [wmlVal('customer')]),
        element('lock', 'lock', [], [wmlVal('contentLocked')]),
        element('contentControlDate', 'date'),
      ]),
      element('contentControlContent', 'sdtContent', [element('paragraph', 'p')]),
    ]);

    expect(contentControlSummaryOf(control)).toEqual({
      id: control.id,
      alias: 'Customer',
      tag: 'customer',
      controlType: 'date',
      locked: true,
    });
  });
});
