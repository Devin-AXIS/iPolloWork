// Browser review writes must bind the collaboration actor before minting `w:comment/@w:id`.
//
// `commitReviewOps` is the gate every comment takes. Without an actor, `nextCommentId` falls
// back to Word's dense "one past highest" sequence, so two peers holding comments 0..2 both
// mint `w:id="3"` and the merged anchors cross-link.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { MAX_DECIMAL_ID, nextStripedDecimalId } from '../../store/package/actor-scoped-ids.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function commentsDoc(): Uint8Array {
  const comment = (id: string) =>
    `<w:comment w:id="${id}" w:author="Ada"><w:p><w:r><w:t>c${id}</w:t></w:r></w:p></w:comment>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_TYPE}"/>` +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:body></w:document>`
    ),
    'word/comments.xml': strToU8(
      `<w:comments xmlns:w="${W}">${comment('0')}${comment('1')}${comment('2')}</w:comments>`
    ),
  });
}

function mountWithActor(actorId: string): PaginatedSurface {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, commentsDoc(), {
    scale: 1,
    collaborationModel: {
      session: stubCollaborationSession({ identity: { actorId, name: actorId } }),
    },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return result.surface;
}

function addComment(surface: PaginatedSurface): string | null {
  const paragraphId = surface.session.paragraphIds()[0];
  if (!paragraphId) throw new Error('no paragraph');
  let created: string | null = null;
  surface.commitReviewOps(() => {
    created = surface.session.replyToComment(
      null,
      { paragraphId, start: 0, end: 5 },
      'note',
      'Alice'
    );
    return { committed: created !== null };
  }, 'comment-add');
  return created;
}

describe('browser review writes bind the collaboration actor', () => {
  test('two actors mint different comment ids from the same comments.xml 0..2', () => {
    const left = addComment(mountWithActor('alice'));
    const right = addComment(mountWithActor('bob'));
    expect(typeof left).toBe('string');
    expect(typeof right).toBe('string');
    expect(left).not.toBe(right);
    const used = new Set(['0', '1', '2']);
    expect(left).toBe(nextStripedDecimalId(used, 'alice', MAX_DECIMAL_ID));
    expect(right).toBe(nextStripedDecimalId(used, 'bob', MAX_DECIMAL_ID));
  });
});
