// Content controls over the automation protocol.
//
// A CONTROL IS NOT ITS `w:id`. The attribute is optional, and a file may write the same one
// twice; a lane that addressed controls by it would leave some unreachable and others
// ambiguous. So a handle names the canonical node, `w:id` is answered as metadata, and
// `getContentControlById` searches the file's own numbering without ever becoming the identity.
//
// Everything a script can do here is something the store already refuses or allows, because the
// protocol plans onto the same ops the keyboard does — the tests below assert the refusal codes
// arrive unchanged rather than re-deriving them.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  errorAt,
  handleAt,
  handlesAt,
  open,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
  textAt,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/** Body, header and footnote controls, so a story-qualified read has somewhere to be wrong. */
function withControls(): AutomationHost {
  return open(
    docx(
      `<w:sdt><w:sdtPr><w:alias w:val="Client"/><w:tag w:val="client"/><w:id w:val="7"/>` +
        `<w:text/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:p><w:r><w:t xml:space="preserve">signed on </w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="when"/><w:id w:val="8"/>` +
        `<w:lock w:val="sdtLocked"/>` +
        `<w:date w:fullDate="2024-01-05T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>` +
        `</w:sdtPr><w:sdtContent><w:r><w:t>2024-01-05</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:p>`
    )
  );
}

function controlsOf(host: AutomationHost, body: AutomationHandle): readonly AutomationHandle[] {
  return handlesAt(
    host.execute({ operations: [{ op: 'getContentControls', scope: { body } }] }),
    0
  );
}

/**
 * The STORE's own refusal reason, which a write carries out as the error's detail.
 *
 * The code for any refused transaction is `transaction-refused` — the lane's existing shape for
 * every write — and the canonical reason travels beside it. That is the assertion that matters
 * here: a script is refused for the same named reason a keystroke is.
 */
function refusedBecause(response: ReturnType<AutomationHost['execute']>): string {
  for (const result of response.results) {
    if (result.status === 'error') return `${result.error.code}/${result.error.detail ?? ''}`;
  }
  throw new Error('the batch reported no failure');
}

function metadata(host: AutomationHost, control: AutomationHandle, op: string): string {
  return textAt(
    host.execute({
      operations: [{ op, contentControl: control } as never],
    }),
    0
  );
}

function bindingState(host: AutomationHost, control: AutomationHandle): boolean {
  const result = host.execute({
    operations: [{ op: 'getContentControlIsBound', contentControl: control }],
  }).results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'flag') {
    throw new Error('the binding-state read did not answer a flag');
  }
  return result.value.value;
}

