// The `contentLockPolicy` prop reaches the editor from `DocxEditor.Root` and the `DocxEditor`
// sugar, and a later change is compared by value before it warns.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { ContentLockPolicy, DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>ABC</w:t></w:r>` +
      '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt>' +
      '<w:r><w:t>DEF</w:t></w:r></w:p></w:body></w:document>'
  ),
});

const POLICY: ContentLockPolicy = { allowFormattingInLockedContent: true };

afterEach(cleanup);

/** Select everything, including the locked control, and toggle bold. */
function boldOverLockedControl(editor: DocxEditorInstance): boolean {
  editor.surface!.selectAll();
  const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
  return result.ok && 'changed' in result && result.changed === true;
}

function rootTree(policy: ContentLockPolicy | undefined, onReady: (editor: unknown) => void) {
  return (
    <DocxEditorRoot
      document={SOURCE}
      onReady={onReady}
      {...(policy ? { contentLockPolicy: policy } : {})}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

describe('contentLockPolicy prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    for (const policy of [POLICY, undefined] as const) {
      test(`${host} ${policy ? 'with' : 'without'} the policy`, async () => {
        let instance: DocxEditorInstance | null = null;
        const onReady = (editor: unknown) => {
          instance = editor as DocxEditorInstance;
        };
        await act(async () => {
          render(
            host === 'root' ? (
              rootTree(policy, onReady)
            ) : (
              <DocxEditor
                document={SOURCE}
                onReady={onReady}
                {...(policy ? { contentLockPolicy: policy } : {})}
              />
            )
          );
        });
        expect(boldOverLockedControl(instance!)).toBe(policy !== undefined);
        expect(instance!.surface!.session.bodyText()).toBe('ABCTOKENDEF');
      });
    }
  }

  test('an equal new object does not warn; a changed value is ignored and warns once', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
    const policyWarnings = () =>
      warnings.filter((message) => message.includes('contentLockPolicy changed'));
    try {
      let instance: DocxEditorInstance | null = null;
      const onReady = (editor: unknown) => {
        instance = editor as DocxEditorInstance;
      };
      let view: ReturnType<typeof render> | null = null;
      await act(async () => {
        view = render(rootTree({ allowFormattingInLockedContent: true }, onReady));
      });
      const first = instance!;
      await act(async () => {
        view!.rerender(rootTree({ allowFormattingInLockedContent: true }, onReady));
      });
      expect(policyWarnings()).toHaveLength(0);

      await act(async () => {
        view!.rerender(rootTree({ allowFormattingInLockedContent: false }, onReady));
      });
      await act(async () => {
        view!.rerender(rootTree(undefined, onReady));
      });
      expect(instance).toBe(first);
      expect(policyWarnings()).toHaveLength(1);
      expect(boldOverLockedControl(first)).toBe(true);
    } finally {
      console.warn = original;
    }
  });
});
