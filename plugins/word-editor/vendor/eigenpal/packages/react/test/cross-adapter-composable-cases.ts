import { CHROME_GROUPS, chromeSlotId, toolbarCommandState } from '@docx-editor.dev/core/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { createT, en, localizeDisabledReason } from '@docx-editor.dev/i18n';
import { zipSync, strToU8 } from 'fflate';
import { stepZoomLevel } from '../../react/src/editor/zoom-levels.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const translate = createT(en);

export function differentialDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const DIFFERENTIAL_SOURCE = differentialDocx(
  '<w:p><w:r><w:t>parity differential</w:t></w:r></w:p>'
);

export const SEARCH_HEAVY_SOURCE = differentialDocx(
  `<w:p><w:r><w:t>${'a '.repeat(5000)}</w:t></w:r></w:p>`
);

export const DIFFERENTIAL_SLOTS = CHROME_GROUPS.flatMap((group) =>
  group.controls.map((control) => chromeSlotId(group, control))
);

export const OFF_LADDER_ZOOM = 0.73;

export function offLadderZoomIn(): number | null {
  return stepZoomLevel(OFF_LADDER_ZOOM, 'in');
}

export interface CommandObservation {
  readonly isEnabled: boolean;
  readonly isActive: boolean;
  readonly disabledReason: string | null;
}

export interface ZoomObservation {
  readonly scale: number;
  readonly canZoomIn: boolean;
  readonly expectedStepIn: number | null;
}

export interface SearchObservation {
  readonly truncated: boolean;
  readonly matchCount: number;
  readonly limit: number;
}

export interface PageSetupObservation {
  readonly widthBefore: number;
  readonly widthAfterApply: number;
  readonly widthAfterUndo: number;
}

export type ComposableObservation =
  | { readonly kind: 'useEditorCommand'; readonly command: CommandObservation }
  | { readonly kind: 'useZoom'; readonly zoom: ZoomObservation }
  | { readonly kind: 'useDocumentSearch'; readonly search: SearchObservation }
  | { readonly kind: 'usePageSetup'; readonly pageSetup: PageSetupObservation };

export type ComposableParityCase =
  | {
      readonly id: string;
      readonly composable: 'useEditorCommand';
      readonly slot: ChromeSlotId;
      readonly assert: (observation: CommandObservation, editor: DocxEditorInstance) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'useZoom';
      readonly assert: (observation: ZoomObservation) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'useDocumentSearch';
      readonly assert: (observation: SearchObservation) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'usePageSetup';
      readonly assert: (observation: PageSetupObservation) => void;
    };

export const COMPOSABLE_PARITY_CASES: readonly ComposableParityCase[] = [
  ...DIFFERENTIAL_SLOTS.map(
    (slot): ComposableParityCase => ({
      id: `useEditorCommand:${slot}`,
      composable: 'useEditorCommand',
      slot,
      assert(binding, editor) {
        const engine = toolbarCommandState(editor, slot);
        if (binding.isEnabled !== engine.enabled) {
          throw new Error(`enabled mismatch for ${slot}`);
        }
        if (binding.isActive !== engine.active) {
          throw new Error(`active mismatch for ${slot}`);
        }
        if (
          (binding.disabledReason ?? null) !==
          localizeDisabledReason(engine.disabledReason ?? null, translate)
        ) {
          throw new Error(`disabledReason mismatch for ${slot}`);
        }
      },
    })
  ),
  {
    id: 'useZoom:offLadder',
    composable: 'useZoom',
    assert(observation) {
      const expected = offLadderZoomIn();
      if (expected === null) throw new Error('expected a step-up rung');
      if (observation.scale !== expected) {
        throw new Error(`off-ladder zoom step mismatch: ${observation.scale} vs ${expected}`);
      }
      if (observation.expectedStepIn !== expected) {
        throw new Error('expectedStepIn disagrees with ladder');
      }
      if (!observation.canZoomIn) {
        throw new Error('canZoomIn should stay true after stepping up');
      }
    },
  },
  {
    id: 'useDocumentSearch:cap',
    composable: 'useDocumentSearch',
    assert(observation) {
      if (!observation.truncated) throw new Error('search results should be truncated at the cap');
      if (observation.matchCount !== observation.limit) {
        throw new Error('truncated search should report the engine cap as the match count');
      }
      if (!(observation.limit > 0)) throw new Error('search cap must be positive');
    },
  },
  {
    id: 'usePageSetup:undo',
    composable: 'usePageSetup',
    assert(observation) {
      if (observation.widthAfterApply !== observation.widthBefore + 144) {
        throw new Error('page setup write did not apply');
      }
      if (observation.widthAfterUndo !== observation.widthBefore) {
        throw new Error('page setup undo did not restore width');
      }
    },
  },
];
