// Hyperlinks and bookmarks: where a stretch of text points, and what points at it.
//
// THE SECURITY BOUNDARY IS HERE, not at paint time. A target arriving through this protocol is
// caller-supplied — an agent's string, a script's variable — and a `javascript:` URL written into
// a `.docx` is a live target handed to whoever opens the file next. So an authored target goes
// through the same gate the engine applies to a file's own: refused schemes never reach the
// package at all, and the refusal is a typed answer rather than a silently inert link.
//
// A bookmark is read as a RANGE, which means matching `w:bookmarkStart` to its `w:bookmarkEnd` by
// `@w:id`. A file is free to write neither, one, or a hundred, so the derivation is bounded and
// the ones it cannot pair are not answered.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  handleAt,
  handlesAt,
  open,
  refusal,
  reopen,
  roots,
  savedMainXml,
  savedPartBytes,
  spanAt,
  storyText,
  textAt,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost, AutomationSpan } from '../protocol.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A document with one external link, one internal one, and a bookmark to jump to. */
function withLinks(): AutomationHost {
  return open(
    docx(
      `<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>` +
        `<w:hyperlink r:id="rId9"><w:r><w:t>the site</w:t></w:r></w:hyperlink>` +
        `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
        `<w:hyperlink w:anchor="target"><w:r><w:t>below</w:t></w:r></w:hyperlink></w:p>` +
        `<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>the place</w:t></w:r>` +
        `<w:bookmarkEnd w:id="1"/></w:p>`,
      undefined,
      {
        rels: `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/a" TargetMode="External"/>`,
      }
    )
  );
}

function spanOfWords(host: AutomationHost, body: AutomationHandle, needle: string): AutomationSpan {
  const found = host.execute({ operations: [{ op: 'search', scope: { body }, text: needle }] });
  const result = found.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'spans' || !result.value.spans[0]) {
    throw new Error(`no match for ${needle}: ${JSON.stringify(found)}`);
  }
  return result.value.spans[0];
}

function hyperlinkOf(host: AutomationHost, span: AutomationSpan): string {
  return textAt(host.execute({ operations: [{ op: 'getHyperlink', span }] }), 0);
}

function bookmarksOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(host.execute({ operations: [{ op: 'getBookmarks', scope: { body } }] }), 0);
}

describe('a stretch of text says where it points', () => {
  test('an external link answers the target its relationship names', () => {
    const host = withLinks();
    const { body } = roots(host);
    expect(hyperlinkOf(host, spanOfWords(host, body, 'the site'))).toBe('https://example.com/a');
  });

  test('an internal link answers the bookmark it jumps to', () => {
    const host = withLinks();
    const { body } = roots(host);
    expect(hyperlinkOf(host, spanOfWords(host, body, 'below'))).toBe('#target');
  });

  test('text in no link answers nothing, which is not an error', () => {
    const host = withLinks();
    const { body } = roots(host);
    expect(hyperlinkOf(host, spanOfWords(host, body, 'see'))).toBe('');
  });

  test('a span that runs out of a link is not that link’s span', () => {
    const host = withLinks();
    const { body } = roots(host);
    // "site and" starts inside the link and ends outside it, so no single link covers it.
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const first = paragraphs[0] as AutomationHandle;
    const span = {
      start: { paragraph: first, offset: 8 },
      end: { paragraph: first, offset: 16 },
    };
    expect(hyperlinkOf(host, span)).toBe('');
  });
});

