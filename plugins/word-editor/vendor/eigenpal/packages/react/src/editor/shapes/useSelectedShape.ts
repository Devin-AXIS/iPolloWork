// `useSelectedShape`: the selected shape for a host's own Format shape controls. The reads and
// the commands come from core (`selected-shape.ts`), so the Vue composable returns the same
// thing (`packages/vue/src/editor/shapes/useSelectedShape.ts`).

import { useMemo } from 'react';
import {
  editSelectedShape,
  execSelectedShape,
  readSelectedShape,
  sameSelectedShape,
  type SelectedShapeCommand,
  type ShapeFormatState,
  type ShapePaneChange,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** What `useSelectedShape` returns. @public */
export interface UseSelectedShapeReturn {
  /** The drawing node id of the selected shape, text box, line, or group, or null. */
  readonly drawingNodeId: string | null;
  /** The shape selected inside the group by a second press, or null. */
  readonly memberId: string | null;
  /** The fill and outline, or null when no shape with a fill or outline is selected. */
  readonly format: ShapeFormatState | null;
  /** Whether `setShapeFill` can run now. */
  readonly canEditFill: boolean;
  /** Whether the transparency of a solid fill can change now. */
  readonly canEditTransparency: boolean;
  /** Whether `setShapeOutline` can run now. */
  readonly canEditOutline: boolean;
  /** Why the fill cannot change, translated, or null when it can. */
  readonly fillDisabledReason: string | null;
  /** Why the transparency cannot change, translated, or null when it can. */
  readonly transparencyDisabledReason: string | null;
  /** Why the outline cannot change, translated, or null when it can. */
  readonly outlineDisabledReason: string | null;
  /**
   * Run a fill or outline edit on the shape this hook shows, as `editor.exec` does, without the
   * `drawingNodeId`: `execute({ type: 'setShapeOutline', color: '0070C0', widthPt: 3 })`. A
   * refusal's reason is translated.
   */
  readonly execute: (command: SelectedShapeCommand) => ExecResult;
  /**
   * Apply one checked change, as the packaged pane does: `edit({ type: 'fillColor',
   * color: 'accent1' })` or `edit({ type: 'outlineWidth', text: '3' })`. A theme color resolves
   * through the document's theme. Text the pane cannot read refuses with a translated reason.
   * One undo step.
   */
  readonly edit: (change: ShapePaneChange) => ExecResult;
}

/** A result with its refusal reason translated, as every reason this hook returns is. */
function localized(
  result: ExecResult,
  t: Parameters<typeof localizeDisabledReason>[1]
): ExecResult {
  if (result.ok) return result;
  return { ...result, reason: localizeDisabledReason(result.reason, t) ?? result.reason };
}

/**
 * The selected shape, its fill and outline, whether each can change, and `execute` for the
 * shape commands. Use it inside `DocxEditor.Root` to build a Format shape pane of your own. It
 * reads the shape on every editor change, because protection, locks, and collaboration change
 * what `can` answers, and keeps its value while nothing it shows changes. Every refusal reason
 * it returns is translated. @public
 */
export function useSelectedShape(): UseSelectedShapeReturn {
  const editor = useDocxEditor();
  const view = useEditorState(
    (snapshot: EditorSnapshot) => readSelectedShape(editor, snapshot.image),
    sameSelectedShape
  );
  const image = useEditorState(selectImage);
  const { t } = useTranslation();
  return useMemo(
    () => ({
      ...view,
      fillDisabledReason: localizeDisabledReason(view.fillDisabledReason, t),
      transparencyDisabledReason: localizeDisabledReason(view.transparencyDisabledReason, t),
      outlineDisabledReason: localizeDisabledReason(view.outlineDisabledReason, t),
      execute: (command: SelectedShapeCommand) =>
        localized(execSelectedShape(editor, image, command), t),
      edit: (change: ShapePaneChange) => localized(editSelectedShape(editor, image, change), t),
    }),
    [editor, view, image, t]
  );
}

const selectImage = (snapshot: EditorSnapshot) => snapshot.image;
