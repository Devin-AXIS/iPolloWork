/** Small line glyphs and illustrations that the native icon set does not provide. */
import type { ReactNode } from 'react'

function Line({ size = 16, children }: { size?: number | undefined; children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}
export const MailGlyph = ({ size }: { size?: number }) => <Line size={size}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></Line>
export const LockGlyph = ({ size }: { size?: number }) => <Line size={size}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></Line>
export const KeyGlyph = ({ size }: { size?: number }) => <Line size={size}><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></Line>
export const CoinGlyph = ({ size }: { size?: number }) => <Line size={size}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5h-2.5a1.75 1.75 0 0 0 0 3.5H14.5"/></Line>
export const ArrowGlyph = ({ size }: { size?: number }) => <Line size={size}><path d="M5 12h14M13 6l6 6-6 6"/></Line>
export const BuildingGlyph = ({ size }: { size?: number }) => <Line size={size}><path d="M4 20V6l8-3v17M12 9h8v11M2 20h20M7 8h2M7 12h2M7 16h2M15 13h2M15 16h2"/></Line>

/** The account mark: the brand glyph on a small glass tile. */
export function AccountArt() {
  return <span data-ipw-art="" aria-hidden="true"><img src="/ipollowork-suite/assets/mark.svg" width="22" height="22" alt="" data-ipw-mark=""/></span>
}

/** Restrained hues for identifier tiles; purple is excluded from the suite palette. */
const HUES = [205, 172, 148, 38, 14, 218, 190, 28]
/** Stable small glyph tile for a provider or person: an initial on a muted hue derived from the identifier. */
export function Monogram({ id, label, size = 28, round = false }: { id: string; label: string; size?: number; round?: boolean }) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  const hue = HUES[Math.abs(hash) % HUES.length]!
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? '·'
  return <span aria-hidden="true" data-ipw-monogram="" style={{ width: size, height: size, borderRadius: round ? '50%' : Math.round(size * .3), fontSize: Math.round(size * .42), ['--ipw-mono-hue' as string]: String(hue) }}>{initial}</span>
}
