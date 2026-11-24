// A .docx is a zip of XML an attacker fully controls, and formatting is a surface made almost
// entirely of attacker-controlled strings: font names, colour values, style names, style
// definitions. This file is the security half of the formatting and style slice.
//
// FOUR CLAIMS:
//
//   NOTHING FILE-DERIVED IS TEMPLATED INTO XML. A style whose NAME is markup is read back as text
//   and, when applied, resolved to its id — never spliced into the part.
//
//   NOTHING IS FETCHED. Formatting reads and writes go to the tree; they add no part, no
//   relationship and no external target, so there is nothing here for a zero-click fetch to use.
//
//   A FIELD STAYS INERT. Formatting a paragraph carrying a `DDEAUTO`/`INCLUDETEXT` instruction
//   formats it as characters. The instruction is not resolved, not rewritten, and not dropped.
//
//   A HOSTILE NUMBER IS NOT A LOOP BOUND. Sizes and indents from a request are bounded before they
//   reach the tree, and a style name of unbounded length is refused rather than searched for.

import { describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';
import { docx, open, paragraphsOf, refusal, roots, savedMainXml } from './support/protocol.ts';
import type { AutomationHost } from '../protocol.ts';

/** A styles part whose NAME is markup, and whose id is ordinary. */
const HOSTILE_STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Sneaky">' +
  '<w:name w:val="&lt;/w:val&gt;&lt;script&gt;alert(1)&lt;/script&gt;"/></w:style>';

const HOSTILE = docx(
  '<w:p w14:paraId="11112222"><w:pPr><w:pStyle w:val="Sneaky"/></w:pPr>' +
    '<w:r><w:t>styled</w:t></w:r></w:p>',
  HOSTILE_STYLES
);

/** A field instruction of exactly the kind that must never be executed or resolved. */
const FIELDED = docx(
  '<w:p w14:paraId="33334444"><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> DDEAUTO c:\\\\evil\\\\payload.exe </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>result</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
);

const partNames = (host: AutomationHost): string[] => {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save refused: ${JSON.stringify(saved)}`);
  return Object.keys(unzipSync(saved.bytes)).sort();
};

function styleNameOf(host: AutomationHost, index: number): string | null {
  const paragraph = paragraphsOf(host, roots(host).body)[index]!;
  const response = host.execute({ operations: [{ op: 'getStyle', span: { paragraph } }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'style') {
    throw new Error(`expected a style: ${JSON.stringify(result)}`);
  }
  return result.value.name;
}

describe('a style name is data, not markup', () => {
  test('reads back as the text the part holds, tags and all, with nothing executed', () => {
    // The name is a string that LOOKS like an attribute break. A reader that concatenated it into
    // anything would either produce a different string or produce markup.
    expect(styleNameOf(open(HOSTILE), 0)).toBe('</w:val><script>alert(1)</script>');
  });

  test('applying it by that name writes the STYLE ID, and the part stays well-formed', () => {
    const host = open(HOSTILE);
    const list = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [
        {
          op: 'setStyle',
          span: { paragraph: list[0]! },
          name: '</w:val><script>alert(1)</script>',
        },
      ],
    });
    expect(response.ok).toBe(true);

    const saved = savedMainXml(host);
    expect(saved).toContain('<w:pStyle w:val="Sneaky"/>');
    expect(saved).not.toContain('<script>');
    // And the document still reads: a broken part would not reopen with a body to read.
    const saved2 = host.save();
    if (!saved2.ok) throw new Error('save refused');
    const reopened = open(saved2.bytes);
    expect(styleNameOf(reopened, 0)).toBe('</w:val><script>alert(1)</script>');
  });

  test('a name of absurd length is refused before anything is searched for it', () => {
    const host = open(HOSTILE);
    const list = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: list[0]! }, name: 'a'.repeat(100_000) }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });
});

describe('a formatting write fetches nothing and adds nothing', () => {
  test('the package holds exactly the parts it held, with no relationship minted', () => {
    const host = open(HOSTILE);
    const before = partNames(host);
    const list = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [
        { op: 'setFont', span: { paragraph: list[0]! }, font: { name: 'Georgia', size: 14 } },
        { op: 'setStyle', span: { paragraph: list[0]! }, name: 'Normal' },
      ],
    });
    expect(response.ok).toBe(true);
    expect(partNames(host)).toEqual(before);
    // No external target of any kind is written by this surface, so there is nothing to auto-load.
    expect(savedMainXml(host)).not.toContain('TargetMode');
  });
});

describe('a field instruction stays inert', () => {
  test('formatting the paragraph that carries it neither resolves nor drops it', () => {
    const host = open(FIELDED);
    const list = paragraphsOf(host, roots(host).body);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: list[0]! }, font: { bold: true } }],
    });
    expect(response.ok).toBe(true);

    const saved = savedMainXml(host);
    // Still an instruction, still unresolved, still exactly the text the file carried.
    expect(saved).toContain('DDEAUTO c:\\\\evil\\\\payload.exe');
    expect(saved).toContain('w:fldCharType="begin"');
    // And the formatting landed on the visible result run rather than being refused.
    expect(saved).toContain('<w:b/>');
  });
});

describe('a number from a request cannot become an allocation', () => {
  test('a size and an indent past what OOXML can express are refused, not clamped silently', () => {
    const host = open(FIELDED);
    const list = paragraphsOf(host, roots(host).body);
    for (const operation of [
      { op: 'setFont', span: { paragraph: list[0]! }, font: { size: 1e9 } },
      {
        op: 'setParagraphFormat',
        paragraph: { paragraph: list[0]! },
        format: { leftIndent: 1e12 },
      },
    ] as const) {
      expect(refusal(host.execute({ operations: [operation] }))).toBe('unsupported-content');
    }
    // Refused means unchanged: no partial write of the other field of the same request.
    expect(savedMainXml(host)).not.toContain('<w:sz');
  });
});
