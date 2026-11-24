// Established content-control value reads over wrappers and struck text.

import { describe, expect, test } from 'bun:test';
import { docx, handlesAt, open, roots, textAt } from './support/protocol.ts';
import type { AutomationTextProjection } from '../operations.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

function controlsOf(host: AutomationHost, scope: { readonly body: AutomationHandle }) {
  return handlesAt(host.execute({ operations: [{ op: 'getContentControls', scope }] }), 0);
}

function controlText(
  host: AutomationHost,
  control: AutomationHandle,
  projection?: AutomationTextProjection
): string {
  return textAt(
    host.execute({
      operations: [{ op: 'getContentControlText', contentControl: control, projection }],
    }),
    0
  );
}

describe('content-control value text', () => {
  test('reads a nested inline control', () => {
    const inner =
      '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt>';
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>' +
          `<w:sdtContent>${inner}</w:sdtContent></w:sdt></w:p>`
      )
    );
    const outer = controlsOf(host, { body: roots(host).body })[0]!;
    const nested = handlesAt(
      host.execute({
        operations: [{ op: 'getContentControls', scope: { contentControl: outer } }],
      }),
      0
    )[0]!;

    expect(controlText(host, nested)).toBe('deep');
  });

  test.each([
    ['hyperlink', '<w:hyperlink w:anchor="target">', '</w:hyperlink>'],
    ['insertion', '<w:ins w:id="1" w:author="Ada">', '</w:ins>'],
  ] as const)('reads a control inside a %s', (_name, openTag, closeTag) => {
    const control =
      '<w:sdt><w:sdtPr><w:tag w:val="wrapped"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>inside</w:t></w:r></w:sdtContent></w:sdt>';
    const host = open(docx(`<w:p>${openTag}${control}${closeTag}</w:p>`));
    const found = controlsOf(host, { body: roots(host).body })[0]!;

    expect(controlText(host, found)).toBe('inside');
  });

  test.each([
    ['hyperlink', '<w:hyperlink w:anchor="target">', '</w:hyperlink>'],
    ['insertion', '<w:ins w:id="1" w:author="Ada">', '</w:ins>'],
  ] as const)('projects a control inside a %s from its own subtree', (_name, openTag, closeTag) => {
    const control =
      '<w:sdt><w:sdtPr><w:tag w:val="wrapped"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>inside</w:t></w:r></w:sdtContent></w:sdt>';
    const host = open(docx(`<w:p>${openTag}${control}${closeTag}</w:p>`));
    const found = controlsOf(host, { body: roots(host).body })[0]!;

    expect(controlText(host, found, 'model')).toBe('inside');
    expect(controlText(host, found, 'original')).toBe('inside');
  });

  test('projects a nested control from its own subtree', () => {
    const inner =
      '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>' +
      '<w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt>';
    const host = open(
      docx(
        '<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>' +
          `<w:sdtContent>${inner}</w:sdtContent></w:sdt></w:p>`
      )
    );
    const outer = controlsOf(host, { body: roots(host).body })[0]!;
    const nested = handlesAt(
      host.execute({
        operations: [{ op: 'getContentControls', scope: { contentControl: outer } }],
      }),
      0
    )[0]!;

    expect(controlText(host, nested, 'model')).toBe('deep');
    expect(controlText(host, nested, 'original')).toBe('deep');
  });

  test('omits struck text and paragraph marks from a block control', () => {
    const host = open(
      docx(
        '<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>' +
          '<w:p><w:r><w:t>one</w:t></w:r><w:del w:id="1" w:author="Ada">' +
          '<w:r><w:delText>GONE</w:delText></w:r></w:del></w:p>' +
          '<w:p><w:r><w:t>two</w:t></w:r></w:p></w:sdtContent></w:sdt>'
      )
    );
    const control = controlsOf(host, { body: roots(host).body })[0]!;

    expect(controlText(host, control)).toBe('onetwo');
  });
});
