// Tracked edits inside or beside another author's pending text revision.
//
// The runtime author's strike over another author's inserted words nests inside their
// insertion. The runtime author's new words go beside struck text, never into it, and new
// words inside another author's insertion split it in two. Each author's decision stays
// separate. Structural, paragraph mark, formatting, and move revisions
// still refuse, and so does a strike over nothing but struck text.

import { describe, expect, test } from 'bun:test';
import type { AutomationOperation } from '../operations.ts';
import type { AutomationHandle, AutomationHost, AutomationSpan } from '../protocol.ts';
import {
  docx,
  handlesAt,
  open,
  p,
  paragraphTexts,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
  spanAt,
  textAt,
} from './support/protocol.ts';

const TRACK = {
  op: 'setChangeTrackingMode',
  mode: 'TrackMineOnly',
  author: 'Avery Chen',
} as const;
const STAMP = 'w:author="Tailspin Legal" w:date="2026-09-01T00:00:00Z"';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (text: string, id = 7) => `<w:ins w:id="${id}" ${STAMP}>${run(text)}</w:ins>`;
const del = (text: string, id = 8) =>
  `<w:del w:id="${id}" ${STAMP}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

const HEAD = 'Payment is due within ';
const PROPOSED = 'thirty (30) days of receipt';
const REPLACEMENT = 'forty-five (45) days of receipt';
const START = HEAD.length;
const END = START + PROPOSED.length;
const inserted = () => docx(`<w:p>${run(HEAD)}${ins(PROPOSED)}${run('.')}</w:p>`);
const struck = () => docx(`<w:p>${run(HEAD)}${del(PROPOSED)}${run(' after notice.')}</w:p>`);

function firstParagraph(host: AutomationHost): AutomationHandle {
  return paragraphsOf(host, roots(host).body)[0]!;
}

function span(paragraph: AutomationHandle, start: number, end: number) {
  return { start: { paragraph, offset: start }, end: { paragraph, offset: end } };
}

function tracked(host: AutomationHost, operation: AutomationOperation) {
  return host.execute({ operations: [TRACK, operation] });
}

function modelText(host: AutomationHost, answer: AutomationSpan): string {
  return textAt(
    host.execute({ operations: [{ op: 'getSpanText', span: answer, projection: 'model' }] }),
    0
  );
}

/** The paragraph markup, without dates and identities that change per run. */
function bodyMarkup(host: AutomationHost): string {
  return savedMainXml(host)
    .replace(/^[\s\S]*<w:body>/, '')
    .replace(/<w:sectPr[\s\S]*$/, '')
    .replace(/<\/w:body>[\s\S]*$/, '')
    .replace(/ w:(date|id)="[^"]*"/g, '')
    .replace(/ w14:(paraId|textId)="[^"]*"/g, '')
    .replace(/ xml:space="preserve"/g, '');
}

function revisions(host: AutomationHost): { handle: AutomationHandle; label: string }[] {
  const { body } = roots(host);
  const found = handlesAt(host.execute({ operations: [{ op: 'getRevisions', body }] }), 0);
  const response = host.execute({
    operations: found.flatMap((revision) => [
      { op: 'getRevisionAuthor' as const, revision },
      { op: 'getRevisionType' as const, revision },
    ]),
  });
  return found.map((handle, index) => ({
    handle,
    label: `${textAt(response, index * 2)}:${textAt(response, index * 2 + 1)}`,
  }));
}

function decide(host: AutomationHost, label: string, accept: boolean) {
  const target = revisions(host).filter((revision) => revision.label === label);
  expect(target.length).toBeGreaterThan(0);
  const response = host.execute({
    operations: target.map(({ handle }) => ({
      op: accept ? ('acceptRevision' as const) : ('rejectRevision' as const),
      revision: handle,
    })),
  });
  expect(response.results).toEqual(target.map(() => expect.objectContaining({ status: 'ok' })));
}

const NESTED_REPLACEMENT =
  `<w:p>${run(HEAD).replace(' xml:space="preserve"', '')}` +
  '<w:ins w:author="Tailspin Legal"><w:del w:author="Avery Chen">' +
  `<w:r><w:delText>${PROPOSED}</w:delText></w:r></w:del></w:ins>` +
  `<w:ins w:author="Avery Chen"><w:r><w:t>${REPLACEMENT}</w:t></w:r></w:ins>` +
  '<w:r><w:t>.</w:t></w:r></w:p>';

describe("another author's pending insertion", () => {
  test('Replace strikes inside their insertion and writes the new words after it', () => {
    const host = open(inserted());
    const response = tracked(host, {
      op: 'replaceSpan',
      span: span(firstParagraph(host), START, END),
      text: REPLACEMENT,
    });
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe(REPLACEMENT);
    expect(bodyMarkup(host)).toBe(NESTED_REPLACEMENT.replace(run(HEAD), `<w:r><w:t>${HEAD}`));
    const again = reopen(host).host;
    expect(bodyMarkup(again)).toBe(bodyMarkup(host));
    expect(
      revisions(again)
        .map((revision) => revision.label)
        .sort()
    ).toEqual(['Avery Chen:Delete', 'Avery Chen:Insert', 'Tailspin Legal:Insert']);
  });

  for (const order of ['accept theirs first', 'reject mine first'] as const) {
    test(`decisions stay separate: ${order}`, () => {
      const host = open(inserted());
      const paragraph = firstParagraph(host);
      expect(
        tracked(host, {
          op: 'replaceSpan',
          span: span(paragraph, START, END),
          text: REPLACEMENT,
        }).ok
      ).toBe(true);
      const { body } = roots(host);
      if (order === 'accept theirs first') {
        decide(host, 'Tailspin Legal:Insert', true);
        // Their words are now plain text, and the reviewer's deletion of them still stands.
        expect(bodyMarkup(host)).toContain(
          `<w:del w:author="Avery Chen"><w:r><w:delText>${PROPOSED}</w:delText></w:r></w:del>`
        );
        expect(bodyMarkup(host)).not.toContain('Tailspin Legal');
        decide(host, 'Avery Chen:Delete', false);
        decide(host, 'Avery Chen:Insert', false);
        expect(paragraphTexts(host, body)).toEqual([`${HEAD}${PROPOSED}.`]);
        expect(bodyMarkup(host)).not.toContain('<w:ins');
        expect(bodyMarkup(host)).not.toContain('<w:del');
      } else {
        decide(host, 'Avery Chen:Delete', false);
        decide(host, 'Avery Chen:Insert', false);
        // Rejecting the reviewer's changes restores the counterparty's pending insertion.
        const original = open(inserted());
        expect(bodyMarkup(host)).toBe(bodyMarkup(original));
        decide(host, 'Tailspin Legal:Insert', true);
        expect(paragraphTexts(host, body)).toEqual([`${HEAD}${PROPOSED}.`]);
      }
      expect(bodyMarkup(reopen(host).host)).toBe(bodyMarkup(host));
    });
  }

  test('After writes beside their insertion, as a separate insertion', () => {
    const host = open(inserted());
    const paragraph = firstParagraph(host);
    const response = tracked(host, {
      op: 'insertText',
      at: span(paragraph, START, END).end,
      text: ' net',
    });
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe(' net');
    expect(bodyMarkup(host)).toContain(
      `<w:ins w:author="Tailspin Legal"><w:r><w:t>${PROPOSED}</w:t></w:r></w:ins>` +
        '<w:ins w:author="Avery Chen"><w:r><w:t> net</w:t></w:r></w:ins>'
    );
  });

  test('delete strikes their words in place, and rejecting it restores their insertion', () => {
    const host = open(inserted());
    const response = tracked(host, {
      op: 'replaceSpan',
      span: span(firstParagraph(host), START + 7, END),
      text: '',
    });
    expect(response.ok).toBe(true);
    expect(bodyMarkup(host)).toContain(
      '<w:ins w:author="Tailspin Legal"><w:r><w:t>thirty </w:t></w:r>' +
        '<w:del w:author="Avery Chen"><w:r><w:delText>(30) days of receipt</w:delText></w:r></w:del></w:ins>'
    );
    decide(host, 'Avery Chen:Delete', false);
    // The reject can leave the run split where the strike ended; the words and decision return.
    expect(paragraphTexts(host, roots(host).body)).toEqual([`${HEAD}${PROPOSED}.`]);
    expect(revisions(host).map((revision) => revision.label)).toEqual(['Tailspin Legal:Insert']);
    expect(bodyMarkup(host)).not.toContain('<w:del');
  });

  test('a replacement inside their words answers where the new words land', () => {
    const host = open(inserted());
    const response = tracked(host, {
      op: 'replaceSpan',
      span: span(firstParagraph(host), START, START + 6),
      text: 'sixty',
    });
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe('sixty');
  });

  test('a tracked deletion across paragraphs strikes inside their insertion', () => {
    const host = open(docx(`<w:p>${run('One ')}${ins('two')}</w:p>${p('Three')}${p('Four')}`));
    const paragraphs = paragraphsOf(host, roots(host).body);
    const response = tracked(host, {
      op: 'replaceSpan',
      span: {
        start: { paragraph: paragraphs[0]!, offset: 4 },
        end: { paragraph: paragraphs[1]!, offset: 2 },
      },
      text: 'ten',
    });
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe('ten');
    expect(bodyMarkup(host)).toContain(
      '<w:ins w:author="Tailspin Legal"><w:del w:author="Avery Chen">' +
        '<w:r><w:delText>two</w:delText></w:r></w:del></w:ins>'
    );
  });
});

describe("another author's pending deletion", () => {
  test('After inside their struck words lands after the deletion', () => {
    const host = open(struck());
    const response = tracked(host, {
      op: 'insertText',
      at: { paragraph: firstParagraph(host), offset: START + 6 },
      text: 'sixty days',
    });
    expect(response.ok).toBe(true);
    const answer = spanAt(response, 1);
    expect(answer.start.offset).toBe(END);
    expect(modelText(host, answer)).toBe('sixty days');
    expect(bodyMarkup(host)).toContain(
      `<w:del w:author="Tailspin Legal"><w:r><w:delText>${PROPOSED}</w:delText></w:r></w:del>` +
        '<w:ins w:author="Avery Chen"><w:r><w:t>sixty days</w:t></w:r></w:ins>'
    );
  });

  for (const offset of [START, END]) {
    test(`an insertion at the deletion edge ${offset === START ? 'before' : 'after'} it stays beside it`, () => {
      const host = open(struck());
      const response = tracked(host, {
        op: 'insertText',
        at: { paragraph: firstParagraph(host), offset },
        text: 'net ',
      });
      expect(response.ok).toBe(true);
      expect(spanAt(response, 1).start.offset).toBe(offset);
      expect(modelText(host, spanAt(response, 1))).toBe('net ');
    });
  }

  test('a replacement ending inside their deletion answers the words after it', () => {
    const host = open(struck());
    const response = tracked(host, {
      op: 'replaceSpan',
      span: span(firstParagraph(host), 4, START + 6),
      text: 'payable',
    });
    expect(response.ok).toBe(true);
    const answer = spanAt(response, 1);
    expect(answer.start.offset).toBe(END);
    expect(modelText(host, answer)).toBe('payable');
    expect(bodyMarkup(reopen(host).host)).toBe(bodyMarkup(host));
  });

  test('a replacement over live text and their deletion strikes only the live text', () => {
    const host = open(struck());
    const response = tracked(host, {
      op: 'replaceSpan',
      span: span(firstParagraph(host), START + 6, END + 6),
      text: 'later',
    });
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe('later');
    expect(bodyMarkup(host)).toContain(
      '<w:del w:author="Avery Chen"><w:r><w:delText> after</w:delText></w:r></w:del>' +
        '<w:ins w:author="Avery Chen"><w:r><w:t>later</w:t></w:r></w:ins>'
    );
  });
});

describe('edits that still refuse', () => {
  function expectRefused(
    bytes: Uint8Array,
    operation: (p: AutomationHandle) => AutomationOperation
  ) {
    const host = open(bytes);
    const before = savedMainXml(host);
    const revision = host.revision();
    const response = tracked(host, operation(firstParagraph(host)));
    expect(response.ok).toBe(false);
    expect(refusal(response)).toBe('unsupported-revision');
    expect(host.revision()).toBe(revision);
    expect(savedMainXml(host)).toBe(before);
  }

  test('a strike over nothing but their struck words', () => {
    expectRefused(struck(), (paragraph) => ({
      op: 'replaceSpan',
      span: span(paragraph, START + 2, END - 2),
      text: 'other',
    }));
  });

  test('an edit over their formatting change', () => {
    const formatted =
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="9" ${STAMP}><w:rPr/></w:rPrChange></w:rPr>` +
      '<w:t>bold words</w:t></w:r></w:p>';
    expectRefused(docx(formatted), (paragraph) => ({
      op: 'replaceSpan',
      span: span(paragraph, 0, 4),
      text: 'thin',
    }));
  });

  test('an edit over their move', () => {
    const moved =
      `<w:p><w:moveFrom w:id="9" ${STAMP}>${run('moved words')}</w:moveFrom>${run(' rest')}</w:p>` +
      `<w:p><w:moveTo w:id="10" ${STAMP}>${run('moved words')}</w:moveTo></w:p>`;
    expectRefused(docx(moved), (paragraph) => ({
      op: 'replaceSpan',
      span: span(paragraph, 2, 8),
      text: 'other',
    }));
  });

  test('an edit at their inserted paragraph mark', () => {
    const marked =
      `<w:p><w:pPr><w:rPr><w:ins w:id="9" ${STAMP}/></w:rPr></w:pPr>${run('split here')}</w:p>` +
      p('next');
    expectRefused(docx(marked), (paragraph) => ({
      op: 'insertText',
      at: { paragraph, offset: 10 },
      text: ' more',
    }));
  });

  test('an explicit proposal outside tracking keeps its independent-decision rule', () => {
    const host = open(inserted());
    const response = host.execute({
      operations: [
        {
          op: 'proposeReplacement',
          span: span(firstParagraph(host), START, END),
          text: REPLACEMENT,
          author: 'Avery Chen',
        },
      ],
    });
    expect(refusal(response)).toBe('unsupported-revision');
  });
});

