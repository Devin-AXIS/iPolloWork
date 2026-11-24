// Paste routing: fidelity order and CONTINUOUS degrade (rich-clipboard-fidelity 4.1/4.5).
//
// The router never no-ops a paste it can land somewhere: a fragment that fails decoding,
// fails the bounded read, or is refused at apply falls to the external-HTML projection,
// and that falls to the plain lane. Force-plain and a closed rich lane skip straight to
// plain.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { routePaste, type PasteRouteTarget } from '../clipboard-paste-router.ts';
import { wrapInteropHtml, fragmentFromHtml } from '../clipboard-fragment-codec.ts';

function target(overrides: Partial<PasteRouteTarget> & { fragmentAnswers?: boolean[] } = {}) {
  const pasted: Array<{ bytes: Uint8Array; lastMarkCovered: boolean }> = [];
  const plain: string[] = [];
  const answers = overrides.fragmentAnswers ?? [true];
  let call = 0;
  const routeTarget: PasteRouteTarget = {
    richLaneOpen: overrides.richLaneOpen ?? true,
    pasteFragment: (bytes, lastMarkCovered) => {
      pasted.push({ bytes, lastMarkCovered });
      const answer = answers[Math.min(call, answers.length - 1)]!;
      call += 1;
      return answer;
    },
    insertPlainText: (text) => plain.push(text),
  };
  return { routeTarget, pasted, plain };
}

const FRAGMENT_BYTES = new Uint8Array([80, 75, 3, 4, 9, 9, 9]);

describe('paste routing', () => {
  test('an embedded fragment beats the external HTML projection', () => {
    const html = wrapInteropHtml('<p>visible</p>', {
      bytes: FRAGMENT_BYTES,
      lastMarkCovered: true,
    });
    const { routeTarget, pasted, plain } = target();
    const lane = routePaste(routeTarget, { html, text: 'visible', forcePlain: false });
    expect(lane).toBe('fragment');
    expect(pasted.length).toBe(1);
    expect([...pasted[0]!.bytes]).toEqual([...FRAGMENT_BYTES]);
    expect(pasted[0]!.lastMarkCovered).toBe(true);
    expect(plain).toEqual([]);
  });

  test('the open-end marker travels beside the payload', () => {
    const html = wrapInteropHtml('<p>x</p>', { bytes: FRAGMENT_BYTES, lastMarkCovered: false });
    const decoded = fragmentFromHtml(html);
    expect(decoded).not.toBeNull();
    expect(decoded!.lastMarkCovered).toBe(false);
  });

  test('a fragment refused at apply degrades to the HTML projection, then plain', () => {
    const html = wrapInteropHtml('<p>beta</p>', { bytes: FRAGMENT_BYTES, lastMarkCovered: true });
    // Both landings refused: the fragment AND the projected external HTML.
    const { routeTarget, pasted, plain } = target({ fragmentAnswers: [false, false] });
    const lane = routePaste(routeTarget, { html, text: 'beta', forcePlain: false });
    expect(lane).toBe('plain');
    expect(pasted.length).toBe(2);
    expect(plain).toEqual(['beta']);
  });

  test('a corrupt fragment attribute degrades to the external HTML lane', () => {
    const html = '<div data-docx-fragment="!!!not-base64!!!"><p>gamma</p></div>';
    const { routeTarget, pasted } = target({ fragmentAnswers: [true] });
    const lane = routePaste(routeTarget, { html, text: 'gamma', forcePlain: false });
    // The projection landed as a synthesized fragment.
    expect(lane).toBe('external-html');
    expect(pasted.length).toBe(1);
  });

  test('a truncated HTML projection yields to complete plain text', () => {
    const prefix = 'x'.repeat(50_001);
    const html = `<p>${'<span>x</span>'.repeat(50_001)}<strong>tail</strong></p>`;
    const { routeTarget, pasted, plain } = target();
    const lane = routePaste(routeTarget, { html, text: `${prefix}tail`, forcePlain: false });
    expect(lane).toBe('plain');
    expect(pasted).toEqual([]);
    expect(plain).toEqual([`${prefix}tail`]);
  });

  test('force-plain skips every rich lane, whatever the payload carries', () => {
    const html = wrapInteropHtml('<p>delta</p>', { bytes: FRAGMENT_BYTES, lastMarkCovered: true });
    const { routeTarget, pasted, plain } = target();
    const lane = routePaste(routeTarget, { html, text: 'delta', forcePlain: true });
    expect(lane).toBe('plain');
    expect(pasted).toEqual([]);
    expect(plain).toEqual(['delta']);
  });

  test('a closed rich lane (suggesting mode, non-body story) lands on plain', () => {
    const html = wrapInteropHtml('<p>epsilon</p>', {
      bytes: FRAGMENT_BYTES,
      lastMarkCovered: true,
    });
    const { routeTarget, pasted, plain } = target({ richLaneOpen: false });
    const lane = routePaste(routeTarget, { html, text: 'epsilon', forcePlain: false });
    expect(lane).toBe('plain');
    expect(pasted).toEqual([]);
    expect(plain).toEqual(['epsilon']);
  });

  test('an empty payload routes nowhere', () => {
    const { routeTarget, pasted, plain } = target();
    expect(routePaste(routeTarget, { html: null, text: '', forcePlain: false })).toBe('none');
    expect(pasted).toEqual([]);
    expect(plain).toEqual([]);
  });
});

test('unsupported fragment content refuses paste without HTML or text fallback', () => {
  let calls = 0;
  const lane = routePaste(
    {
      richLaneOpen: true,
      pasteFragment: () => {
        calls++;
        return 'unsupported-content';
      },
      insertPlainText: () => {
        throw new Error('must not degrade');
      },
    },
    {
      html: wrapInteropHtml('<p>fallback</p>', { bytes: FRAGMENT_BYTES, lastMarkCovered: true }),
      text: 'fallback',
      forcePlain: false,
    }
  );
  expect(lane).toBe('unsupported-content');
  expect(calls).toBe(1);
});
