import type { OoxmlElement } from '@docx-editor.dev/core/store';
// Paint equation geometry without parsing OMML or measuring DOM.

import { markUnsupportedElement } from './unsupported-elements.ts';
import type {
  EquationGeometry,
  EquationSpanRecord,
  EquationTextGeometry,
  ResolvedRunStyle,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import { applyRevisionPresentation } from './semantic-paint-revisions.ts';
import { revisionMarkupStyle } from '../contracts/revision-markup.ts';
import type { PaintContext } from './semantic-paint.ts';

function place(
  element: HTMLElement,
  geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  scale: number
): void {
  element.style.position = 'absolute';
  // The host is the only hit target. A later, larger run can paint its box past the host,
  // which claims only the run's glyphs on the line, so the box must not take presses there.
  element.style.pointerEvents = 'none';
  element.style.left = `${geometry.x * scale}px`;
  element.style.top = `${geometry.y * scale}px`;
  element.style.width = `${geometry.width * scale}px`;
  element.style.height = `${geometry.height * scale}px`;
}

function rule(
  document: Document,
  className: string,
  geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  scale: number
): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.display = 'block';
  element.style.left = `${geometry.x * scale}px`;
  element.style.top = `${geometry.y * scale}px`;
  element.style.width = `${geometry.width * scale}px`;
  element.style.height = `${geometry.height * scale}px`;
  element.style.backgroundColor = 'currentColor';
  element.style.pointerEvents = 'none';
  return element;
}

/** A diagonal strike: a thin bar from one corner of the box to the other, turned. */
function diagonal(
  document: Document,
  line: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number },
  x: number,
  y: number,
  thickness: number,
  scale: number
): HTMLElement {
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
  const element = rule(
    document,
    'docx-equation-box-strike',
    { x: x + line.x1, y: y + line.y1 - thickness / 2, width: length, height: thickness },
    scale
  );
  element.style.transformOrigin = `0 ${(thickness / 2) * scale}px`;
  element.style.transform = `rotate(${angle}rad)`;
  return element;
}

/** Text atoms that one span can draw: one face and size on one line box, left to right. */
function continuesTextRun(previous: EquationGeometry, next: EquationGeometry): boolean {
  return (
    previous.kind === 'text' &&
    next.kind === 'text' &&
    previous.runStyle !== undefined &&
    previous.runStyle === next.runStyle &&
    previous.fontSizePt === next.fontSizePt &&
    previous.box.y === next.box.y &&
    previous.box.height === next.box.height &&
    previous.baseline === next.baseline &&
    // A negative gap (an overlap) cannot be a margin, so it ends the run.
    next.box.x >= previous.box.x + previous.box.width - 1e-9
  );
}

/** How many row items from `start` one span can draw. */
function textRunAt(items: readonly EquationGeometry[], start: number): number {
  let end = start + 1;
  while (end < items.length && continuesTextRun(items[end - 1]!, items[end]!)) end++;
  return end - start;
}

/**
 * Draw the text atoms of one source run as one span. Operator spacing splits a run into
 * atoms at their own positions; each atom after the first takes its own inline-block, so no
 * shaping or kerning crosses an atom join. A positive gap before an atom is its start margin.
 */
function paintTextRun(
  document: Document,
  host: DocumentFragment | HTMLElement,
  atoms: readonly EquationGeometry[],
  scale: number,
  parentX: number,
  parentY: number,
  ancestors: readonly string[],
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
): void {
  const first = atoms[0] as EquationTextGeometry;
  const last = atoms[atoms.length - 1]!;
  const element = document.createElement('span');
  element.className = [
    'docx-equation-node',
    ...[...ancestors, 'text'].map((kind) => `docx-equation-${kind}`),
  ].join(' ');
  place(
    element,
    {
      x: parentX + first.box.x,
      y: parentY + first.box.y,
      width: last.box.x + last.box.width - first.box.x,
      height: first.box.height,
    },
    scale
  );
  element.style.display = 'block';
  if (first.runStyle && applyFace) {
    element.style.fontWeight = first.runStyle.bold ? 'bold' : 'normal';
    element.style.fontStyle = first.runStyle.italic ? 'italic' : 'normal';
    applyFace(element, first.runStyle);
  }
  element.style.fontSize = `${first.fontSizePt * scale}px`;
  element.style.lineHeight = `${first.box.height * scale}px`;
  element.style.whiteSpace = 'pre';
  element.append(document.createTextNode(first.text));
  let end = first.box.x + first.box.width;
  for (const atom of atoms.slice(1) as readonly EquationTextGeometry[]) {
    // An inline-block is an atomic inline, so the browser shapes and kerns each atom alone,
    // as layout measured it. The face is inherited from the run span.
    const child = document.createElement('span');
    child.style.display = 'inline-block';
    const gap = atom.box.x - end;
    if (gap > 1e-9) child.style.marginLeft = `${gap * scale}px`;
    child.textContent = atom.text;
    element.append(child);
    end = atom.box.x + atom.box.width;
  }
  host.append(element);
}

