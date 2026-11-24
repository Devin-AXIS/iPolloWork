// A clipboard payload that carries only `text/html`.
//
// The paste handler prevents the browser's default unconditionally, so returning early on
// a missing `text/plain` flavour meant those payloads pasted NOTHING, with no error and no
// fallback. The text is recovered instead — as text, never as structure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  insertableText,
  plainTextFromHtml,
  plainTextFromTransfer,
} from '../clipboard-plain-text.ts';
import { clipboardDropLandsText, clipboardPasteLandsContent } from '../clipboard-file-lane.ts';
import { isValidXmlText } from '../../store/package/sinks.ts';
import { createClipboardHandlers } from '../surface-input.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';

/** A DataTransfer stand-in: happy-dom's does not carry arbitrary flavours reliably. */
const transfer = (flavours: Record<string, string>): DataTransfer =>
  ({ getData: (type: string) => flavours[type] ?? '' }) as unknown as DataTransfer;

describe('the text behind a clipboard payload', () => {
  test('text/plain wins whenever the payload carries it', () => {
    const data = transfer({ 'text/plain': 'chosen', 'text/html': '<p>ignored</p>' });
    expect(plainTextFromTransfer(data)).toBe('chosen');
  });

  test('an HTML-only payload pastes its text instead of nothing at all', () => {
    const data = transfer({ 'text/html': '<p>alpha</p>' });
    expect(plainTextFromTransfer(data)).toBe('alpha');
  });

  test('a payload with neither flavour is still empty', () => {
    expect(plainTextFromTransfer(transfer({}))).toBe('');
    expect(plainTextFromTransfer(null)).toBe('');
  });
});

