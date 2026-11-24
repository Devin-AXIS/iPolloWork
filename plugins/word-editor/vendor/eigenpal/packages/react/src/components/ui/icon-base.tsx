import type { ReactNode } from 'react';
/**
 * The shared shell every bundled Material Symbol renders through.
 *
 * Split out of `Icons.tsx` so that file can keep growing by one icon at a time without the
 * wrapper riding along; `Icons.tsx` re-exports `IconProps` so the import path consumers
 * already use is unchanged.
 */

import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const defaultSize = 20;

/** SVG wrapper for Material Symbols (viewBox 0 -960 960 960). */
export function SvgIcon({
  size = defaultSize,
  className = '',
  style,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      className={className}
      style={{ display: 'inline-flex', flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
