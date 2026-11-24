// TOC writes must take the same gated apply path typing uses.
//
// `insertToc` / `refreshToc` used to call `session.applyTreeOps` with no options, so they
// skipped `gateOperations` and minted bookmark `@w:id` densely even though `_Toc` names
// were already actor-striped.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { actorStripe } from '../../store/package/actor-scoped-ids.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function headingDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}">` +
        '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>' +
        '</w:styles>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
}

function bookmarkIds(surface: PaginatedSurface): string[] {
  const ids: string[] = [];
  const visit = (node: {
    kind: string;
    localName?: string;
    attributes?: readonly { localName: string; value: string }[];
    children?: readonly unknown[];
  }): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'bookmarkStart') {
      for (const attribute of node.attributes ?? []) {
        if (attribute.localName === 'id') ids.push(attribute.value);
      }
    }
    for (const child of (node.children ?? []) as (typeof node)[]) visit(child);
  };
  visit(surface.session.part().root as never);
  return ids;
}

function mountWithActor(
  actorId: string,
  gate?: () => string | null
): { surface: PaginatedSurface; gates: () => number } {
  let gates = 0;
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, headingDoc(), {
    scale: 1,
    collaborationModel: {
      session: stubCollaborationSession({
        identity: { actorId, name: actorId },
        gateOperations: () => {
          gates += 1;
          return gate ? gate() : null;
        },
      }),
    },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return { surface: result.surface, gates: () => gates };
}

describe('TOC writes take the typing apply path', () => {
  test('two actors mint different bookmark ids from the same heading document', () => {
    const left = mountWithActor('alice');
    const right = mountWithActor('bob');
    expect(left.surface.insertToc()).toBe(true);
    expect(right.surface.insertToc()).toBe(true);
    const leftIds = bookmarkIds(left.surface);
    const rightIds = bookmarkIds(right.surface);
    expect(leftIds.length).toBeGreaterThan(0);
    expect(rightIds.length).toBeGreaterThan(0);
    expect(leftIds[0]).not.toBe(rightIds[0]);
    expect(leftIds[0]).toBe(String(actorStripe('alice')));
    expect(rightIds[0]).toBe(String(actorStripe('bob')));
  });

  test('insertToc asks the collaboration gate the typing lane uses', () => {
    const mounted = mountWithActor('alice');
    expect(mounted.surface.insertToc()).toBe(true);
    expect(mounted.gates()).toBeGreaterThan(0);
  });
});
