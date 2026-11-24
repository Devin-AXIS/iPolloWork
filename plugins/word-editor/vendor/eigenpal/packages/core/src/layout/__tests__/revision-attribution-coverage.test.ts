// Every tracked character reaches the page still wearing its revision.
//
// The review rail derives from the STORE and the page derives from LAYOUT. Two independent
// derivations of one fact, which is exactly how they drift: a document arrived whose rail
// reported a party name as replaced while the page painted the removed words as ordinary
// unchanged text. A reviewer approves a deletion the page never flagged.
//
// `revision-display-differential.test.ts` cannot catch that class. It pins the resolved modes
// against accept-all and reject-all output, and ALL-MARKUP has no accept/reject counterpart —
// it is the one mode specified by what it shows rather than by what it resolves to. So it needs
// its own oracle, and this is it: whatever the tree says is tracked, layout must attribute.
//
// Stated over the whole fixture corpus rather than over hand-written XML because the bug this
// exists for lived in field RESULT text, which no synthetic revision test had a reason to
// build — the shape only shows up in documents Word actually produced.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { isRevisionWrapper, revisionAttributionOf } from '../revision-projection.ts';
import { storyBlocks } from '../story-roots.ts';

const FIXTURES = resolve(import.meta.dir, '../../../../../e2e/fixtures');

/**
 * Text a run child contributes, `w:t` and `w:delText` alike.
 *
 * `w:instrText` is deliberately absent: a field instruction is never rendered, so counting it
 * would demand layout paint something Word does not.
 */
function runChildText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return '';
  if (node.kind !== 'text' && node.kind !== 'deletedText') return '';
  let text = '';
  for (const value of node.children ?? []) if (value.kind === 'textValue') text += value.value;
  return text;
}

/** What the TREE declares: revision identity to the characters it wraps, in document order. */
function declaredByTree(paragraph: OoxmlNode): Map<string, string> {
  const declared = new Map<string, string>();
  const walk = (node: OoxmlNode, active: readonly string[]): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children ?? []) {
      if (child.kind === 'textValue') continue;
      if (child.kind === 'run') {
        for (const grand of child.children ?? []) {
          const text = runChildText(grand);
          if (text.length === 0) continue;
          // Nested wrappers each claim the text: a deletion inside another author's insertion
          // is two pending decisions about the same characters, and layout owes both.
          for (const id of active) declared.set(id, (declared.get(id) ?? '') + text);
        }
        continue;
      }
      if (isRevisionWrapper(child)) {
        const attribution = revisionAttributionOf(child);
        if (attribution) {
          walk(child, [...active, `${attribution.kind}:${attribution.id}`]);
          continue;
        }
      }
      walk(child, active);
    }
  };
  walk(paragraph, []);
  return declared;
}

/** What LAYOUT attributes: revision identity to the characters painted wearing it. */
function attributedByLayout(paragraph: OoxmlNode): Map<string, string> {
  const attributed = new Map<string, string>();
  for (const piece of piecesOfParagraph(
    paragraph,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    'all-markup'
  )) {
    for (const revision of piece.revisions ?? []) {
      const id = `${revision.kind}:${revision.id}`;
      attributed.set(id, (attributed.get(id) ?? '') + piece.text);
    }
  }
  return attributed;
}

/**
 * Line furniture layout adds that the tree has no text node for.
 *
 * A `w:tab` becomes `\t` and a page `w:br` becomes `\f`. Both are always EXTRA characters on
 * the layout side, never missing ones, so they are stripped rather than synthesized into the
 * tree walk — teaching the walk to invent them would be a second implementation of layout,
 * which is the very thing this oracle exists to cross-check.
 */
function withoutLineFurniture(text: string): string {
  return text.replace(/[\t\f\n]/g, '');
}

interface AttributionGap {
  readonly fixture: string;
  readonly part: string;
  readonly revision: string;
  readonly declared: string;
  readonly attributed: string;
}

function gapsIn(fixture: string): AttributionGap[] {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(resolve(FIXTURES, fixture))));
  if (!pkg.ok) return [];
  const gaps: AttributionGap[] = [];
  for (const [part, content] of pkg.package.parts as Map<string, OoxmlPart>) {
    if (!part.endsWith('.xml')) continue;
    for (const block of storyBlocks(content, 'all-markup')) {
      if (block.kind !== 'paragraph') continue;
      const declared = declaredByTree(block);
      if (declared.size === 0) continue;
      const attributed = attributedByLayout(block);
      for (const [revision, text] of declared) {
        const painted = withoutLineFurniture(attributed.get(revision) ?? '');
        if (painted === withoutLineFurniture(text)) continue;
        gaps.push({ fixture, part, revision, declared: text, attributed: painted });
      }
    }
  }
  return gaps;
}

function describeGap(gap: AttributionGap): string {
  return (
    `${gap.fixture} ${gap.part} ${gap.revision}\n` +
    `      tree says    : ${JSON.stringify(gap.declared)}\n` +
    `      layout paints: ${JSON.stringify(gap.attributed)}`
  );
}

/**
 * Bun's 5 s default is the wrong bar for a whole-corpus oracle.
 *
 * This test opens and lays out every `.docx` in `e2e/fixtures/` — around a hundred of them,
 * about 3.1 s in one process on a developer machine. That is close enough to the default
 * that a loaded runner tips it over, and a timing failure here reddens `bun run test:serial`,
 * which is the only run that catches a test leaving state on `document`. A ceiling wide
 * enough to be about hanging rather than about load keeps that gate readable; a real hang
 * still fails it.
 */
const CORPUS_TIMEOUT_MS = 30_000;

describe('revision attribution coverage', () => {
  test(
    'every tracked character is attributed in all-markup, across the corpus',
    () => {
      const fixtures = readdirSync(FIXTURES).filter((name) => name.endsWith('.docx'));
      // A corpus that stopped loading would make this pass by finding nothing, which is the
      // one way an oracle lies. Assert it actually read a corpus.
      expect(fixtures.length).toBeGreaterThan(50);

      const gaps = fixtures.flatMap(gapsIn);
      if (gaps.length > 0) {
        throw new Error(
          `${gaps.length} tracked revision(s) reach the page unattributed:\n\n` +
            `${gaps.map(describeGap).join('\n\n')}\n`
        );
      }
    },
    CORPUS_TIMEOUT_MS
  );
});
