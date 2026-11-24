// The `fieldResults` prop reaches the editor from `DocxEditor.Root` and the `DocxEditor` sugar.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance, FieldResultsMode } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('ab ')}` +
      '<w:fldSimple w:instr=" MERGEFIELD Name "><w:r><w:t>Name</w:t></w:r></w:fldSimple>' +
      `${run(' cd')}</w:p></w:body></w:document>`
  ),
});

afterEach(cleanup);

/** Type at offset 5, inside the result in the editable mode, and read the paragraph back. */
function typeInsideResult(editor: DocxEditorInstance): string | null {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const point = { paragraphId, offset: 5 };
  surface.setSelection({ anchor: point, head: point });
  surface.type('X');
  return paragraphTextOf(surface.session.part(), paragraphId, { fieldResults: 'editable' });
}

describe('fieldResults prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    for (const mode of ['editable', undefined] as const) {
      test(`${host} with ${mode ?? 'the default'}`, async () => {
        let instance: DocxEditorInstance | null = null;
        const onReady = (editor: unknown) => {
          instance = editor as DocxEditorInstance;
        };
        const props = mode ? { fieldResults: mode as FieldResultsMode } : {};
        await act(async () => {
          render(
            host === 'root' ? (
              <DocxEditorRoot document={SOURCE} onReady={onReady} {...props}>
                <DocxEditorViewport>
                  <DocxEditorContent />
                </DocxEditorViewport>
              </DocxEditorRoot>
            ) : (
              <DocxEditor document={SOURCE} onReady={onReady} {...props} />
            )
          );
        });
        expect(typeInsideResult(instance!)).toBe(
          mode === 'editable' ? 'ab NaXme cd' : 'ab Name Xcd'
        );
      });
    }
  }

  test('a changed prop is ignored and warns once', async () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args[0]);
    try {
      let instance: DocxEditorInstance | null = null;
      const tree = (mode: FieldResultsMode) => (
        <DocxEditorRoot
          document={SOURCE}
          fieldResults={mode}
          onReady={(editor) => {
            instance = editor as DocxEditorInstance;
          }}
        >
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
      let view: ReturnType<typeof render> | null = null;
      await act(async () => {
        view = render(tree('atomic'));
      });
      const first = instance!;
      await act(async () => {
        view!.rerender(tree('editable'));
      });
      expect(instance).toBe(first);
      expect(typeInsideResult(first)).toBe('ab Name Xcd');
      expect(warnings.some((message) => String(message).includes('fieldResults changed'))).toBe(
        true
      );
    } finally {
      console.warn = original;
    }
  });
});
