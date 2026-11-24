import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach, expect, test } from 'bun:test';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const EQUATION = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const BODY =
  `<w:p xmlns:m="${M}"><w:r><w:t>co</w:t><w:softHyphen/><w:t>op</w:t></w:r>` +
  EQUATION +
  '<w:r><w:t>end</w:t><w:noBreakHyphen/><w:t>tail</w:t></w:r></w:p>';
const mounted: ReturnType<typeof mount>[] = [];

function open(body: string) {
  const result = mount(body);
  mounted.push(result);
  return result.surface;
}

afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

test('whole-paragraph rich paste preserves equations, hyphens, and the paragraph boundary', () => {
  const source = open(BODY);
  source.selectAll();
  const flavours = source.copyFlavours();
  expect(flavours.text).toBe('coopxend\u2011tail');

  const target = open(paragraph('AB'));
  putCaret(target, 1);
  expect(target.pasteRich(flavours.text, flavours.html)).toBe(true);
  expect(target.session.bodyText()).toBe('Aco\u001fop\ufffcend\u001etail\nB');
  target.selectAll();
  expect(target.selectedText()).toBe('Aco\u00adop\ufffcend\u2011tail\nB');
  expect(target.copyFlavours().text).toBe('Acoopxend\u2011tail\nB');
  putCaret(target, 6);
  expect(target.equations.equationAtCaret()?.linear).toBe('x');

  target.undo();
  expect(target.session.bodyText()).toBe('AB');
  target.redo();
  target.selectAll();
  expect(target.selectedText()).toBe('Aco\u00adop\ufffcend\u2011tail\nB');
  expect(target.copyFlavours().text).toBe('Acoopxend\u2011tail\nB');
});

test('a partial copy keeps the equation after an optional hyphen at its selected position', () => {
  const source = open(BODY);
  const paragraphId = source.session.paragraphIds()[0]!;
  source.setSelection({
    anchor: { paragraphId, offset: 2 },
    head: { paragraphId, offset: 7 },
  });
  const flavours = source.copyFlavours();
  expect(flavours.text).toBe('opxe');

  const target = open(paragraph(''));
  putCaret(target, 0);
  expect(target.pasteRich(flavours.text, flavours.html)).toBe(true);
  target.selectAll();
  expect(target.selectedText()).toBe('\u00adop\ufffce');
  putCaret(target, 3);
  expect(target.equations.equationAtCaret()?.linear).toBe('x');
});
