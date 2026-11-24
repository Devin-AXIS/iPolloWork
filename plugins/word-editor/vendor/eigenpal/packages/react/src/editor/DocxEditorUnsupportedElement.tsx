import { useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { UnsupportedElement, UnsupportedElementRule } from '@docx-editor.dev/core/editor';
import { UnsupportedElementRegistryContext } from './unsupported-element-registry';
import { UnsupportedElementPlaceholder } from './UnsupportedElements';

/** Props for a registered unsupported-content renderer. @public */
export interface DocxEditorUnsupportedElementProps extends UnsupportedElementRule {
  /**
   * Include partially rendered drawings (`support: 'partial'`). Defaults to `false`.
   * Excludes fully supported drawings, hidden drawings, and drawings without a layout position.
   * Excludes shapes with editable text. Partially rendered shapes without text remain eligible.
   */
  includePartial?: UnsupportedElementRule['includePartial'];
  /**
   * Render this occurrence. Empty content preserves the drawing or placeholder.
   * Empty content includes `null`, `false`, empty fragments or arrays, and whitespace.
   * Child components can return empty content while an image loads.
   * The editor calls this function for each occurrence. Put hooks in a returned child component.
   * Use `drawingPreviewDocx` from `@docx-editor.dev/core/editor` to create a preview DOCX.
   */
  children: (props: { element: UnsupportedElement }) => ReactNode;
}

/**
 * Register a renderer under DocxEditor or DocxEditor.Root.
 * The first mounted matching declaration wins. Prop updates retain its priority.
 * Omit match for a catch-all. Returning `null`, `false`, an empty fragment or array, or
 * whitespace keeps what the editor shows.
 * Layout uses points and only sizes content without an existing layout box. Custom content
 * gets the occurrence's box (`element.bounds`); size it to 100% of the width and height.
 * Clicking a custom preview selects the underlying drawing for moving, resizing, or deletion.
 * Links, buttons, and form fields retain their normal behavior.
 * Components can remount when pagination or virtualization removes an occurrence.
 * @public
 */
export function DocxEditorUnsupportedElement({
  match,
  layout,
  includePartial,
  children,
}: DocxEditorUnsupportedElementProps) {
  const registry = useContext(UnsupportedElementRegistryContext);
  if (!registry)
    throw new Error('DocxEditor.UnsupportedElement must render inside DocxEditor.Root.');
  const id = useRef(Symbol('unsupported-element-declaration')).current;
  useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
  useLayoutEffect(() => {
    registry.register(id, {
      includePartial,
      ...(match ? { match } : {}),
      ...(layout ? { layout } : {}),
    });
  }, [registry, id, match, layout, includePartial]);
  useLayoutEffect(() => () => registry.unregister(id), [registry, id]);
  return registry.hosts(id).map((host) => (
    <UnsupportedElementPlaceholder key={host.key} host={host}>
      {children({ element: host.unsupported })}
    </UnsupportedElementPlaceholder>
  ));
}
