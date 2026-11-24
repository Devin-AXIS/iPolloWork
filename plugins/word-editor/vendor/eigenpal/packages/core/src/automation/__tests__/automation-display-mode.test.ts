// The object model formats what the READER can see, not what a default assumes (#497, #498).
//
// A range's offsets cover every revision half whatever the view does with them, so "which runs
// does this span format" has a different answer in All Markup than in the resolved result. The
// toolbar knows which view it is painting; the object model does not, and a lane that picked
// its own default drifted from the toolbar over the same selection the moment the review
// module turned markup on. `AutomationDocumentPort.revisionDisplayMode` carries the reader's
// answer across; a headless owner has no reader and reads the resolved result.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createAutomationHost } from '../host.ts';
import type { AutomationDocumentPort } from '../document-port.ts';
import type { AutomationCapabilities, AutomationHandle, AutomationHost } from '../protocol.ts';
import type { FormattingDisplayMode } from '../../store/store/formattable-runs.ts';
import type { TreeDocOp } from '../../store/store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const CAPABILITIES: AutomationCapabilities = {
  document: true,
  save: false,
  events: false,
  selection: false,
  scrolling: false,
  layout: false,
};

/**
 * Bold `abc` followed by an unformatted tracked deletion of `XYZ`.
 *
 * Six offsets, three of them hidden — and the two halves disagree about bold, so the read
 * answers `true` where only the survivor is in reach and `null` (mixed) where both are.
 */
function packageWithDeletion(): OoxmlPackage {
  const body =
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r>' +
    '<w:del w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:delText>XYZ</w:delText></w:r></w:del></w:p>';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

interface Fixture {
  readonly host: AutomationHost;
  /** Every op the batch staged, so the test asserts on the PLAN rather than on a repaint. */
  readonly ops: TreeDocOp[];
}

function fixture(displayMode?: FormattingDisplayMode): Fixture {
  const pkg = packageWithDeletion();
  const ops: TreeDocOp[] = [];
  const port: AutomationDocumentPort = {
    revision: () => 0,
    currentPackage: () => pkg,
    ...(displayMode ? { revisionDisplayMode: () => displayMode } : {}),
    apply: (staged) => {
      for (const op of staged(() => null) ?? []) ops.push(op);
      return { ok: true, changed: true };
    },
    applyLifecycle: () => ({ ok: true, changed: true }),
    applyCustomNodeWrite: () => ({ ok: true, changed: true }),
    applyCommentWrites: () => ({ ok: true, changed: true, commentId: '1' }),
    save: () => new Uint8Array([1]),
    subscribe: () => () => {},
    dispose: () => {},
  };
  return { host: createAutomationHost({ port, capabilities: CAPABILITIES }), ops };
}

function handleAt(response: { readonly results: readonly unknown[] }, index: number) {
  const result = response.results[index] as
    { status: 'ok'; value: { kind: string; handle: AutomationHandle } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

/** The one paragraph, as a handle the font operations take. */
function paragraph(host: AutomationHost): AutomationHandle {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0] as
    { status: 'ok'; value: { kind: 'handles'; handles: readonly AutomationHandle[] } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return result.value.handles[0]!;
}

/** What `getFont` says about bold over the whole paragraph. */
function boldRead({ host }: Fixture): boolean | null {
  const target = paragraph(host);
  const response = host.execute({ operations: [{ op: 'getFont', span: { paragraph: target } }] });
  const result = response.results[0] as
    { status: 'ok'; value: { kind: 'font'; font: { bold: boolean | null } } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'font') {
    throw new Error('expected a font read');
  }
  return result.value.font.bold;
}

const runEdits = (ops: readonly TreeDocOp[]) =>
  ops
    .filter((op) => op.op === 'setRunProperties')
    .map((op) => `${(op as { start: number }).start}..${(op as { end: number }).end}`);

describe('automation formatting follows the owner display mode', () => {
  test('a port with no reader formats only the surviving text', () => {
    const { host, ops } = fixture();
    const target = paragraph(host);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: target }, font: { bold: true } }],
    });
    expect(response.ok).toBe(true);
    expect(runEdits(ops)).toEqual(['0..3']);
  });

  test('a port reporting All Markup formats the struck text too', () => {
    const { host, ops } = fixture('all-markup');
    const target = paragraph(host);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: target }, font: { bold: true } }],
    });
    expect(response.ok).toBe(true);
    expect(runEdits(ops)).toEqual(['0..3', '3..6']);
  });

  test('the font READ answers in the same view the write does', () => {
    // The read and the write disagreeing is the same defect one step earlier: a span whose
    // surviving text is uniform must not report Mixed because a hidden half differs.
    expect(boldRead(fixture())).toBe(true);
    expect(boldRead(fixture('proposed'))).toBe(true);
    expect(boldRead(fixture('all-markup'))).toBe(null);
  });
});