describe('a link is authored, and only a target this engine will open', () => {
  test('linking a stretch mints the relationship and survives save and reopen', () => {
    const host = withLinks();
    const { body } = roots(host);
    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: spanOfWords(host, body, 'see'),
          target: 'https://example.com/b',
        },
      ],
    });
    expect(response.ok).toBe(true);

    const saved = savedMainXml(host);
    expect(saved).toContain('w:hyperlink');

    const next = reopen(host);
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'see'))).toBe(
      'https://example.com/b'
    );
  });

  test('a document with no hyperlink style gets the built-in one with its first link', () => {
    const host = withLinks();
    const { body } = roots(host);
    const linkWords = (words: string) =>
      host.execute({
        operations: [
          {
            op: 'setHyperlink',
            span: spanOfWords(host, body, words),
            target: 'https://example.com/b',
          },
        ],
      });
    expect(linkWords('see').ok).toBe(true);
    expect(linkWords('the place').ok).toBe(true);

    const styles = savedPartBytes(host, 'word/styles.xml');
    expect(styles.match(/w:styleId="Hyperlink"/g)).toHaveLength(1);
    expect(styles).toMatch(/<w:style\b[^>]*w:type="character"[^>]*>.*<w:u w:val="single"\/>/s);
    expect(savedMainXml(host).match(/<w:rStyle w:val="Hyperlink"\/>/g)).toHaveLength(2);
  });

  test('a refused scheme is refused before anything is written', () => {
    const host = withLinks();
    const { body } = roots(host);
    const before = savedMainXml(host);
    for (const target of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
      const response = host.execute({
        operations: [{ op: 'setHyperlink', span: spanOfWords(host, body, 'see'), target }],
      });
      expect(response.ok).toBe(false);
      expect(refusal(response)).toBe('unsupported-content');
    }
    // Not "written and then rendered inert": the document is byte-for-byte what it was.
    expect(savedMainXml(host)).toBe(before);
  });

  test('a batch refused after the link is planned leaves the relationships alone', () => {
    const host = withLinks();
    const { body } = roots(host);
    const before = savedPartBytes(host, 'word/_rels/document.xml.rels');
    const forged = { kind: 'bookmark', ref: 'bookmark:forged:1' } as unknown as AutomationHandle;
    // A LATER operation fails, so the batch is refused as a whole. The relationship the link
    // would have needed is a package fact that outlives a refusal: minting it while planning
    // left a `Relationship` behind for a link the document never got, and nothing in the
    // protocol could tell the caller their refused batch had still changed the file.
    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: spanOfWords(host, body, 'see'),
          target: 'https://example.com/never',
        },
        { op: 'getBookmarkName', bookmark: forged },
      ],
    });
    expect(response.ok).toBe(false);
    expect(savedPartBytes(host, 'word/_rels/document.xml.rels')).toBe(before);
    expect(savedPartBytes(host, 'word/_rels/document.xml.rels')).not.toContain('example.com/never');
  });

  test('an anchor links to a bookmark in this document', () => {
    const host = withLinks();
    const { body } = roots(host);
    const response = host.execute({
      operations: [{ op: 'setHyperlink', span: spanOfWords(host, body, 'see'), target: '#target' }],
    });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'see'))).toBe('#target');
  });

  test('an anchor no bookmark in this document declares is refused', () => {
    const host = withLinks();
    const { body } = roots(host);
    const response = host.execute({
      operations: [
        { op: 'setHyperlink', span: spanOfWords(host, body, 'see'), target: '#nowhere' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('an empty target unlinks, keeping the words and their formatting', () => {
    const host = withLinks();
    const { body } = roots(host);
    const before = storyText(host, body);
    const response = host.execute({
      operations: [{ op: 'setHyperlink', span: spanOfWords(host, body, 'the site'), target: '' }],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    expect(storyText(next.host, next.body)).toBe(before);
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'the site'))).toBe('');
  });

  test('retargeting a link keeps the link and moves it', () => {
    const host = withLinks();
    const { body } = roots(host);
    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: spanOfWords(host, body, 'the site'),
          target: 'https://example.com/moved',
        },
      ],
    });
    expect(response.ok).toBe(true);
    const next = reopen(host);
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'the site'))).toBe(
      'https://example.com/moved'
    );
    // One link, not a link inside a link.
    expect((savedMainXml(next.host).match(/<w:hyperlink/g) ?? []).length).toBe(2);
  });

  test('a collapsed span has no words to link', () => {
    const host = withLinks();
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const first = paragraphs[0] as AutomationHandle;
    const response = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: { start: { paragraph: first, offset: 0 }, end: { paragraph: first, offset: 0 } },
          target: 'https://example.com/c',
        },
      ],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-content');
  });
});

