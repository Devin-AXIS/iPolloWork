// The paragraph mark's effective run face: docDefaults, the paragraph style, the mark's own
// character style, and its direct properties. A toolbar reads it at a caret whose next
// characters take the mark's face but that has no text span to read.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { propertyContainer } from '../store/store/direct-properties.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  type StyleCascadeTable,
} from './style-cascade.ts';

const absent = {};
const tables = new WeakMap<object, WeakMap<object, StyleCascadeTable>>();

/** One cascade table per styles and settings part; both are immutable in a session. */
function cascadeTableFor(
  styles: OoxmlElement | null,
  settings: OoxmlElement | null
): StyleCascadeTable {
  let bySettings = tables.get(styles ?? absent);
  if (!bySettings) tables.set(styles ?? absent, (bySettings = new WeakMap()));
  let table = bySettings.get(settings ?? absent);
  if (!table) {
    table = buildStyleCascadeTable(styles, undefined, settings);
    bySettings.set(settings ?? absent, table);
  }
  return table;
}

/** The resolved run properties of `paragraph`'s mark. Table styles are not applied. */
export function paragraphMarkFace(
  paragraph: OoxmlNode,
  styles: OoxmlElement | null,
  settings: OoxmlElement | null = null
): readonly OoxmlProperty[] {
  return cascadeParagraphFormatting(
    cascadeTableFor(styles, settings),
    propertyContainer(paragraph, 'paragraphProperties', 'pPr')
  ).markRunProperties;
}
