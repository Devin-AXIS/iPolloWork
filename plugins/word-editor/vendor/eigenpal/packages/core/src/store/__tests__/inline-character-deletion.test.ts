// Deleting text across a hyphen or symbol (issue #1071).
//
// A non-breaking or optional hyphen is one model character, so a deletion takes it like any
// other character. A `w:sym` has no model width: a deletion whose range spans one removes it,
// or strikes it when tracked, and a range that only touches it leaves it in place.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const W = WML_NAMESPACE_URI;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphId(part: OoxmlPart): string {
  const find = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(part.root)!;
}

function paragraphXml(part: OoxmlPart): string {
  return serializeOoxmlPart(part).match(/<w:p>.*<\/w:p>/)![0];
}

function remove(body: string, start: number, end: number, tracked = false): OoxmlPart {
  const part = load(body);
  const result = applyTreeOp(part, {
    op: 'deleteText',
    paragraphId: paragraphId(part),
    start,
    end,
    ...(tracked ? { revision: { author: 'Writer', date: '2026-10-03T00:00:00Z' } } : {}),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// Model text: `the then␞applicable rate␟s`; the non-breaking hyphen is offset 8.
const ONE_RUN =
  '<w:p><w:r><w:t xml:space="preserve">the then</w:t><w:noBreakHyphen/>' +
  '<w:t>applicable rate</w:t><w:softHyphen/><w:t>s</w:t></w:r></w:p>';
// Model text: `co␞signer`; the symbol sits at offset 3, between the hyphen and `signer`.
const OWN_RUNS =
  '<w:p><w:r><w:t>co</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:sym w:font="Symbol" ' +
  'w:char="F0B7"/></w:r><w:r><w:t>signer</w:t></w:r></w:p>';
const SYMBOL_IN_INSERTION =
  '<w:p><w:r><w:t>co</w:t></w:r><w:ins w:id="7" w:author="Other"><w:r><w:sym w:font="Symbol" ' +
  'w:char="F0B7"/></w:r></w:ins><w:r><w:t>op</w:t></w:r></w:p>';

describe('deleting across hyphens and symbols', () => {
  test('a hyphen goes with the range that holds it', () => {
    const xml = paragraphXml(remove(ONE_RUN, 5, 19));
    expect(xml).not.toContain('noBreakHyphen');
    expect(xml).toContain('<w:softHyphen/>');
  });

  test('a range beside a hyphen keeps it', () => {
    expect(paragraphXml(remove(ONE_RUN, 4, 8))).toContain('noBreakHyphen');
    expect(paragraphXml(remove(ONE_RUN, 9, 19))).toContain('noBreakHyphen');
    expect(paragraphXml(remove(ONE_RUN, 8, 9))).not.toContain('noBreakHyphen');
  });

  test('removes a symbol inside the range, and the runs it empties', () => {
    const xml = paragraphXml(remove(OWN_RUNS, 1, 4));
    expect(xml).not.toContain('noBreakHyphen');
    expect(xml).not.toContain('w:sym');
    expect(xml.match(/<w:r>/g)).toHaveLength(2);
  });

  test('keeps a symbol at the edge of the range', () => {
    expect(paragraphXml(remove(OWN_RUNS, 0, 3))).toContain('w:sym');
  });

  test('a tracked deletion strikes them, and accepting removes them', () => {
    for (const [body, start, end] of [
      [ONE_RUN, 5, 19],
      [OWN_RUNS, 1, 4],
      [SYMBOL_IN_INSERTION, 1, 3],
    ] as const) {
      const tracked = remove(body, start, end, true);
      const struck = paragraphXml(tracked)
        .match(/<w:del\b.*?<\/w:del>/g)!
        .join('');
      if (body !== SYMBOL_IN_INSERTION) expect(struck).toContain('noBreakHyphen');
      if (body !== ONE_RUN) expect(struck).toContain('w:sym');
      const batch = planRevisionBatch(tracked, 'accept');
      const accepted = applyTreeOp(tracked, batch.ops[0]!);
      if (!accepted.ok) throw new Error(accepted.reason);
      const xml = paragraphXml(accepted.part);
      expect(xml).not.toContain('noBreakHyphen');
      expect(xml).not.toContain('w:sym');
    }
  });
});
