// The `lockedControlNavigation` prop reaches the editor from `DocxEditor.Root` and the
// `DocxEditor` sugar. The editor reads it once, at creation.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance, LockedControlNavigation } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
/** "aa" [2,7) "TOKEN" "zz": the content-locked control covers offsets 2..7. */
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('aa')}` +
      '<w:sdt><w:sdtPr><w:alias w:val="T"/><w:lock w:val="sdtContentLocked"/><w:text/></w:sdtPr>' +
      `<w:sdtContent>${run('TOKEN')}</w:sdtContent></w:sdt>` +
      `${run('zz')}</w:p></w:body></w:document>`
  ),
});

afterEach(cleanup);

/** Place the caret at offset 2, on the control's left edge, press ArrowRight, read the head. */
function stepRightFromLeftEdge(editor: DocxEditorInstance): number {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const point = { paragraphId, offset: 2 };
  act(() => {
    surface.setSelection({ anchor: point, head: point });
    surface.navigate('right');
  });
  return surface.state().selection.head.offset;
}

function captureWarnings(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(String(args[0]));
  };
  return { messages, restore: () => (console.warn = original) };
}

const navigationWarnings = (messages: readonly string[]) =>
  messages.filter((message) => message.includes('lockedControlNavigation changed')).length;

describe('lockedControlNavigation prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    for (const navigation of ['atomic', undefined] as const) {
      test(`${host} with ${navigation ?? 'the default'}`, async () => {
        let instance: DocxEditorInstance | null = null;
        const onReady = (editor: unknown) => {
          instance = editor as DocxEditorInstance;
        };
        const props = navigation ? { lockedControlNavigation: navigation } : {};
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
        expect(stepRightFromLeftEdge(instance!)).toBe(navigation === 'atomic' ? 7 : 3);
      });
    }
  }

  // The warning prints once per module, so the silent cases run before the warning case.
  test('a changed prop is ignored and warns once, only for a real change', async () => {
    const warnings = captureWarnings();
    try {
      let instance: DocxEditorInstance | null = null;
      const tree = (navigation: LockedControlNavigation | undefined) => (
        <DocxEditorRoot
          document={SOURCE}
          {...(navigation !== undefined ? { lockedControlNavigation: navigation } : {})}
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
        view = render(tree(undefined));
      });
      const first = instance!;

      for (const navigation of [undefined, 'characters', 'characters', undefined] as const) {
        await act(async () => {
          view!.rerender(tree(navigation));
        });
      }
      expect(navigationWarnings(warnings.messages)).toBe(0);

      await act(async () => {
        view!.rerender(tree('atomic'));
      });
      await act(async () => {
        view!.rerender(tree('characters'));
      });
      await act(async () => {
        view!.rerender(tree('atomic'));
      });
      expect(navigationWarnings(warnings.messages)).toBe(1);
      expect(instance).toBe(first);
      expect(stepRightFromLeftEdge(first)).toBe(3);
    } finally {
      warnings.restore();
    }
  });
});
