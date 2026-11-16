import * as React from 'react';
import { INKS, SHAPES } from './ds-bot-avatar-data.js';

// Same deterministic fallback appearance as DS Bot 0.1.7.
function defaultLook(id = '') {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let shape = Math.imul(hash ^ hash >>> 16, 73244475);
  shape = Math.imul(shape ^ shape >>> 13, 3266489909);
  const shapes = ['star', 'moon', 'gumdrop', 'peanut', 'bunny', 'kitty', 'acorn'];
  const seed = hash + 1831565813 | 0;
  let color = Math.imul(seed ^ seed >>> 15, 1 | seed);
  color = color + Math.imul(color ^ color >>> 7, 61 | color) ^ color;
  const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta'];
  return {
    shape: shapes[((shape ^ shape >>> 16) >>> 0) % shapes.length],
    color: colors[Math.floor(((color ^ color >>> 14) >>> 0) / 4294967296 * colors.length)],
  };
}

export function DsBotAvatar({ bot, size = 24 }) {
  const id = React.useId().replaceAll(':', '');
  const fallback = defaultLook(bot?.id);
  const shape = Object.hasOwn(SHAPES, bot?.avatar?.shape)
    ? SHAPES[bot.avatar.shape] : SHAPES[fallback.shape];
  const color = bot?.color ?? fallback.color;
  const fill = /^#[0-9a-f]{6}$/i.test(color) ? color
    : (Object.hasOwn(INKS, color) ? INKS[color] : INKS[fallback.color])[0];
  const image = bot?.avatar?.image;
  if (typeof image === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    return React.createElement('img', {
      className: 'dim-dsBotAvatar', src: image, width: size, height: size, alt: '',
    });
  }
  const h = React.createElement;
  return h('svg', { className: 'dim-dsBotAvatar', width: size, height: size, viewBox: '0 0 100 100', 'aria-hidden': true },
    h('defs', null,
      h('mask', { id: `${id}mask` },
        h('rect', { width: 100, height: 100, fill: '#fff' }),
        shape.eyes.map(([x, y, w, height, angle], index) => (
          h('rect', {
            key: index, x: -w / 2, y: -height / 2, width: w, height, rx: w / 2,
            fill: '#000', transform: `translate(${x} ${y}) rotate(${angle})`,
          })
        ))),
      color === 'aurora' ? h('linearGradient', { id: `${id}gradient`, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
        h('stop', { offset: 0, stopColor: '#A4FFB0' }),
        h('stop', { offset: '.42', stopColor: '#00F0E4' }),
        h('stop', { offset: 1, stopColor: '#2E9EF7' })) : null),
    h('g', { mask: `url(#${id}mask)`, fillRule: 'evenodd' },
      h('path', { d: shape.body, fill: color === 'aurora' ? `url(#${id}gradient)` : fill }),
      (shape.paints ?? []).map(([d, paint, opacity], index) => h('path', { key: index, d, fill: paint, opacity })),
      h('path', { d: shape.shade, fill: '#000', opacity: .14 }),
      h('path', { d: shape.light, fill: '#fff', opacity: .16 })));
}
