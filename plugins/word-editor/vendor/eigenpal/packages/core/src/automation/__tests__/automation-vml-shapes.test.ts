// Legacy VML shapes through the automation host.
//
// A standalone `w:pict` lists the shapes it draws, each named by its VML shape number, and a VML
// text box's story is a body like any other: read, searched, edited and tracked on its own.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  handleAt,
  handlesAt,
  open,
  paragraphTexts,
  roots,
  savedMainXml,
  spansAt,
  storyText,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const VML_NS =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

const story = (text: string) =>
  `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;

/** A `w:pict` run holding `shapes`, with the text box template beside them. */
const pict = (shapes: string) =>
  `<w:r><w:pict ${VML_NS}><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" ` +
  `path="m,l,21600r21600,l21600,xe"/>${shapes}</w:pict></w:r>`;

const FLOAT = 'position:absolute;margin-left:36pt;margin-top:13pt;width:144pt;height:36pt';

const vmlTextBox = (id: string, text: string, extra = '') =>
  `<v:shape id="${id}"${extra} type="#_x0000_t202" style="${FLOAT}"><v:textbox inset="0,0,0,0">` +
  `${story(text)}</v:textbox></v:shape>`;

function shapesOf(target: AutomationHost, span: { body: AutomationHandle }) {
  return handlesAt(target.execute({ operations: [{ op: 'getShapes', span }] }), 0);
}

function shapeRead(target: AutomationHost, shape: AutomationHandle) {
  const result = target.execute({ operations: [{ op: 'getShape', shape }] }).results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'shape') throw new Error('no shape read');
  return result.value.shape;
}

function bodyOf(target: AutomationHost, shape: AutomationHandle): AutomationHandle {
  return handleAt(target.execute({ operations: [{ op: 'getShapeBody', shape }] }), 0);
}

const reads = (target: AutomationHost) => {
  const { body } = roots(target);
  return shapesOf(target, { body }).map((shape) => shapeRead(target, shape));
};

