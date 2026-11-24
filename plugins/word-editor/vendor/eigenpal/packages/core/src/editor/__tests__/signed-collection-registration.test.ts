import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerEmbeddedFontFaces, type FontFaceLike } from '../embedded-font-faces.ts';
import { materializeCollectionFace, sfntChecksum } from '../font-collection-face.ts';
import { boundedStructuralFontValidator } from '../../layout/font-resource.ts';

const fixtures = new URL('../../layout/__tests__/fixtures/fonts/', import.meta.url);
const signatureTable = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]);
function withFaceSignature(font: Uint8Array) {
  const input = new DataView(font.buffer, font.byteOffset, font.length),
    count = input.getUint16(4),
    end = 12 + count * 16;
  const result = new Uint8Array(font.length + 16 + signatureTable.length),
    output = new DataView(result.buffer);
  result.set(font.subarray(0, end));
  result.set(font.subarray(end), end + 16);
  output.setUint16(4, count + 1);
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 16;
    output.setUint32(entry + 8, input.getUint32(entry + 8) + 16);
  }
  result.set(new TextEncoder().encode('DSIG'), end);
  output.setUint32(end + 8, font.length + 16);
  output.setUint32(end + 12, signatureTable.length);
  result.set(signatureTable, font.length + 16);
  return result;
}
const fonts = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((file) =>
  withFaceSignature(new Uint8Array(fs.readFileSync(new URL(file, fixtures))))
);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function collection(signature: boolean): Uint8Array {
  const count = fonts.length;
  const headerSize = 12 + count * 4 + 12;
  const offsets = [headerSize, headerSize + fonts[0]!.length];
  const end = headerSize + fonts.reduce((size, font) => size + font.length, 0);
  const result = new Uint8Array(end + (signature ? 8 : 0));
  const view = new DataView(result.buffer);
  result.set(new TextEncoder().encode('ttcf'));
  view.setUint32(4, 0x00020000);
  view.setUint32(8, count);
  fonts.forEach((font, index) => {
    const offset = offsets[index]!;
    view.setUint32(12 + index * 4, offset);
    result.set(font, offset);
    const original = new DataView(font.buffer, font.byteOffset, font.length);
    for (let table = 0; table < original.getUint16(4); table++) {
      const entry = 12 + table * 16;
      view.setUint32(offset + entry + 8, original.getUint32(entry + 8) + offset);
    }
  });
  if (signature) {
    view.setUint32(12 + count * 4, 0x44534947);
    view.setUint32(16 + count * 4, 8);
    view.setUint32(20 + count * 4, end);
    // A public DSIG envelope tests preservation. It has no cryptographic signature.
    view.setUint32(end, 1);
  }
  return result;
}
async function register(bytes: Uint8Array, faceIndex: number, failsLoading = false) {
  const untouched = hash(bytes);
  assert.deepEqual(boundedStructuralFontValidator(bytes, faceIndex), { valid: true });
  const created: { family: string; bytes: Uint8Array; face: FontFaceLike }[] = [];
  const added: FontFaceLike[] = [],
    deleted: FontFaceLike[] = [];
  const registration = await registerEmbeddedFontFaces(
    [
      {
        request: { family: 'Public Collection', weight: 400, style: 'normal' },
        id: 'public-collection',
        bytes,
        hash: `sha256:${untouched}`,
        faceIndex,
      },
    ],
    {
      fontSet: { add: (face) => added.push(face), delete: (face) => deleted.push(face) },
      createFontFace: (family, source) => {
        const face = {
          load: async () => {
            if (failsLoading) throw new Error('Browser refusal');
          },
        };
        created.push({ family, bytes: source, face });
        return face;
      },
    }
  );
  assert.equal(hash(bytes), untouched);
  return { registration, created, added, deleted };
}

test('first signed collection face preserves the complete admitted bytes and private alias', async () => {
  const bytes = collection(true);
  assert.equal(sfntChecksum(materializeCollectionFace(bytes)), 0xb1b0afba);
  const result = await register(bytes, 0);
  assert.equal(result.registration.installed, 1);
  assert.equal(result.created[0]!.bytes, bytes);
  assert.equal(result.created[0]!.family, result.registration.alias('Public Collection'));
  assert.match(result.created[0]!.family, /^docx-embedded-/);
  result.registration.dispose();
  result.registration.dispose();
  assert.deepEqual(result.deleted, result.added);
});

test('nonzero signed face registers by default with all selected tables and its own alias', async () => {
  const bytes = collection(true),
    first = await register(bytes, 0),
    result = await register(bytes, 1);
  assert.equal(result.registration.installed, 1);
  assert.equal(result.created.length, 1);
  const selected = result.created[0]!.bytes;
  assert.notEqual(selected, bytes);
  assert.deepEqual(selected, materializeCollectionFace(bytes, 1));
  assert.equal(sfntChecksum(selected), 0xb1b0afba);
  assert.notEqual(
    first.registration.alias('Public Collection'),
    result.registration.alias('Public Collection')
  );
  const view = new DataView(selected.buffer);
  const entries = Array.from({ length: view.getUint16(4) }, (_, index) => 12 + index * 16);
  const dsig = entries.find(
    (entry) => new TextDecoder().decode(selected.subarray(entry, entry + 4)) === 'DSIG'
  )!;
  assert.deepEqual(
    selected.subarray(
      view.getUint32(dsig + 8),
      view.getUint32(dsig + 8) + view.getUint32(dsig + 12)
    ),
    signatureTable
  );
  first.registration.dispose();
  result.registration.dispose();
  result.registration.dispose();
  assert.deepEqual(first.deleted, first.added);
  assert.deepEqual(result.deleted, result.added);
});

test('unsigned first face keeps all bytes while its next face uses the selected SFNT', async () => {
  const bytes = collection(false);
  const first = await register(bytes, 0),
    next = await register(bytes, 1);
  assert.equal(first.registration.installed, 1);
  assert.equal(next.registration.installed, 1);
  assert.equal(first.created[0]!.bytes, bytes);
  assert.deepEqual(next.created[0]!.bytes, materializeCollectionFace(bytes, 1));
  assert.notEqual(
    first.registration.alias('Public Collection'),
    next.registration.alias('Public Collection')
  );
  first.registration.dispose();
  next.registration.dispose();
});

test('a browser that refuses a signed collection does not advertise or leak its face', async () => {
  const result = await register(collection(true), 0, true);
  assert.equal(result.registration.installed, 0);
  assert.equal(result.created.length, 1);
  assert.equal(result.registration.alias('Public Collection'), undefined);
  assert.deepEqual(result.added, []);
  result.registration.dispose();
  assert.deepEqual(result.deleted, []);
});

test('an invalid first collection directory never reaches the browser loader', async () => {
  const bytes = collection(true);
  new DataView(bytes.buffer).setUint32(12, bytes.length);
  let calls = 0;
  const result = await registerEmbeddedFontFaces(
    [
      {
        request: { family: 'Invalid Collection', weight: 400, style: 'normal' },
        id: 'invalid',
        bytes,
        hash: `sha256:${hash(bytes)}`,
        faceIndex: 0,
      },
    ],
    {
      fontSet: { add: () => assert.fail('Invalid face added'), delete: () => {} },
      createFontFace: () => {
        calls++;
        return { load: async () => {} };
      },
    }
  );
  assert.equal(calls, 0);
  assert.equal(result.installed, 0);
});
