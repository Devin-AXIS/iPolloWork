import { createContext, useContext } from 'react';
import type { ToolbarProps } from './Toolbar';

/**
 * Props for the EditorToolbar compound component.
 * Extends ToolbarProps with title bar-specific fields.
 */
export interface EditorToolbarProps extends ToolbarProps {}

/**
 * Context value shared between EditorToolbar sub-components.
 */
export const EditorToolbarContext = createContext<ToolbarProps | null>(null);

/**
 * Hook to consume the EditorToolbar context.
 * Must be used within an EditorToolbar compound component.
 */
export function useEditorToolbar(): ToolbarProps {
  const ctx = useContext(EditorToolbarContext);
  if (!ctx) {
    throw new Error('useEditorToolbar must be used within an <EditorToolbar> component');
  }
  return ctx;
}
