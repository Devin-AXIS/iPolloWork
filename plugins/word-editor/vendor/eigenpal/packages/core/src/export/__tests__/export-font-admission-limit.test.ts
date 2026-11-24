import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import type { FontSource } from '../../contracts/editor.ts';
import { composePreparedFontOrigins, defineFontResolver } from '../../layout/font-resolver.ts';
import { sha256FontBytes } from '../../layout/font-resource.ts';
import { EXPORT_HARFBUZZ_SHAPER_POLICY } from '../../layout/layout-shaper-policy.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const oversized = new Uint8Array(EXPORT_HARFBUZZ_SHAPER_POLICY.maxFontBytes + 1);
oversized.set(bytes);
const FAMILY = 'Bounded Face';
const SIBLING = 'Sibling Face';
const request = { families: [FAMILY, SIBLING], defaultFamily: FAMILY };
const faces = [
  { weight: 400, style: 'normal' as const },
  { weight: 700, style: 'normal' as const },
  { weight: 400, style: 'italic' as const },
  { weight: 700, style: 'italic' as const },
];
function source(family: string, id: string, data = bytes): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id,
    bytes: data,
    hash: sha256FontBytes(data),
    faceIndex: 0,
  };
}
function complete(family: string) {
  return faces.map((face) => ({
    ...source(family, `${family}:${face.weight}:${face.style}`),
    request: { family, ...face },
  }));
}
const early = {
  sources: [source(FAMILY, 'oversized', oversized), ...complete(SIBLING)],
  defaultFont: { family: FAMILY, sizeHalfPoints: 22 },
};
const fallback = { sources: complete(FAMILY) };

