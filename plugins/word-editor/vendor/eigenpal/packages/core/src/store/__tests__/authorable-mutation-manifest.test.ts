// Frozen authorable mutation manifest (full-document-yjs-collaboration task 0.5).
//
// The JSON in openspec/ is the freeze. This test rebuilds the mechanical inventory
// from production constants and fails when the freeze drifts.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CHROME_GROUPS, chromeSlotId } from '../../editor/chrome-controls.ts';
import { chromeProbeForSlot, commandForSlot } from '../../editor/toolbar-commands.ts';
import {
  withBinaryPart,
  withContentTypeOverride,
  withEmbeddedImage,
  withNewPart,
  withoutUnreferencedImagePart,
  withPart,
  withRelationship,
} from '../package/index.ts';
import { IMAGE_WRAP_TARGETS } from '../package/drawing-projection.ts';
import { isHeaderFooterLifecycleOp } from '../package/hf-lifecycle.ts';
import { isNoteLifecycleOp } from '../package/note-lifecycle.ts';
import { ensureListDefinition, ensureNumberingLevel } from '../package/numbering-part.ts';
import { withoutPart, withRelationshipsPartFor } from '../package/package-edit.ts';
import {
  addComment,
  insertCustomNodeWrite,
  removeCustomNodeWrite,
  setCommentResolved,
} from '../store/index.ts';
import {
  INSERTABLE_CONTENT_CONTROL_TYPES,
  TREE_OP_REACH_CLASSIFIED,
} from '../store/tree-op-content-controls.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  TREE_DOC_OP_KINDS,
  type TreeDocOp,
} from '../store/tree-ops.ts';
import { COLLABORATION_UNCOVERED } from '../store/collaboration-coverage-contract.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';

const repoRoot = path.resolve(import.meta.dir, '../../../../../');
const manifestPath = path.join(
  repoRoot,
  'openspec/changes/full-document-yjs-collaboration/authorable-mutation-manifest.json'
);