describe('a bookmark is a name over a range', () => {
  test('a story answers its bookmarks, each with the range its markers enclose', () => {
    const host = withLinks();
    const { body } = roots(host);
    const [bookmark] = bookmarksOf(host, body) as [AutomationHandle];
    expect(textAt(host.execute({ operations: [{ op: 'getBookmarkName', bookmark }] }), 0)).toBe(
      'target'
    );
    const span = spanAt(host.execute({ operations: [{ op: 'getBookmarkRange', bookmark }] }), 0);
    expect(textAt(host.execute({ operations: [{ op: 'getSpanText', span }] }), 0)).toBe(
      'the place'
    );
  });

  test('a bookmark with no end marker is not answered, because it has no range', () => {
    const host = open(
      docx(`<w:p><w:bookmarkStart w:id="4" w:name="half"/><w:r><w:t>a</w:t></w:r></w:p>`)
    );
    expect(bookmarksOf(host, roots(host).body)).toEqual([]);
  });

  test('Word’s own scratch bookmarks are not a document’s bookmarks', () => {
    const host = open(
      docx(
        `<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:r><w:t>a</w:t></w:r>` +
          `<w:bookmarkEnd w:id="0"/></w:p>`
      )
    );
    expect(bookmarksOf(host, roots(host).body)).toEqual([]);
  });

  test('a span answers only the bookmarks it overlaps', () => {
    const host = open(
      docx(
        `<w:p><w:bookmarkStart w:id="1" w:name="one"/><w:r><w:t>first</w:t></w:r>` +
          `<w:bookmarkEnd w:id="1"/></w:p>` +
          `<w:p><w:bookmarkStart w:id="2" w:name="two"/><w:r><w:t>second</w:t></w:r>` +
          `<w:bookmarkEnd w:id="2"/></w:p>`
      )
    );
    const { body } = roots(host);
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    const second = paragraphs[1] as AutomationHandle;
    const found = handlesAt(
      host.execute({ operations: [{ op: 'getBookmarks', scope: { paragraph: second } }] }),
      0
    );
    expect(found.length).toBe(1);
    expect(
      textAt(host.execute({ operations: [{ op: 'getBookmarkName', bookmark: found[0]! }] }), 0)
    ).toBe('two');
  });

  test('two asks for one bookmark are one handle, and a name in a header is not the body’s', () => {
    const host = withLinks();
    const { body } = roots(host);
    expect(bookmarksOf(host, body)[0]).toEqual(bookmarksOf(host, body)[0]);
    const forged = { kind: 'bookmark', ref: 'bookmark:forged:1' } as unknown as AutomationHandle;
    expect(
      refusal(host.execute({ operations: [{ op: 'getBookmarkName', bookmark: forged }] }))
    ).toBe('invalid-handle');
  });

  test('a bookmark the document has lost is refused rather than answered a stale range', () => {
    const host = withLinks();
    const { body } = roots(host);
    const [bookmark] = bookmarksOf(host, body) as [AutomationHandle];
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    // Removing the paragraph takes its markers with it.
    const removed = host.execute({
      operations: [{ op: 'deleteParagraph', paragraph: paragraphs[1] as AutomationHandle }],
    });
    expect(removed.ok).toBe(true);
    const response = host.execute({ operations: [{ op: 'getBookmarkRange', bookmark }] });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('invalid-handle');
  });

  test('selecting a missing bookmark refuses the object before asking for a reader', () => {
    const host = withLinks();
    const { body } = roots(host);
    const [bookmark] = bookmarksOf(host, body) as [AutomationHandle];
    const paragraphs = handlesAt(host.execute({ operations: [{ op: 'getParagraphs', body }] }), 0);
    expect(
      host.execute({
        operations: [{ op: 'deleteParagraph', paragraph: paragraphs[1] as AutomationHandle }],
      }).ok
    ).toBe(true);

    const response = host.execute({
      operations: [{ op: 'selectBookmark', bookmark, mode: 'select' }],
    });
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('invalid-handle');
  });
});

