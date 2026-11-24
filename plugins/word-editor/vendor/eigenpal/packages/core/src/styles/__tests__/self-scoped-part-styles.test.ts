// A shape or chart part, a colour picker, or a pane placed outside the editor carries the
// `.docx-editor` scope class on its own element. A rule written as `.docx-editor .x` matches
// only descendants of the scope, so each rule whose subject is such an element must also match
// `.docx-editor.x`. Otherwise the placed part loses its layout, font, and popover position.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const css = readFileSync(resolve(import.meta.dir, '../editor.css'), 'utf8');

/** The classes that sit on an element that can carry the scope class itself. */
const SELF_SCOPED = [
  'docx-object-control',
  'docx-object-control--field',
  'docx-object-control--compact',
  'docx-color-picker',
  'docx-chart-pane',
  'docx-chart-pane__color',
  'docx-shape-pane__color',
];

/** Each selector of the stylesheet, as written. */
function selectors(): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) found.push(selector);
  });
  return found;
}

test('each rule on a self-scoped element also matches that element when it carries the scope', () => {
  const all = selectors();
  for (const name of SELF_SCOPED) {
    const descendantOnly = all.filter((s) => s.trim() === `.docx-editor .${name}`);
    expect({ name, descendantOnly }).toEqual({ name, descendantOnly: [] });
    expect({ name, self: all.some((s) => s.includes(`.docx-editor.${name}`)) }).toEqual({
      name,
      self: true,
    });
  }
});

test('a placed part and a placed picker take the chrome font and text colour', () => {
  const rules = new Map<string, string>();
  postcss.parse(css).walkRules((rule) => {
    for (const s of rule.selectors) rules.set(s, `${rules.get(s) ?? ''}${rule.toString()}`);
  });
  for (const subject of ['.docx-object-control', '.docx-color-picker']) {
    const body = [...rules.entries()]
      .filter(([s]) => s.includes(`.docx-editor${subject}`) && s.trim().endsWith(')'))
      .map(([, b]) => b)
      .join('');
    expect(body).toContain('font-family: var(--doc-font-ui');
    expect(body).toContain('color: var(--doc-text)');
  }
});

test('a grid in a host container stacks its rows', () => {
  const declarations = new Map<string, string>();
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.includes('.docx-editor.docx-color-picker__content--inline')) return;
    rule.walkDecls((decl) => {
      declarations.set(decl.prop, decl.value);
    });
  });
  expect(declarations.get('display')).toBe('flex');
  expect(declarations.get('flex-direction')).toBe('column');
  expect(declarations.has('gap')).toBe(true);
});
