import { waitForDocumentSurface } from './wait-for-document.fixture.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  OFFICE_MATH_NAMESPACE_URI,
  applyTreeOp,
  canonicalOoxmlFingerprint,
  equationExpressionToLinearMath,
  findNode,
  projectOmmlEquation,
  readOoxmlPackage,
  type EquationExpression,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  type SemanticLayout,
} from '@docx-editor.dev/core/layout';
import { openTreeSession } from '../../binding/tree-session.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { createKeyDownHandler } from '../surface-input.ts';

const sample = (): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL('../../../../../examples/vite/public/sample.docx', import.meta.url))
  );

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children) yield* walk(child);
}

function equationsOf(part: OoxmlPart): OoxmlElement[] {
  return [...walk(part.root)].filter(
    (node): node is OoxmlElement =>
      node.kind !== 'textValue' &&
      node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
      node.localName === 'oMath'
  );
}

function expressionKinds(expression: EquationExpression): string[] {
  switch (expression.kind) {
    case 'row':
      return [expression.kind, ...expression.items.flatMap(expressionKinds)];
    case 'fraction':
      return [
        expression.kind,
        ...expressionKinds(expression.numerator),
        ...expressionKinds(expression.denominator),
      ];
    case 'radical':
      return [
        expression.kind,
        ...(expression.degree ? expressionKinds(expression.degree) : []),
        ...expressionKinds(expression.radicand),
      ];
    case 'script':
      return [
        expression.kind,
        ...expressionKinds(expression.base),
        ...(expression.subscript ? expressionKinds(expression.subscript) : []),
        ...(expression.superscript ? expressionKinds(expression.superscript) : []),
      ];
    case 'nary':
      return [
        expression.kind,
        ...expressionKinds(expression.body),
        ...(expression.lowerLimit ? expressionKinds(expression.lowerLimit) : []),
        ...(expression.upperLimit ? expressionKinds(expression.upperLimit) : []),
      ];
    default:
      return [expression.kind];
  }
}

function openSamplePart(): OoxmlPart {
  const opened = readOoxmlPackage(sample());
  if (!opened.ok) throw new Error(opened.reason);
  const part = opened.package.parts.get(opened.package.mainDocumentPart);
  if (!part) throw new Error('sample.docx has no main document part');
  return part;
}

const shapeOf = (layout: SemanticLayout): string => JSON.stringify(layout.pages);

function pageWithEquation(layout: SemanticLayout, equationId: string): number {
  return layout.pages.findIndex((page) =>
    page.fragments.some(
      (fragment) =>
        'lines' in fragment &&
        fragment.lines.some((line) =>
          line.spans.some((span) => span.equation?.sourceNodeId === equationId)
        )
    )
  );
}

const mountedEditors: ReturnType<typeof createDocxEditor>[] = [];