describe('partial hyperlink writes preserve unselected text', () => {
  function textLink(extra = ''): AutomationHost {
    return open(
      docx(
        `<w:p><w:hyperlink r:id="rId9" w:history="0" w:tgtFrame="_blank" w:tooltip="Original tip">${extra}<w:r><w:rPr><w:b/></w:rPr><w:t>alpha beta gamma</w:t></w:r></w:hyperlink></w:p>`,
        undefined,
        {
          rels: `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/original" TargetMode="External"/>`,
        }
      )
    );
  }

  test('retargeting and unlinking middle text preserve wrapper metadata and formatting after reopen', () => {
    const host = textLink();
    const { body } = roots(host);
    expect(
      host.execute({
        operations: [
          {
            op: 'setHyperlink',
            span: spanOfWords(host, body, 'beta'),
            target: 'https://example.com/updated',
          },
        ],
      }).ok
    ).toBe(true);
    const next = reopen(host);
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'alpha'))).toBe(
      'https://example.com/original'
    );
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'beta'))).toBe(
      'https://example.com/updated'
    );
    expect(hyperlinkOf(next.host, spanOfWords(next.host, next.body, 'gamma'))).toBe(
      'https://example.com/original'
    );
    const xml = savedMainXml(next.host);
    expect(xml.match(/w:tgtFrame="_blank"/g)).toHaveLength(3);
    expect(xml.match(/w:tooltip="Original tip"/g)).toHaveLength(3);
    expect(xml.match(/<w:b\//g)).toHaveLength(3);
    expect(
      next.host.execute({
        operations: [
          { op: 'setHyperlink', span: spanOfWords(next.host, next.body, 'et'), target: '' },
        ],
      }).ok
    ).toBe(true);
    const final = reopen(next.host);
    expect(storyText(final.host, final.body)).toBe('alpha beta gamma');
    expect(hyperlinkOf(final.host, spanOfWords(final.host, final.body, 'alpha'))).toBe(
      'https://example.com/original'
    );
    expect(hyperlinkOf(final.host, spanOfWords(final.host, final.body, 'et'))).toBe('');
    expect(hyperlinkOf(final.host, spanOfWords(final.host, final.body, 'gamma'))).toBe(
      'https://example.com/original'
    );
    expect(savedMainXml(final.host).match(/w:tgtFrame="_blank"/g)).toHaveLength(4);
  });

  test('complex partial wrappers refuse without changing their text, targets, or relationships', () => {
    const host = textLink('<w:bookmarkStart w:id="1" w:name="inside"/><w:bookmarkEnd w:id="1"/>');
    const { body } = roots(host);
    const before = savedMainXml(host);
    const rels = savedPartBytes(host, 'word/_rels/document.xml.rels');
    for (const target of ['https://example.com/updated', '']) {
      const result = host.execute({
        operations: [{ op: 'setHyperlink', span: spanOfWords(host, body, 'beta'), target }],
      });
      expect(result.ok).toBe(false);
      expect(refusal(result)).toBe('unsupported-capability');
      expect(savedMainXml(host)).toBe(before);
      expect(savedPartBytes(host, 'word/_rels/document.xml.rels')).toBe(rels);
    }
  });

  test('collapsed positions inside a link refuse without changing the containing link', () => {
    const host = textLink();
    const { body } = roots(host);
    const span = spanOfWords(host, body, 'beta');
    const before = savedMainXml(host);
    const result = host.execute({
      operations: [
        {
          op: 'setHyperlink',
          span: { start: span.start, end: span.start },
          target: 'https://example.com/updated',
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(savedMainXml(host)).toBe(before);
  });
});
