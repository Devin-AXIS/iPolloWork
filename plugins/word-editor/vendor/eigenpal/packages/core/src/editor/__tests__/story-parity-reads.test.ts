// Two document-wide reads that answered for the body alone.
//
// Both are questions ABOUT THE DOCUMENT, and both were derived from one story. A reader has no
// way to tell a narrow answer from a true one, which is what makes this class expensive: the
// engine looks like it is telling you there is nothing there.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { openStory } from './story-parity-harness.ts';
import { CONTROL_TEXT, PROBE_TEXT } from './story-parity-fixture.ts';

describe('bodyText covers the whole body story', () => {
  test('it includes paragraphs inside a block content control', () => {
    const open = openStory('body');
    try {
      const text = open.surface.session.bodyText();
      // Read through the ProseMirror projection's block list, this dropped every paragraph
      // that is not a direct child of `w:body` — so a content control's text, and every table
      // cell in the document, were simply absent.
      expect(text).toContain(CONTROL_TEXT);
      for (const probe of PROBE_TEXT) expect(text).toContain(probe);
    } finally {
      open.destroy();
    }
  });

  test('it agrees with storyText for the same story', () => {
    const open = openStory('body');
    try {
      expect(open.surface.session.bodyText()).toBe(
        open.surface.session.storyText({ kind: 'body' })
      );
    } finally {
      open.destroy();
    }
  });
});

describe('hasReviewContent answers for the whole document', () => {
  /** Wrap this story's first probe paragraph in a tracked insertion. */
  const withTrackedChangeIn = (story: 'body' | 'header' | 'footnote') => {
    const open = openStory(story);
    open.surface.setEditingMode('suggest');
    const paragraphId = open.paragraphIds[0]!;
    open.surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    open.surface.type('X');
    return open;
  };

  test('a clean document carries none', () => {
    const open = openStory('body');
    try {
      expect(open.surface.session.hasReviewContent()).toBe(false);
    } finally {
      open.destroy();
    }
  });

  for (const story of ['body', 'header', 'footnote'] as const) {
    test(`a tracked change in the ${story} counts`, () => {
      const open = withTrackedChangeIn(story);
      try {
        // Derived from the body alone this answered `false` for a header or a note, while
        // `reviewItems` beside it listed the very same change — two derivations of one
        // question, disagreeing. The free tier's upsell hint is the one thing that reads it.
        expect(
          open.surface.session.hasReviewContent(),
          `a tracked change in the ${story} was not counted`
        ).toBe(true);
        // And it really is in that story's part, not the body's.
        expect(open.surface.session.storyText(open.surface.storyScope())).toContain('X');
      } finally {
        open.destroy();
      }
    });
  }
});
