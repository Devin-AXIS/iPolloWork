// A content control's recorded state after a tracked change in it is accepted or rejected.
//
// A dropdown, combo box, date picker or checkbox records its value in its properties
// (`w:lastValue`, `w:fullDate`, `w14:checked`) as well as showing it as text. A suggested value
// moves the properties to the new value at once, because properties have no tracked form. A
// decision then re-derives them from the text it leaves, so a rejected checkbox is unchecked in
// its properties too, and a rejected dropdown choice records the item it shows again.

import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { contentControlPropertiesOf as readControl } from '../package/content-control-nodes.ts';
import { decodeCheckboxGlyph } from './content-control-checkbox.ts';
import { formatContentControlDate, parseIsoDate } from './content-control-dates.ts';
import { editedProperties } from './tree-op-content-controls.ts';
import {
  contentControlContentOf,
  contentControlPropertiesOf,
  formatSdtDateDisplay,
} from './tree-op-nodes.ts';

/** Controls with a recorded value, and the text controls whose prompt a decision restores. */
const STATEFUL_TYPES = new Set([
  'checkbox',
  'dropDownList',
  'comboBox',
  'date',
  'plainText',
  'richText',
]);

/** The text a control shows: inserted text counts, struck text does not. */
function shownText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return '';
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return '';
  if (node.kind === 'text') return node.children.map((child) => child.value).join('');
  if (node.localName === 'sym') {
    const hex = node.attributes.find((attribute) => attribute.localName === 'char')?.value;
    return decodeCheckboxGlyph(hex) ?? '';
  }
  if (node.localName === 'tab') return '\t';
  return node.children.map(shownText).join('');
}

/** The stateful controls around the decided changes, found by climbing the parent index. */
function controlsAround(before: OoxmlPart, decidedIds: Iterable<string>): readonly string[] {
  const ids = new Set<string>();
  for (const id of decidedIds) {
    for (let parent = parentNodeOf(before, id); parent; parent = parentNodeOf(before, parent.id))
      if (parent.kind === 'contentControl' && STATEFUL_TYPES.has(readControl(parent).type))
        ids.add(parent.id);
  }
  return [...ids];
}

/** The live runs that show text, struck ones left out. */
function liveTextRuns(node: OoxmlNode, out: OoxmlElement[] = []): OoxmlElement[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return out;
  if (node.kind === 'run') {
    if (shownText(node) !== '') out.push(node);
    return out;
  }
  for (const child of node.children) liveTextRuns(child, out);
  return out;
}

const childNamed = (node: OoxmlNode | undefined, localName: string): OoxmlNode | undefined =>
  node && node.kind !== 'textValue'
    ? node.children.find((child) => child.kind !== 'textValue' && child.localName === localName)
    : undefined;

const runStyleOf = (run: OoxmlElement): string | undefined => {
  const style = childNamed(childNamed(run, 'rPr'), 'rStyle');
  if (!style || style.kind === 'textValue') return undefined;
  return style.attributes.find((attribute) => attribute.localName === 'val')?.value;
};

/**
 * Whether the text a decision left is the control's prompt. A rejected choice brings back the
 * prompt it struck, which shows as the prompt only under `w:showingPlcHdr`. Two signs name a
 * prompt without the glossary: the prompt character style on every run, and a list item with
 * no value, the item a list shows for its prompt.
 */
function showsPrompt(
  properties: ReturnType<typeof readControl>,
  content: OoxmlNode,
  text: string
): boolean {
  if (properties.showingPlaceholder || text === '') return false;
  const runs = liveTextRuns(content);
  if (runs.length > 0 && runs.every((run) => runStyleOf(run) === 'PlaceholderText')) return true;
  return properties.listItems.some((item) => item.value === '' && item.displayText === text);
}

/** The recorded state the shown text stands for, or null when it already agrees. */
function stateEdits(
  control: OoxmlNode
): Parameters<typeof editedProperties>[1] | 'dropDate' | null {
  const properties = readControl(control);
  const content = contentControlContentOf(control);
  if (!content) return null;
  const text = shownText(content);
  if (properties.type !== 'checkbox' && showsPrompt(properties, content, text))
    return { showingPlaceholder: true };
  switch (properties.type) {
    case 'checkbox': {
      const box = properties.checkbox;
      if (!box) return null;
      const checked =
        text === decodeCheckboxGlyph(box.checkedState?.value ?? '2612')
          ? true
          : text === decodeCheckboxGlyph(box.uncheckedState?.value ?? '2610')
            ? false
            : null;
      return checked === null || checked === box.checked ? null : { checked };
    }
    case 'dropDownList':
    case 'comboBox': {
      const item = properties.listItems.find((candidate) => candidate.displayText === text);
      const value = item?.value ?? (properties.type === 'comboBox' ? text : undefined);
      return value === undefined || value === properties.lastValue ? null : { lastValue: value };
    }
    case 'date': {
      const full = properties.date?.fullDate;
      const parsed = full ? parseIsoDate(full) : null;
      if (!full || !parsed) return null;
      // The date a rejection restores is not recorded anywhere, and a stale one would open
      // the picker on the rejected day: drop it, and let the shown text stand alone. Either
      // formatter the two value paths write with names the same day.
      const format = properties.date?.dateFormat;
      return formatContentControlDate(parsed, format) === text ||
        formatSdtDateDisplay(full, format) === text
        ? null
        : 'dropDate';
    }
    default:
      return null;
  }
}

function withoutFullDate(sdtPr: OoxmlElement): OoxmlElement {
  return {
    ...sdtPr,
    children: sdtPr.children.map((child) =>
      child.kind !== 'textValue' && child.localName === 'date'
        ? {
            ...child,
            attributes: child.attributes.filter((attribute) => attribute.localName !== 'fullDate'),
          }
        : child
    ),
  } as OoxmlElement;
}

/**
 * After a decision on the changes `decidedIds` names, set each stateful control around them
 * from the text the decision left. Returns `after` itself when nothing needed it.
 */
export function syncDecidedControlStates(
  before: OoxmlPart,
  decidedIds: Iterable<string>,
  after: OoxmlPart,
  options?: EditOptions
): OoxmlPart {
  let current = after;
  for (const controlId of controlsAround(before, decidedIds)) {
    const control = findNode(current, controlId);
    if (!control || control.kind !== 'contentControl') continue;
    const edits = stateEdits(control);
    const sdtPr = contentControlPropertiesOf(control);
    if (!edits || !sdtPr) continue;
    const next =
      edits === 'dropDate'
        ? withoutFullDate(sdtPr)
        : editedProperties(sdtPr, edits, createNodeIdAllocator(current));
    const replaced = replaceNode(current, sdtPr.id, next, options);
    if (replaced.ok) current = replaced.part;
  }
  return current;
}
