// The security contract of paint-side registration (issue #78).
//
// `FontFaceSet` is per-DOCUMENT, so a face registered under a family name hides the
// installed font of that name for the whole page. Family names in a DOCX are
// attacker-controlled, so the ONE property that matters here is: a document-declared
// family never reaches the browser's font registry. Everything else (which faces
// register, what the painter is told, disposal) exists to make that safe AND useful.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { FontSource } from '../../contracts/editor.ts';
import {
  registerEmbeddedFontFaces,
  type FontFaceLike,
  type FontFaceSetLike,
} from '../embedded-font-faces.ts';

const fontFixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../../layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );
const regularFace = fontFixture('DejaVuSans.ttf');
const boldFace = fontFixture('DejaVuSans-Bold.ttf');

/** A face in a bold slot holds a bold face unless `bytes` says otherwise. */
function source(
  family: string,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
  hash = `sha256:${family}-${weight}-${style}`,
  bytes = weight >= 600 ? boldFace : new Uint8Array([1, 2, 3])
): FontSource {
  return {
    request: { family, weight, style },
    id: `${family}#${weight}#${style}`,
    bytes,
    hash,
    faceIndex: 0,
  };
}

class FakeFace implements FontFaceLike {
  constructor(
    readonly family: string,
    readonly bytes: Uint8Array,
    readonly descriptors: { readonly weight: string; readonly style: string },
    private readonly fail: boolean
  ) {}
  load(): Promise<unknown> {
    return this.fail ? Promise.reject(new Error('parse failure')) : Promise.resolve(this);
  }
}

/**
 * `failWhenFamilyMatches` is tested against the family the module actually passes to
 * `FontFace`, which is the ALIAS — the caller never sees a declared name here, which is
 * the whole point of the design.
 */
function fakeEnvironment(options: { failWhenFamilyMatches?: string } = {}) {
  const added: FakeFace[] = [];
  const deleted: FakeFace[] = [];
  const created: FakeFace[] = [];
  const fontSet: FontFaceSetLike = {
    add: (face) => added.push(face as FakeFace),
    delete: (face) => {
      deleted.push(face as FakeFace);
      return true;
    },
  };
  return {
    added,
    deleted,
    created,
    environment: {
      fontSet,
      createFontFace: (family: string, bytes: Uint8Array, descriptors: never) => {
        const shouldFail =
          options.failWhenFamilyMatches !== undefined &&
          family.includes(options.failWhenFamilyMatches);
        const face = new FakeFace(family, bytes, descriptors, shouldFail);
        created.push(face);
        return face;
      },
    },
  };
}