describe('a control answers what the document says about it', () => {
  test('a story lists its controls in document order', () => {
    const host = withControls();
    const { body } = roots(host);
    const controls = controlsOf(host, body);
    expect(controls).toHaveLength(2);
    expect(metadata(host, controls[0]!, 'getContentControlTag')).toBe('client');
    expect(metadata(host, controls[1]!, 'getContentControlTag')).toBe('when');
  });

  test('tag, title, subtype and file id are read from the file, not invented', () => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(metadata(host, control, 'getContentControlTitle')).toBe('Client');
    expect(metadata(host, control, 'getContentControlSubtype')).toBe('plainText');
    expect(metadata(host, control, 'getContentControlFileId')).toBe('7');
    expect(metadata(host, control, 'getContentControlText')).toBe('Acme');
  });

  test('the lock is reported as the two flags an object model asks about', () => {
    const host = withControls();
    const controls = controlsOf(host, roots(host).body);
    const locks = host.execute({
      operations: [
        { op: 'getContentControlLock', contentControl: controls[1]! },
        { op: 'getContentControlLock', contentControl: controls[0]! },
      ],
    });
    expect(textAt(locks, 0)).toBe('sdtLocked');
    expect(textAt(locks, 1)).toBe('unlocked');
  });

  test('binding state reports presence only across mixed and custom control kinds', () => {
    const secretXpath = '/attacker/private[1]';
    const secretMappings = "xmlns:evil='urn:attacker-secret'";
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="plain"/><w:text/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>open</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
          `<w:sdt><w:sdtPr><w:tag w:val="custom"/>` +
          `<w:dataBinding w:prefixMappings="${secretMappings}" w:xpath="${secretXpath}" ` +
          `w:storeItemID="{ATTACKER-ID}"/><w:group/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>bound</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const controls = controlsOf(host, roots(host).body);
    const response = host.execute({
      operations: controls.map((contentControl) => ({
        op: 'getContentControlIsBound' as const,
        contentControl,
      })),
    });
    expect(bindingState(host, controls[0]!)).toBe(false);
    expect(bindingState(host, controls[1]!)).toBe(true);
    expect(response.results.map((result) => result.status)).toEqual(['ok', 'ok']);
    expect(JSON.stringify(response)).not.toContain(secretXpath);
    expect(JSON.stringify(response)).not.toContain(secretMappings);
    expect(JSON.stringify(response)).not.toContain('ATTACKER-ID');
  });

  test('a control names the paragraphs it holds and the range they cover', () => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    const answer = host.execute({
      operations: [
        { op: 'getContentControlParagraphs', contentControl: control },
        { op: 'getContentControlRange', contentControl: control },
      ],
    });
    expect(handlesAt(answer, 0)).toHaveLength(1);
    expect(
      textAt(host.execute({ operations: [{ op: 'getSpanText', span: spanOf(answer) }] }), 0)
    ).toBe('Acme');
  });

  // `whole` and `content` are the same stretch here and `before`/`after` collapse onto the
  // content's own edges, because a control's boundary marks occupy no offset in this model — there
  // is no position between the mark and the first character for a caret to be at. Word draws the
  // distinction; a snapshot of the text cannot, and answering an invented offset would be worse
  // than answering the edge.
  test.each([
    ['whole', 'Acme'],
    ['content', 'Acme'],
    ['start', ''],
    ['end', ''],
    ['before', ''],
    ['after', ''],
  ] as const)('the range at %s covers %p', (location, expected) => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    const answer = host.execute({
      operations: [
        { op: 'getContentControlTag', contentControl: control },
        { op: 'getContentControlRange', contentControl: control, location },
      ],
    });
    expect(
      textAt(host.execute({ operations: [{ op: 'getSpanText', span: spanOf(answer) }] }), 0)
    ).toBe(expected);
  });

  test('a control inside a control is listed by the one that holds it', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
          `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>deep</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
          `</w:sdtContent></w:sdt>`
      )
    );
    const { body } = roots(host);
    const outer = controlsOf(host, body);
    expect(outer).toHaveLength(1);
    const nested = handlesAt(
      host.execute({
        operations: [{ op: 'getContentControls', scope: { contentControl: outer[0]! } }],
      }),
      0
    );
    expect(nested).toHaveLength(1);
    expect(metadata(host, nested[0]!, 'getContentControlTag')).toBe('inner');
  });
});

