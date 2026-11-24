// A handle whose object is gone is told apart from a handle that never named a valid target.
//
// Both refuse with `invalid-handle`. Only the first carries a detail that maps to the public
// `edit.stale-target` code, because only for that one does reading the document again help.

import { describe, expect, test } from 'bun:test';
import { richDocx } from './support/furniture.ts';
import { open, paragraphsOf, roots } from './support/protocol.ts';
import { storeEditDiagnosticCode } from '../diagnostics.ts';
import { TARGET_REMOVED } from '../target-removed.ts';
import type { AutomationBatchResponse } from '../protocol.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createHandleTable } from '../handles.ts';
import { createBatchPlanner } from '../plan.ts';
import { documentReads } from '../reads.ts';
import { SERVER_AUTOMATION_CAPABILITIES } from '../server-host.ts';

/** A planner over a real package, with a handle table the test can mint handles in. */
function plannerFor(bytes: Uint8Array) {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const handles = createHandleTable();
  const planner = createBatchPlanner({
    handles,
    reads: documentReads(opened.package),
    capabilities: SERVER_AUTOMATION_CAPABILITIES,
  });
  return { handles, planner };
}

function refusedDetail(response: AutomationBatchResponse): { code: string; detail?: string } {
  for (const result of response.results) {
    if (result.status === 'error') {
      return {
        code: result.error.code,
        ...(result.error.detail === undefined ? {} : { detail: result.error.detail }),
      };
    }
  }
  throw new Error('the batch reported no failure');
}

function twoParagraphs() {
  const host = open(
    richDocx({
      body: '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>',
    })
  );
  const { body } = roots(host);
  const [first, second] = paragraphsOf(host, body);
  return { host, body, first: first!, second: second! };
}

describe('a removed target', () => {
  test('a deleted paragraph refuses with a detail that maps to edit.stale-target', () => {
    const { host, second } = twoParagraphs();
    expect(host.execute({ operations: [{ op: 'deleteParagraph', paragraph: second }] }).ok).toBe(
      true
    );
    const refused = refusedDetail(
      host.execute({ operations: [{ op: 'getText', target: second }] })
    );
    expect(refused.code).toBe('invalid-handle');
    expect(storeEditDiagnosticCode(refused.detail ?? '')).toBe('edit.stale-target');
  });

  test('the dedicated token and the existing removed-object tokens map to edit.stale-target', () => {
    for (const detail of [
      TARGET_REMOVED,
      'paragraph-not-in-body',
      'no-such-story:body',
      'cell-not-in-story',
      'deleted-table-object',
      'missing-parent-table',
      'missing-table-story',
    ]) {
      expect(storeEditDiagnosticCode(detail)).toBe('edit.stale-target');
    }
  });
});

describe('a handle that never named a valid target', () => {
  test('a handle of the wrong kind does not report edit.stale-target', () => {
    const { host, body } = twoParagraphs();
    const refused = refusedDetail(
      host.execute({
        operations: [{ op: 'getParagraphId', paragraph: body as never }],
      })
    );
    expect(refused.code).toBe('invalid-handle');
    expect(refused.detail === undefined ? null : storeEditDiagnosticCode(refused.detail)).not.toBe(
      'edit.stale-target'
    );
  });

  test('misuse details have no stale-target code', () => {
    for (const detail of [
      'span-crosses-stories',
      'not-a-paragraph-handle',
      'not-a-body-handle',
      'cell-not-found',
    ]) {
      expect(storeEditDiagnosticCode(detail)).not.toBe('edit.stale-target');
    }
  });
});

describe('the planner marks removed bookmarks and lists with the dedicated token', () => {
  const ONE = richDocx({ body: '<w:p><w:r><w:t>one</w:t></w:r></w:p>' });

  test('a bookmark the story no longer declares', () => {
    const { handles, planner } = plannerFor(ONE);
    const bookmark = handles.bookmark('gone', { kind: 'body' });
    const planned = planner.plan({ op: 'getBookmarkRange', bookmark });
    expect(planned).toMatchObject({
      ok: false,
      error: { code: 'invalid-handle', detail: TARGET_REMOVED },
    });
  });

  test('a list whose number the story no longer uses', () => {
    const { handles, planner } = plannerFor(ONE);
    const list = handles.list('99', { kind: 'body' });
    const planned = planner.plan({ op: 'getListParagraphs', list });
    expect(planned).toMatchObject({
      ok: false,
      error: { code: 'invalid-handle', detail: TARGET_REMOVED },
    });
  });
});
