// List allocation for the external-HTML projection: numIds, per-level observations,
// and Word desktop's `mso-list` convention — split from clipboard-html-read.ts at
// the max-lines cap.

import {
  htmlListKindAndStart,
  htmlListStartFromMarker,
  semanticHtmlListKind,
  semanticHtmlListStart,
  type HtmlListAllocation as ListAllocation,
  type HtmlListLevel,
} from './clipboard-html-numbering.ts';
import { isElement, isMsoListIgnoreMarker, tagOf } from './clipboard-html-styles.ts';
import type { FlowContext, Projection } from './clipboard-html-projection.ts';

type ParaProps = FlowContext['para'];

export function allocateList(
  p: Projection,
  key: string,
  observed: HtmlListLevel,
  level = 0
): string {
  const existing = p.lists.get(key);
  if (existing) {
    // First observation per level wins; other levels stay open for later markers.
    if (!existing.levels.has(level)) existing.levels.set(level, observed);
    return existing.numId;
  }
  const numId = String(1001 + p.lists.size);
  const allocation: ListAllocation = { numId, levels: new Map([[level, observed]]) };
  p.lists.set(key, allocation);
  p.listsByNumId.set(numId, allocation);
  return numId;
}

/** Word desktop's `mso-list:l<N> level<M> lfo<K>` convention on `MsoListParagraph`. */
export function msoListNumPr(
  element: Element,
  style: ReadonlyMap<string, string>,
  p: Projection,
  noteBody: FlowContext['noteBody']
): ParaProps['numPr'] {
  const declaration = style.get('mso-list');
  if (declaration === undefined) return undefined;
  const match = /\bl(\d{1,4})\s+level(\d{1,2})\b/i.exec(declaration);
  if (!match) return undefined;
  const ilvl = Math.min(Math.max(Number.parseInt(match[2]!, 10) - 1, 0), 8);
  const marker = msoMarkerText(element, p);
  // The head's structured @list rule names the format; the visible marker then
  // names THIS slice's first ordinal under that format. Glyph sniffing alone is
  // only the fallback — it cannot tell 'i.' the roman 1 from 'i.' the 9th letter.
  const lfoMatch = /\blfo(\d{1,4})\b/i.exec(declaration);
  // The lfo-specific @list rule (Word's lvlOverride) outranks the base rule.
  const definition =
    (lfoMatch !== null
      ? p.listDefinitions.get(`l${match[1]}:level${match[2]}:lfo${lfoMatch[1]}`)
      : undefined) ?? p.listDefinitions.get(`l${match[1]}:level${match[2]}`);
  const observed: HtmlListLevel =
    definition !== undefined
      ? {
          kind: definition.kind,
          start: htmlListStartFromMarker(marker, definition.kind) ?? definition.start ?? 1,
          ...(definition.align ? { align: definition.align } : {}),
          ...(definition.format ? { format: definition.format } : {}),
        }
      : marker.trim().length > 0
        ? htmlListKindAndStart(marker)
        : enclosingListLevel(element);
  // A note body's list must not seed the body list's first-observation state — the
  // notes project first, and their markers would pin the body's start values.
  const scope = noteBody === undefined ? '' : `${noteBody.kind}${noteBody.id}:`;
  const key = `mso:${scope}l${match[1]}${lfoMatch ? `:lfo${lfoMatch[1]}` : ''}`;
  return { numId: allocateList(p, key, observed, ilvl), ilvl };
}

/**
 * A Word `<li>` with no `@list` level rule (Word omits an all-default level) and no marker
 * span: its `<ol>`/`<ul>` is the only statement of its format left.
 */
function enclosingListLevel(element: Element): HtmlListLevel {
  const list = element.parentElement;
  if (list === null || (tagOf(list) !== 'ol' && tagOf(list) !== 'ul')) {
    return { kind: 'bullet', start: 1 };
  }
  return { kind: semanticHtmlListKind(list), start: semanticHtmlListStart(list) };
}

/** The text of the `mso-list:Ignore` marker span, for number-vs-bullet detection. */
function msoMarkerText(element: Element, p: Projection): string {
  let found = '';
  const walk = (node: Node, depth: number): void => {
    if (found.length > 0 || depth > 8 || p.nodesLeft <= 0) return;
    if (!isElement(node)) return;
    if (isMsoListIgnoreMarker(node)) {
      found = (node.textContent ?? '').slice(0, 16);
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child, depth + 1);
  };
  for (const child of Array.from(element.childNodes)) walk(child, 0);
  return found;
}
