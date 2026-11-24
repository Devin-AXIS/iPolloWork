/**
 * Toolbar Utility Functions
 *
 * Pure helpers that shape engine-reported selection state for the toolbar.
 * Extracted from Toolbar.tsx to reduce file size.
 */

import type { RunFormatting, Theme } from '@docx-editor.dev/core/contracts/editor';
import { resolveColorToHex } from '../lib/colorResolver';
import { pointsToHalfPoints } from '../lib/units';
import { createDefaultListState } from '../lib/listState';
import type { SelectionFormatting } from './Toolbar';

// Re-export the canonical highlight-color table. Local import below so
// internal callers can use it without going through the public surface.
export { HIGHLIGHT_HEX_TO_NAME, mapHexToHighlightName } from '../lib/highlightColors';

// ============================================================================
// FORMATTING STATE EXTRACTION
// ============================================================================

/**
 * Shape the contract's run formatting (`EditorSnapshot.formatting` /
 * the `selectionFormatting` query result) into the toolbar's display state.
 */
export function getSelectionFormatting(
  formatting?: RunFormatting | null,
  theme?: Theme | null
): SelectionFormatting {
  const result: SelectionFormatting = {};

  if (formatting) {
    result.bold = formatting.bold;
    result.italic = formatting.italic;
    result.underline = formatting.underline;
    result.strike = formatting.strike;
    result.fontFamily = formatting.fontFamily;
    if (formatting.fontSizePt !== undefined) {
      result.fontSize = pointsToHalfPoints(formatting.fontSizePt);
    }
    const colorHex = resolveColorToHex(formatting.color, theme);
    result.color = colorHex ? `#${colorHex}` : undefined;
    result.highlight = formatting.highlight !== 'none' ? formatting.highlight : undefined;
  }

  // The contract's run formatting carries no list state; report the known
  // empty state rather than guessing.
  result.listState = createDefaultListState();

  return result;
}

/**
 * Check if formatting has any active styles
 */
export function hasActiveFormatting(formatting?: SelectionFormatting): boolean {
  if (!formatting) return false;
  return !!(
    formatting.bold ||
    formatting.italic ||
    formatting.underline ||
    formatting.strike ||
    formatting.superscript ||
    formatting.subscript
  );
}
