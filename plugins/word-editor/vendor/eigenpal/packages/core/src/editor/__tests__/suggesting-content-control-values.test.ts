// Suggesting a content control's value: a dropdown, combo box, date picker or checkbox value
// becomes a tracked replacement inside the control, never a direct write, and accepting or
// rejecting it leaves the control's recorded state in line with the text it shows.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const sdt = (properties: string, content: string) =>
  `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const DROPDOWN =
  '<w:dropDownList w:lastValue="1"><w:listItem w:displayText="One" w:value="1"/>' +
  '<w:listItem w:displayText="Two" w:value="2"/><w:listItem w:displayText="Three" w:value="3"/>' +
  '</w:dropDownList>';
const COMBO =
  '<w:comboBox w:lastValue="1"><w:listItem w:displayText="One" w:value="1"/>' +
  '<w:listItem w:displayText="Two" w:value="2"/></w:comboBox>';
const CHECKBOX =
  '<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
  '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>';
const DATE = '<w:date w:fullDate="2030-01-02T00:00:00Z"><w:dateFormat w:val="M/d/yyyy"/></w:date>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const editors: ReturnType<typeof createDocxEditor>[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function open(body: string, mode: 'suggest' | 'edit' = 'suggest') {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
  });
  editors.push(editor);
  const surface = editor.surface!;
  surface.setAuthor('Reviewer');
  surface.setEditingMode(mode);
  const controlId = (): string => {
    const visit = (node: OoxmlNode): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'contentControl') return node.id;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(surface.session.part().root)!;
  };
  const xml = async () =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  const control = async () => {
    const all = await xml();
    return all.slice(all.indexOf('<w:sdt>'), all.indexOf('</w:sdt>'));
  };
  const decide = (op: 'acceptAllRevisions' | 'rejectAllRevisions') =>
    expect(surface.session.applyTreeOps([{ op }]).committed).toBe(true);
  return { editor, surface, controlId, xml, control, decide };
}

test('a dropdown choice is proposed inside the control, and either decision keeps its state', async () => {
  for (const decision of ['acceptAllRevisions', 'rejectAllRevisions'] as const) {
    const view = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`);
    expect(view.surface.contentControls.setValue(view.controlId(), '2')).toBe(true);
    const proposed = await view.control();
    expect(proposed).toContain('<w:delText>One</w:delText>');
    expect(proposed).toMatch(/<w:ins [^>]*><w:r><w:t>Two<\/w:t><\/w:r><\/w:ins>/);
    expect(proposed).toContain('w:lastValue="2"');
    view.decide(decision);
    const decided = await view.control();
    expect(decided).not.toContain('<w:ins ');
    expect(decided).not.toContain('<w:del ');
    if (decision === 'acceptAllRevisions') {
      expect(decided).toContain('<w:t>Two</w:t>');
      expect(decided).toContain('w:lastValue="2"');
    } else {
      expect(decided).toContain('>One</w:t>');
      expect(decided).toContain('w:lastValue="1"');
    }
  }
});

test('a checkbox toggle is proposed, and a rejection unchecks its recorded state too', async () => {
  const view = open(`<w:p>${run('Done: ')}${sdt(CHECKBOX, run('☐'))}</w:p>`);
  expect(view.surface.contentControls.setValue(view.controlId(), 'true')).toBe(true);
  const proposed = await view.control();
  expect(proposed).toContain('<w:delText>☐</w:delText>');
  expect(proposed).toMatch(
    /<w:ins [^>]*><w:r>(<w:rPr>.*<\/w:rPr>)?<w:sym w:char="2612" w:font="MS Gothic"\/>/
  );
  expect(proposed).toContain('<w14:checked w14:val="1"/>');
  view.decide('rejectAllRevisions');
  const rejected = await view.control();
  expect(rejected).toContain('☐');
  expect(rejected).toContain('<w14:checked w14:val="0"/>');
});

test('a combo box keeps a typed value as its last value after acceptance', async () => {
  const view = open(`<w:p>${sdt(COMBO, run('One'))}</w:p>`);
  expect(view.surface.contentControls.setValue(view.controlId(), 'Custom')).toBe(true);
  expect(await view.control()).toContain('<w:delText>One</w:delText>');
  view.decide('acceptAllRevisions');
  const accepted = await view.control();
  expect(accepted).toContain('<w:t>Custom</w:t>');
  expect(accepted).toContain('w:lastValue="Custom"');
});

test('a date is proposed; acceptance keeps the new day and rejection drops the stale one', async () => {
  const accepted = open(`<w:p>${sdt(DATE, run('1/2/2030'))}</w:p>`);
  expect(accepted.surface.contentControls.setValue(accepted.controlId(), '2031-05-06')).toBe(true);
  expect(await accepted.control()).toContain('<w:delText>1/2/2030</w:delText>');
  accepted.decide('acceptAllRevisions');
  expect(await accepted.control()).toContain('5/6/2031');
  expect(await accepted.control()).toContain('w:fullDate="2031-05-06');

  const rejected = open(`<w:p>${sdt(DATE, run('1/2/2030'))}</w:p>`);
  expect(rejected.surface.contentControls.setValue(rejected.controlId(), '2031-05-06')).toBe(true);
  rejected.decide('rejectAllRevisions');
  const restored = await rejected.control();
  expect(restored).toContain('1/2/2030');
  // The rejected day is not left behind to open the picker on.
  expect(restored).not.toContain('2031-05-06');
});

