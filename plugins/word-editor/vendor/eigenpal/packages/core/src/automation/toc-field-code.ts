/** Parse the bounded, inert TOC switch subset accepted by field insertion. */
export function tocFieldCode(switches: string): string | null {
  if (switches.length > 128) return null;
  let rest = switches.trim();
  const seen = new Set<string>();
  const result: string[] = [];
  while (rest) {
    const match = /^\\([ohzu])(?:\s+"([1-9])-([1-9])")?(?=\s|$)/.exec(rest);
    if (!match) return null;
    const [, name, first, last] = match;
    if (seen.has(name!) || (name === 'o' ? !first || Number(first) > Number(last) : !!first))
      return null;
    seen.add(name!);
    result.push(match[0]);
    rest = rest.slice(match[0].length).trimStart();
  }
  return ['TOC', ...result].join(' ');
}
