/**
 * Cross-adapter composable differential — React harness over the shared table.
 */
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useEditorCommand } from '../src/editor/useEditorCommand.ts';
import { useZoom } from '../src/editor/useZoom.ts';
import {
  SEARCH_MATCH_LIMIT,
  SEARCH_DEBOUNCE_MS,
  useDocumentSearch,
} from '../src/editor/navigation/useDocumentSearch.ts';
import { usePageSetup } from '../src/editor/usePageSetup.ts';
import {
  COMPOSABLE_PARITY_CASES,
  DIFFERENTIAL_SOURCE,
  OFF_LADDER_ZOOM,
  SEARCH_HEAVY_SOURCE,
  offLadderZoomIn,
} from './cross-adapter-composable-cases.ts';

function mountReact(
  source: Uint8Array,
  probe: () => null,
  onReady: (editor: DocxEditorInstance) => void = () => {}
) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    createElement(
      DocxEditorRoot,
      {
        document: source,
        onReady: (editor) => {
          instance = editor as DocxEditorInstance;
          onReady(instance);
        },
      },
      createElement(
        DocxEditorViewport,
        null,
        createElement(DocxEditorContent),
        createElement(probe)
      )
    )
  );
  return { view, editor: () => instance! };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
}

afterEach(cleanup);

describe('cross-adapter differential (React harness)', () => {
  for (const parityCase of COMPOSABLE_PARITY_CASES) {
    test(parityCase.id, async () => {
      if (parityCase.composable === 'useEditorCommand') {
        let binding: ReturnType<typeof useEditorCommand> | null = null;
        const Probe = () => {
          binding = useEditorCommand(parityCase.slot);
          return null;
        };
        const { view, editor } = mountReact(DIFFERENTIAL_SOURCE, Probe);
        await settle();
        expect(() =>
          parityCase.assert(
            {
              isEnabled: binding!.isEnabled,
              isActive: binding!.isActive,
              disabledReason: binding!.disabledReason,
            },
            editor()
          )
        ).not.toThrow();
        view.unmount();
        return;
      }

      if (parityCase.composable === 'useZoom') {
        let zoomApi: ReturnType<typeof useZoom> | null = null;
        const Probe = () => {
          zoomApi = useZoom();
          return null;
        };
        const { view, editor } = mountReact(DIFFERENTIAL_SOURCE, Probe);
        await settle();
        act(() => {
          editor().setZoom(OFF_LADDER_ZOOM);
        });
        await settle();
        act(() => {
          zoomApi!.zoomIn();
        });
        await settle();
        expect(offLadderZoomIn()).toBe(
          (await import('../../vue/src/editor/zoom-levels.ts')).stepZoomLevel(OFF_LADDER_ZOOM, 'in')
        );
        expect(() =>
          parityCase.assert({
            scale: zoomApi!.zoom,
            canZoomIn: zoomApi!.canZoomIn,
            expectedStepIn: offLadderZoomIn(),
          })
        ).not.toThrow();
        view.unmount();
        return;
      }

      if (parityCase.composable === 'useDocumentSearch') {
        let searchApi: ReturnType<typeof useDocumentSearch> | null = null;
        const Probe = () => {
          searchApi = useDocumentSearch();
          return null;
        };
        const { view } = mountReact(SEARCH_HEAVY_SOURCE, Probe);
        await settle();
        act(() => {
          searchApi!.setQuery('a');
        });
        await act(async () => {
          await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 100));
        });
        expect(() =>
          parityCase.assert({
            truncated: searchApi!.truncated,
            matchCount: searchApi!.matches.length,
            limit: SEARCH_MATCH_LIMIT,
          })
        ).not.toThrow();
        view.unmount();
        return;
      }

      if (parityCase.composable === 'usePageSetup') {
        let pageSetupApi: ReturnType<typeof usePageSetup> | null = null;
        const Probe = () => {
          pageSetupApi = usePageSetup();
          return null;
        };
        const { view, editor } = mountReact(DIFFERENTIAL_SOURCE, Probe);
        await settle();
        const widthBefore = editor().getPageSetup()!.pageWidthTwips;
        act(() => {
          pageSetupApi!.apply({ pageWidthTwips: widthBefore + 144 });
        });
        const widthAfterApply = editor().getPageSetup()!.pageWidthTwips;
        act(() => {
          editor().exec({ type: 'undo' });
        });
        const widthAfterUndo = editor().getPageSetup()!.pageWidthTwips;
        expect(() =>
          parityCase.assert({ widthBefore, widthAfterApply, widthAfterUndo })
        ).not.toThrow();
        view.unmount();
      }
    });
  }
});
