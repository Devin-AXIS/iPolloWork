import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  readOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '@docx-editor.dev/core/layout';
import {
  observeUnsupportedElements,
  type UnsupportedElementHost,
} from '../unsupported-elements.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

function layoutAndPaint(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 3, {
    measurer: createFixedMeasurer(6, 14),
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  return { container, layout };
}

const supported =
  '<m:oMath>' +
  '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>' +
  '<m:rad><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>' +
  '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
  '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
  '<m:sub><m:r><m:t>n</m:t></m:r></m:sub><m:sup/>' +
  '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
  '</m:oMath>';

describe('semantic equation paint', () => {
  test('paints nested layout records with activation metadata and pointer events', () => {
    const { container, layout } = layoutAndPaint(
      `<w:p><w:r><w:t>A</w:t></w:r>${supported}<w:r><w:t>Z</w:t></w:r></w:p>`
    );
    const record = linesOf(layout)[0]!.spans.find((span) => span.equation)!;
    const equation = container.querySelector<HTMLElement>('[data-docx-equation]');

    expect(equation).not.toBeNull();
    expect(equation!.dataset.docxEquation).toBe(record.equation!.sourceNodeId);
    expect(equation!.dataset.paragraphId).toBe(record.range.paragraphId);
    expect(equation!.dataset.start).toBe(String(record.range.start));
    expect(equation!.dataset.end).toBe(String(record.range.end));
    expect(equation!.getAttribute('contenteditable')).toBe('false');
    expect(equation!.style.pointerEvents).toBe('auto');
    expect(Number.parseFloat(equation!.style.width)).toBeCloseTo(
      record.equation!.geometry.box.width,
      5
    );
    expect(Number.parseFloat(equation!.style.height)).toBeCloseTo(
      record.equation!.geometry.box.height,
      5
    );
    expect(Number.parseFloat(equation!.style.verticalAlign)).toBeCloseTo(
      -(record.equation!.geometry.box.height - record.equation!.geometry.baseline),
      5
    );
    expect(equation!.querySelector('.docx-equation-fraction')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-radical')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-script')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-nary')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-fraction-bar')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-radical-bar')).not.toBeNull();
  });

  test('writes unsupported markup-like fallback through textContent', () => {
    const payload = '&lt;img src=x onerror=alert(1)&gt;';
    const { container } = layoutAndPaint(
      `<w:p><m:oMath><m:unsupported><m:r><m:t>${payload}</m:t></m:r>` +
        '</m:unsupported></m:oMath></w:p>'
    );
    const equation = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    expect(equation.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(equation.querySelector('img')).toBeNull();
    expect(equation.querySelector('script')).toBeNull();
    let hosts: readonly UnsupportedElementHost[] = [];
    const stop = observeUnsupportedElements(container, (next) => {
      hosts = next;
    });
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.unsupported.localName).toBe('oMath');
    expect(hosts[0]!.unsupported.nodeId).toBe(equation.dataset.docxEquation);
    expect(hosts[0]!.unsupported.label).toBe('<img src=x onerror=alert(1)>');
    stop();
  });
});

test('draws the spaced atoms of one run as one span at the laid-out positions', () => {
  const { container, layout } = layoutAndPaint(
    '<w:p><m:oMath><m:r><m:t>a+b=c</m:t></m:r></m:oMath></w:p>'
  );
  const geometry = linesOf(layout)[0]!.spans.find((span) => span.equation)!.equation!.geometry;
  // Layout keeps one node per atom, each at its spaced position.
  if (geometry.kind !== 'row') throw new Error('expected a row');
  const atoms = geometry.items;
  expect(atoms.map((atom) => (atom.kind === 'text' ? atom.text : atom.kind))).toEqual([
    '𝑎',
    '+',
    '𝑏',
    '=',
    '𝑐',
  ]);
  const spans = Array.from(container.querySelectorAll<HTMLElement>('.docx-equation-text'));
  expect(spans).toHaveLength(1);
  const span = spans[0]!;
  expect(span.textContent).toBe('𝑎+𝑏=𝑐');
  const first = atoms[0]!;
  const last = atoms[atoms.length - 1]!;
  expect(Number.parseFloat(span.style.left)).toBeCloseTo(geometry.box.x + first.box.x, 6);
  expect(Number.parseFloat(span.style.width)).toBeCloseTo(
    last.box.x + last.box.width - first.box.x,
    6
  );
  // Each spaced atom carries its gap as a start margin; the widths of the atoms come from the text.
  const margins = Array.from(span.children).map((child) =>
    Number.parseFloat((child as HTMLElement).style.marginLeft)
  );
  const gaps = atoms
    .slice(1)
    .map((atom, index) => atom.box.x - (atoms[index]!.box.x + atoms[index]!.box.width));
  expect(margins).toHaveLength(gaps.filter((gap) => gap > 0).length);
  margins.forEach((margin, index) =>
    expect(margin).toBeCloseTo(gaps.filter((gap) => gap > 0)[index]!, 6)
  );
});

