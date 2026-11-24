// Adjacent floating tables that share one position stack into one table.
//
// Two `w:tbl` elements with no paragraph between them and identical `w:tblpPr` attributes form
// one floating table: the later one starts at the bottom of the earlier one, with no gap and
// without its own offset. Tables whose positions differ, or that have a paragraph between them,
// keep their own placement and may overlap.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import type { PositionedTableAnchor } from './table-float-position.ts';

function tblpPr(table: OoxmlElement): OoxmlElement | undefined {
  for (const child of table.children) {
    if (
      child.kind === 'textValue' ||
      child.namespaceUri !== WML_NAMESPACE_URI ||
      child.localName !== 'tblPr'
    )
      continue;
    for (const property of child.children)
      if (
        property.kind !== 'textValue' &&
        property.namespaceUri === WML_NAMESPACE_URI &&
        property.localName === 'tblpPr'
      )
        return property;
  }
  return undefined;
}

function sameAttributes(a: OoxmlElement, b: OoxmlElement): boolean {
  const attributesA = a.attributes.filter(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI
  );
  const attributesB = b.attributes.filter(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI
  );
  if (attributesA.length !== attributesB.length) return false;
  return attributesA.every((attribute) =>
    attributesB.some(
      (other) =>
        other.localName === attribute.localName &&
        other.namespaceUri === attribute.namespaceUri &&
        other.value === attribute.value
    )
  );
}

/** Whether two tables carry `w:tblpPr` elements with identical attributes. */
export function sameTablePosition(a: OoxmlElement, b: OoxmlElement): boolean {
  const own = tblpPr(a);
  const theirs = tblpPr(b);
  return own !== undefined && theirs !== undefined && sameAttributes(own, theirs);
}

/** The table `table` stacks below: the floating table right before it with the same position. */
export function stackPartner(
  positioned: readonly PositionedTableAnchor[],
  table: PositionedTableAnchor
): PositionedTableAnchor | undefined {
  const previous = positioned.find((candidate) => candidate.sourceIndex === table.sourceIndex - 1);
  if (!previous || previous.anchorId !== table.anchorId) return undefined;
  return sameTablePosition(table.table, previous.table) ? previous : undefined;
}

/** The last fragment of `tableId` among `fragments`, when that table is on the page. */
export function lastTableFragment(
  fragments: readonly BlockFragmentRecord[],
  tableId: string
): TableFragmentRecord | undefined {
  for (let index = fragments.length - 1; index >= 0; index--) {
    const fragment = fragments[index]!;
    if (fragment.kind === 'table' && fragment.tableId === tableId) return fragment;
  }
  return undefined;
}

/**
 * The top that puts `table` right below its stack partner's fragment on this page, whatever its
 * vertical anchor, or `undefined` when it does not stack or the partner is not on the page.
 */
export function stackedTop(
  positioned: readonly PositionedTableAnchor[],
  table: PositionedTableAnchor,
  fragments: readonly BlockFragmentRecord[]
): number | undefined {
  const partner = stackPartner(positioned, table);
  const below = partner && lastTableFragment(fragments, partner.table.id);
  return below ? below.box.y + below.box.height : undefined;
}

/** Every table of the stack `table` belongs to, top first; just `table` when it stacks alone. */
export function stackMembers(
  positioned: readonly PositionedTableAnchor[],
  table: PositionedTableAnchor
): readonly PositionedTableAnchor[] {
  const members = [table];
  for (let above = stackPartner(positioned, table); above; above = stackPartner(positioned, above))
    members.unshift(above);
  for (let index = positioned.indexOf(table) + 1; index < positioned.length; index++) {
    const next = positioned[index]!;
    if (stackPartner(positioned, next) !== members.at(-1)) break;
    members.push(next);
  }
  return members;
}

/** What stack placement reads from the body flow that places the tables. */
interface StackFlow {
  /** The fragments of the page being filled. */
  readonly fragments: () => readonly BlockFragmentRecord[];
  readonly cursorY: () => number;
  /**
   * How far the raised tables of one anchor pushed the earlier lines on this page, for the
   * table at `sourceOrder` (see `earlier-line-push.ts`).
   */
  readonly pushOf: (anchorId: string, sourceOrder: number) => number;
}

/** Stack placement over one story's positioned tables, reading the flow as it advances. */
export function createStackPlacement(
  positioned: readonly PositionedTableAnchor[],
  flow: StackFlow
) {
  const byId = new Map(positioned.map((table) => [table.table.id, table]));
  return {
    /**
     * The push a raised table leaves out of its anchor top: the earlier lines its anchor's raised
     * tables moved. A table positioned below its anchor does not take it.
     */
    push(tableId: string): number {
      const own = byId.get(tableId);
      // A band that rises above the anchor through `w:topFromText` takes the push too.
      const rise = own ? own.float.yPt - (own.float.distances?.top ?? 0) : 0;
      return own && rise < -0.051 && !own.float.ySpec
        ? flow.pushOf(own.anchorId, own.sourceIndex)
        : 0;
    },
    /** The top a waiting table stacks at on this page, when it stacks. */
    top(tableId: string): number | undefined {
      const own = byId.get(tableId);
      return own && stackedTop(positioned, own, flow.fragments());
    },
    /** Where an in-flow table opens: below the table it stacks on, else at the body cursor. */
    anchor(tableId: string): number {
      const own = byId.get(tableId);
      const top = own && stackedTop(positioned, own, flow.fragments());
      return own && top !== undefined ? top - own.float.yPt : flow.cursorY();
    },
    /**
     * The waiting tables `tableId` stacks below, oldest first, taken out of `pending`: they go
     * into the flow right above it when it breaks across pages.
     */
    takeWaiting(tableId: string, pending: Set<string>): readonly string[] {
      const taken: string[] = [];
      const own = byId.get(tableId);
      for (let above = own && stackPartner(positioned, own); above;) {
        if (!pending.delete(above.table.id)) break;
        taken.unshift(above.table.id);
        above = stackPartner(positioned, above);
      }
      return taken;
    },
  };
}
