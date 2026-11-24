// The toolbar form of the shape and chart parts: the parts themselves, keyed by slot.
// `DocxEditor.Toolbar` provides the compact variant to every part inside it, so the contextual
// `shape` and `chart` groups from `CHROME_GROUPS` render as toolbar controls, and a host part
// placed in the toolbar (`<DocxEditor.ShapeFill className="mine" />`) replaces its slot and
// renders compact too.

import type { ReactElement } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { OBJECT_SLOT_PARTS } from './pane-sections';

type ToolbarPart = (props: { hidden?: boolean }) => ReactElement | null;

/** The toolbar parts of every shape and chart slot. */
export const OBJECT_TOOLBAR_PARTS: Partial<Record<ChromeSlotId, ToolbarPart>> =
  OBJECT_SLOT_PARTS as Partial<Record<ChromeSlotId, ToolbarPart>>;
