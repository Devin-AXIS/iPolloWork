// Whole-story structural replacement.
//
// This is deliberately separate from deleting a selected span. A selection delete preserves
// section-ending paragraphs and content-control wrappers. A fresh-document write must remove
// those blocks, while a body must retain its final `w:sectPr` page setup.

import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import { areInsertableTexts, textWithHyphens } from './tree-op-inline-elements.ts';
import { createNodeIdAllocator, findNode, replaceChildren } from '../package/ooxml-edit.ts';
import {
  mintParaId,
  mintedParagraphIdentityAttributes,
  normalizeParagraphIdentity,
  usedParaIds,
  w14RootPrefix,
} from '../package/para-id.ts';
import { storyRootsOf } from '../package/story-blocks.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { TreeOpEffect, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

export const MAX_STORY_REPLACEMENT_PARAGRAPHS = 10_000;

export function validateReplaceStoryBlocks(
  part: OoxmlPart,
  storyRootId: string,
  paragraphs: readonly string[]
): TreeOpRejection | null {
  const root = findNode(part, storyRootId);
  if (!root || root.kind === 'textValue') return 'unknown-block';
  if (!storyRootsOf(part).some((story) => story.root.id === storyRootId)) {
    return 'not-a-block';
  }
  if (
    !Array.isArray(paragraphs) ||
    paragraphs.length < 1 ||
    paragraphs.length > MAX_STORY_REPLACEMENT_PARAGRAPHS
  ) {
    return 'invalidArgs';
  }
  return paragraphs.every((text) => typeof text === 'string') && areInsertableTexts(paragraphs)
    ? null
    : 'invalid-text';
}

function collectIds(node: OoxmlNode, ids: string[]): void {
  ids.push(node.id);
  if (node.kind === 'textValue') return;
  for (const child of node.children) collectIds(child, ids);
}

function paragraph(
  nextId: () => string,
  text: string,
  w14Prefix: string | null,
  seed: string,
  usedParagraphIds: Set<string>
): OoxmlNode {
  const children: OoxmlNode[] = [];
  if (text.length > 0) {
    const content = textWithHyphens(nextId, text);
    children.push({
      id: nextId(),
      kind: 'run',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'r',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: content,
    } as OoxmlNode);
  }
  const identity: OoxmlAttribute[] = [];
  if (w14Prefix !== null) {
    const paraId = mintParaId(actorScopedSeed(seed), usedParagraphIds);
    usedParagraphIds.add(paraId);
    identity.push(...mintedParagraphIdentityAttributes(w14Prefix, paraId));
  }
  return {
    id: nextId(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: identity,
    children,
  } as OoxmlNode;
}

/**
 * Replace every block in one story with fresh plain paragraphs.
 *
 * A body-level final `w:sectPr` survives because it defines the page containing the replacement.
 * Paragraph-level section marks, tables, content controls, comments, and revisions do not survive.
 */
export function applyReplaceStoryBlocks(
  part: OoxmlPart,
  storyRootId: string,
  paragraphs: readonly string[],
  options?: { readonly deferValidation?: boolean }
): TreeOpResult {
  const refusal = validateReplaceStoryBlocks(part, storyRootId, paragraphs);
  if (refusal) return { ok: false, reason: refusal };
  const root = findNode(part, storyRootId) as OoxmlElement;
  const oldChildren = root.children;
  const finalSection =
    root.kind === 'body'
      ? oldChildren.find(
          (child) =>
            child.kind !== 'textValue' &&
            child.namespaceUri === root.namespaceUri &&
            child.localName === 'sectPr'
        )
      : undefined;
  const nextId = createNodeIdAllocator(part);
  const usedParagraphIds = new Set(usedParaIds(part.root));
  const w14Prefix = w14RootPrefix(part.root);
  const created = paragraphs.map((text, index) =>
    paragraph(nextId, text, w14Prefix, `${storyRootId}:${index}`, usedParagraphIds)
  );
  const deleted: string[] = [];
  for (const child of oldChildren) {
    if (child !== finalSection) collectIds(child, deleted);
  }
  const replaced = replaceChildren(
    part,
    root.id,
    [...created, ...(finalSection ? [finalSection] : [])],
    options
  );
  if (!replaced.ok) return { ok: false, reason: 'tree-invariant' };
  const identified = normalizeParagraphIdentity(replaced.part);
  const effect: TreeOpEffect = {
    dirty: [root.id],
    created: created.map((node) => node.id),
    deleted,
    dependencyKeys: ['story-blocks', 'paragraph-text', 'sections', 'review'],
    impact: 'global',
  };
  return { ok: true, part: identified, effect };
}
