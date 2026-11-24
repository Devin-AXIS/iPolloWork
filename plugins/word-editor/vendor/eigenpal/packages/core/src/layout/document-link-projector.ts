// Shared sanitized hyperlink projection for body and secondary stories.

import {
  hyperlinkTargetOf,
  relationshipTargetIn,
  type HeadlessDocumentView,
} from '@docx-editor.dev/core/store';
import type { HyperlinkProjector } from './field-projection.ts';
import {
  createStoryProjectionDependencies,
  type StoryProjectionDependencies,
} from './text-projection-epoch.ts';

const MAX_MEMOIZED_PART_PROJECTORS = 512;

function projector(
  resolveRelationship: Parameters<typeof hyperlinkTargetOf>[1]
): HyperlinkProjector {
  return (link) => {
    if (link.kind === 'textValue') return null;
    const target = hyperlinkTargetOf(link, resolveRelationship);
    return {
      id: link.id,
      kind: target.kind,
      href: target.href,
      ...(target.anchor !== undefined ? { anchor: target.anchor } : {}),
      ...(target.tooltip !== undefined ? { tooltip: target.tooltip } : {}),
    };
  };
}

/**
 * Sanitized projectors paired with the cache identities required to use them safely.
 *
 * Keep this object intact when passing it to a document composition helper. Projected text and
 * its dependency tokens are one contract: accepting either half independently permits stale
 * paragraph caches after relationship- or property-only revisions.
 * @public
 */
export interface DocumentLinkProjectors extends StoryProjectionDependencies {
  readonly projectLink: HyperlinkProjector;
  readonly projectLinkForPart: (partName: string) => HyperlinkProjector;
}

/** Sanitized body and per-part link projectors over one neutral document view. @public */
export function createDocumentLinkProjectors(view: HeadlessDocumentView): DocumentLinkProjectors {
  const projectLink = projector((relationshipId) => view.relationshipTarget(relationshipId));
  const projectorsByPart = new Map<string, HyperlinkProjector>();
  const projectLinkForPart = (partName: string): HyperlinkProjector => {
    const cached = projectorsByPart.get(partName);
    if (cached) return cached;
    const created = projector((relationshipId) =>
      relationshipTargetIn(view.currentPackage(), partName, relationshipId)
    );
    // Avoid unbounded retention if a public caller supplies arbitrary owner names. Package
    // parsing caps real part counts; uncached projectors remain fully correct past this bound.
    if (projectorsByPart.size < MAX_MEMOIZED_PART_PROJECTORS) {
      projectorsByPart.set(partName, created);
    }
    return created;
  };
  return Object.freeze({
    projectLink,
    projectLinkForPart,
    ...createStoryProjectionDependencies(view, projectLinkForPart),
  });
}
