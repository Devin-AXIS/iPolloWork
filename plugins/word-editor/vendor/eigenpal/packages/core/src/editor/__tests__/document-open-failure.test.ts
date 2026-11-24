import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8 } from 'fflate';
import type { DocumentOpenDiagnosticCode } from '../../automation/diagnostic-vocabulary.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { createDocumentOpenFailureState, documentOpenFailure } from '../document-open-failure.ts';
import { createEditorDiagnostics } from '../editor-diagnostics.ts';
import { resolveEditorModules } from '../../contracts/modules.ts';

describe('snapshot().openFailure', () => {
  test('reads null before any document and after a document opens', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    expect(editor.snapshot().openFailure).toBeNull();
    editor.load(blankDocumentBytes());
    expect(editor.snapshot().openFailure).toBeNull();
  });

  test('reports a refused open as a stable code, never the engine text', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    editor.load(strToU8('not a zip'));
    const failure = editor.snapshot().openFailure;
    expect(failure).toEqual({ code: 'open.zip-corrupt', reason: 'damaged' });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(editor.snapshot().parseError).not.toBeNull();
  });

  test('a second refusal of the same bytes is a new object', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    const bytes = strToU8('not a zip');
    editor.load(bytes);
    const first = editor.snapshot().openFailure;
    editor.load(bytes);
    const second = editor.snapshot().openFailure;
    expect(second).toEqual(first!);
    expect(second).not.toBe(first);
  });

  test('stays reference-stable while nothing moves', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    editor.load(strToU8('not a zip'));
    expect(editor.snapshot().openFailure).toBe(editor.snapshot().openFailure);
  });

  test('a later open clears it', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    editor.load(strToU8('not a zip'));
    expect(editor.snapshot().openFailure).not.toBeNull();
    editor.load(blankDocumentBytes());
    expect(editor.snapshot().openFailure).toBeNull();
    expect(editor.snapshot().parseError).toBeNull();
  });

  test('a source that is not bytes reads as not a .docx document', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: 'Blank' as 'blank',
    });
    expect(editor.snapshot().openFailure).toEqual({
      code: 'open.unsupported-source',
      reason: 'not-docx',
    });
  });

  test('load() of a source that is not bytes reports it when nothing is mounted', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    editor.load('not-a-source' as 'blank');
    expect(editor.snapshot().openFailure).toEqual({
      code: 'open.unsupported-source',
      reason: 'not-docx',
    });
    expect(editor.snapshot().isLoading).toBe(false);
  });

  test('a refusal outside a mount emits, so event-driven hosts see it', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    let emitted = 0;
    editor.on('selectionChange', () => (emitted += 1));
    editor.load('not-a-source' as 'blank');
    expect(emitted).toBeGreaterThan(0);
  });

  test('load() of a source that is not bytes keeps a mounted document and no refusal', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: blankDocumentBytes(),
    });
    editor.on('error', () => {});
    editor.load('not-a-source' as 'blank');
    expect(editor.snapshot().openFailure).toBeNull();
    expect(editor.surface).not.toBeNull();
  });

  test('a new open clears the previous refusal before a large document is scheduled', () => {
    const editor = createDocxEditor({ container: document.createElement('div') });
    editor.on('error', () => {});
    editor.load(strToU8('not a zip'));
    expect(editor.snapshot().openFailure).not.toBeNull();
    // Large enough that the open yields a frame before it parses.
    editor.load(new Uint8Array(600 * 1024));
    expect(editor.snapshot().isOpening).toBe(true);
    expect(editor.snapshot().openFailure).toBeNull();
  });

  test('a crashed open reports open.failed and publishes it', () => {
    let published = 0;
    const state = createDocumentOpenFailureState(() => (published += 1));
    state.crash();
    expect(state.failure).toEqual({ code: 'open.failed', reason: 'unknown' });
    expect(state.parseError).not.toBeNull();
    expect(published).toBe(1);
  });

  test('diagnostics call onOpenCrash once for an open that throws in a later slice', () => {
    let crashes = 0;
    const diagnostics = createEditorDiagnostics({
      modules: resolveEditorModules([]),
      events: { emitDiagnostic: () => {}, on: () => () => {} },
      onOpenCrash: () => (crashes += 1),
    });
    // No open in flight: a font remount that throws is not a refused open.
    diagnostics.openCrashed(new Error('remount'));
    expect(crashes).toBe(0);
    diagnostics.openStarted(blankDocumentBytes());
    expect(() =>
      diagnostics.continueOpen(() => {
        throw new Error('layout');
      })
    ).toThrow('layout');
    expect(crashes).toBe(1);
  });

  test('every open code has a reason', () => {
    const codes: Record<DocumentOpenDiagnosticCode, string> = {
      'open.zip-corrupt': 'damaged',
      'open.zip-invalid-entry-name': 'damaged',
      'open.xml-malformed': 'damaged',
      'open.content-types-invalid': 'damaged',
      'open.relationships-invalid': 'damaged',
      'open.unsupported-source': 'not-docx',
      'open.missing-main-document': 'not-docx',
      'open.zip-entry-limit': 'too-large',
      'open.zip-size-limit': 'too-large',
      'open.zip-ratio-limit': 'too-large',
      'open.xml-part-size-limit': 'too-large',
      'open.xml-depth-limit': 'too-large',
      'open.xml-element-limit': 'too-large',
      'open.relationship-limit': 'too-large',
      'open.part-limit': 'too-large',
      'open.xml-dtd-forbidden': 'blocked',
      'open.invalid-limits': 'unknown',
      'open.failed': 'unknown',
    };
    for (const [code, reason] of Object.entries(codes)) {
      expect(documentOpenFailure(code as DocumentOpenDiagnosticCode).reason).toBe(reason as never);
    }
  });
});