function paintNode(
  document: Document,
  host: DocumentFragment,
  node: EquationGeometry,
  equation: EquationSpanRecord & {
    unsupportedSource?: OoxmlElement | null;
    ownerPartName?: string;
  },
  scale: number,
  parentX = 0,
  parentY = 0,
  ancestors: readonly string[] = [],
  path = '0',
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
): void {
  const x = parentX + node.box.x;
  const y = parentY + node.box.y;
  const classes = [...ancestors, node.kind];
  switch (node.kind) {
    case 'text':
    case 'fallback': {
      const element = document.createElement('span');
      element.className = [
        'docx-equation-node',
        ...classes.map((kind) => `docx-equation-${kind}`),
      ].join(' ');
      place(element, { x, y, width: node.box.width, height: node.box.height }, scale);
      element.textContent = node.text;
      element.style.display = 'block';
      if (node.runStyle && applyFace) {
        element.style.fontWeight = node.runStyle.bold ? 'bold' : 'normal';
        element.style.fontStyle = node.runStyle.italic ? 'italic' : 'normal';
        applyFace(element, node.runStyle);
      }
      element.style.fontSize = `${node.fontSizePt * scale}px`;
      element.style.lineHeight = `${node.box.height * scale}px`;
      element.style.whiteSpace = 'pre';
      if (node.kind === 'text' && node.stretch) {
        // A grown delimiter character keeps its font box and scales its glyph vertically.
        element.style.transformOrigin = `0 ${node.stretch.originY * scale}px`;
        element.style.transform = `scaleY(${node.stretch.scale})`;
      }
      if (node.kind === 'fallback') {
        // A text fallback is an unsupported element whose slot takes its own presses.
        element.style.pointerEvents = 'auto';
        const fallback = document.createElement('span');
        fallback.textContent = node.text;
        element.textContent = '';
        element.append(fallback);
        markUnsupportedElement(
          element,
          fallback,
          {
            ownerPartName: equation.ownerPartName ?? '',
            namespaceUri:
              equation.unsupportedSource?.namespaceUri ??
              'http://schemas.openxmlformats.org/officeDocument/2006/math',
            localName: equation.unsupportedSource?.localName ?? 'oMath',
            source: equation.unsupportedSource ?? null,
            placement: 'inline',
            bounds: { x, y, width: node.box.width, height: node.box.height },
            nodeId: equation.sourceNodeId,
            label: node.text,
            equation,
          },
          undefined,
          path
        );
      }
      host.append(element);
      break;
    }
    case 'row':
      for (let index = 0; index < node.items.length; index++) {
        const run = textRunAt(node.items, index);
        if (run > 1) {
          paintTextRun(
            document,
            host,
            node.items.slice(index, index + run),
            scale,
            x,
            y,
            classes,
            applyFace
          );
          index += run - 1;
          continue;
        }
        paintNode(
          document,
          host,
          node.items[index]!,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.${index}`,
          applyFace
        );
      }
      break;
    case 'fraction':
      paintNode(
        document,
        host,
        node.numerator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.numerator`,
        applyFace
      );
      host.append(
        rule(
          document,
          'docx-equation-fraction-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(
        document,
        host,
        node.denominator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.denominator`,
        applyFace
      );
      break;
    case 'radical':
      paintNode(
        document,
        host,
        node.sign,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.sign`,
        applyFace
      );
      if (node.degree)
        paintNode(
          document,
          host,
          node.degree,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.degree`,
          applyFace
        );
      host.append(
        rule(
          document,
          'docx-equation-radical-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(
        document,
        host,
        node.radicand,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.radicand`,
        applyFace
      );
      break;
    case 'bar':
      paintNode(
        document,
        host,
        node.body,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.body`,
        applyFace
      );
      host.append(
        rule(
          document,
          'docx-equation-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      break;
    case 'delimiter':
      node.fences.forEach((fence, index) =>
        paintNode(
          document,
          host,
          fence,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.fences.${index}`,
          applyFace
        )
      );
      node.items.forEach((item, index) =>
        paintNode(
          document,
          host,
          item,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.items.${index}`,
          applyFace
        )
      );
      break;
    case 'borderBox':
      paintNode(
        document,
        host,
        node.body,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.body`,
        applyFace
      );
      for (const stroke of node.rules)
        host.append(
          rule(
            document,
            'docx-equation-box-rule',
            { ...stroke, x: x + stroke.x, y: y + stroke.y },
            scale
          )
        );
      for (const line of node.diagonals)
        host.append(diagonal(document, line, x, y, node.thickness, scale));
      break;
    case 'script':
      paintNode(
        document,
        host,
        node.base,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.base`,
        applyFace
      );
      if (node.subscript)
        paintNode(
          document,
          host,
          node.subscript,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.subscript`,
          applyFace
        );
      if (node.superscript)
        paintNode(
          document,
          host,
          node.superscript,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.superscript`,
          applyFace
        );
      break;
    case 'nary':
      paintNode(
        document,
        host,
        node.operator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.operator`,
        applyFace
      );
      if (node.lowerLimit)
        paintNode(
          document,
          host,
          node.lowerLimit,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.lowerLimit`,
          applyFace
        );
      if (node.upperLimit)
        paintNode(
          document,
          host,
          node.upperLimit,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.upperLimit`,
          applyFace
        );
      paintNode(
        document,
        host,
        node.body,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.body`,
        applyFace
      );
      break;
  }
}

/** Mount one paint-ready equation into its already styled atomic span. */
export function mountEquationGeometry(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord & {
    unsupportedSource?: OoxmlElement | null;
    ownerPartName?: string;
  },
  scale: number,
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void,
  source?: OoxmlElement | null,
  ownerPartName?: string
): void {
  const geometry = equation.geometry;
  host.className = 'layout-run docx-equation';
  host.dataset.docxEquation = equation.sourceNodeId;
  host.setAttribute('contenteditable', 'false');
  host.setAttribute('role', 'math');
  if (equation.fallbackText) host.setAttribute('aria-label', equation.fallbackText);
  host.style.position = 'relative';
  host.style.display = 'inline-block';
  host.style.width = `${geometry.box.width * scale}px`;
  host.style.height = `${geometry.box.height * scale}px`;
  host.style.lineHeight = '0';
  host.style.pointerEvents = 'auto';
  host.style.userSelect = 'none';
  // An inline-block exposes its bottom edge as its CSS baseline. Move the box down by its
  // published descent so the equation's internal baseline meets the surrounding text.
  host.style.verticalAlign = `${-(geometry.box.height - geometry.baseline) * scale}px`;
  const fragment = document.createDocumentFragment();
  paintNode(
    document,
    fragment,
    geometry,
    { ...equation, unsupportedSource: source ?? null, ...(ownerPartName ? { ownerPartName } : {}) },
    scale,
    0,
    0,
    [],
    '0',
    applyFace
  );
  host.append(fragment);
}

/** Resolve canonical metadata at the painter boundary, keeping layout records DOM-free. */
export function mountEquationForSpan(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord,
  context: {
    readonly scale: number;
    readonly unsupportedSource?: (nodeId: string, ownerPartName?: string) => OoxmlElement | null;
    readonly unsupportedOwnerPartName?: (nodeId: string) => string;
  },
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
): void {
  mountEquationGeometry(
    document,
    host,
    equation,
    context.scale,
    applyFace,
    context.unsupportedSource?.(equation.sourceNodeId),
    context.unsupportedOwnerPartName?.(equation.sourceNodeId)
  );
}

/**
 * The revision mark of an equation: its presentation, plus an explicit bar. The glyphs are
 * absolutely positioned, and CSS never carries a text decoration to out-of-flow children, so
 * a struck or underlined equation would otherwise show no line at all, and under a host's
 * revision markup a deleted equation would look the same as an inserted one.
 */
export function applyEquationRevision(
  document: Document,
  host: HTMLElement,
  span: StyleSpanRecord,
  ctx: PaintContext
): void {
  applyRevisionPresentation(host, span, ctx);
  const kind = host.dataset.revisionKind;
  if (kind !== 'delete' && kind !== 'moveFrom' && kind !== 'insert' && kind !== 'moveTo') return;
  const box = span.equation?.geometry.box;
  if (!box) return;
  // A host's revision markup decides the mark, as it does for the text beside the equation.
  const mark = ctx.revisionMarkup
    ? revisionMarkupStyle(ctx.revisionMarkup, kind).mark
    : kind === 'delete' || kind === 'moveFrom'
      ? 'strikethrough'
      : 'underline';
  const strike = mark === 'strikethrough' || mark === 'doubleStrikethrough';
  if (!strike && mark !== 'underline' && mark !== 'doubleUnderline') return;
  const doubled = mark === 'doubleStrikethrough' || mark === 'doubleUnderline';
  if (strike) {
    // Each glyph run is struck on its own, as struck text is. One bar across the box sat on
    // the math axis, where a fraction bar already is, so a deleted fraction looked merely
    // recoloured; striking the runs crosses the numerator and the denominator instead.
    for (const glyph of host.querySelectorAll<HTMLElement>(
      '.docx-equation-text, .docx-equation-fallback'
    )) {
      glyph.classList.add('docx-equation-revision-strike');
      glyph.style.textDecorationLine = 'line-through';
      glyph.style.textDecorationStyle = doubled ? 'double' : 'solid';
      glyph.style.textDecorationColor = 'currentColor';
    }
    return;
  }
  const thickness = 0.75;
  const ys = doubled
    ? [box.height - 3 * thickness, box.height - thickness]
    : [box.height - thickness];
  for (const y of ys) {
    host.append(
      rule(
        document,
        'docx-equation-revision-underline',
        { x: 0, y, width: box.width, height: thickness },
        ctx.scale
      )
    );
  }
}
