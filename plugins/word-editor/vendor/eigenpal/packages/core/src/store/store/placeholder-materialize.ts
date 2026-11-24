// Empty content controls show their prompt, as Word shows it.
//
// Word saves a control the user never filled as `<w:sdtContent/>` and, on open, displays the
// placeholder its `w:placeholder/w:docPart` names in the glossary part ("Click here to enter a
// date."). The engine's own form for a control showing its prompt is the prompt's runs under
// `w:showingPlcHdr`, which is what Word itself writes once the control has been rendered and
// what `insertContentControl` authors: the caret can sit in it, a press selects it whole, and
// the first keystroke replaces it. An empty control had none of that — a zero-width gap the
// caret could not enter, with typed text landing beside it — so the open normalizes it into
// the same shape, from the glossary block when the document carries one and from the type's
// default prompt otherwise.

import { buildingBlocksOf, type BuildingBlock } from '../package/building-blocks.ts';
import {
  contentControlPropertiesOf as contentControlSummaryOf,
  type ContentControlKind,
} from '../package/content-control-nodes.ts';
import { createNodeIdAllocator, replaceChildren } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { usedParaIds, w14PrefixInScopeAt, withFreshParaIds } from '../package/para-id.ts';
import { actorScopedSeed } from '../package/actor-scoped-ids.ts';
import { editedProperties, promptFor, textRun, wmlElement } from './tree-op-content-controls.ts';
import {
  cloneWithNewIds,
  contentControlContentOf,
  contentControlPropertiesOf,
  isContentControlNode,
} from './tree-op-nodes.ts';

/** The kinds whose empty content Word fills with a prompt. A checkbox or a picture has none. */
const PROMPT_KINDS: ReadonlySet<ContentControlKind> = new Set<ContentControlKind>([
  'plainText',
  'richText',
  'date',
  'dropDownList',
  'comboBox',
  'docPartList',
]);

/** Bounded: a hostile document cannot make the open pass walk deeper than the tree reader allows. */
const MAX_DEPTH = 96;

interface EmptyControl {
  readonly control: OoxmlElement;
  readonly content: OoxmlElement;
  readonly kind: ContentControlKind;
  readonly docPart: string | undefined;
  readonly inline: boolean;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function isBlank(node: OoxmlNode): boolean {
  return node.kind === 'textValue' && node.value.trim() === '';
}

/** Every control whose content holds nothing at all, with where it sits. */
function collectEmptyControls(root: OoxmlNode): EmptyControl[] {
  const found: EmptyControl[] = [];
  const visit = (node: OoxmlNode, inline: boolean, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_DEPTH) return;
    if (isContentControlNode(node)) {
      const content = contentControlContentOf(node);
      const summary = contentControlSummaryOf(node);
      if (content && summary && content.children.every(isBlank) && PROMPT_KINDS.has(summary.type)) {
        found.push({
          control: node,
          content,
          kind: summary.type,
          docPart: summary.placeholderDocPart,
          inline,
        });
        return;
      }
    }
    const inParagraph = inline || node.kind === 'paragraph' || isWml(node, 'p');
    for (const child of node.children) visit(child, inParagraph, depth + 1);
  };
  visit(root, false, 0);
  return found;
}

function placeholderRunProperties(nextId: () => string): OoxmlNode {
  return wmlElement(nextId, 'rPr', {
    kind: 'runProperties' as OoxmlNode['kind'],
    children: [wmlElement(nextId, 'rStyle', { attributes: [['val', 'PlaceholderText']] })],
  });
}

/** The inline children of a block's first paragraph: what an inline control can hold. */
function inlineChildrenOf(blocks: readonly OoxmlNode[]): readonly OoxmlNode[] | null {
  const paragraph = blocks.find((block) => block.kind === 'paragraph' || isWml(block, 'p'));
  if (!paragraph || paragraph.kind === 'textValue') return null;
  const children = paragraph.children.filter(
    (child) => child.kind !== 'paragraphProperties' && !isWml(child, 'pPr')
  );
  return children.length > 0 ? children : null;
}

/**
 * Fill every empty prompt-bearing control in `part` with its placeholder and mark it as
 * showing one. Returns `part` itself when there is nothing to fill.
 */
export function materializeGlossaryPlaceholders(pkg: OoxmlPackage, part: OoxmlPart): OoxmlPart {
  const targets = collectEmptyControls(part.root);
  if (targets.length === 0) return part;
  let blocks: readonly BuildingBlock[] | null = null;
  const blockNamed = (name: string | undefined): BuildingBlock | undefined => {
    if (name === undefined) return undefined;
    blocks ??= buildingBlocksOf(pkg);
    return blocks.find((block) => block.name === name);
  };
  const nextId = createNodeIdAllocator(part, 'paste');
  const paraIds = new Set(usedParaIds(part.root as OoxmlElement));
  const counter = { value: 0 };
  let current = part;
  for (const [index, target] of targets.entries()) {
    const block = blockNamed(target.docPart);
    const hostPrefix = w14PrefixInScopeAt(part, target.control);
    let children: readonly OoxmlNode[] | null = null;
    if (block) {
      const cloned = block.blocks.map((entry, position) =>
        withFreshParaIds(
          cloneWithNewIds(entry, nextId),
          paraIds,
          actorScopedSeed(`${target.control.id}:placeholder:${index}:${position}`),
          counter,
          hostPrefix
        )
      );
      children = target.inline ? inlineChildrenOf(cloned) : cloned;
    }
    if (!children) {
      const run = textRun(nextId, promptFor(target.kind), placeholderRunProperties(nextId));
      children = target.inline
        ? [run]
        : [
            withFreshParaIds(
              wmlElement(nextId, 'p', { kind: 'paragraph' as OoxmlNode['kind'], children: [run] }),
              paraIds,
              actorScopedSeed(`${target.control.id}:placeholder:${index}`),
              counter,
              hostPrefix
            ),
          ];
    }
    const properties = editedProperties(
      contentControlPropertiesOf(target.control),
      { showingPlaceholder: true },
      nextId
    );
    const filled = { ...target.content, children } as OoxmlNode;
    const next = target.control.children.map((child) =>
      child.id === target.content.id
        ? filled
        : child.kind !== 'textValue' && child.localName === 'sdtPr'
          ? properties
          : child
    );
    const edited = replaceChildren(current, target.control.id, next);
    if (edited.ok) current = edited.part;
  }
  return current;
}
