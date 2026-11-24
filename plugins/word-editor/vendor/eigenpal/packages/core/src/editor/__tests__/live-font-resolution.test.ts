import { expect, test } from 'bun:test';
import {
  createLiveFontResolution,
  requestFaces,
  type LiveFontRequest,
} from '../live-font-resolution.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('static configurations scan document font needs once on load and never on edits', async () => {
  let scans = 0;
  let resolutions = 0;
  const queue = createLiveFontResolution(
    () => ({
      generation: 1,
      dynamic: false,
      families: () => {
        scans++;
        return ['Calibri'];
      },
    }),
    async () => {
      resolutions++;
    }
  );
  queue.schedule(true);
  await tick();
  queue.schedule();
  await tick();
  // The load scan feeds the substitution plan: a family the configuration lacks needs it.
  expect(resolutions).toBe(1);
  expect(scans).toBe(1);
});

test('late faces install after the resolution in flight, and only for their generation', async () => {
  let generation = 1;
  const order: string[] = [];
  let finishFirst!: () => void;
  const queue = createLiveFontResolution<string>(
    () => ({ generation, dynamic: true, families: () => ['Calibri'] }),
    async (_families, late) => {
      order.push(late ?? 'resolve');
      if (!late) await new Promise<void>((resolve) => (finishFirst = resolve));
    }
  );
  queue.schedule(true);
  queue.deliver(1, 'late');
  await tick();
  expect(order).toEqual(['resolve']);
  finishFirst();
  await tick();
  expect(order).toEqual(['resolve', 'late']);

  generation = 2;
  queue.schedule(true);
  finishFirst();
  await tick();
  queue.deliver(1, 'stale');
  await tick();
  expect(order).toEqual(['resolve', 'late', 'resolve']);
});

test('a face that text uses for the first time asks again for its family', async () => {
  let faces: { family: string; weight: number; style: 'normal' | 'italic' }[] = [
    { family: 'Arial', weight: 400, style: 'normal' },
    { family: 'Calibri', weight: 400, style: 'normal' },
  ];
  const requests: LiveFontRequest[] = [];
  const queue = createLiveFontResolution(
    () => ({
      generation: 1,
      dynamic: true,
      families: () => ['Arial'],
      faces: () => faces,
      defaultFamily: 'Calibri',
    }),
    async (request) => void requests.push(request)
  );
  queue.schedule(true);
  await tick();
  expect(requests).toEqual([{ families: ['Arial'], faces, documentFamilies: ['Arial'] }]);
  // An edit with no new face asks nothing.
  queue.schedule();
  await tick();
  expect(requests).toHaveLength(1);
  // A bold word: its family again, with the faces of that family. The default family stays
  // out of `families`: the request names it apart.
  faces = [...faces, { family: 'Arial', weight: 700, style: 'normal' }];
  queue.schedule();
  await tick();
  expect(requests[1]).toEqual({
    families: ['Arial'],
    documentFamilies: ['Arial'],
    faces: [
      { family: 'Arial', weight: 400, style: 'normal' },
      { family: 'Arial', weight: 700, style: 'normal' },
    ],
  });
  faces = [...faces, { family: 'Calibri', weight: 400, style: 'italic' }];
  queue.schedule();
  await tick();
  expect(requests[2]).toEqual({
    families: [],
    documentFamilies: ['Arial'],
    faces: [
      { family: 'Calibri', weight: 400, style: 'normal' },
      { family: 'Calibri', weight: 400, style: 'italic' },
    ],
  });
});

test('before any layout, the request names no faces', async () => {
  const requests: LiveFontRequest[] = [];
  const queue = createLiveFontResolution(
    () => ({ generation: 1, dynamic: true, families: () => ['Arial'], faces: () => undefined }),
    async (request) => void requests.push(request)
  );
  queue.schedule(true);
  await tick();
  expect(requests).toEqual([{ families: ['Arial'], documentFamilies: ['Arial'] }]);
});

test('requestFaces names a run with no font by the default family, once', () => {
  expect(
    requestFaces(
      [
        { family: null, weight: 400, style: 'normal' },
        { family: 'Calibri', weight: 400, style: 'normal' },
        { family: ' ', weight: 700, style: 'normal' },
      ],
      'Calibri'
    )
  ).toEqual([
    { family: 'Calibri', weight: 400, style: 'normal' },
    { family: 'Calibri', weight: 700, style: 'normal' },
  ]);
  expect(requestFaces([], 'Calibri')).toBeUndefined();
  expect(requestFaces(undefined, 'Calibri')).toBeUndefined();
});

test('a family first asked for with no faces never asks again for a face of it', async () => {
  const laidOut: { faces?: { family: string; weight: number; style: 'normal' | 'italic' }[] } = {};
  const requests: LiveFontRequest[] = [];
  const queue = createLiveFontResolution(
    () => ({
      generation: 1,
      dynamic: true,
      families: () => ['Arial'],
      faces: () => laidOut.faces,
      defaultFamily: 'Calibri',
    }),
    async (request) => void requests.push(request)
  );
  // A large open: fonts resolve before the first layout, for every face.
  queue.schedule(true);
  await tick();
  laidOut.faces = [
    { family: 'Arial', weight: 700, style: 'normal' },
    { family: 'Calibri', weight: 400, style: 'italic' },
  ];
  queue.schedule();
  await tick();
  expect(requests).toEqual([{ families: ['Arial'], documentFamilies: ['Arial'] }]);
});

test('requestFaces names the caret face first, so a picked face loads before typing', () => {
  expect(
    requestFaces([{ family: 'Arial', weight: 400, style: 'normal' }], 'Calibri', {
      fontFamily: 'Georgia',
      bold: true,
    })
  ).toEqual([
    { family: 'Georgia', weight: 700, style: 'normal' },
    { family: 'Arial', weight: 400, style: 'normal' },
  ]);
});