test('draws each atom after the first as an inline-block so no shaping crosses an atom join', () => {
  const { container, layout } = layoutAndPaint(
    '<w:p><m:oMath><m:r><m:t>f(x),y</m:t></m:r></m:oMath></w:p>'
  );
  const geometry = linesOf(layout)[0]!.spans.find((span) => span.equation)!.equation!.geometry;
  if (geometry.kind !== 'row') throw new Error('expected a row');
  const atoms = geometry.items;
  expect(atoms.map((atom) => (atom.kind === 'text' ? atom.text : atom.kind))).toEqual([
    '𝑓',
    '(',
    '𝑥',
    ')',
    ',',
    '𝑦',
  ]);
  const spans = Array.from(container.querySelectorAll<HTMLElement>('.docx-equation-text'));
  expect(spans).toHaveLength(1);
  const span = spans[0]!;
  // The first atom is the run's own text; every later atom is an atomic inline of its own.
  expect(span.firstChild?.nodeType).toBe(3);
  expect(span.firstChild?.textContent).toBe('𝑓');
  const children = Array.from(span.children) as HTMLElement[];
  expect(span.childNodes).toHaveLength(atoms.length);
  expect(children).toHaveLength(atoms.length - 1);
  expect(children.map((child) => child.textContent)).toEqual(['(', '𝑥', ')', ',', '𝑦']);
  for (const child of children) {
    expect(child.style.display).toBe('inline-block');
    // The face comes from the run span, so a child sets no face of its own.
    expect(child.style.fontFamily).toBe('');
    expect(child.style.fontSize).toBe('');
  }
  // Only a positive gap becomes a start margin.
  children.forEach((child, index) => {
    const previous = atoms[index]!;
    const gap = atoms[index + 1]!.box.x - (previous.box.x + previous.box.width);
    if (gap > 1e-9) expect(Number.parseFloat(child.style.marginLeft)).toBeCloseTo(gap, 6);
    else expect(child.style.marginLeft).toBe('');
  });
  expect(children.some((child) => child.style.marginLeft === '')).toBe(true);
});

test('draws a delimiter grown around a fraction by scaling its characters vertically', () => {
  const { container, layout } = layoutAndPaint(
    '<w:p><m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr>' +
      '<m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
      '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:d></m:oMath></w:p>'
  );
  const geometry = linesOf(layout)[0]!.spans.find((span) => span.equation)!.equation!.geometry;
  const delimiter = geometry.kind === 'row' ? geometry.items[0] : geometry;
  if (delimiter?.kind !== 'delimiter') throw new Error('expected a delimiter');
  const equation = container.querySelector<HTMLElement>('[data-docx-equation]')!;
  expect(equation.querySelector('.docx-equation-fallback')).toBeNull();
  expect(equation.querySelector('.docx-equation-fraction-bar')).not.toBeNull();
  const fences = Array.from(
    equation.querySelectorAll<HTMLElement>('.docx-equation-delimiter.docx-equation-text')
  ).filter((span) => span.textContent === '[' || span.textContent === ']');
  expect(fences.map((span) => span.textContent)).toEqual(['[', ']']);
  fences.forEach((span, index) => {
    const stretch = delimiter.fences[index]!.stretch!;
    expect(stretch.scale).toBeGreaterThan(1);
    expect(span.style.transform).toBe(`scaleY(${stretch.scale})`);
    expect(Number.parseFloat(span.style.transformOrigin.split(' ')[1]!)).toBeCloseTo(
      stretch.originY,
      6
    );
  });
  // The fraction parts are not scaled.
  for (const part of equation.querySelectorAll<HTMLElement>('.docx-equation-fraction')) {
    expect(part.style.transform).toBe('');
  }
});
