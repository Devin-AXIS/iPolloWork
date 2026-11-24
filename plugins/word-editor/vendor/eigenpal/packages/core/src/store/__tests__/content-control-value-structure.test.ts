import { expect, test } from 'bun:test';
import {
  contentControlsIn,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { validateTreeOp } from '../store/tree-op-validate.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const meta = { name: '/word/document.xml', contentType: 'application/xml' };

const run = '<w:r w:rsidRPr="00D55315"><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r>';
const paragraph = (content: string) =>
  '<w:p w14:paraId="4E8CAE0A" w14:textId="0E84969E"><w:pPr><w:pStyle w:val="BOX"/></w:pPr><w:bookmarkStart w:id="0" w:name="Field"/>' +
  content +
  '<w:bookmarkEnd w:id="0"/></w:p>';
const cell = (content: string) =>
  '<w:tc><w:tcPr><w:tcW w:w="434" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders></w:tcPr>' +
  content +
  '</w:tc>';
const otherCell =
  '<w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Keep this label</w:t></w:r></w:p></w:tc>';
const row = (content: string) =>
  '<w:tr w:rsidR="00000001"><w:trPr><w:cantSplit/></w:trPr>' + content + otherCell + '</w:tr>';
const table = (content: string) =>
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="434"/><w:gridCol w:w="8000"/></w:tblGrid>' +
  content +
  '</w:tbl>';

type Kind = 'text' | 'dropdown' | 'combo' | 'date';
const properties: Record<Kind, string> = {
  text: '<w:text/>',
  dropdown:
    '<w:dropDownList><w:listItem w:displayText="Yes please" w:value="yes"/><w:listItem w:displayText="No" w:value="no"/></w:dropDownList>',
  combo: '<w:comboBox><w:listItem w:displayText="Other" w:value="other"/></w:comboBox>',
  date: '<w:date w:fullDate="2020-01-01T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>',
};
const control = (kind: Kind, content: string) =>
  `<w:sdt><w:sdtPr><w:id w:val="780542881"/>${properties[kind]}</w:sdtPr><w:sdtEndPr/><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

/** The op each kind takes, in both value forms, and the text the display must then show. */
const writes: Record<
  Kind,
  { readonly string: string; readonly typed: unknown; readonly display: string }
> = {
  text: { string: 'new', typed: { kind: 'text', text: 'new' }, display: 'new' },
  dropdown: { string: 'yes', typed: { kind: 'listItem', value: 'yes' }, display: 'Yes please' },
  combo: { string: 'typed in', typed: { kind: 'text', text: 'typed in' }, display: 'typed in' },
  date: { string: '2024-01-02', typed: { kind: 'date', iso: '2024-01-02' }, display: '2024-01-02' },
};

function load(body: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    meta
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function firstParagraphId(part: OoxmlPart): string {
  const find = (node: OoxmlNode): string | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  const id = find(part.root);
  if (!id) throw new Error('no paragraph');
  return id;
}

function write(part: OoxmlPart, kind: Kind, input: 'string' | 'typed'): string {
  const node = contentControlsIn(part.root)[0]!.node;
  const op = {
    op: 'setContentControlValue',
    controlId: node.id,
    value: input === 'string' ? writes[kind].string : writes[kind].typed,
  } as TreeDocOp;
  expect(validateTreeOp(part, op)).toBeNull();
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return serializeOoxmlPart(result.part);
}

for (const kind of ['text', 'dropdown', 'combo', 'date'] as const) {
  for (const [placement, body] of [
    ['inline', paragraph(control(kind, run))],
    ['paragraph', control(kind, paragraph(run))],
    ['cell', table(row(control(kind, cell(paragraph(run)))))],
    ['row', table(control(kind, row(cell(paragraph(run)))))],
    ['table', control(kind, table(row(cell(paragraph(run)))))],
  ] as const) {
    for (const input of ['string', 'typed'] as const) {
      test(`${kind} ${input} writes keep the complete ${placement} structure`, () => {
        const before = serializeOoxmlPart(load(body));
        const xml = write(load(body), kind, input);
        // Everything outside the replaced run survives: cells, rows, properties, bookmarks.
        expect(xml.match(/<w:tc>/g)?.length ?? 0).toBe(before.match(/<w:tc>/g)?.length ?? 0);
        expect(xml.match(/<w:tr /g)?.length ?? 0).toBe(before.match(/<w:tr /g)?.length ?? 0);
        expect(xml.match(/<w:p /g)?.length ?? 0).toBe(before.match(/<w:p /g)?.length ?? 0);
        if (placement !== 'inline') expect(xml).toContain('<w:pStyle w:val="BOX"/>');
        expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="Field"/>');
        expect(xml).toContain('<w:bookmarkEnd w:id="0"/>');
        if (placement === 'cell' || placement === 'row' || placement === 'table') {
          expect(xml).toContain('<w:tcW w:type="dxa" w:w="434"/>');
          expect(xml).toContain('Keep this label');
        }
        // The value is one run that keeps the old run's face. Inside a paragraph it sits
        // between the bookmark's ends; inline, the bookmark wraps the whole control.
        const valueRun = `<w:r><w:rPr><w:b/></w:rPr><w:t>${writes[kind].display}</w:t></w:r>`;
        expect(xml).toContain(
          placement === 'inline'
            ? `<w:sdtContent>${valueRun}</w:sdtContent>`
            : `<w:bookmarkStart w:id="0" w:name="Field"/>${valueRun}<w:bookmarkEnd w:id="0"/>`
        );
        expect(xml).not.toContain('<w:t>old</w:t>');
        const reopened = readOoxmlPart(xml, meta);
        expect(reopened.ok).toBe(true);
      });
    }
  }
}

for (const input of ['string', 'typed'] as const) {
  test(`text ${input} writes into a cell collapse extra paragraphs but keep the cell`, () => {
    const two = paragraph(run) + '<w:p><w:r><w:t>second</w:t></w:r></w:p>';
    const xml = write(load(table(row(control('text', cell(two))))), 'text', input);
    expect(xml.match(/<w:tc>/g)).toHaveLength(2);
    expect(xml).not.toContain('second');
    expect(xml).toContain('<w:t>new</w:t>');
    expect(xml).toContain('Keep this label');
  });

  test(`text ${input} writes replace inline content but keep its markers`, () => {
    const inline =
      '<w:commentRangeStart w:id="3"/><w:hyperlink w:anchor="x"><w:r><w:t>old</w:t></w:r></w:hyperlink><w:r><w:t>more</w:t></w:r><w:commentRangeEnd w:id="3"/>';
    const xml = write(load(paragraph(control('text', inline))), 'text', input);
    expect(xml).toContain(
      '<w:sdtContent><w:commentRangeStart w:id="3"/><w:r><w:t>new</w:t></w:r><w:commentRangeEnd w:id="3"/></w:sdtContent>'
    );
  });

  test(`an empty block-level text ${input} write lands its run inside a paragraph`, () => {
    const xml = write(load(control('text', '')), 'text', input);
    expect(xml).toContain('<w:sdtContent><w:p><w:r><w:t>new</w:t></w:r></w:p></w:sdtContent>');
  });

  test(`an empty inline text ${input} write inside a hyperlink lands a bare run`, () => {
    const xml = write(
      load(`<w:p><w:hyperlink w:anchor="top">${control('text', '')}</w:hyperlink></w:p>`),
      'text',
      input
    );
    expect(xml).toContain('<w:hyperlink w:anchor="top"><w:sdt>');
    expect(xml).toContain(
      '<w:sdtContent><w:r><w:t>new</w:t></w:r></w:sdtContent></w:sdt></w:hyperlink>'
    );
    expect(xml.match(/<w:p>/g)).toHaveLength(1);
  });

  test(`text ${input} writes drop the placeholder style from the prompt run`, () => {
    const prompt =
      '<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/><w:i/></w:rPr><w:t>Click here</w:t></w:r>';
    const xml = write(load(paragraph(control('text', prompt))), 'text', input);
    expect(xml).not.toContain('PlaceholderText');
    expect(xml).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t>new</w:t></w:r>');
  });

  test(`text ${input} writes replace a picture in the cell's paragraph but keep the cell`, () => {
    // The value replaces the paragraph's content, pictures included, as Word does. Only the
    // structure around the paragraph must survive.
    const drawing =
      '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"/></w:drawing></w:r>';
    const xml = write(load(table(row(control('text', cell(paragraph(drawing)))))), 'text', input);
    expect(xml).not.toContain('<w:drawing>');
    expect(xml.match(/<w:tc>/g)).toHaveLength(2);
    expect(xml).toContain('<w:tcBorders>');
    expect(xml).toContain('<w:t>new</w:t>');
  });

  test(`text ${input} writes refuse a nested block control they cannot write, not flatten it`, () => {
    // The nested control's paragraph holds an equation, so no value can stand in for it. The
    // refusal must come back through the outer control instead of the inline fallback deleting
    // the nested control and leaving a bare run at block level.
    const nested =
      '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath><w:r><w:t>old</w:t></w:r></w:p></w:sdtContent></w:sdt>';
    const part = load(control('text', nested));
    const before = serializeOoxmlPart(part);
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test(`text ${input} writes refuse an empty nested block control rather than dropping it`, () => {
    const nested = '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent/></w:sdt>';
    const part = load(control('text', nested));
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
  });

  test(`text ${input} writes refuse a table beside the display paragraph`, () => {
    // Keeping the table would leave the control's text different from the value written;
    // dropping it is the data loss this walk exists to stop. Either order refuses.
    const nestedTable = table(row(cell('<w:p><w:r><w:t>cell</w:t></w:r></w:p>')));
    for (const body of [paragraph(run) + nestedTable, nestedTable + paragraph(run)]) {
      const part = load(control('text', body));
      const before = serializeOoxmlPart(part);
      const node = contentControlsIn(part.root)[0]!.node;
      const op = {
        op: 'setContentControlValue',
        controlId: node.id,
        value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
      } as TreeDocOp;
      expect(validateTreeOp(part, op)).toBe('unsupported');
      expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
      expect(serializeOoxmlPart(part)).toBe(before);
    }
  });

  test(`text ${input} writes prefer the paragraph with live text and take its face`, () => {
    const empty = '<w:p><w:pPr><w:pStyle w:val="Empty"/></w:pPr></w:p>';
    const xml = write(
      load(table(row(control('text', cell(empty + paragraph(run)))))),
      'text',
      input
    );
    expect(xml).not.toContain('<w:pStyle w:val="Empty"/>');
    expect(xml).toContain(
      '<w:pStyle w:val="BOX"/></w:pPr><w:bookmarkStart w:id="0" w:name="Field"/><w:r><w:rPr><w:b/></w:rPr><w:t>new</w:t></w:r><w:bookmarkEnd w:id="0"/>'
    );
    expect(xml.match(/<w:tc>/g)).toHaveLength(2);
  });

  test(`text ${input} writes keep a comment anchor beside the value`, () => {
    const commented =
      '<w:commentRangeStart w:id="3"/><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="3"/></w:r>';
    const xml = write(load(paragraph(control('text', commented))), 'text', input);
    expect(xml).toContain(
      '<w:sdtContent><w:commentRangeStart w:id="3"/><w:r><w:rPr><w:b/></w:rPr><w:t>new</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="3"/></w:r></w:sdtContent>'
    );
  });

  test(`text ${input} writes drop revision records and link styling from the inherited face`, () => {
    const styled =
      '<w:hyperlink w:anchor="x"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>link</w:t></w:r></w:hyperlink><w:r><w:rPr><w:i/><w:rPrChange w:id="9" w:author="A" w:date="2024-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>old</w:t></w:r>';
    const xml = write(load(paragraph(control('text', styled))), 'text', input);
    expect(xml).toContain(
      '<w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>new</w:t></w:r></w:sdtContent>'
    );
  });

  test(`text ${input} writes refuse a complex field that reaches past the control`, () => {
    const half =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1/1</w:t></w:r>';
    const part = load(
      '<w:p>' + control('text', half) + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
  });

  test(`typing into a ${input === 'string' ? 'cell' : 'row'} prompt keeps the structure it wraps`, () => {
    const prompt = `<w:sdt><w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>${
      input === 'string'
        ? cell(
            paragraph(
              '<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click here</w:t></w:r>'
            )
          )
        : row(
            cell(
              paragraph(
                '<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click here</w:t></w:r>'
              )
            )
          )
    }</w:sdtContent></w:sdt>`;
    const part = load(table(input === 'string' ? row(prompt) : prompt));
    const promptParagraph = firstParagraphId(part);
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: promptParagraph,
      offset: 0,
      text: 'T',
    });
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml.match(/<w:tc>/g)).toHaveLength(2);
    expect(xml).toContain('<w:tcBorders>');
    expect(xml).toContain('Keep this label');
    expect(xml).toContain('<w:pStyle w:val="BOX"/>');
    expect(xml).toContain('<w:t>T</w:t>');
    expect(xml).not.toContain('Click here');
    expect(xml).not.toContain('PlaceholderText');
    expect(xml).not.toContain('showingPlcHdr');
  });

  test(`typing into a prompt no value can stand in for is refused, not flattened (${input})`, () => {
    const math =
      '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>';
    const prompt = `<w:sdt><w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>${cell(
      paragraph('<w:r><w:t>Click here</w:t></w:r>' + math)
    )}</w:sdtContent></w:sdt>`;
    const part = load(table(row(prompt)));
    const before = serializeOoxmlPart(part);
    const op = {
      op: 'insertText',
      paragraphId: firstParagraphId(part),
      offset: input === 'string' ? 0 : 5,
      text: 'T',
    } as const;
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
    expect(serializeOoxmlPart(part)).toBe(before);
  });

  test(`typing into an empty leading prompt paragraph keeps the caret's paragraph (${input})`, () => {
    // The caret's paragraph is the display paragraph even when a later one holds the prompt
    // text, so the insert that follows still finds it.
    const prompt =
      '<w:sdt><w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:pPr><w:pStyle w:val="Lead"/></w:pPr></w:p>' +
      '<w:p><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click here</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>';
    const part = load(input === 'string' ? prompt : table(row(cell(prompt))));
    const lead = firstParagraphId(part);
    const result = applyTreeOp(part, { op: 'insertText', paragraphId: lead, offset: 0, text: 'T' });
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain('<w:pStyle w:val="Lead"/></w:pPr><w:r><w:t>T</w:t></w:r></w:p>');
    expect(xml).not.toContain('Click here');
    // The prompt's second paragraph is gone; the label cell's paragraph stays in the table.
    expect(xml.match(/<w:p>/g)).toHaveLength(input === 'string' ? 1 : 2);
    expect(result.effect.dirty).toContain(lead);
    expect(result.effect.deleted).toHaveLength(1);
    expect(result.effect.impact).toBe('flow-structural');
  });

  test(`typing into a row prompt from its second cell lands there (${input})`, () => {
    const prompt =
      '<w:sdt><w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent>' +
      row(cell('<w:p><w:r><w:t>Click here</w:t></w:r></w:p>')) +
      '</w:sdtContent></w:sdt>';
    const part = load(table(prompt));
    const ids = paragraphIds(part);
    const second = ids[1]!;
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: second,
      offset: input === 'string' ? 0 : 4,
      text: 'T',
    });
    if (!result.ok) throw new Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml.match(/<w:tc>/g)).toHaveLength(2);
    expect(xml).toContain(input === 'string' ? '<w:t>T</w:t>' : '<w:t>T</w:t>');
    expect(xml).toContain('Click here');
    expect(xml).not.toContain('showingPlcHdr');
  });

  test(`${input} value writes report dropped and kept paragraphs in their effect`, () => {
    const two = paragraph(run) + '<w:p><w:r><w:t>second</w:t></w:r></w:p>';
    const part = load(control('text', two));
    const [first, second] = paragraphIds(part);
    const node = contentControlsIn(part.root)[0]!.node;
    const result = applyTreeOp(part, {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp);
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.dirty).toContain(first!);
    expect(result.effect.deleted).toEqual([second!]);
    expect(result.effect.created).toEqual([]);

    const empty = load(control('text', ''));
    const emptyNode = contentControlsIn(empty.root)[0]!.node;
    const minted = applyTreeOp(empty, {
      op: 'setContentControlValue',
      controlId: emptyNode.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp);
    if (!minted.ok) throw new Error(minted.reason);
    expect(minted.effect.created).toEqual(paragraphIds(minted.part));
    expect(minted.effect.deleted).toEqual([]);
  });

  test(`text ${input} writes prefer a paragraph with characters over one with an empty run`, () => {
    const emptyRun =
      '<w:p><w:pPr><w:pStyle w:val="First"/></w:pPr><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>';
    const real =
      '<w:p><w:pPr><w:pStyle w:val="Second"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>real</w:t></w:r></w:p>';
    const xml = write(load(control('text', emptyRun + real)), 'text', input);
    expect(xml).toContain(
      '<w:pStyle w:val="Second"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>new</w:t></w:r>'
    );
    expect(xml).not.toContain('<w:pStyle w:val="First"/>');
  });

  test(`text ${input} writes over a plain run stay plain, whatever the paragraph mark says`, () => {
    const marked = '<w:p><w:pPr><w:rPr><w:i/></w:rPr></w:pPr><w:r><w:t>old</w:t></w:r></w:p>';
    const xml = write(load(control('text', marked)), 'text', input);
    expect(xml).toContain('</w:pPr><w:r><w:t>new</w:t></w:r></w:p>');
  });

  test(`text ${input} writes into a row control land in the first cell that holds text`, () => {
    const emptyCell = cell('<w:p><w:pPr><w:pStyle w:val="Empty"/></w:pPr></w:p>');
    const body = table(control('text', row(emptyCell + cell(paragraph(run)))));
    const xml = write(load(body), 'text', input);
    expect(xml).toContain('<w:pStyle w:val="Empty"/></w:pPr></w:p>');
    expect(xml).toContain(
      '<w:bookmarkStart w:id="0" w:name="Field"/><w:r><w:rPr><w:b/></w:rPr><w:t>new</w:t></w:r><w:bookmarkEnd w:id="0"/>'
    );
    expect(xml).not.toContain('<w:t>old</w:t>');
    expect(xml.match(/<w:tc>/g)).toHaveLength(3);
  });

  test(`text ${input} writes refuse an unknown block beside the display paragraph`, () => {
    const part = load(
      control(
        'text',
        paragraph(run) +
          '<w:altChunk r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
      )
    );
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
  });

  test(`text ${input} writes refuse a run that mixes a comment anchor with text`, () => {
    const mixed =
      '<w:commentRangeStart w:id="3"/><w:r><w:t>old</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/><w:t>tail</w:t></w:r>';
    const part = load(paragraph(control('text', mixed)));
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
  });

  test(`text ${input} writes refuse opaque content without flattening it`, () => {
    const part = load(
      control('text', '<x:content xmlns:x="urn:opaque"><x:value>keep</x:value></x:content>')
    );
    const node = contentControlsIn(part.root)[0]!.node;
    const op = {
      op: 'setContentControlValue',
      controlId: node.id,
      value: input === 'string' ? 'new' : { kind: 'text', text: 'new' },
    } as TreeDocOp;
    expect(validateTreeOp(part, op)).toBe('unsupported');
    expect(applyTreeOp(part, op)).toEqual({ ok: false, reason: 'unsupported' });
  });
}
