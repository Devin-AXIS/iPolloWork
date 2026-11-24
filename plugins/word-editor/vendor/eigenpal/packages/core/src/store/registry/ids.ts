// Stable identifier grammar for the capability/runtime registry
// (document-engine task 0.1). Every extension, capability, command, query,
// schema, dependency key, runtime port, result, and origin uses a globally
// stable ID in one of two forms:
//
//   - reverse-domain:  dev.docx-editor.core.command.insert-text
//   - package-owned:   @docx-editor.dev/engine-core#command/insert-text
//
// IDs are opaque strings once validated; the registry never selects by
// registration order, so the ID (plus version) is the sole identity.

/**
 * Every kind of thing the registry gives a stable identity to.
 *
 * Identity is `(kind, id)` plus version and NEVER registration order, so two bundles contributing
 * the same command resolve deterministically regardless of which loaded first.
 */
export const ID_KINDS = [
  'extension',
  'capability',
  'command',
  'query',
  'schema',
  'dependencyKey',
  'runtimePort',
  'result',
  'origin',
] as const;

/** One of {@link ID_KINDS}. */
/** One of {@link ID_KINDS} — which sort of thing an identifier names. */
export type IdKind = (typeof ID_KINDS)[number];

// A dotted reverse-domain of two or more lowercase alphanumeric/hyphen labels.
const REVERSE_DOMAIN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
// A package-owned id: an npm scope/name (dots allowed, e.g. @docx-editor.dev)
// with an optional `#segment/segment` path.
const PACKAGE_OWNED = /^@[a-z0-9.-]+\/[a-z0-9.-]+(?:#[a-z0-9]+(?:[/._-][a-z0-9]+)*)?$/;

/**
 * Whether a string is a well-formed identifier in either accepted grammar.
 *
 * Reverse-domain (`dev.docx-editor.core.command.insert-text`) or package-owned
 * (`@docx-editor.dev/engine-core#command/insert-text`). Ids are opaque once validated.
 */
export function isValidId(id: string): boolean {
  return REVERSE_DOMAIN.test(id) || PACKAGE_OWNED.test(id);
}

/**
 * Validate an identifier, throwing when it is malformed.
 *
 * Throws rather than returning: a bad id is an author mistake at registration time, not file
 * input, and accepting it would produce a registry whose identities silently collide.
 */
export function assertValidId(id: string, kind?: IdKind): void {
  if (!isValidId(id)) {
    throw new Error(
      `invalid ${kind ?? 'registry'} id ${JSON.stringify(id)}: ` +
        `must be reverse-domain (dev.docx-editor.core.x) or package-owned (@scope/pkg#kind/name)`
    );
  }
}

/** A validated (kind, id, version) triple — the registry's unit of identity. */
export interface CapabilityId {
  readonly kind: IdKind;
  readonly id: string;
  readonly version: string;
}
