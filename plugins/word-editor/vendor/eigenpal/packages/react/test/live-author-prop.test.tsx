import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { LocaleProvider } from '../src/i18n/LocaleContext.tsx';

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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>abcd</w:t></w:r></w:p></w:body></w:document>`
  ),
});

function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

afterEach(cleanup);

describe('DocxEditor.Root author prop', () => {
  test('applies a changed author without replacing the editor', async () => {
    let instance: DocxEditorInstance | null = null;
    const tree = (author: string) => (
      <DocxEditorRoot
        document={SOURCE}
        author={author}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(tree('Initial Author'));
    const firstInstance = instance!;

    await act(async () => {
      select(firstInstance, 0, 1);
      firstInstance.exec({ type: 'proposeReplacement', replaceWith: 'X' });
    });
    await act(async () => {
      view.rerender(tree('Updated Author'));
    });
    expect(instance).toBe(firstInstance);
    expect(firstInstance.getConfiguredAuthor()).toBe('Updated Author');

    await act(async () => {
      select(firstInstance, 1, 2);
      firstInstance.exec({ type: 'proposeReplacement', replaceWith: 'Y' });
      await firstInstance.save();
    });
    const xml = serializeOoxmlPart(firstInstance.surface!.session.part());
    expect(xml.match(/w:author="Initial Author"/g)).toHaveLength(2);
    expect(xml.match(/w:author="Updated Author"/g)).toHaveLength(2);
  });

  test('applies mode, translate, and locale changes without replacing the editor', async () => {
    let instance: DocxEditorInstance | null = null;
    const initialTranslate = (key: string) => `initial:${key}`;
    const updatedTranslate = (key: string) => `updated:${key}`;
    const tree = (mode: 'edit' | 'view', translate: (key: string) => string, locale: string) => (
      <DocxEditorRoot
        document={SOURCE}
        mode={mode}
        translate={translate}
        locale={locale}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(tree('edit', initialTranslate, 'en'));
    const firstInstance = instance!;
    let receivedTranslate: typeof updatedTranslate | undefined;
    let receivedLocale: string | undefined;
    const setTranslate = firstInstance.setTranslate.bind(firstInstance);
    const setLocale = firstInstance.setLocale.bind(firstInstance);
    firstInstance.setTranslate = (value) => {
      receivedTranslate = value as typeof updatedTranslate;
      setTranslate(value);
    };
    firstInstance.setLocale = (value) => {
      receivedLocale = value;
      setLocale(value);
    };

    await act(async () => {
      view.rerender(tree('view', updatedTranslate, 'de-DE'));
    });
    expect(instance).toBe(firstInstance);
    expect(firstInstance.getEditingMode()).toBe('viewing');
    expect(receivedTranslate?.('probe')).toBe('updated:probe');
    expect(receivedLocale).toBe('de-DE');
  });

  test('an unrelated rerender does not restore a host mode after a reader change', async () => {
    let instance: DocxEditorInstance | null = null;
    const tree = (marker: string) => (
      <DocxEditorRoot
        document={SOURCE}
        mode="edit"
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <span>{marker}</span>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(tree('first'));
    const firstInstance = instance!;
    await act(async () => {
      firstInstance.exec({ type: 'setEditingMode', mode: 'viewing' });
      view.rerender(tree('second'));
    });
    expect(instance).toBe(firstInstance);
    expect(firstInstance.getEditingMode()).toBe('viewing');
  });

  test('a locale catalog change updates translation without replacing the editor', async () => {
    let instance: DocxEditorInstance | null = null;
    const catalog = (label: string) => ({ image: { pendingResource: label } });
    const tree = (label: string) => (
      <LocaleProvider i18n={catalog(label)}>
        <DocxEditorRoot
          document={SOURCE}
          onReady={(editor) => {
            instance = editor as DocxEditorInstance;
          }}
        >
          <DocxEditorViewport>
            <DocxEditorContent />
          </DocxEditorViewport>
        </DocxEditorRoot>
      </LocaleProvider>
    );
    const view = render(tree('First loading label'));
    const firstInstance = instance!;
    let resolver: ((key: string) => string) | undefined;
    const setTranslate = firstInstance.setTranslate.bind(firstInstance);
    firstInstance.setTranslate = (value) => {
      resolver = value;
      setTranslate(value);
    };

    await act(async () => {
      view.rerender(tree('Second loading label'));
    });
    expect(instance).toBe(firstInstance);
    expect(resolver?.('image.pendingResource')).toBe('Second loading label');
  });

  test('a fresh equivalent inline translation does not publish a selection change', async () => {
    let instance: DocxEditorInstance | null = null;
    const tree = (marker: string) => (
      <DocxEditorRoot
        document={SOURCE}
        translate={(key) => `same:${key}`}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <span>{marker}</span>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const view = render(tree('first'));
    const firstInstance = instance!;
    let changes = 0;
    firstInstance.on('selectionChange', () => changes++);

    await act(async () => {
      view.rerender(tree('second'));
    });
    expect(instance).toBe(firstInstance);
    expect(changes).toBe(0);
  });
});