describe("new words in the middle of another author's insertion", () => {
  const MIDDLE = START + 'thirty'.length;
  const writeMiddle = (host: AutomationHost) =>
    tracked(host, {
      op: 'insertText',
      at: { paragraph: firstParagraph(host), offset: MIDDLE },
      text: ' (or sixty)',
    });
  const split =
    '<w:ins w:author="Tailspin Legal"><w:r><w:t>thirty</w:t></w:r></w:ins>' +
    '<w:ins w:author="Avery Chen"><w:r><w:t> (or sixty)</w:t></w:r></w:ins>' +
    '<w:ins w:author="Tailspin Legal"><w:r><w:t> (30) days of receipt</w:t></w:r></w:ins>';

  test('split their insertion, so each author keeps one decision', () => {
    const host = open(inserted());
    const response = writeMiddle(host);
    expect(response.ok).toBe(true);
    expect(modelText(host, spanAt(response, 1))).toBe(' (or sixty)');
    expect(bodyMarkup(host)).toContain(split);
    const again = reopen(host).host;
    expect(bodyMarkup(again)).toBe(bodyMarkup(host));
    expect(
      revisions(again)
        .map((revision) => revision.label)
        .sort()
      // Their two halves are listed separately, and each still carries their revision identity.
    ).toEqual(['Avery Chen:Insert', 'Tailspin Legal:Insert', 'Tailspin Legal:Insert']);
  });

  for (const order of ['reject theirs, then accept mine', 'accept mine, then reject theirs']) {
    test(`decide each author separately: ${order}`, () => {
      const first = open(inserted());
      expect(writeMiddle(first).ok).toBe(true);
      const host = reopen(first).host;
      const { body } = roots(host);
      if (order.startsWith('reject')) {
        decide(host, 'Tailspin Legal:Insert', false);
        // The reviewer's words survive as their own pending insertion.
        expect(paragraphTexts(host, body)).toEqual([`${HEAD} (or sixty).`]);
        expect(revisions(host).map((revision) => revision.label)).toEqual(['Avery Chen:Insert']);
        decide(host, 'Avery Chen:Insert', true);
      } else {
        decide(host, 'Avery Chen:Insert', true);
        // The reviewer's words are plain text outside the pending insertion around them.
        expect(bodyMarkup(host)).toContain(
          '<w:ins w:author="Tailspin Legal"><w:r><w:t>thirty</w:t></w:r></w:ins>' +
            '<w:r><w:t> (or sixty)</w:t></w:r>' +
            '<w:ins w:author="Tailspin Legal"><w:r><w:t> (30) days of receipt</w:t></w:r></w:ins>'
        );
        decide(host, 'Tailspin Legal:Insert', false);
      }
      expect(paragraphTexts(host, body)).toEqual([`${HEAD} (or sixty).`]);
      expect(revisions(host)).toEqual([]);
      expect(bodyMarkup(reopen(host).host)).toBe(bodyMarkup(host));
    });
  }

  for (const [name, from, to] of [
    ['the first word', START, START + 'thirty'.length],
    ['a middle part', START + 'thirty '.length, START + 'thirty (30)'.length],
  ] as const) {
    test(`replacing ${name} keeps the new words outside their insertion`, () => {
      const host = open(inserted());
      const response = tracked(host, {
        op: 'replaceSpan',
        span: span(firstParagraph(host), from, to),
        text: 'NEW',
      });
      expect(response.ok).toBe(true);
      expect(modelText(host, spanAt(response, 1))).toBe('NEW');
      const markup = bodyMarkup(host);
      expect(markup).toMatch(/<\/w:ins><w:ins w:author="Avery Chen"><w:r><w:t>NEW<\/w:t>/);
      expect(markup).not.toMatch(/<w:ins w:author="Tailspin Legal">(?:(?!<\/w:ins>).)*<w:ins /);
      decide(host, 'Tailspin Legal:Insert', false);
      expect(paragraphTexts(host, roots(host).body)).toEqual([`${HEAD}NEW.`]);
    });
  }

  test('a content control inside their insertion refuses new words inside it', () => {
    const control =
      `<w:p>${run(HEAD)}<w:ins w:id="7" ${STAMP}><w:sdt><w:sdtPr/><w:sdtContent>` +
      `${run(PROPOSED)}</w:sdtContent></w:sdt></w:ins>${run('.')}</w:p>`;
    const host = open(docx(control));
    const before = savedMainXml(host);
    const response = tracked(host, {
      op: 'insertText',
      at: { paragraph: firstParagraph(host), offset: START + 6 },
      text: ' more',
    });
    expect(refusal(response)).toBe('unsupported-revision');
    expect(response.results.at(-1)).toMatchObject({
      error: { detail: 'edit.tracked-foreign-revision-unsupported' },
    });
    expect(savedMainXml(host)).toBe(before);
  });
});