afterEach(() => {
  for (const editor of mountedEditors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

describe('sample.docx equation integration', () => {
  test('projects the authored quadratic, Einstein, and summation structures', () => {
    const equations = equationsOf(openSamplePart());
    expect(equations).toHaveLength(3);

    const projections = equations.map((equation) => {
      const projection = projectOmmlEquation(equation);
      if (!projection) throw new Error(`could not project ${equation.id}`);
      return {
        fallbackText: projection.fallbackText,
        kinds: expressionKinds(projection.expression),
        linear: equationExpressionToLinearMath(projection.expression),
      };
    });

    const [quadratic, einstein, summation] = projections;
    expect(quadratic?.kinds).toEqual(expect.arrayContaining(['fraction', 'radical']));
    expect(quadratic?.linear).toBe('x = {-b ± √{b² - 4ac}}/{2a}');
    expect(einstein?.kinds).toContain('script');
    expect(einstein?.fallbackText).toBe('E = mc2');
    expect(summation?.kinds).toContain('nary');
    expect(summation?.linear).toBe('∑[i=1]^[n]{i}');
  });

  test('exposes a reversible linear form for the authored Einstein equation', () => {
    const equation = equationsOf(openSamplePart())[1]!;
    const projection = projectOmmlEquation(equation);
    if (!projection) throw new Error(`could not project ${equation.id}`);
    expect(equationExpressionToLinearMath(projection.expression)).toBe('E = mc^{2}');
  });

  test('preserves unedited OMML and reopens an edited equation from package bytes', () => {
    const opened = openTreeSession(sample());
    if (!opened.ok) throw new Error(opened.reason);
    const session = opened.session;
    const before = canonicalOoxmlFingerprint(session.part());

    const unedited = readOoxmlPackage(session.save());
    if (!unedited.ok) throw new Error(unedited.reason);
    const uneditedPart = unedited.package.parts.get(unedited.package.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(uneditedPart)).toBe(before);

    const equation = equationsOf(session.part())[0]!;
    const applied = session.applyTreeOps([
      { op: 'setMathEquation', equationId: equation.id, linear: '{a+b}/{2}' },
    ]);
    expect(applied).toMatchObject({ committed: true, rejected: false });

    const edited = readOoxmlPackage(session.save());
    if (!edited.ok) throw new Error(edited.reason);
    const editedPart = edited.package.parts.get(edited.package.mainDocumentPart)!;
    const reopenedEquation = findNode(editedPart, equation.id);
    if (!reopenedEquation || reopenedEquation.kind === 'textValue') {
      throw new Error('edited equation did not reopen');
    }
    const projection = projectOmmlEquation(reopenedEquation);
    expect(projection?.expression.kind).toBe('fraction');
    expect(equationExpressionToLinearMath(projection!.expression)).toBe('{a+b}/{2}');
  });

  test('reconverges equation layout and preserves page identity', () => {
    const part = openSamplePart();
    const equation = equationsOf(part)[0]!;
    const measurer = createFixedMeasurer(6, 14);
    const cache = createParagraphLayoutCache<never>();
    const session = createLayoutSession();
    const options = { measurer, cache: cache as never, session };

    const first = layoutSemanticDocument(part, 1, options);
    const unchanged = layoutSemanticDocument(part, 2, options);
    expect(session.stats.placed).toBe(0);
    expect(unchanged.pages.every((page, index) => page === first.pages[index])).toBe(true);

    const changed = applyTreeOp(part, {
      op: 'setMathEquation',
      equationId: equation.id,
      linear: '{a+b}/{2}+√{x}+x^2',
    });
    if (!changed.ok) throw new Error(changed.reason);
    const incremental = layoutSemanticDocument(changed.part, 3, options);
    const clean = layoutSemanticDocument(changed.part, 3, { measurer });
    expect(shapeOf(incremental)).toBe(shapeOf(clean));

    const equationPage = pageWithEquation(first, equation.id);
    expect(equationPage).toBeGreaterThanOrEqual(0);
    expect(incremental.pages[equationPage]).not.toBe(first.pages[equationPage]);
    expect(
      incremental.pages.some((page, index) => index !== equationPage && page === first.pages[index])
    ).toBe(true);

    const converged = layoutSemanticDocument(changed.part, 4, options);
    expect(session.stats.placed).toBe(0);
    expect(converged.pages.every((page, index) => page === incremental.pages[index])).toBe(true);
  });

  test('moves ArrowRight across one atom and reports the painted activation rect', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: sample() });
    mountedEditors.push(editor);
    const surface = await waitForDocumentSurface(editor);

    const source = equationsOf(surface.session.part())[0]!;
    const equation = surface.equations.equationById(source.id);
    if (!equation) throw new Error('sample equation is not addressable');
    surface.setSelection({
      anchor: { paragraphId: equation.paragraphId, offset: equation.start },
      head: { paragraphId: equation.paragraphId, offset: equation.start },
    });

    createKeyDownHandler(surface)(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
    expect(surface.state().selection).toEqual({
      anchor: { paragraphId: equation.paragraphId, offset: equation.end },
      head: { paragraphId: equation.paragraphId, offset: equation.end },
    });

    const painted = [...container.querySelectorAll<HTMLElement>('[data-docx-equation]')].find(
      (element) => element.dataset.docxEquation === equation.id
    );
    if (!painted) throw new Error('sample equation was not painted');
    Object.defineProperty(painted, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 11,
          top: 22,
          right: 44,
          bottom: 66,
          x: 11,
          y: 22,
          width: 33,
          height: 44,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    const activations: { rect: { left: number; top: number; right: number; bottom: number } }[] =
      [];
    editor.setEquationChrome({ onPopover: (activation) => activations.push(activation) });
    painted.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(activations).toHaveLength(1);
    expect(activations[0]!.rect).toEqual({ left: 11, top: 22, right: 44, bottom: 66 });
  });
});