describe('a control is found by what the file calls it', () => {
  test('getById finds the control whose w:id matches', () => {
    const host = withControls();
    const { body } = roots(host);
    const found = handleAt(
      host.execute({ operations: [{ op: 'getContentControlById', scope: { body }, id: 8 }] }),
      0
    );
    expect(metadata(host, found, 'getContentControlTag')).toBe('when');
  });

  test('a duplicate w:id answers the first in document order rather than refusing', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="5"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
          `<w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="5"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const { body } = roots(host);
    // Both are reachable as objects; only the id lookup has to pick one.
    expect(controlsOf(host, body)).toHaveLength(2);
    const found = handleAt(
      host.execute({ operations: [{ op: 'getContentControlById', scope: { body }, id: 5 }] }),
      0
    );
    expect(metadata(host, found, 'getContentControlTag')).toBe('one');
  });

  test('a control the file gave no w:id is still listed and still readable', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="anon"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>nameless</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(metadata(host, control, 'getContentControlText')).toBe('nameless');
    expect(metadata(host, control, 'getContentControlFileId')).toBe('');
  });

  test('getByTag and getByTitle answer every match, in document order', () => {
    const host = withControls();
    const { body } = roots(host);
    const byTag = handlesAt(
      host.execute({
        operations: [{ op: 'getContentControlsByTag', scope: { body }, tag: 'when' }],
      }),
      0
    );
    expect(byTag).toHaveLength(1);
    const byTitle = handlesAt(
      host.execute({
        operations: [{ op: 'getContentControlsByTitle', scope: { body }, title: 'Client' }],
      }),
      0
    );
    expect(metadata(host, byTitle[0]!, 'getContentControlTag')).toBe('client');
  });

  test('an id nothing declares refuses instead of answering a neighbour', () => {
    const host = withControls();
    const { body } = roots(host);
    expect(
      refusal(
        host.execute({ operations: [{ op: 'getContentControlById', scope: { body }, id: 99 }] })
      )
    ).toBe('invalid-handle');
  });
});

describe('a script writes through the same refusals the keyboard meets', () => {
  test('a value write reaches the file and survives a save and reopen', () => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    const written = host.execute({
      operations: [
        {
          op: 'setContentControlValue',
          contentControl: control,
          value: { kind: 'text', text: 'Globex' },
        },
      ],
    });
    expect(written.results[0]?.status).toBe('ok');
    expect(savedMainXml(host)).toContain('Globex');
    const next = reopen(host);
    const again = controlsOf(next.host, next.body)[0]!;
    expect(metadata(next.host, again, 'getContentControlText')).toBe('Globex');
  });

  test('sdtLocked refuses the deletion and still allows the value', () => {
    const host = withControls();
    const locked = controlsOf(host, roots(host).body)[1]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [{ op: 'deleteContentControl', contentControl: locked, keepContent: true }],
        })
      )
    ).toBe('transaction-refused/locked');
    const filled = host.execute({
      operations: [
        {
          op: 'setContentControlValue',
          contentControl: locked,
          value: { kind: 'date', iso: '2025-02-02' },
        },
      ],
    });
    expect(filled.results[0]?.status).toBe('ok');
  });

  test('contentLocked refuses the value with the store’s own reason', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="fixed"/><w:lock w:val="contentLocked"/><w:text/>` +
          `</w:sdtPr><w:sdtContent><w:p><w:r><w:t>set</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [
            {
              op: 'setContentControlValue',
              contentControl: control,
              value: { kind: 'text', text: 'other' },
            },
          ],
        })
      )
    ).toBe('transaction-refused/locked');
  });

  test('a bound control refuses the write and keeps its binding in the file', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="bound"/>` +
          `<w:dataBinding w:xpath="/root[1]/a[1]" w:storeItemID="{GUID}"/>` +
          `<w:text/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>from xml</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [
            {
              op: 'setContentControlValue',
              contentControl: control,
              value: { kind: 'text', text: 'x' },
            },
          ],
        })
      )
    ).toBe('transaction-refused/bound');
    expect(savedMainXml(host)).toContain('w:dataBinding');
  });

  test('a dropdown refuses a value it does not declare', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="pick"/><w:dropDownList>` +
          `<w:listItem w:displayText="Red" w:value="r"/></w:dropDownList></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>Red</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [
            {
              op: 'setContentControlValue',
              contentControl: control,
              value: { kind: 'listItem', value: 'Blue' },
            },
          ],
        })
      )
    ).toBe('transaction-refused/invalidArgs');
  });

  test('a checkbox writes the glyph and the flag together', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="agree"/><w14:checkbox xmlns:w14="${W14}">` +
          `<w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
          `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>` +
          `</w:sdtPr><w:sdtContent><w:p><w:r><w:t>\u2610</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    host.execute({
      operations: [
        {
          op: 'setContentControlValue',
          contentControl: control,
          value: { kind: 'checkbox', checked: true },
        },
      ],
    });
    const xml = savedMainXml(host);
    expect(xml).toContain('w14:val="1"');
    expect(xml).toContain('<w:sym w:char="2612" w:font="MS Gothic"/>');
    expect(xml).not.toContain('<w:t>☒</w:t>');
  });

  test('metadata is written through the op path and reads back', () => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    host.execute({
      operations: [
        {
          op: 'setContentControlProperties',
          contentControl: control,
          tag: 'customer',
          title: 'Customer',
        },
      ],
    });
    expect(metadata(host, control, 'getContentControlTag')).toBe('customer');
    expect(metadata(host, control, 'getContentControlTitle')).toBe('Customer');
  });

  test('delete keeps the content by default and can take it', () => {
    const host = withControls();
    const { body } = roots(host);
    const control = controlsOf(host, body)[0]!;
    host.execute({
      operations: [{ op: 'deleteContentControl', contentControl: control, keepContent: true }],
    });
    expect(controlsOf(host, body)).toHaveLength(1);
    expect(savedMainXml(host)).toContain('Acme');
  });

  test('a handle to a deleted control refuses rather than naming its neighbour', () => {
    const host = withControls();
    const { body } = roots(host);
    const control = controlsOf(host, body)[0]!;
    host.execute({
      operations: [{ op: 'deleteContentControl', contentControl: control, keepContent: false }],
    });
    expect(
      errorAt(
        host.execute({ operations: [{ op: 'getContentControlText', contentControl: control }] }),
        0
      )
    ).toBe('invalid-handle');
  });

  // The three insertion locations a source-compatible caller writes. `replace` is the control's
  // own value path — prompt and `w:temporary` included — and the two edges are ordinary story
  // insertions at the ends of the content the control holds. THE HOST RESOLVES THE EDGE, not the
  // caller: a script that had to read the span first could only write to where the control used
  // to be, and the two operations would not be one refusal.
  test.each([
    ['replace', 'ACME'],
    ['start', 'ACMEAcme'],
    ['end', 'AcmeACME'],
  ] as const)('text is inserted at %s', (at, expected) => {
    const host = withControls();
    const control = controlsOf(host, roots(host).body)[0]!;
    const answer = host.execute({
      operations: [{ op: 'insertContentControlText', contentControl: control, text: 'ACME', at }],
    });
    expect(answer.results[0]?.status).toBe('ok');
    expect(
      textAt(
        host.execute({ operations: [{ op: 'getContentControlText', contentControl: control }] }),
        0
      )
    ).toBe(expected);
  });

  // The same three locations on an INLINE control, where the two edges are offsets in a paragraph
  // the control does not own. The trailing edge is the one that catches a host resolving the
  // location as a bare offset: the store gives a boundary offset to the run that STARTS there, so
  // an insertion at the control's end would land in the text after it and the command would
  // report success for text it wrote outside the control it was asked to write into.
  test.each([
    ['replace', 'ACME'],
    ['start', 'ACMEMID'],
    ['end', 'MIDACME'],
  ] as const)('text is inserted at %s of an inline control', (at, expected) => {
    const host = open(
      docx(
        `<w:p><w:r><w:t>abc</w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="f"/><w:text/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
          `<w:r><w:t>xyz</w:t></w:r></w:p>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    const answer = host.execute({
      operations: [{ op: 'insertContentControlText', contentControl: control, text: 'ACME', at }],
    });
    expect(answer.results[0]?.status).toBe('ok');
    expect(
      textAt(
        host.execute({ operations: [{ op: 'getContentControlText', contentControl: control }] }),
        0
      )
    ).toBe(expected);
    // And the text around it is untouched, so nothing leaked out of the control on the way.
    expect(savedMainXml(host)).toContain('abc');
    expect(savedMainXml(host)).toContain('xyz');
  });

  // The shipped command, on a control whose value belongs to a custom XML part. `replace` was
  // always refused; the two edges reach the same content through an ordinary insertion, and a
  // binding that only the value path honoured would be a binding the command could walk around.
  test.each(['replace', 'start', 'end'] as const)(
    'inserting at %s of a bound control is refused',
    (at) => {
      const host = open(
        docx(
          `<w:p><w:r><w:t>abc</w:t></w:r>` +
            `<w:sdt><w:sdtPr><w:tag w:val="f"/><w:text/>` +
            `<w:dataBinding w:xpath="/a/b" w:storeItemID="{2C0E8B1A-1111-2222-3333-444455556666}"/>` +
            `</w:sdtPr><w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
            `<w:r><w:t>xyz</w:t></w:r></w:p>`
        )
      );
      const control = controlsOf(host, roots(host).body)[0]!;
      expect(
        refusedBecause(
          host.execute({
            operations: [
              { op: 'insertContentControlText', contentControl: control, text: 'PWNED', at },
            ],
          })
        )
      ).toBe('transaction-refused/bound');
      expect(savedMainXml(host)).not.toContain('PWNED');
      expect(savedMainXml(host)).toContain('MID');
    }
  );

  test('an insertion into a locked inline control is refused wherever it lands', () => {
    const host = open(
      docx(
        `<w:p><w:r><w:t>abc</w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="f"/><w:text/><w:lock w:val="contentLocked"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
          `<w:r><w:t>xyz</w:t></w:r></w:p>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    for (const at of ['replace', 'start', 'end'] as const) {
      expect(
        refusedBecause(
          host.execute({
            operations: [
              { op: 'insertContentControlText', contentControl: control, text: 'x', at },
            ],
          })
        )
      ).toBe('transaction-refused/locked');
    }
  });

  test('an insertion into a locked control is refused wherever it lands', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="fixed"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>kept</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const control = controlsOf(host, roots(host).body)[0]!;
    for (const at of ['replace', 'start', 'end'] as const) {
      expect(
        refusedBecause(
          host.execute({
            operations: [
              { op: 'insertContentControlText', contentControl: control, text: 'x', at },
            ],
          })
        )
      ).toBe('transaction-refused/locked');
    }
  });

  // A SCRIPT MEETS THE REFUSAL A KEYSTROKE MEETS, INCLUDING THE ONES THAT ARE NOT ADDRESSED AT A
  // CONTROL. `insertText` names a paragraph and an offset; whether those offsets land inside a
  // locked or bound control is resolved by the store, so the protocol needs no rule of its own.
  test('typing at an offset inside an inline locked control is refused', () => {
    const host = open(
      docx(
        `<w:p><w:r><w:t>a</w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="f"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>LOCKED</w:t></w:r></w:sdtContent></w:sdt>` +
          `<w:r><w:t>z</w:t></w:r></w:p>`
      )
    );
    const paragraph = paragraphsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [{ op: 'insertText', at: { paragraph, offset: 3 }, text: 'x' }],
        })
      )
    ).toBe('transaction-refused/locked');
  });

  test('typing inside a bound control is refused for being bound', () => {
    const host = open(
      docx(
        `<w:sdt><w:sdtPr><w:tag w:val="c"/>` +
          `<w:dataBinding w:xpath="/root/a" w:storeItemID="{FEED}"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      )
    );
    const paragraph = paragraphsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [{ op: 'insertText', at: { paragraph, offset: 0 }, text: 'x' }],
        })
      )
    ).toBe('transaction-refused/bound');
  });

  test('a forged handle is refused', () => {
    const host = withControls();
    const forged = {
      kind: 'contentControl',
      ref: 'contentControl:0:1',
    } as unknown as AutomationHandle;
    expect(
      errorAt(
        host.execute({ operations: [{ op: 'getContentControlText', contentControl: forged }] }),
        0
      )
    ).toBe('invalid-handle');
  });
});

