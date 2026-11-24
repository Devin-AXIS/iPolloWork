// The clipboard fragment content trust boundary (rich-clipboard-fidelity, security).
//
// A fragment is attacker-controlled: a hostile page can put a crafted
// `data-docx-fragment` zip on the clipboard, and it reaches the merge WITHOUT passing
// through the extractor. So the merge sanitizes every fragment before it lands, exactly
// as the extractor sanitizes what it packs — the guarantee cannot depend on who authored
// the payload. Matching CLAUDE.md ("Field codes / OLE — never execute or auto-resolve
// field instructions … Render inert"; sections/comments are clipboard non-goals):
//
//   1. Structural strip: `w:sectPr`, comment range markers and references, and the
//      external-content import elements `w:altChunk` / `w:subDoc`.
//   2. Dangerous field neutralization: a `w:fldSimple` or a complex field whose
//      instruction names a remote-fetch or command verb (DDE, INCLUDE*, …) is unlinked to
//      its cached RESULT runs — the machinery and the instruction string are dropped, the
//      visible text stays. Benign fields (PAGE, TOC, REF, …) travel intact for fidelity.
//
// Complex fields legally span paragraphs (a TOC covers dozens), so danger is judged over a
// GLOBAL run scan in document order, exactly like the extractor's field balancer — never
// per sibling list.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { attributeValueOf } from './tree-op-nodes.ts';

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

const COMMENT_MARKER_LOCAL_NAMES = new Set(['commentRangeStart', 'commentRangeEnd']);
const IMPORT_LOCAL_NAMES = new Set(['altChunk', 'subDoc']);

function isCommentReferenceRun(node: OoxmlNode): boolean {
  return node.kind === 'run' && node.children.some((child) => child.kind === 'commentReference');
}

/**
 * Field verbs that fetch remote content or invoke a command, matched case-insensitively on
 * the leading token of the instruction. INCLUDE* auto-fetch on field update (SSRF /
 * NetNTLM leak); DDE/DDEAUTO are the classic exec vectors; the rest reach a data source, a
 * template, or the shell.
 */
const DANGEROUS_FIELD_VERBS = new Set([
  'DDE',
  'DDEAUTO',
  'INCLUDE',
  'INCLUDEPICTURE',
  'INCLUDETEXT',
  'IMPORT',
  'LINK',
  'DATABASE',
  'AUTOTEXT',
  'AUTOTEXTLIST',
  'GOTOBUTTON',
  'MACROBUTTON',
  'PRINT',
  'ADDIN',
]);

function isDangerousInstruction(instruction: string | undefined): boolean {
  if (instruction === undefined) return false;
  const token = instruction.trim().replace(/^"+/, '').split(/\s+/, 1)[0] ?? '';
  return DANGEROUS_FIELD_VERBS.has(token.toUpperCase());
}

function fldCharTypeOf(run: OoxmlNode): 'begin' | 'separate' | 'end' | null {
  if (run.kind !== 'run') return null;
  for (const child of run.children) {
    if (child.kind === 'fldChar') {
      const type = attributeValueOf(child, 'fldCharType');
      return type === 'separate' || type === 'end' ? type : 'begin';
    }
  }
  return null;
}

function instrTextOf(run: OoxmlNode): string | null {
  if (run.kind !== 'run') return null;
  let text = '';
  let found = false;
  for (const child of run.children) {
    if (child.kind !== 'instrText') continue;
    found = true;
    for (const grand of child.children) {
      if (grand.kind === 'textValue') text += grand.value;
    }
  }
  return found ? text : null;
}

/**
 * Node ids of runs to DROP: the machinery, instruction, and pre-result content of every
 * dangerous complex field, scanned globally so a multi-paragraph field is one span.
 */
function dangerousComplexFieldRunIds(blocks: readonly OoxmlNode[]): Set<string> {
  interface Frame {
    dangerous: boolean;
    afterSeparate: boolean;
    machinery: string[];
    instr: string[];
    preResult: string[];
  }
  const stack: Frame[] = [];
  const drop = new Set<string>();
  const commit = (frame: Frame): void => {
    if (!frame.dangerous) return;
    for (const id of frame.machinery) drop.add(id);
    for (const id of frame.instr) drop.add(id);
    for (const id of frame.preResult) drop.add(id);
  };

  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'run') {
      const type = fldCharTypeOf(node);
      if (type === 'begin') {
        stack.push({
          dangerous: false,
          afterSeparate: false,
          machinery: [node.id],
          instr: [],
          preResult: [],
        });
        return;
      }
      const frame = stack[stack.length - 1];
      if (frame) {
        if (type === 'separate') {
          frame.afterSeparate = true;
          frame.machinery.push(node.id);
          return;
        }
        if (type === 'end') {
          frame.machinery.push(node.id);
          stack.pop();
          commit(frame);
          return;
        }
        const instr = instrTextOf(node);
        if (instr !== null) {
          frame.instr.push(node.id);
          if (isDangerousInstruction(instr)) frame.dangerous = true;
          return;
        }
        if (!frame.afterSeparate) frame.preResult.push(node.id);
        // Post-separate content (the cached result) is kept even for dangerous fields.
        return;
      }
      return; // a run outside any field
    }
    for (const child of node.children) visit(child);
  };
  for (const block of blocks) visit(block);
  // An unbalanced field (crafted, never closed) drops all its machinery so nothing leaks.
  while (stack.length > 0) {
    const frame = stack.pop()!;
    frame.dangerous = true;
    commit(frame);
  }
  return drop;
}

/** One tree rewrite: drop the marked run ids, strip structural elements, splice simple fields. */
function rewrite(node: OoxmlNode, dropIds: ReadonlySet<string>): OoxmlNode | 'drop' | OoxmlNode[] {
  if (node.kind === 'textValue') return node;

  if (node.namespaceUri === WML_NAMESPACE_URI) {
    if (
      COMMENT_MARKER_LOCAL_NAMES.has(node.localName) ||
      node.localName === 'sectPr' ||
      IMPORT_LOCAL_NAMES.has(node.localName)
    ) {
      return 'drop';
    }
  }
  if (isCommentReferenceRun(node)) return 'drop';
  if (dropIds.has(node.id)) return 'drop';

  // A simple dangerous field unlinks to its result runs, spliced into the parent.
  if (isWml(node, 'fldSimple') && isDangerousInstruction(attributeValueOf(node, 'instr'))) {
    return rewriteChildren(node.children, dropIds);
  }

  const children = rewriteChildren(node.children, dropIds);
  if (
    children.length === node.children.length &&
    children.every((child, index) => child === node.children[index])
  ) {
    return node;
  }
  return withChildren(node, children);
}

function rewriteChildren(
  children: readonly OoxmlNode[],
  dropIds: ReadonlySet<string>
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of children) {
    const result = rewrite(child, dropIds);
    if (result === 'drop') continue;
    if (Array.isArray(result)) out.push(...result);
    else out.push(result);
  }
  return out;
}

/**
 * Sanitize fragment blocks at the merge trust boundary. Idempotent on content the
 * extractor already cleaned, neutralizing on a crafted payload.
 */
export function sanitizeFragmentBlocks(blocks: readonly OoxmlNode[]): OoxmlNode[] {
  const dropIds = dangerousComplexFieldRunIds(blocks);
  return rewriteChildren(blocks, dropIds);
}
