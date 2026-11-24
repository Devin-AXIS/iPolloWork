// What leaves the system: applying a host's export policy to the custom nodes in a document.
//
// A host may not want its own markup travelling in a file its users download — a `w:tag` naming
// the tool, or a payload that means nothing anywhere else. This is the mechanism for that, and
// it takes the DECISION from the caller: core has no idea which tags belong to which definition,
// and a policy guessed from a tag prefix would be this library deciding what a host's nodes mean.
//
// Three fates, and the middle one is the interesting one:
//
//   - `keep`   — untouched, tag, binding, payload and all.
//   - `text`   — the control is UNWRAPPED. A reader still sees the words; the `w:sdt`, its tag,
//                its binding and its node are gone. Right for a citation, whose text is the point.
//   - `remove` — the control goes and takes its content with it.
//
// WHAT THIS DOES NOT MAKE ANONYMOUS. It removes THIS LIBRARY'S markup and nothing else. A `.docx`
// carries its origin in `docProps/app.xml`, `docProps/core.xml`, comment and revision authors,
// rsids and custom document properties. Describing this as "no traces" would be false, and the
// distinction belongs here as much as in the docs.

import { boundCustomXmlNodeIdsInPackage } from './custom-node-payloads.ts';
import { customXmlNodes, withoutOrphanCustomXmlNodes } from './custom-xml-nodes.ts';
import { customXmlDataParts, type CustomXmlDataPart } from './custom-xml-part.ts';
import { withoutPart, type WithoutPartResult } from './package-edit.ts';
import {
  contentControlContentNodeOf,
  contentControlPropertiesOf,
  contentControlsIn,
} from './content-control-nodes.ts';
import { parentNodeOf, removeNode, replaceChildren } from './ooxml-edit.ts';

import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlInvariantIssue, OoxmlNode } from './ooxml-tree.ts';

/** What happens to one control when the document is exported. */
export type CustomNodeExportPolicy = 'keep' | 'text' | 'remove';

/** How {@link withExportedCustomNodes} decides, and which stores it may tidy afterwards. */
export interface CustomNodeExportRequest {
  /** The story whose controls are policed, and whose relationships the stores hang off. */
  readonly storyPartName: string;
  /**
   * Payload namespaces the caller CLAIMS.
   *
   * The store cleanup runs only over these. Word's own Cover Page Properties store rides in most
   * templates, and an export that tidied every customXml part would be deleting from documents it
   * was only asked to strip its own markup from.
   */
  readonly namespaces: readonly string[];
  /** The fate of a control carrying this `w:tag`. A control with no tag is never touched. */
  readonly decide: (tag: string) => CustomNodeExportPolicy;
}

/**
 * The export, or the reason there is no export.
 *
 * A refusal answers no package on purpose. "Stripping failed, here is the document anyway" is the
 * one outcome that must not be possible: a caller would ship the markup it asked to remove and
 * have been told the export succeeded.
 */