describe('the paste handler', () => {
  // The handler's job narrowed with the rich lane: prevent the default, then hand BOTH
  // flavours to `pasteRich`, whose router owns the fidelity order. The "plain wins" rule
  // lives on in the PLAIN LANE — `plainTextFromTransfer` above — which is what every
  // degraded payload lands on.
  const paste = (flavours: Record<string, string>) => {
    const routed: Array<{ text: string; html: string | null }> = [];
    let prevented = false;
    const surface = {
      pasteRich: (text: string, html: string | null) => routed.push({ text, html }),
    } as unknown as PaginatedSurface;
    const handlers = createClipboardHandlers(surface);
    handlers.onPaste({
      clipboardData: transfer(flavours),
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as ClipboardEvent);
    return { routed, prevented };
  };

  test('an HTML-only payload reaches the router with its text fallback', () => {
    const { routed } = paste({ 'text/html': '<p>alpha</p><p>beta</p>' });
    expect(routed).toEqual([{ text: 'alpha\nbeta', html: '<p>alpha</p><p>beta</p>' }]);
  });

  test('the browser default is prevented either way, including on an empty payload', () => {
    expect(paste({ 'text/html': '<p>alpha</p>' }).prevented).toBe(true);
    const empty = paste({});
    expect(empty.prevented).toBe(true);
    expect(empty.routed).toEqual([]);
  });

  test('a payload with both flavours keeps the plain text verbatim for the plain lane', () => {
    const { routed } = paste({
      'text/plain': '  spaced  text  ',
      'text/html': '<p>collapsed</p>',
    });
    expect(routed).toEqual([{ text: '  spaced  text  ', html: '<p>collapsed</p>' }]);
  });
});

describe('making pasted text insertable', () => {
  // Run text is serialized to XML and the store validates it, so ONE illegal character
  // rejects the op — and one rejected op vetoes the transaction, which is why a paste
  // carrying a page break used to do nothing at all rather than partially land.

  test('a page break becomes a paragraph break instead of killing the paste', () => {
    expect(insertableText('alpha\fbeta')).toBe('alpha\nbeta');
  });

  test('the engine can paste back what it copied across a page break', () => {
    // `selectedText()` writes U+000C for a page break, so Select All + Copy + Paste fed
    // this exact shape straight back in and the whole paste was refused.
    const copied = 'page one\n\fpage two';
    const insertable = insertableText(copied);
    expect(isValidXmlText(insertable)).toBe(true);
    expect(insertable.split('\n')).toEqual(['page one', '', 'page two']);
  });

  test('CRLF and a lone CR still collapse to one paragraph break', () => {
    expect(insertableText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  test('tab, newline and ordinary text survive untouched', () => {
    expect(insertableText('a\tb\nc')).toBe('a\tb\nc');
  });

  test('every other control character is dropped rather than refused', () => {
    expect(insertableText('a\u0001b\u0000c\u001fd')).toBe('abcd');
    expect(insertableText('a\ufffeb\uffffc')).toBe('abc');
  });

  test('a valid surrogate pair survives and a lone surrogate is dropped', () => {
    expect(insertableText('a\u{1F600}b')).toBe('a\u{1F600}b');
    expect(insertableText('a\ud800b')).toBe('ab');
    expect(insertableText('a\udc00b')).toBe('ab');
    expect(insertableText('a\ud800')).toBe('a');
  });

  test('whatever it returns is always something the store will accept', () => {
    const hostile = 'x\f\u0001\ud800y\uffff\u{1F600}\r\n\tz\udfff';
    expect(isValidXmlText(insertableText(hostile))).toBe(true);
    // …and the guard is meaningful: the raw payload is refused.
    expect(isValidXmlText(hostile)).toBe(false);
  });
});

describe('the visible text of an HTML fragment', () => {
  test('block boundaries become newlines, so paste splits paragraphs', () => {
    expect(plainTextFromHtml('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(plainTextFromHtml('alpha<br>beta')).toBe('alpha\nbeta');
  });

  test('table cells become tabs and rows newlines, like a copied cell range', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>';
    expect(plainTextFromHtml(html)).toBe('a\tb\nc\td');
  });

  test('script and style CONTENT never becomes pasted text', () => {
    const html = '<div>before<script>alert(1)</script><style>p{color:red}</style>after</div>';
    const text = plainTextFromHtml(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toBe('beforeafter');
  });

  test('an unclosed script tag does not leak its body either', () => {
    expect(plainTextFromHtml('<div>keep<script>alert(1)')).toBe('keep');
  });

  test('comments are dropped, including tag-shaped text inside them', () => {
    expect(plainTextFromHtml('a<!-- <p>hidden</p> -->b')).toBe('ab');
  });

  test('entities decode only AFTER tags are gone, so markup cannot reassemble', () => {
    // The payload names a tag through entities. Decoding first would hand the tag
    // stripper live markup; decoding last leaves it as the literal text it always was.
    const text = plainTextFromHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(text).toBe('<script>alert(1)</script>');
  });

  test('numeric and named references decode, and nonsense ones stay literal', () => {
    // `&nbsp;` stays a real U+00A0 rather than collapsing to a space.
    expect(plainTextFromHtml('<p>a&amp;b&#65;c&#x42;d&nbsp;e</p>')).toBe('a&bAcBd\u00a0e');
    expect(plainTextFromHtml('<p>&#x110000;</p>')).toBe('&#x110000;');
    expect(plainTextFromHtml('<p>&notareal;</p>')).toBe('&notareal;');
  });

  test('a lone surrogate reference never throws', () => {
    expect(() => plainTextFromHtml('<p>&#xD800;</p>')).not.toThrow();
  });

  test('a hostile oversized payload is bounded rather than dropped', () => {
    const huge = `<p>${'x'.repeat(3_000_000)}</p>`;
    const text = plainTextFromHtml(huge);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(2_000_000);
  });

  test('no output ever carries an angle-bracketed tag through', () => {
    const html = '<p onclick="evil()">text<img src=x onerror=alert(1)></p>';
    expect(plainTextFromHtml(html)).toBe('text');
  });

  test('a bracket a browser shows as text is kept, even beside a removed element', () => {
    // A `<` that opens no tag is text, so removing the element after it can leave that `<`
    // next to a word — `<script>` here, where the tag-stripping reader gave `script>`. The
    // output is only ever inserted as run text, so a bracket in it is a character, not
    // markup; what matters is that the reader never RE-READS what it wrote.
    expect(plainTextFromHtml('<<div>script>')).toBe('<script>');
    expect(plainTextFromHtml('<<!---->script>')).toBe('<script>');
    expect(plainTextFromHtml('<scr<div>ipt>alert(1)')).toBe('ipt>alert(1)');
  });

  test('a quoted attribute may hold a bracket without ending the tag', () => {
    expect(plainTextFromHtml('<p title="a > b">text</p>')).toBe('text');
    expect(plainTextFromHtml("<p data-x='a > b'>text</p>")).toBe('text');
  });

  test('an apostrophe in an unquoted attribute is a character, not a quote', () => {
    // Only the quote directly after `=` opens a value. Reading this one as an opening quote
    // sent the scan hunting for a partner to the end of the payload and pasted nothing.
    expect(plainTextFromHtml("<p class=note title=it's>Para one</p><p>Second</p>")).toBe(
      'Para one\nSecond'
    );
    expect(plainTextFromHtml("<div><img src=a.jpg alt=John's photo><p>Caption</p></div>")).toBe(
      'Caption'
    );
  });

  test('an unpaired bracket in prose stays prose', () => {
    expect(plainTextFromHtml('<p>1 < 2 and 3 > 2</p>')).toBe('1 < 2 and 3 > 2');
  });

  test('a doctype is furniture, not text', () => {
    expect(plainTextFromHtml('<!DOCTYPE html><p>alpha</p>')).toBe('alpha');
  });

  test('a comment that closes at once does not swallow the payload behind it', () => {
    // `<!-->` and `<!--->` are complete comments. Demanding a full `-->` after them found no
    // terminator and dropped everything that followed — the whole paste, for five characters.
    expect(plainTextFromHtml('<!-->text')).toBe('text');
    expect(plainTextFromHtml('<!--->text')).toBe('text');
    expect(plainTextFromHtml('a<!--<!-- -->b')).toBe('ab');
  });

  test('raw text stays out of the document even when the elements overlap', () => {
    expect(plainTextFromHtml('<style><script></style>alert(1)</script>')).toBe('alert(1)');
    expect(plainTextFromHtml('<script>a<script>b</script>c</script>')).toBe('c');
    expect(plainTextFromHtml('<SCRIPT>alert(1)</SCRIPT>keep')).toBe('keep');
  });

  test('an attribute does not stop a break or a cell from reading as one', () => {
    expect(plainTextFromHtml('a<br class="x">b')).toBe('a\nb');
    expect(plainTextFromHtml('<tr><td>a</td class=x><td>b</td></tr>')).toBe('a\tb');
  });

  test('truncation landing inside a tag does not paste the tag as text', () => {
    const text = plainTextFromHtml(`${'x'.repeat(1_999_990)}<p class="y`);
    expect(text.endsWith('x')).toBe(true);
    expect(text).not.toContain('<p');
  });

  test('a payload built to make a reader backtrack still finishes at once', () => {
    // Raw-text elements and bare brackets, repeated: each branch of the walk consumes what
    // it reads, so the cost stays proportional to the length rather than squaring it.
    const hostile = `${'<style>x</style>'.repeat(50_000)}${'< '.repeat(100_000)} text`;
    const started = performance.now();
    expect(plainTextFromHtml(hostile)).toContain('text');
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  test('a solid run of cell tabs is answered at once too', () => {
    // `</td>` emits exactly one tab, so a payload of nothing else is a tab run a sender
    // controls. Trimming those with `/\t+\n/g` backtracked over every position of the run:
    // 80,000 cells cost 2.7 seconds, and the input cap allows five times that many.
    const hostile = `${'</td>'.repeat(80_000)}z`;
    const started = performance.now();
    expect(plainTextFromHtml(hostile)).toContain('z');
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('clipboardPasteLandsContent — the image-file stand-down predicate for adapters', () => {
  // A real 1x1 PNG: the projection sniffs magic bytes, so only a genuine image reads as
  // one the engine lands.
  const REAL_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  test('a Word-for-Mac text copy (HTML with text, PNG file beside it) stands the file lane down', () => {
    const wordHtml =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>' +
      '<meta name=ProgId content=Word.Document><style>p.MsoNormal{margin:0}</style></head>' +
      '<body><!--StartFragment--><p class=MsoNormal align=center><b>' +
      '<span style="font-size:26.0pt">DOCX TITLE</span></b></p><!--EndFragment--></body></html>';
    const payload = transfer({ 'text/html': wordHtml, 'text/plain': 'DOCX TITLE' });
    expect(clipboardPasteLandsContent(payload)).toBe(true);
  });

  test('a projectable data: image lands through the engine', () => {
    expect(
      clipboardPasteLandsContent(
        transfer({ 'text/html': `<img src="data:image/png;base64,${REAL_PNG}">` })
      )
    ).toBe(true);
  });

  test('a fragment that does not read as a package keeps the file lane', () => {
    // The router refuses bytes `readOoxmlPackage` cannot open and would land nothing, so
    // a decodable-but-garbage attribute must not stand the file lane down.
    expect(
      clipboardPasteLandsContent(transfer({ 'text/html': '<div data-docx-fragment="AAAA"></div>' }))
    ).toBe(false);
  });

  test('a data: image the projection refuses keeps the file lane', () => {
    // Standing down for a payload the engine then refuses dropped the real PNG file AND
    // landed nothing — a dead paste gesture. The predicate asks the projection itself.
    expect(
      clipboardPasteLandsContent(
        transfer({ 'text/html': '<img src="data:image/webp;base64,AAAA">' })
      )
    ).toBe(false);
    // Claims png, but the bytes are not a PNG: the magic-byte sniff refuses it.
    expect(
      clipboardPasteLandsContent(
        transfer({ 'text/html': '<img src="data:image/png;base64,AAAA">' })
      )
    ).toBe(false);
  });

  test('a malformed fragment attribute keeps the file lane', () => {
    expect(
      clipboardPasteLandsContent(transfer({ 'text/html': '<span data-docx-fragment=""></span>' }))
    ).toBe(false);
  });

  test('a browser copy-image payload and a bare screenshot keep the file lane', () => {
    expect(
      clipboardPasteLandsContent(transfer({ 'text/html': '<img src="https://example.com/x.png">' }))
    ).toBe(false);
    expect(clipboardPasteLandsContent(transfer({}))).toBe(false);
    expect(clipboardPasteLandsContent(null)).toBe(false);
  });

  test('a page title around a copied image does not count as content', () => {
    // A full-document copy-image flavour carries a <title> no reader ever saw. Counting
    // it stood the file lane down and pasted the word instead of the image.
    const html =
      '<html><head><title>Photos</title></head><body><img src="https://cdn/x.png"></body></html>';
    expect(clipboardPasteLandsContent(transfer({ 'text/html': html }))).toBe(false);
  });

  test('invisible-only text does not stand the file lane down', () => {
    // Zero-width wrappers around an external image (Slack/Notion-style markup), or a bare
    // newline in text/plain. The engine may still land those invisible characters beside
    // the file — the predicate deliberately values the image over suppressing them.
    expect(
      clipboardPasteLandsContent(
        transfer({ 'text/html': '<span>\u200b<img src="https://x/y.png"></span>' })
      )
    ).toBe(false);
    expect(clipboardPasteLandsContent(transfer({ 'text/html': '<p>&nbsp;</p>' }))).toBe(false);
    expect(clipboardPasteLandsContent(transfer({ 'text/plain': '\u200b \n' }))).toBe(false);
  });

  test('a payload with no HTML stands down on visible plain text', () => {
    // text/plain + image file and no text/html: the engine's plain lane inserts the text,
    // so the file is Word's duplicate rendering.
    expect(clipboardPasteLandsContent(transfer({ 'text/plain': 'plain words' }))).toBe(true);
  });

  test('bidi format characters are invisible too', () => {
    // Directional marks around an external image render as nothing; counting them stood
    // the file lane down and pasted two invisible characters instead of the picture.
    expect(
      clipboardPasteLandsContent(
        transfer({ 'text/html': '&#x200E;<img src="https://x/y.png">&#x200F;' })
      )
    ).toBe(false);
  });

  test('visible text/plain wins even when the HTML flavour carries none', () => {
    // A caption or URL beside a text-free HTML flavour: the plain lane lands it whatever
    // the rich lanes do, so the file would be a second insertion.
    const payload = transfer({
      'text/html': '<img src="data:image/webp;base64,AAAA">',
      'text/plain': 'a caption',
    });
    expect(clipboardPasteLandsContent(payload)).toBe(true);
  });
});

describe('clipboardDropLandsText — the image-file drop-lane stand-down', () => {
  test('a dropped text selection stands the file lane down', () => {
    expect(
      clipboardDropLandsText(
        transfer({ 'text/html': '<p>dropped words</p>', 'text/plain': 'dropped words' })
      )
    ).toBe(true);
  });

  test('an image-file drag that mirrors its path into text/plain keeps the file lane', () => {
    // Safari image drags and file managers put the path or URL in text/plain; the payload
    // is still an IMAGE drag, so text/plain must not stand the file lane down.
    expect(clipboardDropLandsText(transfer({ 'text/plain': 'file:///Users/a/photo.png' }))).toBe(
      false
    );
    expect(
      clipboardDropLandsText(
        transfer({ 'text/plain': 'https://x/y.png', 'text/html': '<img src="https://x/y.png">' })
      )
    ).toBe(false);
  });

  test('fragments and data: images do NOT land from a drop, so they keep the file lane', () => {
    // The drop lane is plain text only; only visible HTML text stands the file lane down.
    expect(
      clipboardDropLandsText(transfer({ 'text/html': '<div data-docx-fragment="AAAA"></div>' }))
    ).toBe(false);
  });
});
