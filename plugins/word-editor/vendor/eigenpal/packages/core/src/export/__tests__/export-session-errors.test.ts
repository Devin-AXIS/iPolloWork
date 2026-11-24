import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createFixedMeasurer } from '../../layout/fixed-measurer.ts';
import { TablePaginationError } from '../../layout/semantic-table-layout.ts';
import { refusalYieldsHiddenFurniture } from '../../layout/furniture-drawing-exclusion.ts';
import { ExportResourceError, openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

test('does not inspect a host failure when no hidden furniture can yield', () => {
  let inspected = false;
  const hostile = new Proxy(new Error('host failure'), {
    getPrototypeOf() {
      inspected = true;
      throw new Error('prototype inspection');
    },
  });
  expect(refusalYieldsHiddenFurniture(hostile, {})).toBe(false);
  expect(inspected).toBe(false);
});

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test('normalizes fail-closed layout invariants at the shared exporter boundary', async () => {
  // Layout fails closed when authored geometry cannot fit its page model. The measurer raises
  // that invariant here, so the boundary is tested without depending on one document shape.
  const fallback = createFixedMeasurer();
  const source = docx('<w:p><w:r><w:t>Invariant</w:t></w:r></w:p>');
  const opened = openDocumentForExport(source, {
    measurer: {
      measure: () => {
        throw new TablePaginationError('table-row-overheight', 'Authored overheight row');
      },
      lineMetrics: (style) => fallback.lineMetrics(style),
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const error = await opened.session.layout().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'layoutInvariant' });
    expect((error as Error).cause).toMatchObject({
      name: 'TablePaginationError',
      code: 'table-row-overheight',
    });
  } finally {
    opened.session.dispose();
  }
});

test('classifies hostile host failures safely and permits a transient retry', async () => {
  const messageTrap = new Error('hidden');
  Object.defineProperty(messageTrap, 'message', {
    get: () => {
      throw new Error('message getter escaped');
    },
  });
  const prototypeTrap = new Proxy(new Error('hidden'), {
    getPrototypeOf: () => {
      throw new Error('prototype trap escaped');
    },
  });
  const failures: unknown[] = [messageTrap, prototypeTrap];
  const fallback = createFixedMeasurer();
  const opened = openDocumentForExport(docx('<w:p><w:r><w:t>Retry me</w:t></w:r></w:p>'), {
    measurer: {
      measure: (text, style) => {
        const failure = failures.shift();
        if (failure) throw failure;
        return fallback.measure(text, style);
      },
      lineMetrics: (style) => fallback.lineMetrics(style),
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    for (const cause of [messageTrap, prototypeTrap]) {
      const error = await opened.session.layout().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ExportResourceError);
      expect(error).toMatchObject({ code: 'layoutFailed', message: 'Export layout failed' });
      expect((error as Error).cause).toBe(cause);
      expect(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable).toBe(false);
    }
    await expect(opened.session.layout()).resolves.toMatchObject({ pages: [{ index: 0 }] });
  } finally {
    opened.session.dispose();
  }
});