describe('a third author inside the insertion', () => {
  const THIRD = 'w:author="Third Party" w:date="2026-09-02T00:00:00Z"';
  // Tailspin inserted "thirty (30) days"; a third author proposes deleting "(30) ".
  const layered = () =>
    docx(
      `<w:p>${run(HEAD)}<w:ins w:id="7" ${STAMP}>${run('thirty ')}` +
        `<w:del w:id="9" ${THIRD}><w:r><w:delText xml:space="preserve">(30) </w:delText></w:r></w:del>` +
        `${run('days')}</w:ins>${run('.')}</w:p>`
    );
  const insertionEnd = START + 'thirty (30) days'.length;

  for (const [name, from] of [
    ['all of the insertion', START],
    ['only the live words after the third deletion', START + 'thirty (30) '.length],
  ] as const) {
    for (const accept of [true, false]) {
      test(`striking ${name} keeps every decision resolvable (${accept ? 'accept' : 'reject'})`, () => {
        const host = open(layered());
        expect(
          tracked(host, {
            op: 'replaceSpan',
            span: span(firstParagraph(host), from, insertionEnd),
            text: '',
          }).ok
        ).toBe(true);
        decide(host, 'Avery Chen:Delete', accept);
        // The third author's deletion was decidable before the edit and stays decidable.
        decide(host, 'Third Party:Delete', false);
        decide(host, 'Tailspin Legal:Insert', true);
        // The reviewer's strike skips the third author's struck words, which reject restores.
        const kept = from === START ? '(30) ' : 'thirty (30) ';
        expect(paragraphTexts(host, roots(host).body)).toEqual([
          accept ? `${HEAD}${kept}.` : `${HEAD}thirty (30) days.`,
        ]);
        expect(revisions(host)).toEqual([]);
      });
    }
  }
});