describe('legacy VML shapes', () => {
  test('a standalone w:pict lists each shape it draws, by its shape number', () => {
    const picture =
      '<v:shape id="_x0000_i1030" type="#_x0000_t75" style="width:20pt;height:20pt">' +
      '<v:imagedata r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></v:shape>';
    const target = open(
      docx(
        `<w:p><w:r><w:t>Lead</w:t></w:r>${pict(vmlTextBox('_x0000_s1025', 'Boxed'))}` +
          pict(
            `<v:rect id="Rectangle 3" o:spid="_x0000_s1027" style="${FLOAT}"><v:textbox>` +
              `${story('Label')}</v:textbox></v:rect>`
          ) +
          pict(picture) +
          pict(`<v:line id="_x0000_s1031" from="0,0" to="10pt,0" style="position:absolute"/>`) +
          pict(
            `<v:group id="_x0000_s1032" style="${FLOAT}" coordsize="100,100">` +
              `${vmlTextBox('_x0000_s1033', 'Inner')}</v:group>`
          ) +
          pict(
            `<v:shape id="_x0000_s1034" style="${FLOAT}"><v:textpath on="t" string="DRAFT"/></v:shape>`
          ) +
          pict(`<v:rect id="_x0000_i1035" o:hr="t" style="width:0;height:1.5pt"/>`) +
          '</w:p>'
      )
    );
    expect(reads(target)).toEqual([
      { id: 1025, name: '_x0000_s1025', type: 'TextBox' },
      { id: 1027, name: 'Rectangle 3', type: 'GeometricShape' },
      { id: 1030, name: '_x0000_i1030', type: 'Picture' },
      { id: 1031, name: '_x0000_s1031', type: 'GeometricShape' },
      { id: 1032, name: '_x0000_s1032', type: 'Group' },
      { id: 1034, name: '_x0000_s1034', type: 'Unsupported' },
      { id: 1035, name: '_x0000_i1035', type: 'Unsupported' },
    ]);
    // A line has no text frame, and a group's members belong to the group.
    const [, rectangle, , line, group] = shapesOf(target, { body: roots(target).body });
    expect(storyText(target, bodyOf(target, rectangle!))).toBe('Label');
    for (const shape of [line!, group!]) {
      const refused = target.execute({ operations: [{ op: 'getShapeBody', shape }] });
      expect(refused.results[0]?.status).toBe('error');
    }
  });

  test('a VML text box body reads, searches and edits its own story', () => {
    const target = open(
      docx(
        `<w:p><w:r><w:t>Cover</w:t></w:r>` +
          `${pict(vmlTextBox('_x0000_s1025', 'Client: Acme Holdings'))}</w:p>`
      )
    );
    const { body } = roots(target);
    // The anchoring paragraph keeps its own text; the box is a story of its own.
    expect(storyText(target, body)).toBe('Cover');
    const [box] = shapesOf(target, { body });
    const boxBody = bodyOf(target, box!);
    expect(paragraphTexts(target, boxBody)).toEqual(['Client: Acme Holdings']);
    expect(
      spansAt(target.execute({ operations: [{ op: 'search', scope: { body }, text: 'Acme' }] }), 0)
    ).toHaveLength(0);
    const [match] = spansAt(
      target.execute({
        operations: [{ op: 'search', scope: { body: boxBody }, text: 'Acme Holdings' }],
      }),
      0
    );
    expect(
      target.execute({ operations: [{ op: 'replaceSpan', span: match!, text: 'Beta Logistics' }] })
        .results[0]?.status
    ).toBe('ok');
    expect(storyText(target, boxBody)).toBe('Client: Beta Logistics');
    const xml = savedMainXml(target);
    expect(xml).toContain('<v:textbox inset="0,0,0,0"><w:txbxContent>');
    expect(xml.match(/Beta Logistics/g)).toHaveLength(1);
    expect(xml).not.toContain('Acme');
  });

  test('a VML text box lists and decides its own tracked changes', () => {
    const target = open(
      docx(`<w:p><w:r><w:t>Cover</w:t></w:r>${pict(vmlTextBox('_x0000_s1025', 'Acme'))}</w:p>`)
    );
    const { body } = roots(target);
    const boxBody = bodyOf(target, shapesOf(target, { body })[0]!);
    target.execute({
      operations: [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: 'Reviewer' }],
    });
    const [match] = spansAt(
      target.execute({ operations: [{ op: 'search', scope: { body: boxBody }, text: 'Acme' }] }),
      0
    );
    target.execute({ operations: [{ op: 'replaceSpan', span: match!, text: 'Beta' }] });
    const revisions = (scope: AutomationHandle) =>
      handlesAt(target.execute({ operations: [{ op: 'getRevisions', body: scope }] }), 0);
    expect(revisions(body)).toHaveLength(0);
    expect(revisions(boxBody).length).toBeGreaterThan(0);
    expect(
      target.execute({ operations: [{ op: 'acceptAllRevisions', body: boxBody }] }).results[0]
        ?.status
    ).toBe('ok');
    expect(storyText(target, boxBody)).toBe('Beta');
    expect(savedMainXml(target)).not.toMatch(/<w:(ins|del)\b/);
  });

  test('a VML text box with no story reads as empty and refuses writes', () => {
    const frame = `<v:shape id="_x0000_s1026" type="#_x0000_t202" style="${FLOAT}" stroked="t"/>`;
    const target = open(docx(`<w:p><w:r><w:t>Cover</w:t></w:r>${pict(frame)}</w:p>`));
    const { body } = roots(target);
    const [shape] = shapesOf(target, { body });
    expect(shapeRead(target, shape!)).toEqual({
      id: 1026,
      name: '_x0000_s1026',
      type: 'TextBox',
    });
    const empty = bodyOf(target, shape!);
    expect(storyText(target, empty)).toBe('');
    const before = savedMainXml(target);
    const [result] = target.execute({
      operations: [{ op: 'insertText', at: { body: empty, at: 'end' }, text: 'x' }],
    }).results;
    expect(result?.status === 'error' && result.error.detail).toBe('unsupported-story');
    expect(savedMainXml(target)).toBe(before);
  });

  test('a VML number another shape already uses names neither VML shape', () => {
    const drawing =
      '<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:inline distT="0" ' +
      'distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1025" ' +
      'name="Picture 1025"/><a:graphic><a:graphicData ' +
      'uri="http://schemas.openxmlformats.org/drawingml/2006/picture"/></a:graphic></wp:inline>' +
      '</w:drawing></w:r>';
    // An inline and a floating VML shape number from separate counters, so both can be 1026.
    const target = open(
      docx(
        `<w:p>${drawing}${pict(vmlTextBox('_x0000_s1025', 'Clash'))}` +
          `${pict(vmlTextBox('_x0000_i1026', 'One'))}${pict(vmlTextBox('_x0000_s1026', 'Two'))}` +
          `${pict(vmlTextBox('_x0000_s1027', 'Kept'))}</w:p>`
      )
    );
    expect(reads(target)).toEqual([
      { id: 1025, name: 'Picture 1025', type: 'Picture' },
      { id: 1027, name: '_x0000_s1027', type: 'TextBox' },
    ]);
  });

  test('a VML shape with no shape number, or a VML fallback, is not listed', () => {
    const fallback =
      '<w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
      'xmlns:x99="urn:example:unsupported">' +
      '<mc:Choice Requires="x99"><w:t>never</w:t></mc:Choice><mc:Fallback>' +
      `<w:pict ${VML_NS}>${vmlTextBox('_x0000_s1040', 'Fallback')}</w:pict></mc:Fallback>` +
      '</mc:AlternateContent></w:r>';
    const target = open(docx(`<w:p>${pict(vmlTextBox('Text Box 2', 'Unnamed'))}${fallback}</w:p>`));
    expect(reads(target)).toEqual([]);
  });

  test('a VML connector has no text frame, so its body refuses', () => {
    const target = open(
      docx(
        `<w:p>${pict(
          `<v:shape id="_x0000_s1036" type="#_x0000_t32" o:connectortype="straight" style="${FLOAT}"/>`
        )}</w:p>`
      )
    );
    const [connector] = shapesOf(target, { body: roots(target).body });
    expect(shapeRead(target, connector!).type).toBe('GeometricShape');
    const refused = target.execute({ operations: [{ op: 'getShapeBody', shape: connector! }] });
    expect(refused.results[0]?.status).toBe('error');
  });

  test('o:spid names the shape and id names it in words', () => {
    const target = open(
      docx(`<w:p>${pict(vmlTextBox('Text Box 2', 'Named', ' o:spid="_x0000_s1026"'))}</w:p>`)
    );
    expect(reads(target)).toEqual([{ id: 1026, name: 'Text Box 2', type: 'TextBox' }]);
  });
});
