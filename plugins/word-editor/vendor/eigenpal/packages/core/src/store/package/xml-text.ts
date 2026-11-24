// Character data of a part read at the trust boundary: references decoded, validity checked,
// and storage detached from the part's XML text. Shared by both XML readers.

import { isValidXmlText } from './sinks.ts';

/**
 * A copy of `value` that does not point into the part's XML text. V8 keeps a substring of 13 or
 * more characters as a view of its parent, so one long attribute or run kept the whole decoded
 * part alive for as long as the tree. Shorter strings are already copies.
 */
export function ownString(value: string): string {
  return value.length < 13 ? value : (value + ' ').slice(0, -1);
}

/** `value`, or a throw when it holds a character XML 1.0 forbids. */
export function validateXmlText(value: string): string {
  if (!isValidXmlText(value)) throw new Error('value is not valid XML 1.0 text');
  return value;
}

/**
 * Decode ONLY the five predefined XML entities and numeric character references.
 * Safe because the readers have already rejected any DTD / custom entity declaration
 * or reference before this runs — so `&amp;`/`&#nn;` are the only refs possible,
 * and the parser leaves them raw (avoiding entity-expansion attacks).
 * Without this, run text keeps its escaped lexical form and a re-serialize
 * double-escapes it.
 */
export function decodeXmlEntities(s: string): string {
  const decoded =
    s.indexOf('&') < 0
      ? s
      : s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_match, e: string) => {
          switch (e) {
            case 'amp':
              return '&';
            case 'lt':
              return '<';
            case 'gt':
              return '>';
            case 'quot':
              return '"';
            case 'apos':
              return "'";
            default: {
              const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
              if (
                !Number.isSafeInteger(code) ||
                !(
                  code === 0x9 ||
                  code === 0xa ||
                  code === 0xd ||
                  (code >= 0x20 && code <= 0xd7ff) ||
                  (code >= 0xe000 && code <= 0xfffd) ||
                  (code >= 0x10000 && code <= 0x10ffff)
                )
              )
                throw new Error('numeric reference is not a valid XML 1.0 scalar');
              return String.fromCodePoint(code);
            }
          }
        });
  return ownString(validateXmlText(decoded));
}