describe('refusals name their rule', () => {
  const cases: [string, () => Uint8Array, (p: AutomationHandle) => AutomationOperation, string][] =
    [
      [
        'only deleted text',
        () => struck(),
        (paragraph) => ({
          op: 'replaceSpan',
          span: span(paragraph, START + 2, END - 2),
          text: 'x',
        }),
        'edit.tracked-deleted-text-only',
      ],
      [
        "another author's formatting change",
        () =>
          docx(
            `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="9" ${STAMP}><w:rPr/></w:rPrChange></w:rPr>` +
              '<w:t>bold words</w:t></w:r></w:p>'
          ),
        (paragraph) => ({ op: 'replaceSpan', span: span(paragraph, 0, 4), text: 'x' }),
        'edit.tracked-foreign-revision-unsupported',
      ],
      [
        'your own pending insertion',
        () =>
          docx(
            '<w:p><w:ins w:id="9" w:author="Avery Chen" w:date="2026-09-01T00:00:00Z">' +
              `${run('mine')}</w:ins>${run(' rest')}</w:p>`
          ),
        (paragraph) => ({ op: 'replaceSpan', span: span(paragraph, 0, 4), text: 'x' }),
        'edit.tracked-own-pending-change',
      ],
    ];
  for (const [name, bytes, operation, detail] of cases)
    test(name, () => {
      const host = open(bytes());
      const response = tracked(host, operation(firstParagraph(host)));
      expect(response.results.at(-1)).toMatchObject({
        status: 'error',
        error: { code: 'unsupported-revision', detail },
      });
    });
});

test("a range from another author's deleted paragraph tail into the next paragraph strikes the mark", () => {
  const host = open(docx(`<w:p>${run('Keep ')}${del('gone')}</w:p>${p('Next words')}${p('Last')}`));
  const paragraphs = paragraphsOf(host, roots(host).body);
  const response = tracked(host, {
    op: 'replaceSpan',
    span: {
      start: { paragraph: paragraphs[0]!, offset: 5 },
      end: { paragraph: paragraphs[1]!, offset: 4 },
    },
    text: '',
  });
  expect(response.ok).toBe(true);
  expect(bodyMarkup(host)).toContain('<w:del w:author="Avery Chen"/>');
  expect(bodyMarkup(host)).toContain(
    '<w:del w:author="Avery Chen"><w:r><w:delText>Next</w:delText></w:r></w:del>'
  );
});
