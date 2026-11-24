// Tab leaders (ECMA-376 §17.3.1.38) and the document-wide default tab interval (§17.15.1.25).
//
// Both are Word-fidelity features the tab lane used to drop: a table of contents lost its dot
// leaders, and a metric-locale document tabbed on a 0.5" grid Word never used.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openTreeSession } from '../../binding/tree-session.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  linesOf,
} from '../index.ts';
import {
  DEFAULT_TAB_INTERVAL_PT,
  cascadedTabStops,
  defaultTabIntervalFromSettings,
  nextTabDestination,
  paragraphTabStops,
  tabStopsFingerprint,
} from '../paragraph-tabs.ts';
import { cascadeParagraphFormatting, buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadSettings(inner: string) {
  const result = readOoxmlPart(`<w:settings xmlns:w="${W}">${inner}</w:settings>`, {
    name: '/word/settings.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function pPrOf(part: OoxmlPart) {
  return part.root.children[0]!.children[0]!.children[0]!;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, defaultTabStopPt?: number) =>
  layoutSemanticDocument(part, 1, {
    measurer,
    ...(defaultTabStopPt !== undefined ? { defaultTabStopPt } : {}),
  });

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

describe('w:tab/@w:leader is read and carried', () => {
  test('recognised leaders survive; an unknown one is none', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs>` +
        `<w:tab w:val="right" w:pos="720" w:leader="dot"/>` +
        `<w:tab w:val="left" w:pos="1440" w:leader="hyphen"/>` +
        `<w:tab w:val="left" w:pos="2160" w:leader="underscore"/>` +
        `<w:tab w:val="left" w:pos="2880" w:leader="heavy"/>` +
        `<w:tab w:val="left" w:pos="3600" w:leader="middleDot"/>` +
        `<w:tab w:val="left" w:pos="4320" w:leader="none"/>` +
        `<w:tab w:val="left" w:pos="5040" w:leader="__proto__"/>` +
        `</w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    expect(paragraphTabStops(pPrOf(part)).stops.map((stop) => stop.leader)).toEqual([
      'dot',
      'hyphen',
      'underscore',
      'heavy',
      'middleDot',
      undefined,
      undefined,
    ]);
  });

  test('clear removes the inherited stop and its leader together', () => {
    const styles = readOoxmlPart(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="T"><w:pPr><w:tabs>` +
        `<w:tab w:val="right" w:pos="720" w:leader="dot"/>` +
        `<w:tab w:val="right" w:pos="2880" w:leader="hyphen"/>` +
        `</w:tabs></w:pPr></w:style></w:styles>`,
      { name: '/word/styles.xml', contentType: 'app/xml' }
    );
    if (!styles.ok) throw new Error(styles.reason);
    const table = buildStyleCascadeTable(styles.part.root);
    const part = load(
      `<w:p><w:pPr><w:pStyle w:val="T"/><w:tabs>` +
        `<w:tab w:val="clear" w:pos="720"/>` +
        `</w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    );
    const cascaded = cascadeParagraphFormatting(table, pPrOf(part));
    expect(cascadedTabStops(cascaded.paragraphPropertyNodes).stops).toEqual([
      { alignment: 'right', positionPt: 144, leader: 'hyphen' },
    ]);
  });

  test('a default-interval tab reaches no authored stop, so it carries no leader', () => {
    const destination = nextTabDestination(
      { stops: [{ positionPt: 10, alignment: 'left', leader: 'dot' }], defaultIntervalPt: 36 },
      20,
      500
    );
    expect(destination).toEqual({ positionPt: 36, alignment: 'left' });
  });

  test('a leader-only change moves the break cache token', () => {
    const plain = tabStopsFingerprint({
      stops: [{ positionPt: 144, alignment: 'right' }],
      defaultIntervalPt: DEFAULT_TAB_INTERVAL_PT,
    });
    const dotted = tabStopsFingerprint({
      stops: [{ positionPt: 144, alignment: 'right', leader: 'dot' }],
      defaultIntervalPt: DEFAULT_TAB_INTERVAL_PT,
    });
    expect(dotted).not.toBe(plain);
  });
});

describe('the leader reaches the layout record and the paint', () => {
  const TOC_ENTRY =
    `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4320" w:leader="dot"/></w:tabs></w:pPr>` +
    `<w:r><w:t>Chapter One</w:t><w:tab/><w:t>7</w:t></w:r></w:p>`;

  test('layout publishes the leader on the tab span', () => {
    const [line] = linesOf(lay(load(TOC_ENTRY)));
    const tab = line!.spans.find((span) => span.text === '\t')!;
    expect(tab.tabLeader).toBe('dot');
    // The leader adds no advance of its own — the following text still lands on the stop.
    const after = line!.spans[line!.spans.indexOf(tab) + 1]!;
    expect(after.box.x + after.box.width).toBeCloseTo(216, 5);
  });

  test('a tab with no leader publishes none', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs></w:pPr>` +
        `<w:r><w:t>A</w:t><w:tab/><w:t>7</w:t></w:r></w:p>`
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans.find((span) => span.text === '\t')!.tabLeader).toBeUndefined();
  });

  test('paint fills the reserved advance with the leader glyph', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, lay(load(TOC_ENTRY)), { scale: 1 });
    const leader = container.querySelector('[data-docx-tab-leader]') as HTMLElement | null;
    expect(leader).not.toBeNull();
    expect(leader!.textContent!.length).toBeGreaterThan(1);
    expect(new Set(leader!.textContent!)).toEqual(new Set(['.']));
    // Positioned and clipped to the advance the tab reserved, never wider.
    const tab = linesOf(lay(load(TOC_ENTRY)))[0]!.spans.find((span) => span.text === '\t')!;
    // Compared as a number: CSS serializes a width to six decimals, so a published advance
    // that is a repeating decimal never matches its own `${value}px` spelling.
    expect(Number.parseFloat(leader!.style.width)).toBeCloseTo(tab.box.width, 5);
    expect(leader!.style.overflow).toBe('hidden');
  });

  test('the leader is inert furniture, outside the span that carries the model range', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, lay(load(TOC_ENTRY)), { scale: 1 });
    const leader = container.querySelector('[data-docx-tab-leader]') as HTMLElement;
    expect(leader.getAttribute('aria-hidden')).toBe('true');
    expect(leader.getAttribute('contenteditable')).toBe('false');
    expect(leader.dataset.paragraphId).toBeUndefined();
    expect(leader.closest('[data-start]')).toBeNull();
    // `dom-selection` reads a span's length from its textContent: the tab must stay one char.
    const spans = [...container.querySelectorAll('[data-paragraph-id][data-start]')];
    const tab = spans.find((span) => span.textContent === '\t');
    expect(tab).toBeDefined();
    expect(spans.map((span) => span.textContent).join('')).toBe('Chapter One\t7');
  });

  test('a tab with no leader paints no leader layer', () => {
    const container = document.createElement('div');
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs></w:pPr>` +
        `<w:r><w:t>A</w:t><w:tab/><w:t>7</w:t></w:r></w:p>`
    );
    paintSemanticLayout(container, lay(part), { scale: 1 });
    expect(container.querySelectorAll('[data-docx-tab-leader]')).toHaveLength(0);
  });
});