test('a prompt is struck by the proposal, and a rejection shows it as the prompt again', async () => {
  const PROMPTED =
    '<w:dropDownList><w:listItem w:displayText="Choose an item." w:value=""/>' +
    '<w:listItem w:displayText="Three" w:value="3"/></w:dropDownList>';
  const styled = (text: string) =>
    `<w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${text}</w:t></w:r>`;
  for (const [properties, prompt, value] of [
    // A block control, as a list prompt with no value names it.
    [PROMPTED, run('Choose an item.'), '3'],
    // A date has no list: the prompt character style names it.
    [
      '<w:date><w:dateFormat w:val="M/d/yyyy"/></w:date>',
      styled('Click to enter a date.'),
      '2031-05-06',
    ],
  ] as const) {
    const view = open(sdt(`<w:showingPlcHdr/>${properties}`, `<w:p>${prompt}</w:p>`));
    expect(view.surface.contentControls.setValue(view.controlId(), value)).toBe(true);
    const proposed = await view.control();
    expect(proposed).toMatch(
      /<w:del [^>]*>.*<w:delText>(Choose an item\.|Click to enter a date\.)/
    );
    expect(proposed).toMatch(/<w:ins [^>]*><w:r>.*<w:t>(Three|5\/6\/2031)<\/w:t>/);
    expect(proposed).not.toContain('showingPlcHdr');
    view.decide('rejectAllRevisions');
    const rejected = await view.control();
    expect(rejected).toContain('<w:showingPlcHdr/>');
    expect(rejected).toMatch(/<w:t>(Choose an item\.|Click to enter a date\.)<\/w:t>/);
    expect(rejected).not.toContain('<w:ins ');
  }
});

test('choosing the original value again withdraws the author’s own pending choice', async () => {
  const box = open(`<w:p>${run('Done: ')}${sdt(CHECKBOX, run('☐'))}</w:p>`);
  const before = await box.control();
  expect(box.surface.contentControls.setValue(box.controlId(), 'true')).toBe(true);
  expect(box.surface.contentControls.setValue(box.controlId(), 'false')).toBe(true);
  expect(await box.control()).toBe(before);

  const list = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`);
  expect(list.surface.contentControls.setValue(list.controlId(), '2')).toBe(true);
  expect(list.surface.contentControls.setValue(list.controlId(), '1')).toBe(true);
  const back = await list.control();
  expect(back).not.toContain('<w:ins ');
  expect(back).not.toContain('<w:del ');
  expect(back).toContain('w:lastValue="1"');

  // Another author's pending choice is not the author's to take back.
  const shared = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`);
  expect(shared.surface.contentControls.setValue(shared.controlId(), '2')).toBe(true);
  shared.surface.setAuthor('Second');
  expect(shared.surface.contentControls.setValue(shared.controlId(), '1')).toBe(true);
  expect(await shared.control()).toContain('w:author="Reviewer"');
});

test('picking again retracts the author’s own pending choice', async () => {
  const view = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`);
  expect(view.surface.contentControls.setValue(view.controlId(), '2')).toBe(true);
  expect(view.surface.contentControls.setValue(view.controlId(), '3')).toBe(true);
  const proposed = await view.control();
  expect(proposed.split('<w:del ')).toHaveLength(2);
  expect(proposed.split('<w:ins ')).toHaveLength(2);
  expect(proposed).not.toContain('>Two<');
  expect(proposed).toContain('<w:t>Three</w:t>');
  view.decide('rejectAllRevisions');
  expect(await view.control()).toContain('w:lastValue="1"');
});

test('undo takes a proposed value back whole, and redo proposes it again', async () => {
  const view = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`);
  const original = await view.control();
  expect(view.surface.contentControls.setValue(view.controlId(), '2')).toBe(true);
  expect(view.editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(await view.control()).toBe(original);
  expect(view.editor.exec({ type: 'redo' }).ok).toBe(true);
  expect(await view.control()).toContain('<w:delText>One</w:delText>');
});

test('a block dropdown is proposed inside its paragraph', async () => {
  const view = open(sdt(DROPDOWN, `<w:p>${run('One')}</w:p>`) + '<w:p/>');
  expect(view.surface.contentControls.setValue(view.controlId(), '2')).toBe(true);
  const proposed = await view.control();
  expect(proposed).toMatch(
    /<w:p[^>]*><w:del [^>]*>.*One.*<\/w:del><w:ins [^>]*>.*Two.*<\/w:ins><\/w:p>/
  );
});

test('editing mode still writes the value directly', async () => {
  const view = open(`<w:p>${sdt(DROPDOWN, run('One'))}</w:p>`, 'edit');
  expect(view.surface.contentControls.setValue(view.controlId(), '2')).toBe(true);
  const written = await view.control();
  expect(written).not.toContain('<w:ins ');
  expect(written).not.toContain('<w:del ');
  expect(written).toContain('<w:t>Two</w:t>');
});
