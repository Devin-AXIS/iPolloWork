import { findNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { validatedParaIdOfNode } from './paragraph-anchors.ts';

interface DirectParagraphPartSource {
  readonly body: OoxmlPart;
  readonly openStories: readonly OoxmlPart[];
  readonly otherStories: readonly OoxmlPart[];
  normalize(part: OoxmlPart): OoxmlPart;
}

/** Read one paragraph identity without composing the complete anchor index. */
export function directParaIdOf(nodeId: string, source: DirectParagraphPartSource): string | null {
  const hash = nodeId.indexOf('#');
  if (hash === 0) return null;
  const part = hash === -1 ? partHoldingLogicalId(nodeId, source) : partNamed(nodeId, hash, source);
  if (!part) return null;
  const paragraph = findNode(part, nodeId);
  return paragraph?.kind === 'paragraph' ? validatedParaIdOfNode(paragraph) : null;
}

function partNamed(
  nodeId: string,
  hash: number,
  source: DirectParagraphPartSource
): OoxmlPart | undefined {
  const partName = nodeId.slice(0, hash);
  let part = source.body.name === partName ? source.body : undefined;
  part ??= source.openStories.find((candidate) => candidate.name === partName);
  const other = part
    ? undefined
    : source.otherStories.find((candidate) => candidate.name === partName);
  return part ?? (other ? source.normalize(other) : undefined);
}

/**
 * The part holding a logical id. A collaboration session names the nodes it creates by logical
 * id, which carries no part name, so each story's node index is asked, the body first.
 */
function partHoldingLogicalId(
  nodeId: string,
  source: DirectParagraphPartSource
): OoxmlPart | undefined {
  if (findNode(source.body, nodeId)) return source.body;
  const open = source.openStories.find((candidate) => findNode(candidate, nodeId) !== null);
  if (open) return open;
  for (const other of source.otherStories) {
    const normalized = source.normalize(other);
    if (findNode(normalized, nodeId)) return normalized;
  }
  return undefined;
}
