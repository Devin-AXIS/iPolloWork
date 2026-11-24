// Bound content controls open showing the value of the node they are bound to.
//
// `w:sdtContent` of a control with `w:dataBinding` is a cached rendering of a store node. A
// process that edits the store without re-rendering the body leaves the cache stale, and the
// open has to read the binding again so the control shows what the store holds. The content is
// rebuilt the way a value write builds it (`planValue`), so a refreshed control has the same
// shape as one set through the API: the first run's formatting kept, placeholder state,
// `w:lastValue`, `w:fullDate` and the checkbox state updated with it.
//
// Only the kinds whose value is plain text refresh: plain text controls, combo boxes, dropdowns,
// dates and checkboxes. A rich text control, which a file writes as a control with no type
// element, holds formatted paragraphs that a store string cannot stand for. A value this pass
// cannot place (an unknown dropdown item, a date it cannot read, a text with characters a run
// cannot hold) leaves the cached content as the file wrote it. An empty value shows the
// placeholder the control names, through the open's placeholder pass, or an empty run when it
// names none. A date whose stored day matches `w:fullDate` keeps
// the text the file wrote, which follows the control's own language and calendar.

import {
  contentControlPropertiesOf as contentControlSummaryOf,
  contentControlTextOf,
  type ContentControlProperties,
} from '../package/content-control-nodes.ts';
import {
  bindingStores,
  boundValueOf,
  MAX_BOUND_VALUE_LENGTH,
} from '../package/custom-xml-binding.ts';
import { createNodeIdAllocator, replaceNode } from '../package/ooxml-edit.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { checkboxContent, isInlineControl } from './content-control-checkbox.ts';
import {
  contentWithText,
  editedProperties,
  planValue,
  promptFor,
  type ContentControlValueInput,
  type PlannedValue,
} from './tree-op-content-controls.ts';
import { LINE_BREAK_TEXT } from './tree-op-inline-elements.ts';
import {
  contentControlContentOf,
  contentControlPropertiesOf,
  isContentControlNode,
} from './tree-op-nodes.ts';

/** Bounded like the other open passes: no walk deeper than the tree reader allows. */
const MAX_DEPTH = 96;

const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STORY_RELS = new Set([
  `${OFFICE_REL}/header`,
  `${OFFICE_REL}/footer`,
  `${OFFICE_REL}/footnotes`,
  `${OFFICE_REL}/endnotes`,
]);

function boundControls(root: OoxmlNode): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const stack: { readonly node: OoxmlNode; readonly depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (node.kind === 'textValue' || depth > MAX_DEPTH) continue;
    // A bound control's content is rebuilt whole, so nothing inside it is visited.
    if (isContentControlNode(node) && contentControlSummaryOf(node).dataBinding) {
      found.push(node);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1)
      stack.push({ node: node.children[i]!, depth: depth + 1 });
  }
  return found;
}

