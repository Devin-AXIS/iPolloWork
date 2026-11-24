import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import {
  createFixedMeasurer,
  prepareLayoutFontConfiguration,
  sha256FontBytes,
} from '../../layout/index.ts';
import type {
  ExportDroppedEmbeddedFont,
  ExportFontFaceResolution,
} from '../document-export-font-resolution.ts';
import {
  hasExportAdmittedFont,
  hasExportLaidOutText,
  hasFontBackedExportCapabilities,
  openFontBackedDocumentForExport,
  type FontBackedExportSession,
} from '../document-export-shaping.ts';
import { acquireSharedExportShaping, type SharedExportShaping } from '../shared-export-shaping.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const fontBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const fontHash = sha256FontBytes(fontBytes);

function assertAssignable<T>(_value: T): void {}

function unusedLayout(): Promise<never> {
  return Promise.reject(new Error('legacy mock does not layout'));
}

function legacyDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Compat</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

test('legacy SharedExportShaping mocks remain assignable without laid-out text', async () => {
  const mock = {
    createMeasurer: () => createFixedMeasurer(),
    producer: 'legacy-shared',
    extensionFingerprint: 'legacy',
  };
  assertAssignable<SharedExportShaping>(mock);
  expect(hasExportLaidOutText(mock)).toBe(false);

  const prepared = prepareLayoutFontConfiguration({
    epoch: 1,
    maxFontBytes: 2_000_000,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
        id: 'compat-dejavu',
        bytes: fontBytes,
        hash: fontHash,
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
  });
  const core = await acquireSharedExportShaping(prepared);
  assertAssignable<SharedExportShaping>(core);
  expect(hasExportLaidOutText(core)).toBe(true);
});

test('legacy FontBackedExportSession mocks remain assignable without new methods', async () => {
  const mock: FontBackedExportSession = {
    fontResolution: {
      requestedFamilies: [],
      defaultFamily: 'Calibri',
      families: [],
      originFailures: [],
    },
    layout: unusedLayout,
    layoutFor: unusedLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
  assertAssignable<FontBackedExportSession>(mock);
  expect(hasExportLaidOutText(mock)).toBe(false);
  expect(hasExportAdmittedFont(mock)).toBe(false);
  expect(hasFontBackedExportCapabilities(mock)).toBe(false);

  const opened = await openFontBackedDocumentForExport(legacyDocx(), {
    fonts: {
      sources: [
        {
          request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
          id: 'compat-session',
          bytes: fontBytes,
          hash: fontHash,
          faceIndex: 0,
        },
      ],
      defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  assertAssignable<FontBackedExportSession>(opened.session);
  expect(hasFontBackedExportCapabilities(opened.session)).toBe(true);
  expect(hasExportLaidOutText(opened.session)).toBe(true);
  expect(hasExportAdmittedFont(opened.session)).toBe(true);
  opened.session.dispose();
});

test('legacy ExportFontFaceResolution literals remain assignable', () => {
  const face: ExportFontFaceResolution = {
    weight: 400,
    style: 'normal',
    sourceFamily: 'Calibri',
    via: 'direct',
  };
  assertAssignable<ExportFontFaceResolution>(face);
  expect(face.identity).toBeUndefined();
  expect(face.id).toBeUndefined();
  expect(face.hash).toBeUndefined();
  expect(face.faceIndex).toBeUndefined();
  expect(face.substitution).toBeUndefined();
});

test('legacy ExportFontResolutionReport mocks omit droppedEmbeddedFonts', () => {
  const report = {
    requestedFamilies: [],
    defaultFamily: 'Calibri',
    families: [],
    originFailures: [],
  };
  assertAssignable<import('../document-export-font-resolution.ts').ExportFontResolutionReport>(
    report
  );
});

test('ExportDroppedEmbeddedFont literals remain assignable', () => {
  const drop: ExportDroppedEmbeddedFont = {
    request: { family: 'Broken Face', weight: 400, style: 'normal' },
    partName: '/word/fonts/font1.odttf',
    reason: 'overLimit',
  };
  assertAssignable<ExportDroppedEmbeddedFont>(drop);
});
