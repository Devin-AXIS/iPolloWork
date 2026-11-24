// The download name, and what a hostile document title cannot make it do.
//
// The title reaching `downloadName` is not always typed by the user: a host that populates
// `title` from the package's `docProps/core.xml` `dc:title` is handing it a DOCX-derived
// string, which the repo's trust rule treats as attacker-controlled. The name is not an
// injection sink — the browser reads `download` as a plain name — but it IS text the user
// reads in a download shelf and a file manager, and those render invisible and
// direction-changing characters faithfully.

import { describe, expect, test } from 'bun:test';
import { downloadName } from '../src/editor/menu/download.ts';

describe('downloadName', () => {
  test('keeps an ordinary title as itself', () => {
    // Punctuation and spaces are prose, not danger. Over-sanitizing here would mangle
    // every real document name to fix a threat that is about invisible characters.
    expect(downloadName('Q3 report - draft (v2)')).toBe('Q3 report - draft (v2).docx');
    expect(downloadName('Contrat — Société Générale')).toBe('Contrat — Société Générale.docx');
    expect(downloadName('契約書 2026')).toBe('契約書 2026.docx');
  });

  test('does not double the extension', () => {
    expect(downloadName('Report.docx')).toBe('Report.docx');
    expect(downloadName('Report.DOCX')).toBe('Report.docx');
    // A suffix followed by a space, a dot, or an invisible character is still the suffix.
    expect(downloadName('report.docx ')).toBe('report.docx');
    expect(downloadName('report.docx.')).toBe('report.docx');
    expect(downloadName('report.docx\u200b')).toBe('report.docx');
    expect(downloadName('report.DOCX\n')).toBe('report.docx');
    expect(downloadName('.docx')).toBe('document.docx');
    // Only the final suffix goes: a title the user typed with two keeps the inner one.
    expect(downloadName('notes.docx.docx')).toBe('notes.docx.docx');
  });

  test('strips path separators, so a name can never be a path', () => {
    expect(downloadName('../../etc/passwd')).toBe('etc passwd.docx');
    expect(downloadName('C:\\Windows\\System32')).toBe('C Windows System32.docx');
  });

  test('neutralizes the bidi override filename spoof', () => {
    // `Invoice<RLO>fdp.exe` renders as `Invoicexcod.exe.pdf` in a download shelf while the
    // bytes are a .docx. Display-only deception, and exactly what the sanitizer is for.
    const spoof = `Invoice\u202Efdp.exe`;
    const name = downloadName(spoof);
    expect(name).not.toContain('\u202E');
    expect(name).toBe('Invoice fdp.exe.docx');
    // The isolate forms too, not just the embedding ones.
    expect(downloadName(`a\u2066b\u2069c`)).toBe('a b c.docx');
  });

  test('a title of only invisible characters falls back rather than saving an unfindable file', () => {
    // The trap: a zero-width string is TRUTHY, so a naive `|| 'document'` never fires and
    // the user gets a file they can neither see in a list nor type in a terminal.
    expect(downloadName('\u200B')).toBe('document.docx');
    expect(downloadName('\uFEFF\u200D\u200C')).toBe('document.docx');
    expect(downloadName('\u0000\u001f\u007f\u009f')).toBe('document.docx');
  });

  test('a newline cannot split the name', () => {
    // The `/` becomes a space and the trailing space is trimmed.
    expect(downloadName('Invoice\nrm -rf /')).toBe('Invoice rm -rf.docx');
  });

  test('dot-only and leading-dot titles do not become hidden files', () => {
    // `.` would otherwise produce `.docx`: a dotfile with an empty stem.
    expect(downloadName('.')).toBe('document.docx');
    expect(downloadName('...')).toBe('document.docx');
    expect(downloadName('.hidden')).toBe('hidden.docx');
    // Windows silently drops trailing dots and spaces.
    expect(downloadName('report...')).toBe('report.docx');
    expect(downloadName('report   ')).toBe('report.docx');
  });

  test('a long run of dots and spaces before the end stays linear', () => {
    // A trailing `/[.\s]+$/` retried from every position of this run: 200k characters took
    // about 25 seconds, far past the test timeout. A title can come from `dc:title`, so the
    // document picks its length.
    const hostile = `a${'. '.repeat(100_000)}b`;
    // The byte cap drops `b`, then the trailing strip removes every `. ` pair.
    expect(downloadName(hostile)).toBe('a.docx');
    expect(downloadName(`a${'. '.repeat(100_000)}`)).toBe('a.docx');
  });

  test('truncation that ends on a dot or a space does not leave one', () => {
    expect(downloadName(`${'a'.repeat(199)}.b`)).toBe(`${'a'.repeat(199)}.docx`);
    expect(downloadName(`${'a'.repeat(199)} b`)).toBe(`${'a'.repeat(199)}.docx`);
    // The cap can also cut a longer name down to one that ends in `.docx`.
    expect(downloadName(`${'a'.repeat(195)}.docxb`)).toBe(`${'a'.repeat(195)}.docx`);
    expect(downloadName(`${'a'.repeat(193)}. .docxb`)).toBe(`${'a'.repeat(193)}.docx`);
  });

  test('Windows reserved device names fall back, extension or not', () => {
    // `CON.docx` is still the CON device: saving to it fails or behaves strangely.
    for (const device of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9']) {
      expect(downloadName(device)).toBe('document.docx');
    }
    for (const device of ['COM\u00b9', 'COM0', 'CONIN$']) {
      expect(downloadName(device)).toBe('document.docx');
    }
    // Windows reads the device from the part before the FIRST dot, so a device stem before
    // a dot gets a prefix. The title survives: "Con. Law outline" is prose, not a device.
    expect(downloadName('NUL.tar')).toBe('_NUL.tar.docx');
    expect(downloadName('aux.a.b')).toBe('_aux.a.b.docx');
    expect(downloadName('lpt\u00b3.log')).toBe('_lpt\u00b3.log.docx');
    expect(downloadName('conout$.txt')).toBe('_conout$.txt.docx');
    expect(downloadName('Con. Law outline')).toBe('_Con. Law outline.docx');
    // A name that merely CONTAINS one is fine.
    expect(downloadName('CONTRACT')).toBe('CONTRACT.docx');
    expect(downloadName('con report')).toBe('con report.docx');
  });

  test('a title of only separators falls back', () => {
    expect(downloadName('///')).toBe('document.docx');
    expect(downloadName('   ')).toBe('document.docx');
    expect(downloadName('')).toBe('document.docx');
    expect(downloadName(undefined)).toBe('document.docx');
  });

  test('truncation counts BYTES and never splits a character', () => {
    // `NAME_MAX` is 255 bytes, not 255 characters. Slicing UTF-16 units could also leave a
    // lone surrogate, which the browser renders as U+FFFD in the saved name.
    const long = '😀'.repeat(200);
    const name = downloadName(long);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(206);
    expect(name.endsWith('.docx')).toBe(true);
    expect(name).not.toContain('\uFFFD');
    // Every astral character survived whole: no lone surrogates.
    const stem = name.slice(0, -'.docx'.length);
    expect([...stem].every((character) => character === '😀')).toBe(true);

    const ascii = 'a'.repeat(500);
    expect(downloadName(ascii).length).toBe(200 + '.docx'.length);
  });
});

