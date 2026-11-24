// Bounded scan of one paragraph for its LISTNUM fields, in reading order.
//
// The anchor of each field is the node id the field projection keys synthesis on: the begin
// `w:fldChar` of a complex field, or the `w:fldSimple` element. Only outermost fields count:
// a LISTNUM nested in another field's instruction or result is part of that field. A field
// inside a deletion does not count, because accepting the deletion removes it.

import {
  fldSimpleInstr,
  isFldSimple,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { walkStoryParagraphs } from './story-paragraph-walk.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import {
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  effectiveFieldInstruction,
  ingestInstrTextBounded,
  isFldChar,
  isInstrText,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
} from './field-instruction.ts';
import { parseListNumInstruction, type ListNumFieldSpec } from './field-listnum.ts';
import { isDrawingHost } from './field-ref-text.ts';
import { isRevisionWrapper, revisionAttributionOf } from './revision-projection.ts';

/** Most LISTNUM fields counted in one paragraph; later ones keep their previous rendering. */
const MAX_LISTNUM_FIELDS_PER_PARAGRAPH = 64;

/** One LISTNUM field of a paragraph. */
export interface ScannedListNumField {
  readonly anchorId: string;
  readonly spec: ListNumFieldSpec;
}

const NO_FIELDS: readonly ScannedListNumField[] = Object.freeze([]);
const scans = new WeakMap<OoxmlElement, readonly ScannedListNumField[]>();
const signatures = new WeakMap<readonly ScannedListNumField[], string>();

/** Whether a deletion encloses the content: then it does not exist once changes resolve. */
function isDeletion(node: OoxmlElement): boolean {
  const kind = revisionAttributionOf(node)?.kind;
  return kind === 'delete' || kind === 'moveFrom';
}

/** The paragraph's LISTNUM fields, memoized per immutable paragraph node. */
export function listNumFieldsOf(paragraph: OoxmlElement): readonly ScannedListNumField[] {
  const memo = scans.get(paragraph);
  if (memo) return memo;
  let fields: ScannedListNumField[] | null = null;
  const budget = createScanBudget();
  const field = createFieldParseState();
  let beginId: string | null = null;
  let captured = false;
  let deletedDepth = 0;

  const capture = (): void => {
    if (captured || field.nesting !== 1 || field.phase !== 'instruction') return;
    if (field.nestingOverflow || beginId === null) return;
    captured = true;
    const effective = effectiveFieldInstruction(field);
    if (effective.overflow || deletedDepth > 0) return;
    const spec = parseListNumInstruction(effective.instruction);
    if (spec && (fields?.length ?? 0) < MAX_LISTNUM_FIELDS_PER_PARAGRAPH) {
      (fields ??= []).push({ anchorId: beginId, spec });
    }
  };

  const visit = (node: OoxmlNode, depth: number, containerDepth: number): void => {
    if (node.kind === 'textValue') return;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (budget.exhausted || depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'run') {
      for (const grand of node.children) {
        if (!consumeScanNode(budget)) return;
        if (isFldChar(grand, 'begin')) {
          onFldCharBegin(field);
          if (field.nesting === 1) {
            beginId = grand.id;
            captured = false;
          }
        } else if (isInstrText(grand)) {
          ingestInstrTextBounded(field, grand, budget, depth + 1);
        } else if (isFldChar(grand, 'separate')) {
          capture();
          onFldCharSeparate(field);
        } else if (isFldChar(grand, 'end')) {
          capture();
          onFldCharEnd(field);
        }
      }
      return;
    }
    if (isFldSimple(node)) {
      const spec = field.nesting === 0 ? parseListNumInstruction(fldSimpleInstr(node) ?? '') : null;
      if (spec && deletedDepth === 0 && (fields?.length ?? 0) < MAX_LISTNUM_FIELDS_PER_PARAGRAPH) {
        (fields ??= []).push({ anchorId: node.id, spec });
      }
      return;
    }
    if (isDrawingHost(node)) return;
    if (!consumeScanNode(budget)) return;
    const deletion = isRevisionWrapper(node) && isDeletion(node);
    if (deletion) deletedDepth += 1;
    const nextDepth = nextInlineContainerDepth(node, containerDepth);
    for (const child of node.children) visit(child, depth + 1, nextDepth);
    if (deletion) deletedDepth -= 1;
  };
  for (const child of paragraph.children) {
    if (!consumeScanNode(budget)) break;
    visit(child, 1, 0);
  }
  const result = fields ?? NO_FIELDS;
  scans.set(paragraph, result);
  return result;
}

/** A value equal for two paragraphs exactly when their LISTNUM fields count alike. */
export function listNumSignatureOf(paragraph: OoxmlElement): string {
  const fields = listNumFieldsOf(paragraph);
  if (fields.length === 0) return '';
  let signature = signatures.get(fields);
  if (signature === undefined) {
    signature = JSON.stringify(
      fields.map((f) => [f.anchorId, f.spec.name, f.spec.level, f.spec.start])
    );
    signatures.set(fields, signature);
  }
  return signature;
}

const blockHasListNum = new WeakMap<OoxmlElement, boolean>();

/** Whether any paragraph of the story's blocks holds a LISTNUM field; memoized per block. */
export function storyHasListNumFields(blocks: readonly OoxmlElement[]): boolean {
  for (const block of blocks) {
    let has = blockHasListNum.get(block);
    if (has === undefined) {
      has = walkStoryParagraphs([block], 8, true).some(
        (paragraph) => listNumFieldsOf(paragraph).length > 0
      );
      blockHasListNum.set(block, has);
    }
    if (has) return true;
  }
  return false;
}