type Manifest = {
  readonly treeDocOpKinds: readonly string[];
  readonly applyPathSets: {
    readonly singlePart: readonly string[];
    readonly headerFooterLifecycle: readonly string[];
    readonly noteLifecycle: readonly string[];
    readonly unsupported: readonly string[];
  };
  readonly chromeSlots: {
    readonly all: readonly string[];
    readonly commandWired: readonly string[];
    readonly probe: readonly string[];
  };
  readonly authorableVariants: {
    readonly setRunProperties: { readonly localNames: readonly string[] };
    readonly setParagraphProperties: { readonly localNames: readonly string[] };
    readonly insertContentControl: { readonly type: readonly string[] };
    readonly setDrawingWrap: { readonly wrap: readonly string[] };
  };
  readonly packageIntents: readonly { readonly name: string }[];
  readonly openSpecDependencies: readonly { readonly name: string }[];
  readonly operations: readonly { readonly kind: string }[];
  readonly counts: {
    readonly treeDocOpKinds: number;
    readonly singlePartApply: number;
    readonly headerFooterLifecycle: number;
    readonly noteLifecycle: number;
    readonly treeDocOpUnsupported: number;
    readonly chromeSlots: number;
    readonly chromeCommandWired: number;
    readonly chromeProbe: number;
  };
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

function chromeSlots(): string[] {
  return CHROME_GROUPS.flatMap((group) =>
    group.controls.map((control) => chromeSlotId(group, control))
  );
}

function dummyPart() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('authorable mutation manifest freeze (task 0.5)', () => {
  test('TREE_DOC_OP_KINDS matches the frozen kind list in order', () => {
    expect([...TREE_DOC_OP_KINDS]).toEqual([...manifest.treeDocOpKinds]);
    expect(TREE_DOC_OP_KINDS.length).toBe(manifest.counts.treeDocOpKinds);
  });

  test('every frozen operation row names one kind, with no extras or gaps', () => {
    expect(manifest.operations.map((row) => row.kind)).toEqual([...manifest.treeDocOpKinds]);
  });

  test('apply-path partitions cover every kind exactly once', () => {
    const { singlePart, headerFooterLifecycle, noteLifecycle, unsupported } =
      manifest.applyPathSets;
    const union = [...singlePart, ...headerFooterLifecycle, ...noteLifecycle, ...unsupported];
    expect([...union].sort()).toEqual([...TREE_DOC_OP_KINDS].sort());
    expect(new Set(union).size).toBe(union.length);
    expect(singlePart).toHaveLength(manifest.counts.singlePartApply);
    expect(headerFooterLifecycle).toHaveLength(manifest.counts.headerFooterLifecycle);
    expect(noteLifecycle).toHaveLength(manifest.counts.noteLifecycle);
    expect(unsupported).toHaveLength(manifest.counts.treeDocOpUnsupported);
  });

  test('lifecycle classifiers still match the frozen header/footer and note sets', () => {
    const hf = TREE_DOC_OP_KINDS.filter((kind) => isHeaderFooterLifecycleOp({ op: kind }));
    const notes = TREE_DOC_OP_KINDS.filter((kind) => isNoteLifecycleOp({ op: kind }));
    expect(hf).toEqual([...manifest.applyPathSets.headerFooterLifecycle]);
    expect(notes).toEqual([...manifest.applyPathSets.noteLifecycle]);
  });

  test('reach classification covers the whole op vocabulary', () => {
    const unclassified = TREE_DOC_OP_KINDS.filter((kind) => !TREE_OP_REACH_CLASSIFIED.has(kind));
    expect(unclassified).toEqual([]);
  });

  test('repeating-section kinds stay unsupported on validate and apply', () => {
    const part = dummyPart();
    for (const kind of manifest.applyPathSets.unsupported) {
      const op = { op: kind, controlId: 'missing' } as TreeDocOp;
      const applied = applyTreeOp(part, op);
      expect(applied.ok).toBe(false);
      if (!applied.ok) expect(applied.reason).toBe('unsupported');
    }
  });

  test('the frozen unsupported set matches the collaboration coverage contract', () => {
    // The manifest freeze and the contract that gates collaboration coverage name the same
    // not-expressible ops, so a change that promotes one to replicable cannot leave the other
    // claiming it is still unsupported.
    expect([...COLLABORATION_UNCOVERED.opKinds.keys()].sort()).toEqual(
      [...manifest.applyPathSets.unsupported].sort()
    );
  });

  test('property, control, and wrap vocabularies match the freeze', () => {
    expect([...ACCEPTED_RUN_PROPERTIES]).toEqual([
      ...manifest.authorableVariants.setRunProperties.localNames,
    ]);
    expect([...ACCEPTED_PARAGRAPH_PROPERTIES]).toEqual([
      ...manifest.authorableVariants.setParagraphProperties.localNames,
    ]);
    expect([...INSERTABLE_CONTENT_CONTROL_TYPES]).toEqual([
      ...manifest.authorableVariants.insertContentControl.type,
    ]);
    expect([...IMAGE_WRAP_TARGETS]).toEqual([...manifest.authorableVariants.setDrawingWrap.wrap]);
  });

  test('chrome slots, wired commands, and probes match the freeze', () => {
    const slots = chromeSlots();
    expect(slots).toEqual([...manifest.chromeSlots.all]);
    expect(slots).toHaveLength(manifest.counts.chromeSlots);
    const wired = slots.filter((slot) => commandForSlot(slot) !== null);
    const probe = slots.filter(
      (slot) => commandForSlot(slot) === null && chromeProbeForSlot(slot) !== null
    );
    expect(wired).toEqual([...manifest.chromeSlots.commandWired]);
    expect(probe).toEqual([...manifest.chromeSlots.probe]);
    expect(wired).toHaveLength(manifest.counts.chromeCommandWired);
    expect(probe).toHaveLength(manifest.counts.chromeProbe);
  });

  test('named package intent functions still exist', () => {
    const named = {
      withPart,
      withNewPart,
      withoutPart,
      withRelationshipsPartFor,
      withRelationship,
      withContentTypeOverride,
      withBinaryPart,
      withEmbeddedImage,
      withoutUnreferencedImagePart,
      addComment,
      setCommentResolved,
      insertCustomNodeWrite,
      removeCustomNodeWrite,
      ensureListDefinition,
      ensureNumberingLevel,
    };
    for (const row of manifest.packageIntents) {
      if (row.name === 'replacePackageShell') continue;
      expect(typeof named[row.name as keyof typeof named]).toBe('function');
    }
  });

  test('active OpenSpec change directories match the frozen dependency names', () => {
    const changesDir = path.join(repoRoot, 'openspec/changes');
    const live = readdirSync(changesDir)
      .filter((entry) => entry !== 'archive')
      .filter((entry) => statSync(path.join(changesDir, entry)).isDirectory())
      .sort();
    const frozen = manifest.openSpecDependencies.map((row) => row.name).sort();
    expect(live).toEqual(frozen);
  });
});
