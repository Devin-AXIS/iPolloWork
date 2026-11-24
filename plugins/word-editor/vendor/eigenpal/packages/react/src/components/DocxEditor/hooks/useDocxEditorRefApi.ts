/**
 * The imperative `DocxEditorRef` handle: the greenfield seven-member shape, each member
 * forwarding to the `Editor` facade.
 *
 * Every member is safe to call before the editor has mounted. Mutations no-op, and reads
 * return the honest empty answer — `null`, a `notFound` refusal, a loading snapshot —
 * rather than throwing, so a host can hold the ref from first render without guarding it.
 *
 * The legacy nineteen-member handle (zoom, paging, print, find, comments, tracked
 * changes) is gone: everything it mirrored is reachable through the facade via
 * `getEditor`, and mirroring contract capabilities onto the ref is how the two adapters
 * drifted apart.
 */
import { useImperativeHandle } from 'react';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { LOADING_SNAPSHOT } from '../../../editor/loading-snapshot';
import type { DocxEditorRef } from '../../../types';

/**
 * What `snapshot()` reports before an editor exists: loading, not editable, nothing
 * selected — never invented state. The SAME frozen constant `useEditorState` serves
 * pre-mount and on the server, so the ref and the hooks can never disagree about the
 * loading shape.
 */
export const PRE_MOUNT_SNAPSHOT: EditorSnapshot = LOADING_SNAPSHOT;

export function useDocxEditorRefApi({
  ref,
  editorRef,
}: {
  ref: React.Ref<DocxEditorRef>;
  editorRef: React.RefObject<Editor | null>;
}) {
  useImperativeHandle(
    ref,
    (): DocxEditorRef => ({
      load: (document) => editorRef.current?.load(document),
      save: () => editorRef.current?.save() ?? Promise.resolve(null),
      getDocumentHandle: () => editorRef.current?.getDocumentHandle() ?? null,
      getEditor: () => editorRef.current,
      focus: () => {
        editorRef.current?.focus();
      },
      exec: (command, options) =>
        editorRef.current?.exec(command, options) ?? {
          ok: false,
          code: 'notFound',
          reason: 'no editor is mounted',
        },
      snapshot: (options) => editorRef.current?.snapshot(options) ?? PRE_MOUNT_SNAPSHOT,
    }),
    [editorRef]
  );
}
