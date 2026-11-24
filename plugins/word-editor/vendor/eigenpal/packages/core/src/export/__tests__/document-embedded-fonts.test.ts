import { expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import {
  composeFontOrigins,
  defineFontResolver,
  type FontOriginCompositionRequest,
  type MarkedFontResolver,
} from '../../layout/font-resolver.ts';
import { HARD_MAX_AGGREGATE_FONT_BYTES } from '../../layout/font-resource.ts';
import * as fontResource from '../../layout/font-resource.ts';
import { deobfuscateFont } from '../../store/package/embedded-fonts.ts';
import { openHeadlessDocument } from '../../store/headless-document-view.ts';
import {
  documentEmbeddedFontOrigin,
  type DocumentEmbeddedFontDiagnostics,
} from '../document-embedded-fonts.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const GUID = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';

const fontBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

function docxWithTwoEmbeds(): Uint8Array {
  const obfuscated = deobfuscateFont(fontBytes, GUID)!;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${FT}" Target="fontTable.xml"/></Relationships>`
    ),
    'word/_rels/fontTable.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFont1" Type="${FONT_REL}" Target="fonts/font1.odttf"/>` +
        `<Relationship Id="rIdFont2" Type="${FONT_REL}" Target="fonts/font2.odttf"/>` +
        '</Relationships>'
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}" xmlns:r="${R}">` +
        `<w:font w:name="Body Face"><w:embedRegular r:id="rIdFont1" w:fontKey="{${GUID}}"/></w:font>` +
        `<w:font w:name="Other Face"><w:embedRegular r:id="rIdFont2" w:fontKey="{${GUID}}"/></w:font>` +
        '</w:fonts>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Body Face"/></w:rPr><w:t>Body</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
    'word/fonts/font1.odttf': obfuscated,
    'word/fonts/font2.odttf': obfuscated,
  });
}

function openEmbeddedOrigin(): {
  readonly origin: MarkedFontResolver;
  readonly diagnostics: DocumentEmbeddedFontDiagnostics;
} {
  const opened = openHeadlessDocument(docxWithTwoEmbeds());
  if (!opened.ok) throw new Error(opened.reason);
  const diagnostics: DocumentEmbeddedFontDiagnostics = { dropped: [] };
  const origin = documentEmbeddedFontOrigin(opened.view, diagnostics);
  if (typeof origin !== 'function') throw new Error('expected a document-embedded origin');
  return { origin, diagnostics };
}

const REQUEST: FontOriginCompositionRequest = {
  families: ['Body Face', 'Other Face'],
  defaultFamily: 'Calibri',
};

function originRequest(
  extra: Partial<FontOriginCompositionRequest> = {}
): FontOriginCompositionRequest {
  return { ...REQUEST, ...extra };
}

test('a public request without committedSourceBytes still admits remaining faces', async () => {
  const { origin, diagnostics } = openEmbeddedOrigin();
  const hash = spyOn(fontResource, 'sha256FontBytes');
  try {
    const answer = await origin(REQUEST);
    expect(answer?.sources).toHaveLength(2);
    expect(diagnostics.dropped).toEqual([]);
    expect(hash).toHaveBeenCalledTimes(2);
  } finally {
    hash.mockRestore();
  }
});

test('over-budget faces drop as droppedEmbeddedFonts without hashing', async () => {
  const { origin, diagnostics } = openEmbeddedOrigin();
  const hash = spyOn(fontResource, 'sha256FontBytes');
  try {
    const answer = await origin(
      originRequest({ committedSourceBytes: HARD_MAX_AGGREGATE_FONT_BYTES })
    );
    expect(answer?.sources).toEqual([]);
    expect(diagnostics.dropped).toEqual([
      {
        request: { family: 'Body Face', weight: 400, style: 'normal' },
        partName: '/word/fonts/font1.odttf',
        reason: 'overLimit',
      },
      {
        request: { family: 'Other Face', weight: 400, style: 'normal' },
        partName: '/word/fonts/font2.odttf',
        reason: 'overLimit',
      },
    ]);
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});

test('remaining budget after earlier origins admits the first face and drops the rest', async () => {
  const { origin, diagnostics } = openEmbeddedOrigin();
  const hash = spyOn(fontResource, 'sha256FontBytes');
  try {
    const answer = await origin(
      originRequest({
        committedSourceBytes: HARD_MAX_AGGREGATE_FONT_BYTES - fontBytes.byteLength,
      })
    );
    expect(answer?.sources?.map((source) => source.id)).toEqual([
      'embedded:/word/fonts/font1.odttf#regular',
    ]);
    expect(diagnostics.dropped).toEqual([
      {
        request: { family: 'Other Face', weight: 400, style: 'normal' },
        partName: '/word/fonts/font2.odttf',
        reason: 'overLimit',
      },
    ]);
    expect(hash).toHaveBeenCalledTimes(1);
  } finally {
    hash.mockRestore();
  }
});

test('first-wins coverage still skips a shadowed face before budget or hashing', async () => {
  const { origin, diagnostics } = openEmbeddedOrigin();
  const hash = spyOn(fontResource, 'sha256FontBytes');
  try {
    const answer = await origin(
      originRequest({
        resolvedFaces: [{ family: 'Body Face', weight: 400, style: 'normal' }],
        committedSourceBytes: HARD_MAX_AGGREGATE_FONT_BYTES,
      })
    );
    expect(answer?.sources).toEqual([]);
    expect(diagnostics.dropped).toEqual([
      {
        request: { family: 'Other Face', weight: 400, style: 'normal' },
        partName: '/word/fonts/font2.odttf',
        reason: 'overLimit',
      },
    ]);
    expect(hash).not.toHaveBeenCalled();
  } finally {
    hash.mockRestore();
  }
});

test('composeFontOrigins feeds committed bytes into the document-embedded origin', async () => {
  const { origin, diagnostics } = openEmbeddedOrigin();
  const seen: FontOriginCompositionRequest[] = [];
  const probe = defineFontResolver((request: FontOriginCompositionRequest) => {
    seen.push(request);
    return origin(request);
  });
  const merged = await composeFontOrigins(
    [
      {
        sources: [
          {
            request: { family: 'Georgia', weight: 400, style: 'normal' as const },
            id: 'explicit-georgia',
            bytes: new Uint8Array([1, 2, 3, 4, 5]),
            hash: 'sha256:explicit',
            faceIndex: 0,
          },
        ],
      },
      probe,
    ],
    REQUEST
  );

  expect(seen[0]!.committedSourceBytes).toBe(5);
  expect(merged?.sources?.map((source) => source.id)).toEqual([
    'explicit-georgia',
    'embedded:/word/fonts/font1.odttf#regular',
    'embedded:/word/fonts/font2.odttf#regular',
  ]);
  expect(diagnostics.dropped).toEqual([]);
});
