// The `DocxEditorConfig` fields the surface takes as they are, kept out of the composition root
// so `docx-editor.ts` stays under the max-lines gate.

import type { DocxEditorConfig } from './docx-editor-types.ts';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';

/** The pass-through surface options of `config`, each present only when the host set it. */
export function configSurfaceOptions(
  config: DocxEditorConfig
): Pick<
  PaginatedSurfaceOptions,
  'tableInteractionLabel' | 'imageDecodePort' | 'lockedControlNavigation'
> {
  return {
    ...(config.tableInteractionLabel
      ? { tableInteractionLabel: config.tableInteractionLabel }
      : {}),
    ...(config.imageDecodePort ? { imageDecodePort: config.imageDecodePort } : {}),
    ...(config.lockedControlNavigation === 'atomic' ? { lockedControlNavigation: 'atomic' } : {}),
  };
}
