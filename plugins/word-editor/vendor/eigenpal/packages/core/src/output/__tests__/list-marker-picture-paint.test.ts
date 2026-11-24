// Browser sink for `w:lvlPicBulletId` markers, and every way it degrades to the level text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { paintListMarkerPicture } from '../semantic-paint-list-marker-picture.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import type { ParagraphFragmentRecord } from '../../layout/semantic-records.ts';

function readyResource(mime: ImageResourceState extends { mime: infer M } ? M : never) {
  return Object.freeze({
    kind: 'ready',
    partName: '/word/media/bullet',
    contentId: 'content',
    resourceKey: 'resource',
    validatedHandle: { resourceKey: 'resource' },
    mime,
    pixelWidth: 12,
    pixelHeight: 12,
    dpiX: 96,
    dpiY: 96,
  }) as unknown as ImageResourceState;
}

/** A fragment carrying only what this sink reads: its own box and the marker's picture. */
function fragmentWith(resource: ImageResourceState): ParagraphFragmentRecord {
  return {
    box: { x: 10, y: 100, width: 400, height: 20 },
    marker: {
      text: '•',
      picture: {
        ownerPartName: '/word/numbering.xml',
        relationshipId: 'rId1',
        box: { x: 18, y: 105, width: 15, height: 15 },
        resource,
      },
    },
  } as unknown as ParagraphFragmentRecord;
}

const registry = {
  urlForReady: () => 'blob:marker',
};

describe('list marker picture paint', () => {
  test('a ready image paints one img at the published box', () => {
    const element = paintListMarkerPicture(document, fragmentWith(readyResource('image/png')), {
      scale: 1,
      urlRegistry: registry,
    });
    expect(element).not.toBeNull();
    expect(element!.dataset.docxMarker).toBe('');
    expect(element!.getAttribute('contenteditable')).toBe('false');
    expect(element!.getAttribute('aria-hidden')).toBe('true');
    // Fragment-relative, from the published box: 18 - 10 and 105 - 100.
    expect(element!.style.left).toBe('8px');
    expect(element!.style.top).toBe('5px');
    const image = element!.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('blob:marker');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.style.width).toBe('15px');
    expect(image.style.height).toBe('15px');
  });

  test('every renderable format an img can decode is drawn, not refused', () => {
    // The browser sink is WIDER than the PDF writer, which embeds only PNG and JPEG. A GIF
    // bullet is a picture here and the level text there, and neither is a failure.
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'])
      expect(
        paintListMarkerPicture(document, fragmentWith(readyResource(mime)), {
          scale: 1,
          urlRegistry: registry,
        })
      ).not.toBeNull();
  });

  test('a resource that is not ready paints nothing, so the caller draws the level text', () => {
    const notReady: readonly ImageResourceState[] = [
      { kind: 'pending', resourceKey: 'resource' },
      { kind: 'missing', relationshipId: 'rId1' },
      { kind: 'external', relationshipId: 'rId1', sinkSafe: true },
      { kind: 'unrenderable', partName: null, mime: 'unknown', reason: 'resource-limit' },
    ];
    for (const resource of notReady)
      expect(
        paintListMarkerPicture(document, fragmentWith(resource), {
          scale: 1,
          urlRegistry: registry,
        })
      ).toBeNull();
  });

  test('a host with no URL registry, or a stale handle, paints nothing', () => {
    const fragment = fragmentWith(readyResource('image/png'));
    expect(paintListMarkerPicture(document, fragment, { scale: 1, urlRegistry: null })).toBeNull();
    expect(
      paintListMarkerPicture(document, fragment, {
        scale: 1,
        urlRegistry: { urlForReady: () => null },
      })
    ).toBeNull();
  });

  test('a marker with no picture at all paints nothing', () => {
    const fragment = { box: { x: 0, y: 0, width: 1, height: 1 }, marker: { text: '•' } };
    expect(
      paintListMarkerPicture(document, fragment as unknown as ParagraphFragmentRecord, {
        scale: 1,
        urlRegistry: registry,
      })
    ).toBeNull();
  });
});