export type CustomNodeExportResult =
  | {
      readonly ok: true;
      readonly pkg: OoxmlPackage;
      /** Controls unwrapped (`text`) and controls removed (`remove`). */
      readonly unwrapped: number;
      readonly removed: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Apply the policy, then take the payloads and the stores the policy orphaned.
 *
 * Order matters and is the reverse of the write's. The BODY goes first, so the sweep that follows
 * sees the controls that actually survive; the stores go last, once nothing binds them. Doing it
 * the other way would strip a store while a control still quoted its `w:storeItemID`, which is a
 * document Word opens and offers to repair.
 */
export function withExportedCustomNodes(
  pkg: OoxmlPackage,
  request: CustomNodeExportRequest
): CustomNodeExportResult {
  const story = pkg.parts.get(request.storyPartName);
  if (!story) return { ok: false, reason: `no story part named ${request.storyPartName}` };

  // Decided against ONE tree, applied one at a time. Every edit rebuilds the part, so a list of
  // node objects gathered up front would go stale; the ids do not, and an id whose node the
  // previous edit already removed is simply skipped.
  const decided: { readonly nodeId: string; readonly policy: CustomNodeExportPolicy }[] = [];
  for (const entry of contentControlsIn(story.root)) {
    const tag = contentControlPropertiesOf(entry.node).tag;
    if (tag === undefined || tag.length === 0) continue;
    const policy = request.decide(tag);
    if (policy === 'keep') continue;
    decided.push({ nodeId: entry.node.id, policy });
  }

  let part = story;
  let unwrapped = 0;
  let removed = 0;
  for (const { nodeId, policy } of decided) {
    // A control INSIDE one already unwrapped or removed is reached through the outer decision,
    // so its id may no longer be in the tree. That is not a failure — the outer policy already
    // said what happens to everything under it.
    const parent = parentNodeOf(part, nodeId);
    if (!parent) continue;
    if (policy === 'remove') {
      const edit = removeNode(part, nodeId, { deferValidation: true });
      if (!edit.ok) return { ok: false, reason: `a node could not be removed: ${describe(edit)}` };
      part = edit.part;
      removed += 1;
      continue;
    }
    const control = parent.children.find((child) => child.id === nodeId);
    if (!control) continue;
    const content = contentControlContentNodeOf(control);
    // No `w:sdtContent` is a control with nothing to keep, so unwrapping it is removing it.
    const kept: readonly OoxmlNode[] = content ? content.children : [];
    const children = parent.children.flatMap((child) => (child.id === nodeId ? kept : [child]));
    const edit = replaceChildren(part, parent.id, children, { deferValidation: true });
    if (!edit.ok) return { ok: false, reason: `a node could not be unwrapped: ${describe(edit)}` };
    part = edit.part;
    unwrapped += 1;
  }

  let next = part === story ? pkg : withPart(pkg, part);
  if (!next.parts.has(request.storyPartName)) {
    return { ok: false, reason: 'the story went missing during the export' };
  }

  for (const namespaceUri of request.namespaces) {
    // EVERY store for the namespace, not the first. A document can carry several — a server
    // splicing markup authors one store per `customNodeXml` call, and a file from anywhere can
    // hold as many as it likes — and stripping only the first ships the payloads in the rest.
    for (const dataPart of storesFor(next, request.storyPartName, namespaceUri)) {
      // EVERY story, not the one this pass policed. Two definitions sharing a `tagPrefix` share a
      // store, and a control in a header binds one as readily as a control in the body — so
      // "nothing references this any more" is a question about the package, and answering it from
      // one part strips a store another chip still names.
      const referenced = boundCustomXmlNodeIdsInPackage(next, dataPart.itemId);

      // THE PAYLOADS FIRST, one by one. Dropping the whole store only when nothing binds it left
      // a store with one surviving chip carrying every OTHER chip's payload — including the ones
      // a `preserveOnExport: false` definition had just been removed for. The export said `ok`
      // and shipped the data it was called to remove.
      const swept = withoutOrphanCustomXmlNodes(next, dataPart.partName, referenced);
      if (
        swept.pkg === next &&
        swept.removed.length === 0 &&
        !isTidy(next, dataPart.partName, referenced)
      ) {
        return { ok: false, reason: `the payloads in ${namespaceUri} could not be removed` };
      }
      next = swept.pkg;

      // Then the store itself: part, properties, both relationships and the content-type
      // Override, which is what "no record of it" means.
      if (referenced.size > 0) continue;
      const stripped = withoutCustomXmlPart(next, dataPart);
      // `ok: false` means NOTHING was removed. Answering the unchanged package would hand back
      // a document a caller could not tell from a stripped one.
      if (!stripped.ok) {
        return { ok: false, reason: `the payload store for ${namespaceUri} could not be removed` };
      }
      next = stripped.pkg;
    }
  }

  return { ok: true, pkg: next, unwrapped, removed };
}

/**
 * Whether a store already holds nothing but what is still bound.
 *
 * `withoutOrphanCustomXmlNodes` answers an unchanged package for "nothing to do" and for "the
 * rewrite was refused" alike, and only one of those may be exported. This tells them apart.
 */
function isTidy(pkg: OoxmlPackage, partName: string, referenced: ReadonlySet<string>): boolean {
  return customXmlNodes(pkg, partName).every((node) => referenced.has(node.id));
}

/** An edit refusal as one line, so an export failure names the invariant that stopped it. */
function describe(edit: { readonly issues: readonly OoxmlInvariantIssue[] }): string {
  return edit.issues.map((issue) => issue.code).join(', ') || 'the edit was refused';
}

/** Every store carrying this namespace, in relationship order. */
function storesFor(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): readonly CustomXmlDataPart[] {
  return customXmlDataParts(pkg, storyPartName).filter(
    (store) => store.namespaceUri === namespaceUri
  );
}

/**
 * Remove ONE store: its part, its properties, both relationships and the Override.
 *
 * By part rather than by namespace, because a namespace can name several and the caller here has
 * already decided which of them is unreferenced.
 */
function withoutCustomXmlPart(pkg: OoxmlPackage, store: CustomXmlDataPart): WithoutPartResult {
  const item = withoutPart(pkg, store.partName);
  if (!item.ok) return { pkg, ok: false };
  const props = withoutPart(item.pkg, store.propsPartName);
  if (!props.ok) return { pkg, ok: false };
  return { pkg: props.pkg, ok: true };
}
