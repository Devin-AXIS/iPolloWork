import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileNativeVideo } from '../src/native-video.mjs';

export function projectFixture() {
  return {
    id: 'film-main', title: '短片工程', width: 1920, height: 1080,
    fps: { numerator: 30, denominator: 1 },
    tracks: [
      { id: 'picture', label: '视频', kind: 'video', clips: [
        { id: 'shot-1', label: '分镜一', startFrame: 0, durationFrames: 90, source: 'assets/one.mp4', sourceStartSeconds: 1, sourceDurationSeconds: 10 },
        { id: 'shot-2', label: '分镜二', startFrame: 90, durationFrames: 90, source: 'assets/two.mp4', sourceStartSeconds: 2, sourceDurationSeconds: 10, playbackRate: 2 },
      ] },
      { id: 'original-sound', label: '原声', kind: 'audio', clips: [
        { id: 'sound-1', label: '分镜一原声', startFrame: 0, durationFrames: 90, source: 'assets/one.mp4', sourceStartSeconds: 1, sourceDurationSeconds: 10, volume: 0.5 },
      ] },
      { id: 'voice', label: '配音', kind: 'audio', clips: [
        { id: 'voice-1', label: '旁白一', startFrame: 30, durationFrames: 120, source: 'assets/voice.wav', sourceDurationSeconds: 5 },
      ] },
      { id: 'music', label: '背景音乐', kind: 'audio', clips: [
        { id: 'music-1', label: '背景音乐', startFrame: 0, durationFrames: 180, source: 'assets/music.mp3', sourceStartSeconds: 5, sourceDurationSeconds: 60, volume: 0.15 },
      ] },
      { id: 'subtitles', label: '字幕', kind: 'caption', clips: [
        { id: 'line-1', label: '字幕一', startFrame: 30, durationFrames: 120, text: '每一个镜头都可以继续编辑。' },
      ] },
    ],
  };
}

test('hands off six independently editable clips on five tracks, not a flattened MP4', () => {
  const result = compileNativeVideo(projectFixture());
  assert.equal(result.clipCount, 6);
  assert.equal(result.durationSeconds, 6);
  assert.equal((result.html.match(/<video /g) ?? []).length, 2);
  assert.equal((result.html.match(/<audio /g) ?? []).length, 3);
  assert.equal((result.html.match(/data-ipw-caption="true"/g) ?? []).length, 1);
  assert.deepEqual([...new Set([...result.html.matchAll(/data-track-index="(\d+)"/g)].map(match => match[1]))], ['0', '1', '2', '3', '4']);
  assert.deepEqual(result.assetPaths, ['assets/music.mp3', 'assets/one.mp4', 'assets/two.mp4', 'assets/voice.wav']);
  assert.match(result.html, /data-start="3" data-duration="3"/);
  assert.match(result.html, /data-media-start="2" data-playback-rate="2"/);
  assert.match(result.html, /data-volume="0.15"/);
  assert.doesNotMatch(result.html, /https?:|\.play\(|<script|autoplay/);
});

test('compilation is deterministic and does not reorder or modify the source project', () => {
  const project = projectFixture();
  project.tracks[0].clips.reverse();
  const before = structuredClone(project);
  const first = compileNativeVideo(project);
  assert.deepEqual(project, before);
  assert.deepEqual(compileNativeVideo(project), first);
});

test('fractional frame rates preserve timing without integer-fps drift', () => {
  const project = projectFixture();
  project.fps = { numerator: 30000, denominator: 1001 };
  assert.ok(Math.abs(compileNativeVideo(project).durationSeconds - 6.006) < 1e-10);
});

test('captions and labels are inert editable text, not executable markup', () => {
  const project = projectFixture();
  project.title = '<img src=x onerror=alert(1)>';
  project.tracks[4].clips[0].text = '</span><script>alert(1)</script>';
  const { html } = compileNativeVideo(project);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test('multiple sound sources can overlap across independent tracks', () => {
  const project = projectFixture();
  project.tracks[2].clips[0].muted = true;
  const { html } = compileNativeVideo(project);
  assert.match(html, /id="clip-voice-1"[^>]+data-volume="0" muted/);
  assert.match(html, /id="clip-music-1"[^>]+data-volume="0.15"/);
});

test('visual overlays are separate image clips', () => {
  const project = projectFixture();
  project.tracks.push({ id: 'logo', label: '图片', kind: 'image', clips: [
    { id: 'logo-1', label: '封面', startFrame: 0, durationFrames: 30, source: 'assets/cover.webp' },
  ] });
  assert.match(compileNativeVideo(project).html, /<img id="clip-logo-1"[^>]+data-track-index="5"/);
});

for (const [name, mutate, expected] of [
  ['overlapping clips on one track', p => { p.tracks[0].clips[1].startFrame = 89; }, /重叠/],
  ['duplicate clip identity', p => { p.tracks[0].clips[1].id = 'shot-1'; }, /片段 ID 重复/],
  ['duplicate track identity', p => { p.tracks[1].id = 'picture'; }, /轨道 ID 重复/],
  ['missing source duration', p => { delete p.tracks[0].clips[0].sourceDurationSeconds; }, /源素材时长/],
  ['invalid speed', p => { p.tracks[0].clips[0].playbackRate = 0; }, /播放速度/],
  ['source overrun at speed', p => { p.tracks[0].clips[1].sourceDurationSeconds = 7; }, /超出源素材/],
  ['negative start', p => { p.tracks[0].clips[0].startFrame = -1; }, /片段起点/],
  ['fractional frame count', p => { p.tracks[0].clips[0].durationFrames = 4.5; }, /片段时长/],
  ['nonfinite fps', p => { p.fps.numerator = Infinity; }, /帧率/],
  ['muted string', p => { p.tracks[1].clips[0].muted = 'false'; }, /布尔/],
  ['oversize project', p => { p.tracks[0].clips[0].startFrame = 30 * 3600; }, /最长/],
  ['empty project', p => { p.tracks.forEach(t => { t.clips = []; }); }, /空工程/],
]) {
  test(`rejects ${name} instead of silently flattening or losing data`, () => {
    const project = projectFixture();
    mutate(project);
    assert.throws(() => compileNativeVideo(project), expected);
  });
}

for (const path of ['../secret.mp4', 'assets/../secret.mp4', 'assets//one.mp4', 'https://example.com/a.mp4', 'file:///tmp/a.mp4', 'assets/%2e%2e/a.mp4', 'assets/a.mp4?token=secret', 'assets/a.mp4" onerror="x', 'assets/run.html']) {
  test(`rejects nonportable or unsafe asset path: ${path}`, () => {
    const project = projectFixture();
    project.tracks[0].clips[0].source = path;
    assert.throws(() => compileNativeVideo(project), /素材/);
  });
}