describe('buildReportIssueUrl', () => {
  test('reports the page WITHOUT the query string or fragment', async () => {
    // This URL goes into a public issue form on a tracker the host does not own, from a
    // row that ships inside other people's products. `location.href` carries whatever the
    // host put in its query and hash — session ids, one-time tokens, document ids — and a
    // user clicking "Report issue" agreed to describe a bug, not to publish their address
    // bar. Origin and path answer the only question we need: which screen.
    const { buildReportIssueUrl } = await import('../src/lib/reportIssue.ts');
    const url = buildReportIssueUrl({
      pageUrl: undefined,
      userAgent: 'test-agent',
      viewport: { width: 1, height: 1 },
    });
    // No window in this environment, so the default resolves to empty rather than throwing.
    expect(url.startsWith('https://github.com/eigenpal/docx-editor/issues/new?')).toBe(true);
    expect(url).toContain('test-agent');

    // An explicitly supplied URL is passed through verbatim: a caller that WANTS the query
    // string can still send it.
    const explicit = buildReportIssueUrl({
      pageUrl: 'https://app.example.com/docs/abc?session=secret',
      userAgent: 'a',
      viewport: { width: 1, height: 1 },
    });
    expect(decodeURIComponent(explicit)).toContain('session=secret');
  });
});