describe('w:defaultTabStop is read from settings.xml and bounded', () => {
  test('an authored interval is honoured', () => {
    // 1134 twips = 2cm, what a metric-locale Word template writes.
    expect(defaultTabIntervalFromSettings(loadSettings(`<w:defaultTabStop w:val="1134"/>`))).toBe(
      1134 / 20
    );
  });

  test('an absent part or element falls back to the schema default', () => {
    expect(defaultTabIntervalFromSettings(null)).toBe(DEFAULT_TAB_INTERVAL_PT);
    expect(defaultTabIntervalFromSettings(loadSettings(''))).toBe(DEFAULT_TAB_INTERVAL_PT);
  });

  test('a decimal interval truncates to whole twips', () => {
    expect(defaultTabIntervalFromSettings(loadSettings('<w:defaultTabStop w:val="720.9"/>'))).toBe(
      36
    );
  });

  test('hostile values fall back rather than entering layout arithmetic', () => {
    for (const val of ['0', '0.4', '-720', '1e3', '7.5e1', 'NaN', '999999999', '31681', '']) {
      expect(
        defaultTabIntervalFromSettings(loadSettings(`<w:defaultTabStop w:val="${val}"/>`))
      ).toBe(DEFAULT_TAB_INTERVAL_PT);
    }
  });
});

