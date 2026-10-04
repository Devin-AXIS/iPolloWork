import { test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileNativeVideo } from '../src/native-video.mjs';

// Development-only probe of the actual installed host; no host source is copied
// or imported by the distributable plugin. Fail, rather than silently skip.
const hostRoot = process.env.IPOLLOWORK_SOURCE_ROOT;
if (!hostRoot) throw new Error('Set IPOLLOWORK_SOURCE_ROOT to the iPolloWork checkout for this compatibility check.');
const load = (path: string) => import(pathToFileURL(resolve(hostRoot, path)).href);
const { parseHTMLContent } = await load('vendor/hyperframes/packages/core/src/compiler/htmlDocument.ts');
const { extractResolvedMedia, compileTimingAttrs } = await load('vendor/hyperframes/packages/core/src/compiler/timingCompiler.ts');
const { createTimelineElementFromManifestClip } = await load('vendor/hyperframes/packages/studio/src/player/lib/timelineDOM.ts');

test('the real host recognizes independent clips, offsets and authored tracks', () => {
  const { html } = compileNativeVideo({
    id: 'compat-film', title: '交接验证', width: 1920, height: 1080,
    fps: { numerator: 30, denominator: 1 },
    tracks: [
      { id: 'pictures', label: '视频轨', kind: 'video', clips: [
        { id: 'shot', label: '镜头', startFrame: 60, durationFrames: 90, source: 'assets/shot.mp4', sourceStartSeconds: 1, sourceDurationSeconds: 10, playbackRate: 2 },
      ] },
      { id: 'narration', label: '配音轨', kind: 'audio', clips: [
        { id: 'voice', label: '配音', startFrame: 60, durationFrames: 90, source: 'assets/voice.wav', sourceDurationSeconds: 6, volume: 0.7 },
      ] },
      { id: 'music', label: '音乐轨', kind: 'audio', clips: [
        { id: 'bgm', label: '音乐', startFrame: 0, durationFrames: 180, source: 'assets/music.mp3', sourceDurationSeconds: 30, volume: 0.2 },
      ] },
    ],
  });
  const compiled = compileTimingAttrs(html);
  expect(compiled.unresolved).toEqual([]);
  const media = extractResolvedMedia(compiled.html);
  expect(media).toHaveLength(3);
  expect(media[0]).toMatchObject({ id: 'clip-shot', start: 2, duration: 3, mediaStart: 1 });
  const doc = parseHTMLContent(compiled.html);
  const clips = media.map((item: { id: string; tagName: string; start: number; duration: number }, i: number) => {
    const node = doc.getElementById(item.id);
    return createTimelineElementFromManifestClip({
      clip: {
        ...item, kind: item.tagName, track: Number(node.getAttribute('data-track-index')),
        timelineClipLabel: node.getAttribute('data-timeline-clip-label'), assetUrl: node.getAttribute('src'),
      },
      fallbackIndex: i,
    });
  });
  expect(clips.map((item: { authoredTrack: number }) => item.authoredTrack)).toEqual([0, 1, 2]);
  expect(clips[0]).toMatchObject({ id: 'clip-shot', clipLabel: '镜头', start: 2, duration: 3, src: 'assets/shot.mp4' });
  expect(doc.getElementById('clip-shot').getAttribute('data-playback-rate')).toBe('2');
  expect(doc.getElementById('clip-shot').getAttribute('data-source-duration')).toBe('10');
  expect(doc.getElementById('clip-voice').getAttribute('data-volume')).toBe('0.7');
  expect(doc.getElementById('clip-bgm').getAttribute('data-volume')).toBe('0.2');
});
