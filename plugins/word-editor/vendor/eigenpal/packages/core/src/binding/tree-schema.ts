// Minimal ProseMirror schema over the canonical tree (task 6.1).
//
// Minimal in the sense the task asks: ONE node per authored content token and ONE mark
// carrying the whole accepted run-property boundary, rather than a mark per property. A
// mark-per-property schema would need nineteen registrations that all mean "some `w:rPr`
// child", and every new D8 property would be a schema change; carrying the validated
// property list as a mark attribute covers the complete boundary with one registration.
//
// What the projection is NOT allowed to do is drop anything. Unknown content inside a
// paragraph projects as an inert inline atom holding its tree node id, so it keeps its
// position in the child sequence and can be mapped back to the exact node it came from. A
// run consisting only of clipart therefore survives a round trip through the editor — the
// case the legacy projection dropped entirely.

import { Schema, type Node as PMNode } from 'prosemirror-model';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { paragraphPropsToCss, runPropsToCss } from './tree-styles.ts';

/** Attributes carried by a projected paragraph. */
export interface ParagraphAttrs {
  /** The canonical tree node id this paragraph projects. */
  readonly nodeId: string | null;
  /** Accepted `w:pPr` children, as authored. */
  readonly props: readonly OoxmlProperty[];
}

/**
 * The ProseMirror schema the canonical tree projects into.
 *
 * Deliberately minimal. It models only what an editing surface must manipulate directly —
 * paragraphs, text, tabs, breaks, and run properties as marks — because everything it does NOT
 * model stays on the tree and is preserved losslessly there. Widening this schema moves content
 * out of the tree's custody, which is the opposite of what it is for.
 *
 * The node and mark unions are written out rather than inferred from the spec below. Inferred,
 * tsup's dts worker emits their members in an order that varies run to run, so the generated
 * `binding.api.md` differed between builds of identical source and `api:check` failed at random.
 * An explicit annotation pins the emitted order. Adding a node or mark to the spec means adding
 * it here too — the compiler rejects the assignment otherwise.
 */
export const treeSchema: Schema<
  'doc' | 'paragraph' | 'text' | 'tab' | 'hardBreak' | 'pageBreak' | 'unknownInline',
  'runProps'
> = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },

    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { nodeId: { default: null }, props: { default: [] } },
      toDOM: (node) => {
        const style = paragraphPropsToCss((node.attrs.props as OoxmlProperty[]) ?? []);
        return [
          'p',
          {
            'data-node-id': String(node.attrs.nodeId ?? ''),
            ...(style ? { style } : {}),
          },
          0,
        ];
      },
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (dom: HTMLElement | string) =>
            typeof dom === 'string'
              ? null
              : { nodeId: dom.getAttribute('data-node-id') || null, props: [] },
        },
      ],
    },

    text: { group: 'inline' },

    /** `w:tab`. An atom because a tab is one addressable character, not editable content. */
    tab: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      toDOM: () => ['span', { 'data-token': 'tab', class: 'docx-tab' }, '→'],
      parseDOM: [{ tag: 'span[data-token="tab"]' }],
    },

    /** `w:br`. */
    hardBreak: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }],
    },

    /** `w:br w:type="page"`. */
    pageBreak: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      toDOM: () => ['span', { 'data-token': 'page-break', class: 'docx-page-break' }],
      parseDOM: [{ tag: 'span[data-token="page-break"]' }],
    },

    /**
     * Any tree node the paragraph holds that this schema does not model — a drawing, a
     * field, a future element. Inert and non-editable, but PRESENT and positional, so the
     * reverse mapping can prove it was neither moved nor lost.
     */
    unknownInline: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      draggable: false,
      attrs: { nodeId: { default: null }, label: { default: '' } },
      // Rendered as a VISIBLE placeholder rather than an empty span. Content the editor
      // cannot model still occupies space in the document, and showing nothing tells the
      // user their picture was lost — it is not, it is in the tree and it will be saved.
      toDOM: (node) => [
        'span',
        {
          'data-token': 'unknown',
          'data-node-id': String(node.attrs.nodeId ?? ''),
          contenteditable: 'false',
          class: 'docx-unknown-inline',
          title: String(
            node.attrs.label || 'Content this editor cannot edit yet. It is preserved.'
          ),
        },
      ],
      parseDOM: [
        {
          tag: 'span[data-token="unknown"]',
          getAttrs: (dom: HTMLElement | string) =>
            typeof dom === 'string'
              ? false
              : // Resolve ONLY to a node id; the DOM never carries the content itself, so a
                // forged span can at worst name a node already in this document.
                { nodeId: dom.getAttribute('data-node-id') || null, label: '' },
        },
      ],
    },
  },

  marks: {
    /**
     * The run's accepted `w:rPr` children, verbatim.
     *
     * One mark for the whole property set means two runs merge in the projection only when
     * their properties are identical, which is exactly the canonical rule — and it makes
     * the reverse mapping a comparison rather than a reconstruction.
     */
    runProps: {
      attrs: { props: { default: [] } },
      // Two different property sets must not nest into one another.
      excludes: 'runProps',
      // The style is what makes the document LOOK like itself. Without it the projection
      // carried the properties and painted none of them, so a formatted document rendered
      // as plain text — the same defect the legacy preservation capsule had.
      toDOM: (mark) => {
        const props = (mark.attrs.props as OoxmlProperty[]) ?? [];
        const style = runPropsToCss(props);
        return [
          'span',
          { 'data-run-props': serializeProps(props), ...(style ? { style } : {}) },
          0,
        ];
      },
      parseDOM: [
        {
          tag: 'span[data-run-props]',
          getAttrs: (dom: HTMLElement | string) => {
            if (typeof dom === 'string') return false;
            const parsed = parseProps(dom.getAttribute('data-run-props'));
            return parsed ? { props: parsed } : false;
          },
        },
      ],
    },
  },
});

/**
 * Encode a property list for the DOM.
 *
 * JSON rather than a bespoke syntax because it round-trips exactly, and the values reaching
 * here have already passed the DocOp validator's name/value checks. `parseProps` re-checks
 * the SHAPE on the way back so a hand-written attribute cannot inject a non-object.
 */
function serializeProps(props: unknown): string {
  return JSON.stringify(Array.isArray(props) ? props : []);
}

function parseProps(raw: string | null): OoxmlProperty[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const props: OoxmlProperty[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) return null;
      const record = entry as { localName?: unknown; attributes?: unknown };
      if (typeof record.localName !== 'string') return null;
      // Attribute values are re-validated by the DocOp validator before they reach the
      // tree; this only rejects a shape that could not have come from a projection.
      if (
        record.attributes !== undefined &&
        (typeof record.attributes !== 'object' || record.attributes === null)
      ) {
        return null;
      }
      props.push(
        record.attributes === undefined
          ? { localName: record.localName }
          : { localName: record.localName, attributes: record.attributes as Record<string, string> }
      );
    }
    return props;
  } catch {
    return null;
  }
}

/** The accepted run properties carried by a text node, or an empty list. */
export function runPropsOf(node: PMNode): readonly OoxmlProperty[] {
  for (const mark of node.marks) {
    if (mark.type.name === 'runProps') return (mark.attrs.props as OoxmlProperty[]) ?? [];
  }
  return [];
}
