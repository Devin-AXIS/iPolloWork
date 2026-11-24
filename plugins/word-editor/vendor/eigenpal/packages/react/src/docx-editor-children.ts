import type { ReactNode } from 'react';

/**
 * Slot and icon content in public component props.
 *
 * React hosts pass {@link ReactNode}. Vue hosts pass {@link https://vuejs.org/api/utility-types.html#vnode | VNode}
 * through the paired {@link DocxEditorChildren} alias in `@docx-editor.dev/vue`.
 *
 * @public
 */
export type DocxEditorChildren = ReactNode;
