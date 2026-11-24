// Why a content control refuses an edit or a removal, from its lock and data binding.
import type { ContentControlBoundaryRecord } from '@docx-editor.dev/core/layout';
import type { OoxmlElement } from '@docx-editor.dev/core/store';

/** Why the control's content refuses an edit: bound to custom XML, or content-locked. */
export function contentLockedOrBound(control: ContentControlBoundaryRecord): string | null {
  if (control.bound) return 'bound';
  if (control.effectiveLock === 'contentLocked' || control.effectiveLock === 'sdtContentLocked') {
    return 'locked';
  }
  return null;
}

/** Why the control refuses its own removal. */
export function removalLocked(control: ContentControlBoundaryRecord): string | null {
  if (control.effectiveLock === 'sdtLocked' || control.effectiveLock === 'sdtContentLocked') {
    return 'locked';
  }
  return null;
}

/**
 * The same answers read from the control's own `w:sdtPr`, for a control that layout has not
 * published a boundary for yet. Conservative: it refuses on the properties alone.
 */
export function treeLockRefusal(control: OoxmlElement, action: 'edit' | 'remove'): string | null {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (
      (child as { kind?: string }).kind !== 'contentControlProperties' &&
      child.localName !== 'sdtPr'
    ) {
      continue;
    }
    if (child.children.some((c) => c.kind !== 'textValue' && c.localName === 'dataBinding')) {
      if (action === 'edit') return 'bound';
    }
    for (const prop of child.children) {
      if (prop.kind === 'textValue' || prop.localName !== 'lock') continue;
      const val = prop.attributes.find((a) => a.localName === 'val')?.value;
      if (action === 'remove') {
        if (val === 'sdtLocked' || val === 'sdtContentLocked') return 'locked';
      } else if (val === 'contentLocked' || val === 'sdtContentLocked') {
        return 'locked';
      }
    }
  }
  return null;
}
