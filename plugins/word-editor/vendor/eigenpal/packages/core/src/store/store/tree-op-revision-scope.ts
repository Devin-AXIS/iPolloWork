import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { noteKindOf } from '../package/note-nodes.ts';
import { WPS_NAMESPACE_URI } from '../package/ooxml-drawing-rules.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

const VML_NAMESPACE_URI = 'urn:schemas-microsoft-com:vml';
/** Ancestors a VML text box may sit under before its `mc:Fallback`, if any, is ruled out. */
const MAX_FALLBACK_DEPTH = 256;

/**
 * Resolve an exact canonical story root accepted for a scoped revision collection decision: a
 * note root, the `w:txbxContent` story of a DrawingML shape (`wps:txbx/w:txbxContent`), or that
 * of a standalone legacy VML shape (`v:textbox/w:txbxContent`). A VML copy under `mc:Fallback`
 * is not a story of its own: it is decided with the DrawingML story it copies.
 *
 * This checks structure only. Automation scopes a decision to a VML box only when the shape
 * listing names that box (`automation/textbox-revision-scope.ts`); a wider structural scope here
 * still decides exactly the changes inside the root it names.
 *
 * A `w:footnote`-named generic node elsewhere in a hostile part is not a note root: it must be a
 * direct child of the matching typed notes-part root. Keeping this predicate shared makes validation, protection reach,
 * and application fail closed on exactly the same scope.
 */
export function scopedRevisionRoot(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const node = findNode(part, nodeId);
  if (node === null) return null;
  if (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === 'txbxContent'
  ) {
    const parent = parentNodeOf(part, node.id);
    if (parent?.namespaceUri === WPS_NAMESPACE_URI && parent.localName === 'txbx') return node;
    if (parent?.namespaceUri !== VML_NAMESPACE_URI || parent.localName !== 'textbox') return null;
    let ancestor = parentNodeOf(part, parent.id);
    for (let depth = 0; ancestor; depth += 1) {
      if (depth > MAX_FALLBACK_DEPTH) return null;
      if (ancestor.namespaceUri === MC_NAMESPACE_URI && ancestor.localName === 'Fallback')
        return null;
      ancestor = parentNodeOf(part, ancestor.id);
    }
    return node;
  }
  const noteKind = noteKindOf(node);
  if (noteKind === null) return null;
  const expectedRootKind = noteKind === 'footnote' ? 'footnotes' : 'endnotes';
  if (part.root.kind !== expectedRootKind) return null;
  return parentNodeOf(part, node.id)?.id === part.root.id ? node : null;
}
