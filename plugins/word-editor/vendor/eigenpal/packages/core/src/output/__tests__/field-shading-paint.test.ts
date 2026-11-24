// Word's field shading: the grey block behind computed text.
//
// A view affordance, not document formatting. It answers "where did this text come from" — a
// page number, a cross-reference, the blank in a form — and Word does not print it. Two
// independent rules, which is the part worth pinning: legacy form fields follow the DOCUMENT's
// `w:doNotShadeFormData`, ordinary fields follow the HOST's preference.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout, type PaintOptions } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paint(body: string, options: PaintOptions = {}): HTMLElement {
  const layout = layoutSemanticDocument(load(body), 1, { measurer });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false, ...options });
  return container;
}

function fieldSpans(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-field-atom]')];
}

/** A complex field; `ffData` present makes it a legacy FORM field. */
function complexField(text: string, formField: boolean): string {
  const payload = formField
    ? '<w:ffData><w:name w:val="Text1"/><w:enabled/>' +
      '<w:textInput><w:default w:val="Placeholder"/></w:textInput></w:ffData>'
    : '';
  return (
    `<w:p><w:r><w:fldChar w:fldCharType="begin">${payload}</w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> ${formField ? 'FORMTEXT' : 'REF _Ref1 \\h'} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    `<w:r><w:t>${text}</w:t></w:r>` +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
}

describe('marking which spans are fields', () => {
  test('a form field is distinguishable from an ordinary one', () => {
    expect(fieldSpans(paint(complexField('Placeholder', true)))[0]?.dataset.fieldAtom).toBe('form');
    expect(fieldSpans(paint(complexField('Section 3', false)))[0]?.dataset.fieldAtom).toBe('field');
  });

  test('ordinary text is not marked at all', () => {
    expect(fieldSpans(paint('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'))).toHaveLength(0);
  });

  test('the mark is present even when shading is off, so a host can flip it without relayout', () => {
    const spans = fieldSpans(paint(complexField('Section 3', false), { fieldShading: 'never' }));
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(span.classList.contains('docx-field-atom')).toBe(false);
  });

  test('a result that wraps carries the mark on every span it broke into', () => {
    // Line breaking splits a field's result at its spaces like any other text. Marking only
    // the first span would shade half a cross-reference.
    const spans = fieldSpans(paint(complexField('Section 3', false), { fieldShading: 'always' }));
    expect(spans.length).toBeGreaterThan(1);
    for (const span of spans) {
      expect(span.classList.contains('docx-field-atom--shaded')).toBe(true);
    }
  });
});

describe('legacy form fields follow the document', () => {
  test('shaded by default, because Word shades them unless told not to', () => {
    const span = fieldSpans(paint(complexField('Placeholder', true)))[0]!;
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(true);
  });

  test('w:doNotShadeFormData turns them off', () => {
    const span = fieldSpans(
      paint(complexField('Placeholder', true), { shadeFormFields: false })
    )[0]!;
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(false);
  });

  test('the host field-shading preference does not govern them', () => {
    // A form's blanks are the document's statement about itself, not a reader's preference.
    const span = fieldSpans(
      paint(complexField('Placeholder', true), { fieldShading: 'never' })
    )[0]!;
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(true);
  });
});

describe('ordinary fields follow the host preference', () => {
  const body = complexField('Section 3', false);

  test('always shades without waiting for the caret', () => {
    const span = fieldSpans(paint(body, { fieldShading: 'always' }))[0]!;
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(true);
  });

  test('never draws nothing at all', () => {
    const span = fieldSpans(paint(body, { fieldShading: 'never' }))[0]!;
    expect(span.classList.contains('docx-field-atom')).toBe(false);
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(false);
  });

  test('when-selected defers the decision to the caret', () => {
    // Marked as shadable, but NOT resolved — the surface adds `--active` as the caret moves,
    // which is what keeps the caret out of layout's cache key.
    const span = fieldSpans(paint(body, { fieldShading: 'when-selected' }))[0]!;
    expect(span.classList.contains('docx-field-atom')).toBe(true);
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(false);
  });

  test('when-selected is the default', () => {
    const span = fieldSpans(paint(body))[0]!;
    expect(span.classList.contains('docx-field-atom')).toBe(true);
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(false);
  });
});

describe('shading against a tracked change', () => {
  test('a deleted field still reads as deleted', () => {
    // The revision wash is inline style and the shading is a class, so the wash wins. A field
    // that was struck must say "removed" first and "computed" second.
    const body =
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> REF a </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:del w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">' +
      '<w:r><w:delText>Section 3</w:delText></w:r></w:del>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    const span = fieldSpans(paint(body, { fieldShading: 'always' }))[0]!;
    expect(span.dataset.revisionKind).toBe('delete');
    expect(span.style.textDecorationLine).toBe('line-through');
    // The shading class is still there; the stylesheet loses to the inline wash.
    expect(span.classList.contains('docx-field-atom--shaded')).toBe(true);
    expect(span.style.backgroundColor).toBe('var(--doc-revision-deletion-wash)');
  });
});