describe('registerEmbeddedFontFaces', () => {
  test('reads each face once, and keeps the source rather than a copy of its bytes', async () => {
    const env = fakeEnvironment();
    let reads = 0;
    const lazy: FontSource = {
      ...source('Lazy'),
      // A source that hands out a fresh copy per read, as the editor's validated fonts do.
      get bytes() {
        reads += 1;
        return new Uint8Array([1, 2, 3]);
      },
    };
    const registration = await registerEmbeddedFontFaces([lazy], env.environment);
    expect(registration.installed).toBe(1);
    expect(reads).toBe(1);
  });

  test('a document-declared family NEVER reaches the FontFaceSet', async () => {
    const env = fakeEnvironment();
    const hostile = ['Segoe UI', 'Roboto', 'Material Symbols Outlined', 'Arial'];
    const registration = await registerEmbeddedFontFaces(
      hostile.map((family) => source(family)),
      env.environment
    );
    expect(registration.installed).toBe(4);
    for (const family of hostile) {
      expect(env.added.some((face) => face.family === family)).toBe(false);
      expect(env.added.some((face) => face.family.includes(family))).toBe(false);
    }
    // Every registered family is an engine-minted alias.
    for (const face of env.added) expect(face.family).toMatch(/^docx-embedded-[a-z0-9]+$/);
  });

  test('the painter is told the alias for a declared family, and nothing else', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(
      [source('Segoe UI'), source('Segoe UI', 700)],
      env.environment
    );
    const alias = registration.alias('Segoe UI');
    expect(alias).toMatch(/^docx-embedded-/);
    // Both faces of the family share one alias; CSS picks weight through the descriptors.
    expect(new Set(env.added.map((face) => face.family)).size).toBe(1);
    expect(env.added.map((face) => face.descriptors.weight).sort()).toEqual(['400', '700']);
    // A family the document did not embed has no alias, so paint uses the declared name.
    expect(registration.alias('Calibri')).toBeUndefined();
  });

  test('two documents embedding the same family name get different aliases', async () => {
    const first = await registerEmbeddedFontFaces(
      [source('Calibri', 400, 'normal', 'sha256:aaa')],
      fakeEnvironment().environment
    );
    const second = await registerEmbeddedFontFaces(
      [source('Calibri', 400, 'normal', 'sha256:bbb')],
      fakeEnvironment().environment
    );
    expect(first.alias('Calibri')).not.toBe(second.alias('Calibri'));
  });

  test('case and surrounding whitespace share one alias across weights and styles', async () => {
    const env = fakeEnvironment();
    const sources = [
      source('Brand Face'),
      source(' brand face ', 700),
      source('BRAND FACE', 400, 'italic'),
    ];
    const originalRequests = sources.map((face) => ({ ...face.request }));
    const registration = await registerEmbeddedFontFaces(sources, env.environment);
    const alias = registration.alias('brand face');
    expect(alias).toMatch(/^docx-embedded-/);
    expect(registration.installed).toBe(3);
    expect(registration.alias(' Brand Face ')).toBe(alias);
    expect(registration.alias('BRAND FACE')).toBe(alias);
    expect(env.created.map((face) => face.family)).toEqual([alias, alias, alias]);
    expect(env.created.map((face) => face.descriptors)).toEqual([
      { weight: '400', style: 'normal' },
      { weight: '700', style: 'normal' },
      { weight: '400', style: 'italic' },
    ]);
    expect(sources.map((face) => face.request)).toEqual(originalRequests);
    for (let index = 0; index < sources.length; index++) {
      expect(env.created[index]!.bytes).toBe(sources[index]!.bytes);
    }
    registration.dispose();
    registration.dispose();
    expect(env.deleted).toEqual(env.added);
    expect(env.deleted).toHaveLength(3);
    expect(registration.alias(' Brand Face ')).toBeUndefined();
    expect(registration.alias('brand face')).toBeUndefined();
  });

  test('substitution aliases normalize both families and preserve direct-face precedence', async () => {
    const env = fakeEnvironment();
    const face = (family: string) => ({ family, weight: 400, style: 'normal' as const });
    const registration = await registerEmbeddedFontFaces(
      [source(' Stand In '), source('DIRECT FACE')],
      env.environment,
      [
        { from: face(' Authored Face '), to: face('STAND IN') },
        { from: face(' direct face '), to: face('stand in') },
        { from: face('Missing Alias'), to: face('ABSENT FACE') },
      ]
    );
    expect(registration.alias('authored face')).toBe(registration.alias('stand in'));
    expect(registration.alias(' AUTHORED FACE ')).toMatch(/^docx-embedded-/);
    expect(registration.alias(' direct face ')).toMatch(/^docx-embedded-/);
    expect(registration.alias('direct face')).not.toBe(registration.alias('stand in'));
    expect(registration.alias('missing alias')).toBeUndefined();
    registration.dispose();
    expect(env.deleted).toEqual(env.added);
    expect(registration.alias('authored face')).toBeUndefined();
    expect(registration.alias('DIRECT FACE')).toBeUndefined();
  });

  test('a family whose every face fails to load advertises no alias', async () => {
    const env = fakeEnvironment({ failWhenFamilyMatches: 'docx-embedded-' });
    const registration = await registerEmbeddedFontFaces([source('Broken')], env.environment);
    expect(registration.installed).toBe(0);
    expect(registration.alias('Broken')).toBeUndefined();
  });

  test('dispose removes exactly the added faces, once, and stops advertising', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(
      [source('Calibri'), source('Calibri', 700), source('Cambria')],
      env.environment
    );
    expect(registration.alias('Calibri')).toBeDefined();
    registration.dispose();
    registration.dispose();
    expect(env.deleted).toEqual(env.added);
    expect(env.deleted).toHaveLength(3);
    // A disposed registration must not keep pointing paint at a removed face.
    expect(registration.alias('Calibri')).toBeUndefined();
  });

  test('no FontFaceSet in the environment is a silent no-op', async () => {
    const registration = await registerEmbeddedFontFaces([source('Calibri')], {});
    expect(registration.installed).toBe(0);
    expect(registration.alias('Calibri')).toBeUndefined();
    registration.dispose();
  });

  test('no sources is a no-op without touching the set', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces([], env.environment);
    expect(registration.installed).toBe(0);
    expect(env.created).toHaveLength(0);
  });
});

// A document embeds the face that draws bold text in the bold slot. For a family without a
// bold face, that slot holds a copy of the regular face, and bold text in it draws with a
// synthesized bold. A browser synthesizes bold only for a face whose weight descriptor is below
// 600.
describe('a bold slot that holds a regular face', () => {
  const descriptorsOf = async (sources: FontSource[]) => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(sources, env.environment);
    expect(registration.installed).toBe(sources.length);
    return env.created.map((face) => face.descriptors);
  };

  test('registers below the bold threshold, so bold text selects it and the browser emboldens it', async () => {
    const sources = [
      source('Single Weight', 400, 'normal', 'sha256:r', regularFace),
      source('Single Weight', 700, 'normal', 'sha256:b', regularFace),
      source('Single Weight', 400, 'italic', 'sha256:i', regularFace),
      source('Single Weight', 700, 'italic', 'sha256:bi', regularFace),
    ];
    expect(await descriptorsOf(sources)).toEqual([
      { weight: '400', style: 'normal' },
      { weight: '599', style: 'normal' },
      { weight: '400', style: 'italic' },
      { weight: '599', style: 'italic' },
    ]);
  });

  test('a real bold face keeps its bold weight', async () => {
    const sources = [
      source('Two Weights', 400, 'normal', 'sha256:r', regularFace),
      source('Two Weights', 700, 'normal', 'sha256:b', boldFace),
    ];
    expect(await descriptorsOf(sources)).toEqual([
      { weight: '400', style: 'normal' },
      { weight: '700', style: 'normal' },
    ]);
  });

  test('another window gets the same descriptors', async () => {
    const registration = await registerEmbeddedFontFaces(
      [source('Single Weight', 700, 'normal', 'sha256:b', regularFace)],
      fakeEnvironment().environment
    );
    const created: { readonly descriptors: unknown }[] = [];
    class OtherWindowFontFace {
      constructor(
        _family: string,
        _bytes: ArrayBuffer,
        readonly descriptors: unknown
      ) {
        created.push(this);
      }
      load(): Promise<unknown> {
        return Promise.resolve(this);
      }
    }
    const otherDocument = {
      fonts: { add: () => {}, delete: () => true },
      defaultView: { FontFace: OtherWindowFontFace },
    } as unknown as Document;
    registration.showIn(otherDocument);
    expect(created.map((face) => face.descriptors)).toEqual([{ weight: '599', style: 'normal' }]);
    registration.dispose();
  });
});