function documentBytes(text = 'Visible') {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="doc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        [FAMILY, SIBLING]
          .map(
            (family) =>
              `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
          )
          .join('') +
        '</w:body></w:document>'
    ),
  });
}

test('execution admission leaves an oversized face available to later origins and retains its siblings', async () => {
  let copies = 0;
  const failures: unknown[] = [];
  const later = defineFontResolver((next) => {
    expect(next.resolvedFaces?.some((face) => face.family === FAMILY)).toBe(false);
    expect(next.resolvedFaces?.filter((face) => face.family === SIBLING)).toHaveLength(4);
    return fallback;
  });
  const result = await composePreparedFontOrigins([early, later], request, {
    maxExecutionFontBytes: bytes.length,
    instrumentation: {
      onOwnedByteCopy: () => {
        copies += 1;
      },
    },
    onOriginFailure: ({ cause }) => failures.push(cause),
  });
  expect(result?.sources).toHaveLength(8);
  expect(result?.sources?.every((face) => face.bytes.length <= bytes.length)).toBe(true);
  expect(result?.sources?.some((face) => face.id === 'oversized')).toBe(false);
  expect(copies).toBe(8);
  expect(failures).toHaveLength(1);
  expect(String(failures[0])).toContain(`${oversized.length} bytes`);
});

test('execution admission preserves a stricter base ceiling', async () => {
  const result = await composePreparedFontOrigins(
    [{ ...fallback, maxFontBytes: bytes.length - 1 }],
    request,
    { maxExecutionFontBytes: bytes.length, onOriginFailure: () => {} }
  );
  expect(result).toBeUndefined();
});

test('font-backed export shapes visible text with a valid fallback after an oversized source', async () => {
  const opened = await openFontBackedDocumentForExport(documentBytes(), {
    fonts: [early, fallback],
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  const session = opened.session;
  try {
    expect(session.fontResolution.originFailures).toHaveLength(1);
    expect(session.fontResolution.families.every((family) => family.coverage === 'complete')).toBe(
      true
    );
    for (const family of [FAMILY, SIBLING]) {
      for (const face of faces) {
        const admitted = session.admittedFontFace({ family, ...face });
        expect(admitted).not.toBeNull();
        expect(admitted!.byteLength).toBeLessThanOrEqual(
          EXPORT_HARFBUZZ_SHAPER_POLICY.maxFontBytes
        );
        expect(admitted!.id).not.toBe('oversized');
      }
    }
    const layout = await session.layout();
    const spans = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
      .filter((span) => span.text === 'Visible');
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      const shaped = session.shapeLaidOutText(span);
      expect(shaped).not.toBeNull();
      expect(shaped!.run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    }
  } finally {
    session.dispose();
  }
});

test('strict font policy still refuses an oversized origin despite complete fallback coverage', async () => {
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [early, fallback],
      glyphFallbacks: [{ family: FAMILY, weight: 400, style: 'normal' }],
      fontPolicy: 'strict',
      onFontResolution: () => {},
    })
  ).rejects.toThrow('a font origin failed');
});

test('without a fallback, an oversized face is neither admitted nor reported as complete', async () => {
  const opened = await openFontBackedDocumentForExport(documentBytes(), {
    fonts: [early],
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    expect(
      opened.session.admittedFontFace({ family: FAMILY, weight: 400, style: 'normal' })
    ).toBeNull();
    expect(
      opened.session.fontResolution.families.find((family) => family.family === FAMILY)?.coverage
    ).not.toBe('complete');
    expect(opened.session.fontResolution.originFailures).toHaveLength(1);
  } finally {
    opened.session.dispose();
  }
});

const OPTIONAL = 'Optional Fallback';
const optionalRequest = { family: OPTIONAL, weight: 400, style: 'normal' as const };
const optionalOversized = source(OPTIONAL, 'optional-oversized', oversized);
const requiredFonts = {
  sources: [...complete(FAMILY), ...complete(SIBLING)],
  defaultFont: { family: FAMILY, sizeHalfPoints: 22 },
};

test('strict Latin export retains optional fallback diagnostics without refusing usable text', async () => {
  const opened = await openFontBackedDocumentForExport(documentBytes(), {
    fonts: [requiredFonts, { sources: [optionalOversized] }, { sources: complete(OPTIONAL) }],
    glyphFallbacks: [optionalRequest],
    fontPolicy: 'strict',
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    expect(opened.session.fontResolution.originFailures).toHaveLength(1);
    expect(opened.session.admittedFontFace(optionalRequest)?.id).not.toBe('optional-oversized');
    expect(opened.session.admittedFontFace(optionalRequest)).not.toBeNull();
    const layout = await opened.session.layout();
    const spans = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
      .filter((span) => span.text === 'Visible');
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      const shaped = opened.session.shapeLaidOutText(span);
      expect(shaped).not.toBeNull();
      expect(shaped!.run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    }
  } finally {
    opened.session.dispose();
  }
});

test('strict policy still refuses an oversized configured default listed as a glyph fallback', async () => {
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [
        {
          ...requiredFonts,
          defaultFont: { family: OPTIONAL, sizeHalfPoints: 22 },
          sources: [...requiredFonts.sources, optionalOversized],
        },
        { sources: complete(OPTIONAL) },
      ],
      glyphFallbacks: [optionalRequest],
      fontPolicy: 'strict',
      onFontResolution: () => {},
    })
  ).rejects.toThrow('a font origin failed');
});

test('strict policy preserves explicit byte limits for optional fallback sources', async () => {
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [{ ...requiredFonts, maxFontBytes: bytes.length }, { sources: [optionalOversized] }],
      glyphFallbacks: [optionalRequest],
      fontPolicy: 'strict',
      onFontResolution: () => {},
    })
  ).rejects.toThrow('a font origin failed');
});

test('duplicate oversized faces cannot invalidate an earlier winning face', async () => {
  const failures: unknown[] = [];
  const result = await composePreparedFontOrigins([requiredFonts, early], request, {
    maxExecutionFontBytes: bytes.length,
    onOriginFailure: (failure) => failures.push(failure),
  });
  expect(result?.sources).toHaveLength(8);
  expect(result?.sources?.some((face) => face.id === 'oversized')).toBe(false);
  expect(failures).toEqual([]);
});

test('later optional fallback supplies missing glyphs after an execution-limit rejection', async () => {
  const fallbackBytes = new Uint8Array(
    readFileSync(
      new URL('../../../../docx-to-pdf/test/fixtures/Devanagari.subset.ttf', import.meta.url)
    )
  );
  const opened = await openFontBackedDocumentForExport(documentBytes('नमस्ते'), {
    fonts: [
      requiredFonts,
      { sources: [optionalOversized] },
      { sources: [source(OPTIONAL, 'usable-devanagari', fallbackBytes)] },
    ],
    glyphFallbacks: [optionalRequest],
    fontPolicy: 'strict',
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    expect(opened.session.admittedFontFace(optionalRequest)?.id).toBe('usable-devanagari');
    expect(opened.session.fontResolution.originFailures).toHaveLength(1);
    const layout = await opened.session.layout();
    const spans = layout.pages
      .flatMap((page) => page.fragments)
      .flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
      )
      .filter((span) => span.text === 'नमस्ते');
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      const shaped = opened.session.shapeLaidOutText(span);
      expect(shaped).not.toBeNull();
      expect(shaped!.run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    }
  } finally {
    opened.session.dispose();
  }
});

test('strict policy checks required failures after an optional failure in an all-dropped origin', async () => {
  let cause: unknown;
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [
        { sources: [optionalOversized, source(FAMILY, 'required-oversized', oversized)] },
        requiredFonts,
      ],
      glyphFallbacks: [optionalRequest],
      fontPolicy: 'strict',
      onFontResolution: (report) => {
        cause = report.originFailures[0]?.cause;
      },
    })
  ).rejects.toThrow('a font origin failed');
  expect(cause).toBeInstanceOf(AggregateError);
  expect((cause as AggregateError).errors).toHaveLength(2);
});

test('strict policy checks malformed failures after an optional failure in an all-dropped origin', async () => {
  let cause: unknown;
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [
        {
          sources: [optionalOversized, { ...source('Malformed Face', 'malformed'), faceIndex: -1 }],
        },
        requiredFonts,
      ],
      glyphFallbacks: [optionalRequest],
      fontPolicy: 'strict',
      onFontResolution: (report) => {
        cause = report.originFailures[0]?.cause;
      },
    })
  ).rejects.toThrow('a font origin failed');
  expect(cause).toBeInstanceOf(AggregateError);
  expect((cause as AggregateError).errors).toHaveLength(2);
});

test('strict policy permits an all-dropped origin containing only optional execution failures', async () => {
  const second = { ...optionalOversized, request: { ...optionalRequest, weight: 700 } };
  const opened = await openFontBackedDocumentForExport(documentBytes(), {
    fonts: [{ sources: [optionalOversized, second] }, requiredFonts],
    glyphFallbacks: [optionalRequest],
    fontPolicy: 'strict',
    onFontResolution: () => {},
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const cause = opened.session.fontResolution.originFailures[0]?.cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors).toHaveLength(2);
    expect(
      opened.session.fontResolution.families.every((family) => family.coverage === 'complete')
    ).toBe(true);
    expect(opened.session.admittedFontFace(optionalRequest)).toBeNull();
  } finally {
    opened.session.dispose();
  }
});

test('strict policy retains explicit resolver failures when all optional candidates drop', async () => {
  const partialFailure = new Error('Required font read failed');
  const rejectedOrigin = { sources: [optionalOversized], failures: [partialFailure] };
  let causes: readonly unknown[] = [];
  await expect(
    openFontBackedDocumentForExport(documentBytes(), {
      fonts: [rejectedOrigin, requiredFonts],
      glyphFallbacks: [optionalRequest],
      fontPolicy: 'strict',
      onFontResolution: (report) => {
        causes = report.originFailures.map((failure) => failure.cause);
      },
    })
  ).rejects.toThrow('a font origin failed');
  expect(causes).toHaveLength(2);
  expect(causes).toContain(partialFailure);
});