/** The value write a store value stands for, or null when the kind does not refresh. */
function inputFor(
  properties: ContentControlProperties,
  raw: string
): ContentControlValueInput | null {
  const text = raw.replace(/\r\n?/g, '\n');
  switch (properties.type) {
    case 'plainText':
      return {
        kind: 'text',
        // A single-line control drops a stored line break; it does not stand in a space.
        text: text.replaceAll('\n', properties.multiLine ? LINE_BREAK_TEXT : ''),
      };
    case 'comboBox': {
      const item = properties.listItems.find((candidate) => candidate.value === text);
      return item ? { kind: 'listItem', value: item.value } : { kind: 'text', text };
    }
    case 'dropDownList':
      return text === '' ? { kind: 'text', text } : { kind: 'listItem', value: text };
    case 'checkbox':
      return text.trim() === '' ? null : { kind: 'text', text };
    case 'date': {
      if (text.trim() === '') return { kind: 'text', text: '' };
      const day = /^\s*(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/.exec(text);
      return day ? { kind: 'date', iso: day[1]! } : null;
    }
    default:
      return null;
  }
}

/** The planned content, or null when the value cannot be placed in this control. */
function planFor(properties: ContentControlProperties, raw: string): PlannedValue | null {
  if (raw.length > MAX_BOUND_VALUE_LENGTH) return null;
  const input = inputFor(properties, raw);
  if (!input) return null;
  // An empty value shows the document's own placeholder when the control names one, and
  // otherwise an empty control: no prompt text stands in for a value the store holds.
  if (input.kind === 'text' && input.text === '')
    return properties.placeholderDocPart !== undefined
      ? { text: promptFor(properties.type), showingPlaceholder: true }
      : { text: '', showingPlaceholder: false };
  if (properties.type === 'checkbox') {
    const checked = parseCheckbox(input.kind === 'text' ? input.text : '');
    if (checked === null) return null;
    const planned = planValue(properties, { kind: 'checkbox', checked });
    return typeof planned === 'string' ? null : planned;
  }
  const planned = planValue(properties, input);
  return typeof planned === 'string' ? null : planned;
}

function parseCheckbox(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

function alreadyShows(
  control: OoxmlElement,
  properties: ContentControlProperties,
  planned: PlannedValue
): boolean {
  if (planned.showingPlaceholder) return properties.showingPlaceholder;
  if (properties.showingPlaceholder) return false;
  // The cached date text is in the control's own format, language and calendar.
  if (planned.fullDate !== undefined)
    return properties.date?.fullDate?.slice(0, 10) === planned.fullDate.slice(0, 10);
  if (planned.checked !== undefined && properties.checkbox?.checked !== planned.checked)
    return false;
  // Many files leave `w:lastValue` out; the text then says what the control shows.
  if (
    planned.lastValue !== undefined &&
    properties.lastValue !== undefined &&
    properties.lastValue !== planned.lastValue
  )
    return false;
  return contentControlTextOf(control, LINE_BREAK_TEXT) === planned.text;
}

/**
 * `current` with `control` showing `value`. `source` is the part the controls were found in,
 * which still answers where each sits; `nextId` is one allocator for the whole part.
 */
function refreshControl(
  current: OoxmlPart,
  source: OoxmlPart,
  control: OoxmlElement,
  value: string,
  nextId: () => string
): OoxmlPart {
  const part = current;
  const properties = contentControlSummaryOf(control);
  const planned = planFor(properties, value);
  if (!planned || alreadyShows(control, properties, planned)) return part;
  const content = contentControlContentOf(control);
  const inline = isInlineControl(source, control.id);
  // A placeholder is left to the open's placeholder pass, which reads it from the glossary.
  const children = planned.showingPlaceholder
    ? []
    : planned.symbol
      ? checkboxContent(content, planned.symbol, planned.text, nextId, inline)
      : contentWithText(content, planned.text, nextId, inline);
  if (!children || !content) return part;
  const sdtPr = contentControlPropertiesOf(control);
  const nextProperties = editedProperties(
    sdtPr,
    {
      showingPlaceholder: planned.showingPlaceholder,
      ...(planned.lastValue === undefined ? {} : { lastValue: planned.lastValue }),
      ...(planned.fullDate === undefined ? {} : { fullDate: planned.fullDate }),
      ...(planned.checked === undefined ? {} : { checked: planned.checked }),
    },
    nextId
  );
  const rebuilt = {
    ...control,
    children: control.children.map((child) =>
      child.id === content.id
        ? ({ ...content, children } as OoxmlNode)
        : child.id === sdtPr?.id
          ? nextProperties
          : child
    ),
  } as OoxmlNode;
  const written = replaceNode(part, control.id, rebuilt);
  return written.ok ? written.part : part;
}

/** Refresh every bound control in one story part. Returns `part` itself when nothing changes. */
export function refreshBoundContentControls(
  part: OoxmlPart,
  stores: ReadonlyMap<string, OoxmlElement>,
  controls: readonly OoxmlElement[] = boundControls(part.root)
): OoxmlPart {
  if (stores.size === 0 || controls.length === 0) return part;
  let current = part;
  let nextId: (() => string) | null = null;
  for (const control of controls) {
    const binding = contentControlSummaryOf(control).dataBinding!;
    const value = boundValueOf(stores, binding);
    if (value === null) continue;
    nextId ??= createNodeIdAllocator(part, 'paste');
    current = refreshControl(current, part, control, value, nextId);
  }
  return current;
}

/**
 * The package with every data-bound content control in the main document, its headers,
 * footers and notes showing its store's current value.
 *
 * Every open path runs this before the store is built, so a refreshed control is part of the
 * opened document, not an edit: it adds no undo step and leaves the document clean. Run it
 * before `materializeGlossaryPlaceholders`, which fills a control this empties for an empty
 * value. A control whose value cannot be placed keeps the content the file saved.
 *
 * @param pkg - The package as read.
 * @returns `pkg` itself when no control changes, otherwise a new package.
 * @public
 */
export function refreshBoundContent(pkg: OoxmlPackage): OoxmlPackage {
  const names = [pkg.mainDocumentPart];
  for (const rel of pkg.relationships.get(pkg.mainDocumentPart) ?? []) {
    if (!STORY_RELS.has(rel.type) || rel.targetMode === 'External') continue;
    const target = resolveInternalTarget(pkg.mainDocumentPart, rel.rawTarget);
    if (target.ok && !names.includes(target.partName)) names.push(target.partName);
  }
  // Most documents bind nothing, and then no store part is read.
  const found: { readonly part: OoxmlPart; readonly controls: OoxmlElement[] }[] = [];
  for (const name of names) {
    const part = pkg.parts.get(name);
    const controls = part ? boundControls(part.root) : [];
    if (part && controls.length > 0) found.push({ part, controls });
  }
  if (found.length === 0) return pkg;
  const stores = bindingStores(pkg);
  if (stores.size === 0) return pkg;
  let next = pkg;
  for (const { part, controls } of found) {
    const refreshed = refreshBoundContentControls(part, stores, controls);
    if (refreshed !== part) next = withPart(next, refreshed);
  }
  return next;
}
