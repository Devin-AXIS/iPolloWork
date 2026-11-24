// Replacing the glyph of a checkbox content control (#1144).
//
// A span that covers exactly the control's display changes the control in place. One of its two
// state glyphs ticks or clears the box, flag included, and keeps the glyph run's properties.
// Other text is refused, because a checkbox shows only its state glyphs.

import { describe, expect, test } from 'bun:test';
import { docx, open, paragraphsOf, refusal, roots, savedMainXml } from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const GOTHIC =
  '<w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr>';

function checkbox(checked: boolean): string {
  return (
    `<w:sdt><w:sdtPr><w:id w:val="1"/><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/>` +
    `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:r>${GOTHIC}<w:t>${checked ? '☒' : '☐'}</w:t></w:r>` +
    `</w:sdtContent></w:sdt>`
  );
}

function withCheckbox(checked = false): { host: AutomationHost; paragraph: AutomationHandle } {
  const host = open(
    docx(`<w:p>${checkbox(checked)}<w:r><w:t xml:space="preserve"> Option A</w:t></w:r></w:p>`)
  );
  return { host, paragraph: paragraphsOf(host, roots(host).body)[0]! };
}

function replace(host: AutomationHost, paragraph: AutomationHandle, end: number, text: string) {
  return host.execute({
    operations: [
      {
        op: 'replaceSpan',
        span: { start: { paragraph, offset: 0 }, end: { paragraph, offset: end } },
        text,
      },
    ],
  });
}

function controlXml(host: AutomationHost): string {
  const xml = savedMainXml(host);
  return xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
}

describe('replaceSpan over a checkbox glyph', () => {
  test('the checked glyph ticks the box inside the control', () => {
    const { host, paragraph } = withCheckbox();
    const response = replace(host, paragraph, 1, '☒');
    expect(response.results[0]!.status).toBe('ok');
    // Nothing is written in front of the control, and the control shows the checked state.
    expect(savedMainXml(host)).toMatch(/<w:p [^>]*><w:sdt>/);
    expect(controlXml(host)).toContain('<w:sym w:char="2612" w:font="MS Gothic"/>');
    expect(controlXml(host)).toContain('w:ascii="MS Gothic"');
    expect(controlXml(host)).toContain('<w14:checked w14:val="1"/>');
  });

  test('the unchecked glyph clears a ticked box', () => {
    const { host, paragraph } = withCheckbox(true);
    expect(replace(host, paragraph, 1, '☐').results[0]!.status).toBe('ok');
    expect(controlXml(host)).toContain('<w:sym w:char="2610" w:font="MS Gothic"/>');
    expect(controlXml(host)).toContain('<w14:checked w14:val="0"/>');
  });

  test('other text over the glyph is refused and the control keeps its glyph', () => {
    const { host, paragraph } = withCheckbox();
    expect(refusal(replace(host, paragraph, 1, 'X'))).toBe('unsupported-capability');
    expect(refusal(replace(host, paragraph, 1, ''))).toBe('unsupported-capability');
    expect(controlXml(host)).toContain('☐');
    expect(savedMainXml(host)).not.toContain('>X<');
  });

  test('text inserted before the checkbox still lands beside it', () => {
    const { host, paragraph } = withCheckbox();
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'Pick: ' }],
    });
    const xml = savedMainXml(host);
    expect(xml.indexOf('Pick: ')).toBeLessThan(xml.indexOf('<w:sdt>'));
    expect(controlXml(host)).toContain('☐');
  });
});
