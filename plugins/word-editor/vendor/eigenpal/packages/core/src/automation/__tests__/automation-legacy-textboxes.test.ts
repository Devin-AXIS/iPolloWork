// Legacy VML text boxes through the automation host. A VML shape has no `wp:docPr/@id`, so the
// shape listing cannot name it and its story is not reachable through `Shape.body`. Its anchor
// reads like any floating drawing: no character of its paragraph's text.

import { describe, expect, test } from 'bun:test';
import { docx, handlesAt, open, paragraphTexts, roots, spansAt } from './support/protocol.ts';

const V = 'urn:schemas-microsoft-com:vml';

function legacyBox(style: string, text: string): string {
  return (
    `<w:r><w:pict xmlns:v="${V}"><v:rect style="${style}"><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>`
  );
}

describe('legacy VML text boxes', () => {
  test('a floating box is no character of its paragraph text and is not a listed shape', () => {
    const target = open(
      docx(
        `<w:p><w:r><w:t>ab</w:t></w:r>${legacyBox('position:absolute;width:3in;height:36pt', 'Boxed')}` +
          '<w:r><w:t>cd</w:t></w:r></w:p>'
      )
    );
    const { body } = roots(target);
    expect(paragraphTexts(target, body)).toEqual(['abcd']);
    const find = (text: string) =>
      spansAt(target.execute({ operations: [{ op: 'search', scope: { body }, text }] }), 0);
    // The anchor keeps its model offset, so a match never spans it.
    expect(find('abcd')).toHaveLength(0);
    expect(find('Boxed')).toHaveLength(0);
    expect(
      handlesAt(target.execute({ operations: [{ op: 'getShapes', span: { body } }] }), 0)
    ).toEqual([]);
  });

  test('an inline box keeps its object character, as an inline drawing does', () => {
    const target = open(
      docx(`<w:p><w:r><w:t>ab</w:t></w:r>${legacyBox('width:3in;height:36pt', 'Boxed')}</w:p>`)
    );
    const { body } = roots(target);
    expect(paragraphTexts(target, body)).toEqual(['ab\uFFFC']);
  });
});
