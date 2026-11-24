import { describe, expect, test } from 'bun:test';
import { producerWithControlContext } from '../pass-producer.ts';

describe('content-control producer identity', () => {
  test('stays compact and stable after more live pairs than the hot-context cache retains', () => {
    const pairs = Array.from({ length: 12 }, (_, index) => ({
      base: `measurer-${index}`,
      token: `control-${index}:${'x'.repeat(256 * 1024)}`,
    }));
    const firstPass = pairs.map(({ base, token }) => producerWithControlContext(base, token));

    // Twelve alternating live contexts evict the first four exact tokens from the eight-slot
    // hot cache. Revisit in the same order: eviction may rehash, but must not remint identity
    // and invalidate every paragraph break measured under an unchanged context.
    const revisited = pairs.map(({ base, token }) => producerWithControlContext(base, token));
    expect(revisited).toEqual(firstPass);
    expect(new Set(firstPass).size).toBe(pairs.length);
    expect(firstPass.every((producer) => producer.length < 200)).toBe(true);
  });

  test('frames base absence, base text, and control tokens as distinct identities', () => {
    expect(producerWithControlContext(undefined, 'same')).not.toBe(
      producerWithControlContext('undefined', 'same')
    );
    expect(producerWithControlContext('base', 'left')).not.toBe(
      producerWithControlContext('base', 'right')
    );
    expect(producerWithControlContext('left', 'token')).not.toBe(
      producerWithControlContext('right', 'token')
    );
  });
});
