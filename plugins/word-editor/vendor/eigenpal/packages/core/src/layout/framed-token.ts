// Length-framed cache token composition, shared by every layout token builder.

/**
 * Injective token join: every part is length-prefixed (netstring framing), so NO content —
 * file-controlled text, other framed joins, even a part containing digits and colons — can
 * forge a part boundary. Two part lists concatenate to one string only when they are the
 * same list. Use this for every cache/reuse token composed over file-influenced strings; a
 * printable separator, and even a NUL separator once parts may themselves contain NUL, lets
 * two different states alias and a reused page paint the stale one.
 */
export function framedTokenJoin(parts: readonly string[]): string {
  let out = '';
  for (const part of parts) out += `${part.length}:${part}`;
  return out;
}
