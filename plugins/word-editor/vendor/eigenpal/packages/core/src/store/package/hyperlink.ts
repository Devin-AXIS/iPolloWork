// Reading a typed `w:hyperlink` into a target record, and the ONE place a file-derived link
// target becomes a runtime URL.
//
// TWO VALUES, NEVER ONE. `authored` is the target exactly as the document wrote it — that is
// what serialization re-emits, XML-escaped, and it is never touched by sanitization, so a
// round trip is lossless whatever the target says. `href` is the runtime projection, produced
// once here through `sanitizeHref`, and it is the only value allowed to reach a DOM
// attribute, `window.open`, or the clipboard. A refused scheme (`javascript:`, `data:`,
// `vbscript:`, `file:`) yields `href: null` — an INERT link: it still paints, still holds its
// text, still saves, and has no way to be activated.
//
// Sanitizing here rather than at each consumer is the whole point. Paint, the popover,
// navigation and the editor query are four sinks; a boundary crossed once cannot be crossed
// inconsistently, and a new consumer inherits the guarantee instead of having to remember it.
//
// NOTHING IN THIS MODULE FETCHES. Resolving a relationship means reading the package's own
// rels record; an external target is classified and validated as a string and never
// requested. Opening a document performs no network access for any hyperlink.

import { sanitizeHref } from './sinks.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode } from './ooxml-tree.ts';

/** The relationship namespace `r:id` lives in. */
export const OFFICE_RELATIONSHIP_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The `Type` a hyperlink relationship declares. */
export const HYPERLINK_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

/**
 * What a part's relationships answer for one `r:id`: the authored target and whether the
 * package declared it external. `null` for an id the part does not declare — a DANGLING
 * relationship, which is a real thing in real documents.
 */
export type RelationshipTargetResolver = (relationshipId: string) => {
  readonly target: string;
  readonly external: boolean;
  /**
   * The PACKAGE's own verdict on this target (`validateExternalTarget`): whether it is an
   * absolute URI with a safe scheme.
   *
   * Carried separately because `sanitizeHref` cannot answer it. That function is a SCHEME
   * allowlist and deliberately admits relative URLs — the right rule for a value the host
   * authored, and the wrong one for a value a `.docx` did. A file-supplied
   * `Target="/admin/delete-account"` has no scheme to refuse, so it would pass the
   * allowlist and resolve against the EMBEDDING APPLICATION'S origin: a link reading
   * "Company policy" that issues an authenticated same-origin request to whatever host
   * app the editor is mounted in. Absent, a target is treated as unverified.
   */
  readonly sinkSafe?: boolean;
} | null;

/**
 * What a hyperlink points at, which decides what activating it may do.
 *
 * The security-relevant split: an `external` link goes through `sanitizeHref` and opens only on
 * explicit user action, while an anchor merely scrolls and never navigates.
 */
export type HyperlinkKind =
  /** `r:id` → a relationship with `TargetMode="External"`. Opens somewhere else. */
  | 'external'
  /** `w:anchor` → a bookmark in this document. Scrolls, never navigates. */
  | 'internal'
  /**
   * `r:id` naming a relationship the part does not declare, or one that is not external.
   *
   * The link keeps its runs — the text is never lost twice — but there is nothing to
   * activate, so it paints inert exactly like a refused scheme.
   */
  | 'unresolved';

/** A resolved hyperlink: its kind, its target, and the tooltip Word shows on hover. */
export interface HyperlinkTarget {
  readonly kind: HyperlinkKind;
  /**
   * The authored target, verbatim: the relationship's `Target` for an `r:id` link, the
   * anchor name for an internal one. Save re-emits from the tree, never from this — it is
   * here so a UI can show what the document actually says.
   */
  readonly authored: string;
  /**
   * The sanitized runtime projection, or `null` when there is nothing safe to navigate to.
   * The ONLY value permitted in a DOM `href`, `window.open`, or a copied link.
   */
  readonly href: string | null;
  /** `w:anchor`, for an internal link. */
  readonly anchor?: string;
  /** `w:tooltip` — Word's hover text; paint puts it on the anchor's `title`. */
  readonly tooltip?: string;
  /** The authored `r:id`, so an edit can rewrite the relationship it names. */
  readonly relationshipId?: string;
}

