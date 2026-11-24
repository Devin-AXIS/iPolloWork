// Shared trust boundary for HYPERLINK field results.

import { sanitizeHref } from '../store/package/sinks.ts';
import { stripControlChars, validateExternalTarget } from '../store/package/opc-names.ts';
import type { HyperlinkFieldSpec } from './field-link.ts';
import type { SpanLinkRecord } from './semantic-records.ts';

const MAX_REGISTERED_FIELD_LINKS = 4096;

/** Sanitized field link retained for interactive consumers. @public */
export interface RegisteredFieldLink {
  readonly id: string;
  readonly paragraphId: '';
  readonly start: 0;
  readonly end: 0;
  readonly text: '';
  readonly kind: 'external' | 'internal' | 'unresolved';
  readonly href: string | null;
  readonly authored: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}

/** Per-layout registry for projected HYPERLINK fields. @public */
export interface FieldLinkRegistry {
  project(spec: HyperlinkFieldSpec): SpanLinkRecord | null;
  linkById(linkId: string): RegisteredFieldLink | null;
  clear(): void;
}

interface ResolvedFieldLink {
  readonly kind: RegisteredFieldLink['kind'];
  readonly href: string | null;
  readonly authored: string;
  readonly anchor?: string;
  readonly tooltip?: string;
}

function resolveFieldLink(spec: HyperlinkFieldSpec): ResolvedFieldLink | null {
  const tooltip = spec.tooltip !== null ? { tooltip: stripControlChars(spec.tooltip) } : {};
  if (spec.target !== null) {
    const projection = sanitizeHref(spec.target);
    const admitted =
      projection.ok && projection.href.length > 0 && validateExternalTarget(projection.href).ok;
    if (admitted) {
      const anchorHref =
        spec.anchor !== null && !projection.href.includes('#')
          ? sanitizeHref(stripControlChars(spec.anchor))
          : null;
      const href =
        anchorHref && anchorHref.ok && anchorHref.href.length > 0
          ? `${projection.href}#${anchorHref.href}`
          : projection.href;
      return {
        kind: 'external',
        href,
        authored: spec.target,
        ...(spec.anchor !== null ? { anchor: stripControlChars(spec.anchor) } : {}),
        ...tooltip,
      };
    }
    if (spec.anchor === null) return null;
  }
  if (spec.anchor === null) return null;
  const anchor = stripControlChars(spec.anchor);
  const fragment = sanitizeHref(anchor);
  return {
    kind: 'internal',
    href: fragment.ok && fragment.href.length > 0 ? `#${fragment.href}` : null,
    authored: spec.anchor,
    anchor,
    ...tooltip,
  };
}

/** Create a bounded, content-keyed field-link registry. @public */
export function createFieldLinkRegistry(): FieldLinkRegistry {
  const idByKey = new Map<string, string>();
  const byId = new Map<string, RegisteredFieldLink>();
  let minted = 0;
  return {
    project(spec) {
      const resolved = resolveFieldLink(spec);
      if (!resolved) return null;
      const key = `${spec.target ?? ''}\0${spec.anchor ?? ''}\0${spec.tooltip ?? ''}`;
      let id = idByKey.get(key);
      if (id === undefined) {
        if (idByKey.size >= MAX_REGISTERED_FIELD_LINKS) return null;
        id = `field-hyperlink:${++minted}`;
        idByKey.set(key, id);
        byId.set(
          id,
          Object.freeze({
            id,
            paragraphId: '',
            start: 0,
            end: 0,
            text: '',
            kind: resolved.kind,
            href: resolved.href,
            authored: resolved.authored,
            ...(resolved.anchor !== undefined ? { anchor: resolved.anchor } : {}),
            ...(resolved.tooltip !== undefined ? { tooltip: resolved.tooltip } : {}),
          })
        );
      }
      return {
        id,
        kind: resolved.kind,
        href: resolved.href,
        ...(resolved.anchor !== undefined ? { anchor: resolved.anchor } : {}),
        ...(resolved.tooltip !== undefined ? { tooltip: resolved.tooltip } : {}),
      };
    },
    linkById: (linkId) => byId.get(linkId) ?? null,
    clear() {
      idByKey.clear();
      byId.clear();
    },
  };
}
