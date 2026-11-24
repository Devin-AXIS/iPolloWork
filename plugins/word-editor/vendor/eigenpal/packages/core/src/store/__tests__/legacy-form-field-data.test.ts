// The bounded `w:ffData` reader: legacy form-field RENDER STATE only, macros never.
//
// Everything in ffData is attacker-controlled. The reader walks fldChar → ffData →
// checkBox/ddList → leaf attributes with a hard node budget, caps every collection before
// allocating, and fails closed to null so callers keep the presence-only behavior.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { legacyFormFieldDataOf } from '../package/field-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    metadata
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Parse a run holding one begin `w:fldChar` and return that fldChar node. */
function fldCharOf(fldCharInner: string): OoxmlNode {
  const part = partOf(
    `<w:p><w:r><w:fldChar w:fldCharType="begin">${fldCharInner}</w:fldChar></w:r></w:p>`
  );
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind !== 'textValue' && node.localName === 'fldChar') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const fldChar = find(part.root);
  if (!fldChar) throw new Error('no fldChar');
  return fldChar;
}

function checkboxDataOf(checkBoxInner: string, ffDataExtra = '') {
  return legacyFormFieldDataOf(
    fldCharOf(`<w:ffData>${ffDataExtra}<w:checkBox>${checkBoxInner}</w:checkBox></w:ffData>`)
  );
}

function dropdownDataOf(ddListInner: string) {
  return legacyFormFieldDataOf(
    fldCharOf(`<w:ffData><w:ddList>${ddListInner}</w:ddList></w:ffData>`)
  );
}

describe('checkbox state', () => {
  test('w:checked on/off value forms', () => {
    expect(checkboxDataOf('<w:checked/>')).toMatchObject({ kind: 'checkbox', checked: true });
    expect(checkboxDataOf('<w:checked w:val="1"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:checked w:val="true"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:checked w:val="0"/>')).toMatchObject({ checked: false });
    expect(checkboxDataOf('<w:checked w:val="false"/>')).toMatchObject({ checked: false });
  });

  test('w:default is the fallback and w:checked wins over it', () => {
    expect(checkboxDataOf('<w:default w:val="1"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:default/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:default w:val="0"/>')).toMatchObject({ checked: false });
    expect(checkboxDataOf('')).toMatchObject({ kind: 'checkbox', checked: false });
    expect(checkboxDataOf('<w:checked w:val="0"/><w:default w:val="1"/>')).toMatchObject({
      checked: false,
    });
  });

  test('explicit w:size is half-points, clamped to the render range', () => {
    expect(checkboxDataOf('<w:size w:val="24"/>')).toMatchObject({ sizeHalfPoints: 24 });
    expect(checkboxDataOf('<w:size w:val="1"/>')).toMatchObject({ sizeHalfPoints: 2 });
    expect(checkboxDataOf('<w:size w:val="999999"/>')).toMatchObject({ sizeHalfPoints: 288 });
    // Malformed size falls back to auto rather than failing the whole read.
    expect(checkboxDataOf('<w:size w:val="abc"/>')).toMatchObject({ sizeHalfPoints: null });
    expect(checkboxDataOf('<w:size/>')).toMatchObject({ sizeHalfPoints: null });
    // ST_HpsMeasure is UNSIGNED: a negative value is malformed (auto), never a 1pt box.
    expect(checkboxDataOf('<w:size w:val="-5"/>')).toMatchObject({ sizeHalfPoints: null });
    // First size wins, same rule as the other state elements.
    expect(checkboxDataOf('<w:size w:val="24"/><w:size w:val="48"/>')).toMatchObject({
      sizeHalfPoints: 24,
    });
  });

  test('w:sizeAuto means auto even beside an explicit size', () => {
    expect(checkboxDataOf('<w:sizeAuto/>')).toMatchObject({ sizeHalfPoints: null });
    expect(checkboxDataOf('<w:size w:val="24"/><w:sizeAuto/>')).toMatchObject({
      sizeHalfPoints: null,
    });
  });
});

