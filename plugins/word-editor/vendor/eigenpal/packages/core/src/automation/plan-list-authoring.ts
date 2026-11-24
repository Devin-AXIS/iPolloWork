import { PackageEditRefusal } from '../store/store/package-edit-refusal.ts';
import { isProposedList } from './tracked-list.ts';
import { revisionDateNow } from './revision-date.ts';
import { withPart } from '../store/package/ooxml-package.ts';
import {
  WML_NAMESPACE_URI as W,
  type OoxmlPart,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../store/store/tree-ops.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveParagraphHandle } from './spans.ts';
import { listMembershipOf, listReads } from './lists.ts';
import {
  createAutomationList,
  formatAutomationListLevel,
  validAutomationListFormat,
  automationListLevelExists,
} from './list-authoring.ts';
import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import { storyParagraphs, storyRootsOf } from '../store/package/story-blocks.ts';

type ListOperation = Extract<
  AutomationOperation,
  { op: 'startNewList' | 'attachToList' | 'detachFromList' | 'setListLevelFormat' }
>;
const refuse = (message: string): PlannedOperation => ({
  ok: false,
  error: { code: 'unsupported-content', message },
});

/** Direct style references can affect inherited, protected paragraphs absent from list reads. */
function styleUsesList(part: OoxmlPart, numId: string): boolean {
  if (part.root.namespaceUri !== W || part.root.localName !== 'styles') return false;
  const pending: OoxmlNode[] = [part.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (
      node.namespaceUri === W &&
      node.localName === 'numId' &&
      node.attributes.some(
        (attribute) =>
          attribute.namespaceUri === W && attribute.localName === 'val' && attribute.value === numId
      )
    )
      return true;
    for (const child of node.children) pending.push(child);
  }
  return false;
}

export function planListAuthoring(
  operation: ListOperation,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  claim: (
    story: AutomationStoryReads,
    paragraphId: string,
    numbering?: { numId: string; level: number }
  ) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  const pkg = reads.package;
  if (!pkg) return refuse('no document');
  if (operation.op === 'setListLevelFormat') {
    const target = handles.resolve(operation.list, 'list');
    if (!target || target.kind !== 'list') return refuse('that is not a list');
    const story = reads.story(target.story);
    const list = story && listReads(story).find((entry) => entry.numId === target.numId);
    if (!story || !list) return refuse('that list no longer exists');
    if (trackingAuthor && !isProposedList(story, list.paragraphIds, target.numId, trackingAuthor))
      return {
        ok: false,
        error: {
          code: 'unsupported-capability',
          message: 'Only a newly proposed list definition can change while tracking',
        },
      };
    if (!validAutomationListFormat(operation.level, operation.format))
      return refuse('invalid list level format');
    // A definition affects every paragraph using this instance. Refuse cross-story sharing
    // until one transaction can check all affected stories against the same admission policy.
    for (const part of pkg.parts.values()) {
      // The ordinary subset reads direct membership. Refuse shared style references
      // until admission can enumerate every effective member and its locks.
      if (styleUsesList(part, target.numId)) return refuse('list is referenced by a style');
      for (const root of storyRootsOf(part)) {
        for (const paragraph of storyParagraphs(root.root)) {
          const id = listMembershipOf(paragraph)?.numId;
          if (id === target.numId && !story.has(paragraph.id))
            return refuse('list is shared across stories');
        }
      }
    }
    for (const id of list.paragraphIds) {
      if (effectiveContentLockAt(story.part, id).content || isBoundAt(story.part, id))
        return refuse('list contains protected content');
      const conflict = claim(story, id, { numId: target.numId, level: operation.level });
      if (conflict) return conflict;
    }
    if (!formatAutomationListLevel(pkg, target.numId, operation.level, operation.format))
      return refuse('cannot format this list');
    return {
      ok: true,
      kind: 'command',
      story: story.story,
      ops: [],
      packageEdits: [
        (current) => {
          const updated = formatAutomationListLevel(
            current,
            target.numId,
            operation.level,
            operation.format
          );
          if (!updated) throw new PackageEditRefusal('list definition changed during transaction');
          return updated;
        },
      ],
      answer: () => ({ kind: 'applied' }),
    };
  }
  const point = resolveParagraphHandle(operation.paragraph, handles, reads);
  if (!point.ok) return { ok: false, error: { code: point.code, message: point.detail } };
  const story = reads.story(point.value.story);
  if (!story) return refuse('missing story');
  const conflict = claim(story, point.value.paragraphId);
  if (conflict) return conflict;
  let numId: string | null = null;
  let level = 0;
  const packageEdits: ((
    pkg: NonNullable<AutomationPackageReads['package']>
  ) => NonNullable<AutomationPackageReads['package']>)[] = [];
  if (operation.op === 'startNewList') {
    const made = createAutomationList(pkg);
    if (!made) return refuse('cannot create numbering definition');
    const paragraphId = point.value.paragraphId;
    const trial = applyTreeOp(story.part, {
      op: 'setListNumbering',
      paragraphId,
      numId: made.numId,
      level: 0,
    });
    if (!trial.ok) return refuse('cannot number this paragraph');
    let committedId = made.numId;
    return {
      ok: true,
      kind: 'command',
      story: story.story,
      ops: [],
      packageEdits: [
        (current) => {
          // Allocate inside the canonical actor transaction, which the planner's preview shares;
          // both the paragraph and the returned handle use the committed ID.
          const created = createAutomationList(current);
          const part = created?.pkg.parts.get(story.part.name);
          if (!created || !part) throw new PackageEditRefusal('cannot create numbering definition');
          const applied = applyTreeOp(part, {
            op: 'setListNumbering',
            paragraphId,
            numId: created.numId,
            level: 0,
            ...(trackingAuthor
              ? { revision: { author: trackingAuthor, date: revisionDateNow() } }
              : {}),
          });
          // The commit numbers with the tracking revision the trial left out, so a refusal
          // here is the paragraph's own and keeps its reason.
          if (!applied.ok)
            throw new PackageEditRefusal(
              applied.detail ?? 'cannot number this paragraph',
              applied.reason
            );
          committedId = created.numId;
          return withPart(created.pkg, applied.part);
        },
      ],
      answer: () => ({ kind: 'handle', handle: handles.list(committedId, story.story) }),
    };
  } else if (operation.op === 'attachToList') {
    if (
      !Number.isSafeInteger(operation.listId) ||
      operation.listId <= 0 ||
      !Number.isInteger(operation.level) ||
      operation.level < 0 ||
      operation.level > 8
    )
      return refuse('invalid list identity or level');
    numId = String(operation.listId);
    level = operation.level;
    if (!automationListLevelExists(pkg, numId, level))
      return refuse('list level is not defined; configure that level first');
    if (!listReads(story).some((list) => list.numId === numId))
      return refuse('that list does not exist in this story');
  }
  const answeredId = numId;
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops: [
      {
        op: 'setListNumbering',
        paragraphId: point.value.paragraphId,
        numId: operation.op === 'detachFromList' ? '0' : numId,
        level,
      },
    ],
    packageEdits,
    answer: () =>
      answeredId === null
        ? { kind: 'applied' }
        : { kind: 'handle', handle: handles.list(answeredId, story.story) },
  };
}
