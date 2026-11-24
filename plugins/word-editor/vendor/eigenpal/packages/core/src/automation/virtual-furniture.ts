// A missing header/footer is a virtual empty body until its first content write.
import { PackageEditRefusal } from '../store/store/package-edit-refusal.ts';
import { applyHeaderFooterLifecycleOp } from '../store/package/hf-lifecycle.ts';
import { withPart, type OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../store/store/tree-ops.ts';
import type { AutomationOperation } from './operations.ts';
import type { BatchPlanner, BatchPlannerHost, PlannedOperation } from './plan.ts';
import { documentReads, type AutomationPackageReads } from './reads.ts';
import type { AutomationHandle } from './protocol.ts';
import type { AutomationStoryId } from './stories.ts';

const refuse = (message: string): PlannedOperation => ({
  ok: false,
  error: { code: 'unsupported-content', message },
});

/** The body handle a place names: `{ body }`, a body edge, or a span between body edges. */
function bodyOf(place: unknown): AutomationHandle | undefined {
  if (typeof place !== 'object' || place === null) return undefined;
  if ('body' in place) return place.body as AutomationHandle;
  if ('start' in place && 'end' in place) return bodyOf(place.start) ?? bodyOf(place.end);
  return undefined;
}

/** The body an operation is about, wherever its shape names one. */
export function bodyHandle(operation: AutomationOperation): AutomationHandle | undefined {
  if (operation.op === 'getText') return operation.target;
  if ('body' in operation) return operation.body as AutomationHandle;
  const fields = operation as unknown as Readonly<Record<string, unknown>>;
  for (const key of ['span', 'scope', 'at', 'anchor', 'paragraph']) {
    const handle = bodyOf(fields[key]);
    if (handle) return handle;
  }
  return undefined;
}

type FurnitureStory = Extract<AutomationStoryId, { kind: 'header' | 'footer' }>;

/** Create the missing part in a copy of the package; nothing is published. */
function withFurniture(pkg: OoxmlPackage, story: FurnitureStory) {
  const created = applyHeaderFooterLifecycleOp(pkg, {
    op: 'createHeaderFooter',
    sectionIndex: story.sectionIndex,
    kind: story.kind,
    variant: story.variant,
    ...(story.variant === 'first' ? { titlePage: true } : {}),
    ...(story.variant === 'even' ? { evenAndOddHeaders: true } : {}),
  });
  return created.ok && created.createdPartName ? created : null;
}

/**
 * Reads over the package as if the missing story existed and held nothing.
 *
 * Every read then answers what it answers for an empty story: no paragraphs, tables, shapes,
 * fields, comments, or matches. Nothing here is committed.
 */
function emptyStoryReads(pkg: OoxmlPackage, story: FurnitureStory): AutomationPackageReads | null {
  const created = withFurniture(pkg, story);
  const part = created && created.package.parts.get(created.createdPartName!);
  if (!created || !part) return null;
  const root = { ...part.root, children: [] } as unknown as OoxmlElement;
  return documentReads(withPart(created.package, { ...part, root }));
}

/** Intercept only bodies whose section exists but whose resolved furniture story is absent. */
export function planVirtualFurniture(
  operation: AutomationOperation,
  host: BatchPlannerHost,
  createPlanner: (reads: AutomationPackageReads) => BatchPlanner
): PlannedOperation | null {
  const handle = bodyHandle(operation);
  if (!handle) return null;
  const target = host.handles.resolve(handle, 'body');
  if (
    !target ||
    target.kind !== 'body' ||
    (target.story.kind !== 'header' && target.story.kind !== 'footer')
  )
    return null;
  const story = target.story;
  const pkg = host.reads.package;
  if (!pkg || host.reads.story(story)) return null;
  if (!host.reads.sections()[story.sectionIndex]) return refuse('that section no longer exists');
  if (
    operation.op !== 'insertText' &&
    operation.op !== 'replaceSpan' &&
    operation.op !== 'insertParagraph'
  ) {
    const empty = emptyStoryReads(pkg, story);
    if (!empty) return refuse('cannot read this header or footer');
    const step = createPlanner(empty).plan(operation);
    if (!step.ok || step.kind === 'query') return step;
    // A command that changes nothing in an empty story is a no-op. One that would write needs
    // the part to exist, which only a text write creates.
    if (
      step.kind !== 'command' ||
      step.ops.length ||
      step.lifecycle ||
      step.packageEdits?.length ||
      step.relate
    )
      return refuse('this header or footer does not exist yet; write text to create it');
    // Answered now, against the empty story it was planned on: the committed package still has
    // no such story to answer from. As a query it commits nothing and does not count as a
    // command, so a text write later in the batch can still create the part.
    return { ok: true, kind: 'query', value: step.answer(empty) };
  }

  type Prepared = {
    readonly pkg: OoxmlPackage;
    readonly planner: BatchPlanner;
    readonly step: Extract<PlannedOperation, { kind: 'command' }>;
  };
  const prepare = (current: OoxmlPackage): Prepared | null => {
    const created = withFurniture(current, story);
    if (!created) return null;
    const projected = documentReads(created.package);
    const planner = createPlanner(projected);
    const step = planner.plan(operation);
    if (
      !step.ok ||
      step.kind !== 'command' ||
      step.relate ||
      step.lifecycle ||
      step.packageEdits?.length
    )
      return null;
    let part = created.package.parts.get(created.createdPartName!);
    if (!part) return null;
    for (const op of step.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) return null;
      part = result.part;
    }
    const next = withPart(created.package, part);
    // Check proxy settlement against the prepared result before entering the write gate.
    if (!planner.settle(documentReads(next)).ok) return null;
    return { pkg: next, planner, step };
  };
  let prepared = prepare(pkg);
  if (!prepared) return refuse('cannot create this header or footer with that content');
  return {
    ok: true,
    kind: 'command',
    story: { kind: 'body' },
    ops: [],
    solitary: true,
    packageEdits: [
      (current) => {
        const applied = prepare(current);
        if (!applied)
          throw new PackageEditRefusal('header/footer creation changed during transaction');
        prepared = applied;
        return applied.pkg;
      },
    ],
    answer: (post) => prepared!.step.answer(post),
  };
}