describe('dropdown state', () => {
  const entries =
    '<w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/>';

  test('result picks the entry; default is the fallback; both-out-of-range is 0', () => {
    expect(dropdownDataOf(`<w:result w:val="2"/>${entries}`)).toEqual({
      kind: 'dropdown',
      entries: ['Red', 'Green', 'Blue'],
      selectedIndex: 2,
    });
    expect(dropdownDataOf(`<w:result w:val="9"/><w:default w:val="1"/>${entries}`)).toMatchObject({
      selectedIndex: 1,
    });
    expect(dropdownDataOf(`<w:result w:val="9"/><w:default w:val="8"/>${entries}`)).toMatchObject({
      selectedIndex: 0,
    });
    expect(dropdownDataOf(entries)).toMatchObject({ selectedIndex: 0 });
  });

  test('an out-of-range index is absent — never clamped onto another entry', () => {
    // A negative result must not clamp to 0 and shadow the authored default.
    expect(dropdownDataOf(`<w:result w:val="-5"/><w:default w:val="1"/>${entries}`)).toMatchObject({
      selectedIndex: 1,
    });
    expect(dropdownDataOf(`<w:result w:val="-5"/>${entries}`)).toMatchObject({ selectedIndex: 0 });
    // Past 63 with a FULL 64-entry list: clamping painted entry 63; absent falls to default.
    const full = Array.from({ length: 64 }, (_, i) => `<w:listEntry w:val="e${i}"/>`).join('');
    expect(dropdownDataOf(`<w:result w:val="200"/><w:default w:val="5"/>${full}`)).toMatchObject({
      selectedIndex: 5,
    });
    expect(dropdownDataOf(`<w:result w:val="200"/>${full}`)).toMatchObject({ selectedIndex: 0 });
    // In [0, 63] but past a short list: default when in range, else 0 (unchanged rule).
    expect(dropdownDataOf(`<w:result w:val="70"/><w:default w:val="2"/>${entries}`)).toMatchObject({
      selectedIndex: 2,
    });
    expect(dropdownDataOf(`<w:result w:val="junk"/>${entries}`)).toMatchObject({
      selectedIndex: 0,
    });
  });

  test('the first w:result / w:default ELEMENT wins, even when malformed', () => {
    // Same rule as checkbox w:size: a malformed or out-of-range first element must not
    // let a later valid sibling shadow it — `??=` could not express that.
    expect(dropdownDataOf(`<w:result w:val="9"/><w:result w:val="1"/>${entries}`)).toMatchObject({
      selectedIndex: 0,
    });
    expect(
      dropdownDataOf(`<w:result w:val="9"/><w:result w:val="1"/><w:default w:val="2"/>${entries}`)
    ).toMatchObject({ selectedIndex: 2 });
    expect(
      dropdownDataOf(`<w:result w:val="9"/><w:default w:val="-1"/><w:default w:val="1"/>${entries}`)
    ).toMatchObject({ selectedIndex: 0 });
    // A valid first element keeps winning, unchanged.
    expect(dropdownDataOf(`<w:result w:val="1"/><w:result w:val="2"/>${entries}`)).toMatchObject({
      selectedIndex: 1,
    });
  });

  test('the node budget failing closed mid-ddList still returns a sane shape', () => {
    // Flood ffData with siblings so the shared budget is exhausted while entries collect.
    // The walk must stop, never throw, and anything returned stays within collected bounds.
    const flood = '<w:listEntry w:val="x"/>'.repeat(300);
    const data = dropdownDataOf(`<w:result w:val="1"/>${flood}`);
    if (data !== null) {
      if (data.kind !== 'dropdown') throw new Error('expected dropdown');
      expect(data.entries.length).toBeLessThanOrEqual(64);
      expect(data.selectedIndex).toBeGreaterThanOrEqual(0);
      if (data.entries.length > 0) {
        expect(data.selectedIndex).toBeLessThan(data.entries.length);
      } else {
        expect(data.selectedIndex).toBe(0);
      }
    }
  });

  test('an empty list still returns the dropdown shape', () => {
    expect(dropdownDataOf('<w:result w:val="1"/>')).toEqual({
      kind: 'dropdown',
      entries: [],
      selectedIndex: 0,
    });
  });

  test('a hostile entry count caps at 64 collected entries', () => {
    const flood = '<w:listEntry w:val="x"/>'.repeat(1000);
    const data = dropdownDataOf(flood);
    expect(data).not.toBeNull();
    if (data?.kind !== 'dropdown') throw new Error('expected dropdown');
    expect(data.entries.length).toBe(64);
  });

  test('a hostile entry length caps at 256 characters', () => {
    const long = 'a'.repeat(10_000);
    const data = dropdownDataOf(`<w:listEntry w:val="${long}"/>`);
    if (data?.kind !== 'dropdown') throw new Error('expected dropdown');
    expect(data.entries[0]!.length).toBe(256);
  });
});

describe('the security contract', () => {
  test('macro, name and behavior strings never surface in the result', () => {
    const data = checkboxDataOf(
      '<w:checked/>',
      '<w:name w:val="SecretFieldName"/>' +
        '<w:enabled/><w:calcOnExit w:val="1"/>' +
        '<w:entryMacro w:val="EvilEntryMacro"/>' +
        '<w:exitMacro w:val="EvilExitMacro"/>' +
        '<w:helpText w:type="text" w:val="EvilHelp"/>' +
        '<w:statusText w:type="text" w:val="EvilStatus"/>'
    );
    expect(data).toEqual({ kind: 'checkbox', checked: true, sizeHalfPoints: null });
    const serialized = JSON.stringify(data);
    for (const leak of [
      'SecretFieldName',
      'EvilEntryMacro',
      'EvilExitMacro',
      'EvilHelp',
      'EvilStatus',
      'enabled',
      'calcOnExit',
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  test('deep hostile nesting inside state elements is never descended into', () => {
    const data = checkboxDataOf(
      '<w:checked><w:entryMacro w:val="Nested"/><w:checked w:val="0"/></w:checked>'
    );
    expect(data).toEqual({ kind: 'checkbox', checked: true, sizeHalfPoints: null });
    expect(JSON.stringify(data)).not.toContain('Nested');
    // ffData nested one level too deep is not found either.
    const buried = legacyFormFieldDataOf(
      fldCharOf('<w:wrapper><w:ffData><w:checkBox><w:checked/></w:checkBox></w:ffData></w:wrapper>')
    );
    expect(buried).toBeNull();
  });

  test('no ffData, textInput-only ffData, and non-fldChar nodes all read as null', () => {
    expect(legacyFormFieldDataOf(fldCharOf(''))).toBeNull();
    expect(
      legacyFormFieldDataOf(
        fldCharOf('<w:ffData><w:textInput><w:default w:val="x"/></w:textInput></w:ffData>')
      )
    ).toBeNull();
    const part = partOf('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(legacyFormFieldDataOf(part.root)).toBeNull();
  });
});
