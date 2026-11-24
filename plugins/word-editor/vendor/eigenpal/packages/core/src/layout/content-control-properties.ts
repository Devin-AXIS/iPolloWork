// Pure content-control (SDT) property helpers.
//
// These read chrome metadata off a content-control wrapper and its `sdtPr`
// properties: value attributes, the properties element, typed markers, lock
// state, mapped type, and structural level. They hold no layout state and close
// over nothing in `semantic-layout.ts`; they operate only on their arguments.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import {
  MAX_CONTENT_CONTROL_NESTING as MAX_SDT_NESTING,
  contentControlContentChildren,
  isContentControl,
} from '../store/package/content-control-walk.ts';
import type {
  ContentControlLevel,
  ContentControlLock,
  ContentControlMappedType,
} from './semantic-records.ts';

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';

export function wmlValOf(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === 'val' && attribute.namespaceUri === WML_NS) return attribute.value;
  }
  return undefined;
}

export function contentControlPropertiesOf(control: OoxmlElement): OoxmlElement | undefined {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'contentControlProperties' || child.localName === 'sdtPr') return child;
  }
  return undefined;
}

export function propertyChild(
  properties: OoxmlElement | undefined,
  localName: string
): OoxmlElement | undefined {
  if (!properties) return undefined;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === localName) return child;
  }
  return undefined;
}

export function propertyVal(
  properties: OoxmlElement | undefined,
  localName: string
): string | undefined {
  const child = propertyChild(properties, localName);
  return child ? wmlValOf(child) : undefined;
}

export function parseContentControlLock(value: string | undefined): ContentControlLock {
  if (value === 'sdtLocked' || value === 'contentLocked' || value === 'sdtContentLocked') {
    return value;
  }
  return 'unlocked';
}

export function mapContentControlType(
  properties: OoxmlElement | undefined
): ContentControlMappedType {
  if (!properties) return 'richText';
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    const kind = child.kind;
    const localName = child.localName;
    const namespaceUri = child.namespaceUri;
    // Typed markers after the SDT merge; `localName` covers demoted/generic fallbacks.
    // Do not match `kind === 'text'` — that is `w:t`, not `CT_SdtText` (`contentControlText`).
    if (kind === 'contentControlDropDownList' || localName === 'dropDownList') return 'dropdown';
    if (kind === 'contentControlComboBox' || localName === 'comboBox') return 'comboBox';
    if (kind === 'contentControlDate' || localName === 'date') return 'date';
    if (localName === 'picture') return 'picture';
    if (localName === 'docPartList') return 'buildingBlockGallery';
    if (kind === 'contentControlText' || localName === 'text') return 'plainText';
    if (localName === 'richText') return 'richText';
    if (
      kind === 'contentControlCheckbox' ||
      (localName === 'checkbox' && namespaceUri === W14_NS)
    ) {
      return 'checkbox';
    }
    if (localName === 'repeatingSection' && namespaceUri === W15_NS) {
      return 'repeatingSection';
    }
  }
  return 'richText';
}

export function controlLevelOf(control: OoxmlElement): ContentControlLevel {
  const classify = (nodes: readonly OoxmlNode[], depth: number): ContentControlLevel | null => {
    for (const child of nodes) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'tableRow') return 'row';
      if (child.kind === 'tableCell') return 'cell';
      if (child.kind === 'paragraph' || child.kind === 'table') return 'block';
      if (isContentControl(child) && depth < MAX_SDT_NESTING) {
        const nested = classify(contentControlContentChildren(child), depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  };
  return classify(contentControlContentChildren(control), 0) ?? 'inline';
}
