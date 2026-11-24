export function getPrimaryFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (!trimmed) return '';

  let quote: '"' | "'" | null = null;
  let first = '';

  for (const char of trimmed) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      first += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      first += char;
      continue;
    }

    if (char === ',' && quote === null) {
      break;
    }

    first += char;
  }

  return first.trim().replace(/^['"]|['"]$/g, '');
}
