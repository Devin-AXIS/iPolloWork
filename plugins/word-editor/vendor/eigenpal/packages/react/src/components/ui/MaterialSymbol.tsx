/**
 * Material Symbol Icon Component
 *
 * Now uses inline SVGs instead of Google Fonts for better bundling.
 * This file re-exports from Icons.tsx for backwards compatibility.
 */

export { MaterialSymbol, type IconProps as MaterialSymbolProps } from './Icons';
export default MaterialSymbol;

// Re-export MaterialSymbol as default for existing imports
import { MaterialSymbol } from './Icons';
