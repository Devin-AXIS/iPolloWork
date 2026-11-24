// An exporter replays a metafile through the installed metafile renderer. Without one every
// metafile declines, and the exporter keeps its placeholder.

import { afterEach, expect, test } from 'bun:test';
import { replayMetafile } from '../metafile-replay.ts';
import {
  drawingRenderers,
  installDrawingRenderers,
} from '../../store/package/drawing-renderers.ts';

const installed = drawingRenderers().metafile;
afterEach(() => installDrawingRenderers({ metafile: installed }));
const measureText = () => 0;

test('without a metafile renderer a metafile does not replay', async () => {
  installDrawingRenderers({ metafile: undefined });
  expect(await replayMetafile(new Uint8Array(64), 'image/x-wmf', { measureText })).toBeNull();
});

test('a metafile replays through the installed renderer', async () => {
  const replay = { drawing: { width: 4, height: 2, commands: [] }, complete: true };
  installDrawingRenderers({ metafile: { replay: async () => replay } });
  expect(await replayMetafile(new Uint8Array(64), 'image/x-emf', { measureText })).toBe(replay);
});