// NAMING THE OUTER CONTROL DOES NOT MAKE THE INNER ONE EDITABLE.
//
// `insertContentControlText` resolves `start` and `end` from the named control's own span and
// hands the store the control as the owner of the write. When the control's content begins or
// ends with a NESTED control, those two offsets land inside the nested one — so an honest script
// naming an unlocked, unbound outer control wrote into a `sdtContentLocked` or `w:dataBinding`
// inner one and was told `ok`.
describe('a nested control is refused at the locations this command writes at', () => {
  const inner = (properties: string): string =>
    `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>`;

  const inlineOverInline = (properties: string): Uint8Array =>
    docx(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent>${inner(properties)}</w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );

  const blockOverInline = (properties: string): Uint8Array =>
    docx(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>abc</w:t></w:r>${inner(properties)}</w:p>` +
        `</w:sdtContent></w:sdt>`
    );

  const blockOverBlock = (properties: string): Uint8Array =>
    docx(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  const LOCKED = `<w:lock w:val="sdtContentLocked"/>`;
  const BOUND = `<w:dataBinding w:xpath="/root/a" w:storeItemID="{FEED}"/>`;

  /** Name the outer control and write at `at`; answer the refusal and the saved markup. */
  function writeNaming(
    bytes: Uint8Array,
    at: 'start' | 'end'
  ): { readonly answer: string; readonly saved: string } {
    const host = open(bytes);
    const control = controlsOf(host, roots(host).body)[0]!;
    const response = host.execute({
      operations: [{ op: 'insertContentControlText', contentControl: control, text: 'PWNED', at }],
    });
    const failed = response.results.some((result) => result.status === 'error');
    return {
      answer: failed ? refusedBecause(response) : 'ok',
      saved: savedMainXml(host),
    };
  }

  test('an inline control nested in the named one refuses both edges', () => {
    for (const at of ['start', 'end'] as const) {
      const written = writeNaming(inlineOverInline(LOCKED), at);
      expect(written.answer).toBe('transaction-refused/locked');
      expect(written.saved).not.toContain('PWNED');
      expect(written.saved).toContain('MID');
    }
  });

  test('and a bound one refuses them with bound', () => {
    for (const at of ['start', 'end'] as const) {
      const written = writeNaming(inlineOverInline(BOUND), at);
      expect(written.answer).toBe('transaction-refused/bound');
      expect(written.saved).not.toContain('PWNED');
    }
  });

  test('a block control ending in a locked field refuses the end location', () => {
    const written = writeNaming(blockOverInline(LOCKED), 'end');
    expect(written.answer).toBe('transaction-refused/locked');
    expect(written.saved).not.toContain('PWNED');
  });

  test('its start location is still a write, because that is its own text', () => {
    const written = writeNaming(blockOverInline(LOCKED), 'start');
    expect(written.answer).toBe('ok');
    expect(written.saved).toContain('<w:t>PWNEDabc</w:t>');
    // And the locked field beside it holds exactly what the file wrote.
    expect(written.saved).toContain('<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent>');
  });

  test('a nested block control refuses both locations, locked or bound', () => {
    for (const at of ['start', 'end'] as const) {
      expect(writeNaming(blockOverBlock(LOCKED), at).answer).toBe('transaction-refused/locked');
      expect(writeNaming(blockOverBlock(BOUND), at).answer).toBe('transaction-refused/bound');
    }
  });

  test('an unlocked, unbound nested control still takes the text', () => {
    const written = writeNaming(inlineOverInline(''), 'end');
    expect(written.answer).toBe('ok');
    expect(written.saved).toContain('PWNED');
  });

  // AND WHEN THERE IS NO RUN TO JOIN. A nested control holding an empty paragraph gives the
  // command the same offset for `start` and for `end`, and the write mints a run in that
  // paragraph — inside the nested control, which is where a lock or a binding lives.
  const overEmptyBlock = (properties: string): Uint8Array =>
    docx(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  const overBlankLastBlock = (properties: string): Uint8Array =>
    docx(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>abc</w:t></w:r></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr>` +
        `<w:sdtContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  test('a nested control holding an empty paragraph refuses both locations', () => {
    for (const at of ['start', 'end'] as const) {
      const written = writeNaming(overEmptyBlock(LOCKED), at);
      expect(written.answer).toBe('transaction-refused/locked');
      expect(written.saved).not.toContain('PWNED');
    }
  });

  test('and a bound one holding an empty paragraph refuses them with bound', () => {
    for (const at of ['start', 'end'] as const) {
      const written = writeNaming(overEmptyBlock(BOUND), at);
      expect(written.answer).toBe('transaction-refused/bound');
      expect(written.saved).not.toContain('PWNED');
    }
  });

  test('a blank last paragraph inside a locked nested control refuses the end location', () => {
    const written = writeNaming(overBlankLastBlock(LOCKED), 'end');
    expect(written.answer).toBe('transaction-refused/locked');
    expect(written.saved).not.toContain('PWNED');
  });

  test('and a bound one refuses that location too', () => {
    const written = writeNaming(overBlankLastBlock(BOUND), 'end');
    expect(written.answer).toBe('transaction-refused/bound');
    expect(written.saved).not.toContain('PWNED');
  });

  test('the start location there is the outer control own paragraph, so it writes', () => {
    const written = writeNaming(overBlankLastBlock(LOCKED), 'start');
    expect(written.answer).toBe('ok');
    expect(written.saved).toContain('PWNED');
  });

  test('an unlocked nested control holding an empty paragraph still takes the text', () => {
    const written = writeNaming(overEmptyBlock(''), 'end');
    expect(written.answer).toBe('ok');
    expect(written.saved).toContain('PWNED');
  });
});

// REPLACING A CONTROL'S VALUE THROWS AWAY EVERYTHING IT HELD.
//
// The two locations above write INTO the content. `replace` writes OVER it: the value path
// rebuilds `w:sdtContent` from scratch, so a nested control is not typed into, it is deleted —
// lock, `w:dataBinding` and text together. Both public paths a script has to a whole-value write
// land on the same store op, so both are asserted here.
describe('replacing a control value is refused by the controls it would delete', () => {
  const LOCKED = `<w:lock w:val="sdtContentLocked"/>`;
  const REMOVAL_LOCKED = `<w:lock w:val="sdtLocked"/>`;
  const BOUND = `<w:dataBinding w:xpath="/root/a" w:storeItemID="{FEED}"/>`;

  const inlineNested = (properties: string): Uint8Array =>
    docx(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:r><w:t>OUT</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:p>`
    );

  const blockNested = (properties: string): Uint8Array =>
    docx(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>OUT</w:t></w:r></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>MID</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt>`
    );

  /** The whole-value write, through each of the two commands that reach it. */
  function replaceNaming(
    bytes: Uint8Array,
    via: 'setValue' | 'insertText'
  ): { readonly answer: string; readonly saved: string } {
    const host = open(bytes);
    const control = controlsOf(host, roots(host).body)[0]!;
    const response = host.execute({
      operations: [
        via === 'setValue'
          ? {
              op: 'setContentControlValue',
              contentControl: control,
              value: { kind: 'text', text: 'REPLACED' },
            }
          : {
              op: 'insertContentControlText',
              contentControl: control,
              text: 'REPLACED',
              at: 'replace',
            },
      ],
    });
    const failed = response.results.some((result) => result.status === 'error');
    return { answer: failed ? refusedBecause(response) : 'ok', saved: savedMainXml(host) };
  }

  const BOTH = ['setValue', 'insertText'] as const;

  test('a locked inline control inside the named one refuses both commands', () => {
    for (const via of BOTH) {
      const written = replaceNaming(inlineNested(LOCKED), via);
      expect(written.answer).toBe('transaction-refused/locked');
      expect(written.saved).toContain('MID');
      expect(written.saved).toContain('sdtContentLocked');
      expect(written.saved).not.toContain('REPLACED');
    }
  });

  test('a nested control that may not be deleted refuses them too', () => {
    for (const via of BOTH) {
      const written = replaceNaming(inlineNested(REMOVAL_LOCKED), via);
      expect(written.answer).toBe('transaction-refused/locked');
      expect(written.saved).toContain('sdtLocked');
      expect(written.saved).not.toContain('REPLACED');
    }
  });

  test('a bound inline control inside the named one refuses them with bound', () => {
    for (const via of BOTH) {
      const written = replaceNaming(inlineNested(BOUND), via);
      expect(written.answer).toBe('transaction-refused/bound');
      expect(written.saved).toContain('w:dataBinding');
      expect(written.saved).not.toContain('REPLACED');
    }
  });

  test('a nested BLOCK control is reached the same way, locked or bound', () => {
    for (const via of BOTH) {
      expect(replaceNaming(blockNested(LOCKED), via).answer).toBe('transaction-refused/locked');
      expect(replaceNaming(blockNested(BOUND), via).answer).toBe('transaction-refused/bound');
    }
  });

  test('an unlocked, unbound nested control is still replaced', () => {
    for (const via of BOTH) {
      const written = replaceNaming(inlineNested(''), via);
      expect(written.answer).toBe('ok');
      expect(written.saved).toContain('REPLACED');
    }
  });

  test('and a leaf control with nothing nested still takes its value', () => {
    const leaf = docx(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>OUT</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    for (const via of BOTH) {
      const written = replaceNaming(leaf, via);
      expect(written.answer).toBe('ok');
      expect(written.saved).toContain('REPLACED');
    }
  });

  test('deleting the wrapper while keeping its content is not refused', () => {
    const host = open(inlineNested(LOCKED));
    const control = controlsOf(host, roots(host).body)[0]!;
    const response = host.execute({
      operations: [{ op: 'deleteContentControl', contentControl: control, keepContent: true }],
    });
    expect(response.results.every((result) => result.status === 'ok')).toBe(true);
    const saved = savedMainXml(host);
    expect(saved).toContain('MID');
    expect(saved).toContain('sdtContentLocked');
  });

  test('but deleting it AND its content is refused by the locked control inside', () => {
    const host = open(inlineNested(LOCKED));
    const control = controlsOf(host, roots(host).body)[0]!;
    expect(
      refusedBecause(
        host.execute({
          operations: [{ op: 'deleteContentControl', contentControl: control, keepContent: false }],
        })
      )
    ).toBe('transaction-refused/locked');
    expect(savedMainXml(host)).toContain('MID');
  });
});

function spanOf(response: ReturnType<AutomationHost['execute']>) {
  const result = response.results[1];
  if (result?.status !== 'ok' || result.value.kind !== 'span') throw new Error('no span');
  return result.value.span;
}