function attributeValue(
  node: OoxmlNode,
  namespaceUri: string,
  localName: string
): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === namespaceUri && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/** Whether a node is a typed `w:hyperlink`. */
export function isHyperlinkNode(node: OoxmlNode): boolean {
  return node.kind === 'hyperlink';
}

/** A typed hyperlink's `w:anchor`, or undefined. */
export function hyperlinkAnchorOf(link: OoxmlNode): string | undefined {
  return attributeValue(link, WML_NAMESPACE_URI, 'anchor');
}

/** A typed hyperlink's `r:id`, or undefined. */
export function hyperlinkRelationshipIdOf(link: OoxmlNode): string | undefined {
  return attributeValue(link, OFFICE_RELATIONSHIP_NAMESPACE_URI, 'id');
}

/**
 * Read a typed `w:hyperlink` into its target record.
 *
 * `r:id` wins over `w:anchor` when a link carries both, matching Word: the relationship
 * names the document and the anchor names a place inside it, so the pair is a link to a
 * bookmark in ANOTHER file — which this engine will not follow, but whose external half is
 * the part that decides where it points.
 *
 * A link with neither is `unresolved`: it paints its runs and does nothing.
 */
export function hyperlinkTargetOf(
  link: OoxmlNode,
  resolve: RelationshipTargetResolver
): HyperlinkTarget {
  const tooltip = attributeValue(link, WML_NAMESPACE_URI, 'tooltip');
  const relationshipId = hyperlinkRelationshipIdOf(link);
  const anchor = hyperlinkAnchorOf(link);

  if (relationshipId !== undefined && relationshipId !== '') {
    const record = resolve(relationshipId);
    if (record && record.external) {
      // TWO gates, not one. The scheme allowlist refuses `javascript:` and friends; the
      // package's absolute-URI check refuses a target with no scheme at all, which the
      // allowlist passes through by design. A file-derived target must clear BOTH — a
      // relative or protocol-relative target resolves against the host application's
      // origin, which is not somewhere this document gets to point.
      const projection = sanitizeHref(record.target);
      const admitted = projection.ok && record.sinkSafe === true;
      return {
        kind: 'external',
        authored: record.target,
        href: admitted ? projection.href : null,
        ...(anchor !== undefined ? { anchor } : {}),
        ...(tooltip !== undefined ? { tooltip } : {}),
        relationshipId,
      };
    }
    // A missing relationship, or one the package resolved INTERNALLY (a link to another
    // part of this package). Neither is something to open: the first has no target at all,
    // the second would be a same-package navigation this engine does not model. The runs
    // still paint, which is the part that matters.
    return {
      kind: 'unresolved',
      authored: record?.target ?? '',
      href: null,
      ...(anchor !== undefined ? { anchor } : {}),
      ...(tooltip !== undefined ? { tooltip } : {}),
      relationshipId,
    };
  }

  if (anchor !== undefined && anchor !== '') {
    return {
      kind: 'internal',
      authored: anchor,
      // A fragment, not a URL: it never leaves the page, and the anchor name is
      // file-derived so it goes through the same allowlist as everything else. A name that
      // sanitizes away leaves an inert link rather than an attribute built from raw input.
      href: sanitizeFragment(anchor),
      anchor,
      ...(tooltip !== undefined ? { tooltip } : {}),
    };
  }

  return {
    kind: 'unresolved',
    authored: '',
    href: null,
    ...(tooltip !== undefined ? { tooltip } : {}),
  };
}

/**
 * `#<anchor>` for a bookmark name, or null.
 *
 * The fragment is built from a file-derived name, so it takes the same allowlist path as an
 * external target: `sanitizeHref` strips the embedded tab/LF/CR used to smuggle a scheme
 * past a naive check, and a name that manages to look like `javascript:` — a legal bookmark
 * name contains no colon, but nothing stops a hostile file writing one — is refused rather
 * than concatenated onto a `#`.
 */
function sanitizeFragment(anchor: string): string | null {
  const projection = sanitizeHref(anchor);
  if (!projection.ok || projection.href.length === 0) return null;
  return `#${projection.href}`;
}