describe('the default interval moves default-interval tabs', () => {
  const BODY = `<w:p><w:r><w:t>Hi</w:t><w:tab/><w:t>Z</w:t></w:r></w:p>`;

  test('a body tab lands on the authored grid, not the 0.5" one', () => {
    const at720 = linesOf(lay(load(BODY)))[0]!.spans.find((span) => span.text === 'Z')!;
    expect(at720.box.x).toBe(36);
    const at1134 = linesOf(lay(load(BODY), 1134 / 20))[0]!.spans.find((span) => span.text === 'Z')!;
    expect(at1134.box.x).toBeCloseTo(1134 / 20, 5);
  });

  test('an authored stop still wins over the interval', () => {
    const part = load(
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="600"/></w:tabs></w:pPr>` +
        `<w:r><w:t>Hi</w:t><w:tab/><w:t>Z</w:t></w:r></w:p>`
    );
    const after = linesOf(lay(part, 1134 / 20))[0]!.spans.find((span) => span.text === 'Z')!;
    expect(after.box.x).toBe(30);
  });

  test('a cell paragraph tabs on the same document-wide grid', () => {
    const table =
      `<w:tbl><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Hi</w:t><w:tab/><w:t>Z</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const zOf = (defaultTabStopPt?: number) =>
      linesOf(lay(load(table), defaultTabStopPt))[0]!.spans.find((span) => span.text === 'Z')!;
    expect(zOf(1134 / 20).box.x - zOf().box.x).toBeCloseTo(1134 / 20 - 36, 5);
  });
});

describe('header/footer stories tab on the document grid', () => {
  // Word's own Footer style right-tabs the page number, but plenty of documents just press
  // Tab — and furniture reading a different grid from the body is exactly the mismatch
  // "identical to Word" forbids.
  function footerPart(): OoxmlPart {
    const result = readOoxmlPart(
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Hi</w:t><w:tab/><w:t>Z</w:t></w:r></w:p></w:ftr>`,
      { name: '/word/footer1.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  const zOf = (defaultTabStopPt?: number) => {
    const story = layoutHeaderFooterStory(
      footerPart(),
      400,
      measurer,
      'test',
      undefined,
      undefined,
      undefined,
      undefined,
      defaultTabStopPt
    );
    const spans = story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.spans) : []
    );
    return spans.find((span) => span.text === 'Z')!;
  };

  test('a footer tab lands on the authored interval, not the 0.5" one', () => {
    expect(zOf().box.x).toBe(36);
    expect(zOf(1134 / 20).box.x).toBeCloseTo(1134 / 20, 5);
  });
});

describe('the session resolves the settings part', () => {
  test('a real package answers its w:settings root', () => {
    const opened = openTreeSession(new Uint8Array(readFileSync(FIXTURE)));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const root = opened.session.settingsRoot();
    expect(root).not.toBeNull();
    expect(root!.localName).toBe('settings');
    // Whatever it declares must be a usable, bounded interval.
    const interval = defaultTabIntervalFromSettings(root);
    expect(interval).toBeGreaterThan(0);
    expect(interval).toBeLessThanOrEqual(31_680 / 20);
  });
});
