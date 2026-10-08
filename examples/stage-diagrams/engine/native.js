/* Stage Diagrams — native output.
 * One engine, two outputs: the gallery draws SVG; video components use native nodes made here from the
 * same render — positioned HTML text and per-shape SVG fragments with stable keys. Motion stays declared on
 * the nodes (data-a / data-loop, as in SVG mode) and compiles to one paused GSAP timeline with the engine's
 * own keyframes, durations and easing. When component data changes, the diagram is laid out again by the
 * engine and the live nodes take the new geometry in place, so editor changes to them are kept.
 */
(() => {
  'use strict';
  const SD = window.StageDiagrams;
  const W = 1200, H = 675;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'use', 'image']);
  const GEOMETRY = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform', 'class', 'opacity', 'style', 'href'];
  const q = n => Math.round(n * 10) / 10;

  /* ------------------------------------------------------------ convert */
  const metricsCache = new Map();
  function fontMetrics(font) {
    if (!metricsCache.has(font)) {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = font;
      const m = ctx.measureText('Hg国');
      metricsCache.set(font, { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent });
    }
    return metricsCache.get(font);
  }
  const matrixOf = el => {
    const t = el.transform && el.transform.baseVal.consolidate();
    if (!t) return null;
    const m = t.matrix;
    return `matrix(${q(m.a * 1000) / 1000}, ${q(m.b * 1000) / 1000}, ${q(m.c * 1000) / 1000}, ${q(m.d * 1000) / 1000}, ${q(m.e)}, ${q(m.f)})`;
  };
  const plane = () => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none`;
    return d;
  };
  // Motion attributes move from the SVG element to the native node that the timeline animates.
  const MOTION = ['data-a', 'data-t', 'data-dur', 'data-o', 'data-loop', 'data-dx', 'data-dy', 'data-op', 'data-ox', 'data-oy', 'data-dir', 'data-amp', 'data-len', 'data-tail', 'data-seg', 'data-rev'];
  function moveMotion(from, to) {
    for (const a of MOTION) if (from.hasAttribute(a)) { to.setAttribute(a, from.getAttribute(a)); from.removeAttribute(a); }
  }

  function convert(svg, opts = {}) {
    const prefix = opts.prefix || 'sd';
    const counters = new Map();
    const key = (u) => { const n = (counters.get(u) || 0) + 1; counters.set(u, n); return `${prefix}-${u || 'f'}-${n}`; };
    const unitOf = (el, inherited) => el.getAttribute('data-u') || inherited;
    const root = plane();
    root.className = 'sd-native';

    // Comet heads are derived in SVG mode at setup; derive them here the same way.
    svg.querySelectorAll('.comet').forEach(c => {
      if (c.nextElementSibling && c.nextElementSibling.classList.contains('comet-head')) return;
      const h = c.cloneNode();
      h.setAttribute('class', 'comet-head');
      h.setAttribute('data-tail', String(Math.min(+c.dataset.seg || 110, c.getTotalLength() * 0.45)));
      h.setAttribute('data-seg', '9');
      c.after(h);
    });

    const walk = (node, parent, unit) => {
      for (const el of Array.from(node.children)) {
        const tag = el.tagName.toLowerCase();
        if (['defs', 'title', 'desc', 'style', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'filter', 'pattern', 'symbol'].includes(tag)) continue;
        const u = unitOf(el, unit);
        let host = parent;
        const m = matrixOf(el);
        if (m) {
          const t = plane();
          // Local icon/group coordinates need a local carrier, not a second full-canvas hit box.
          // Keep origin zero and the exact matrix; only shrink unused positive extent, without clipping.
          const b = el.getBBox(), pad = 3;
          t.style.width = `${q(Math.max(0, b.x + b.width) + pad)}px`;
          t.style.height = `${q(Math.max(0, b.y + b.height) + pad)}px`;
          t.style.transform = m; t.style.transformOrigin = '0 0';
          t.setAttribute('data-hf-id', key(u));
          host.appendChild(t); host = t;
        }
        if (tag === 'g' || tag === 'a') {
          let box = host;
          const animated = el.hasAttribute('data-a') || el.hasAttribute('data-loop');
          if (animated || el.getAttribute('class') || el.hasAttribute('opacity') || el.hasAttribute('filter') || el.hasAttribute('mask') || el.hasAttribute('data-layout-overflow')) {
            box = plane();
            box.setAttribute('data-hf-id', key(u));
            if (el.getAttribute('class')) box.className = el.getAttribute('class');
            if (el.hasAttribute('opacity')) box.style.opacity = el.getAttribute('opacity');
            if (animated) {
              const b = el.getBBox();
              box.style.transformOrigin = `${q(b.x + b.width / 2)}px ${q(b.y + b.height / 2)}px`;
              box.setAttribute('data-box', `${q(b.x)} ${q(b.y)} ${q(b.width)} ${q(b.height)}`);
              moveMotion(el, box);
            }
            if (el.hasAttribute('filter') || el.hasAttribute('mask')) {
              // Group-level filters/masks need an SVG context: keep the group as one vector node.
              host.appendChild(box);
              vector(el, box, u, true);
              continue;
            }
            host.appendChild(box);
          }
            if (u !== unit) box.setAttribute('data-u', u);
            if (el.hasAttribute('data-layout-overflow')) box.setAttribute('data-layout-overflow', el.getAttribute('data-layout-overflow'));
            if (el.hasAttribute('data-layout-box')) box.setAttribute('data-layout-box', el.getAttribute('data-layout-box'));
          walk(el, box, u);
        } else if (tag === 'text') {
          text(el, host, u);
        } else if (SHAPES.has(tag)) {
          vector(el, host, u, false);
        }
      }
    };

    function vector(el, host, u, whole) {
      let b;
      try { b = el.getBBox(); } catch { return; }
      if (!whole && b.width === 0 && b.height === 0) return;
      const cs = getComputedStyle(el);
      const sw = parseFloat(cs.strokeWidth) || 0;
      const pad = Math.ceil(sw / 2 + (el.getAttribute('filter') || cs.filter !== 'none' ? 24 : 2));
      const x = q(b.x - pad), y = q(b.y - pad), w = q(b.width + pad * 2), h = q(b.height + pad * 2);
      const wrap = document.createElement('div');
      wrap.setAttribute('data-hf-id', key(u));
      wrap.setAttribute('data-hf-edit-as-unit', '');
      // The light sweep starts offstage and travels across it; this exact decorative surface overflows by design.
      if (el.getAttribute('data-a') === 'sweep') wrap.setAttribute('data-layout-allow-overflow', '');
      wrap.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;pointer-events:auto`;
      const frag = document.createElementNS(SVGNS, 'svg');
      frag.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      frag.setAttribute('width', w); frag.setAttribute('height', h);
      frag.setAttribute('style', 'position:absolute;inset:0;overflow:visible;pointer-events:none');
      const clone = el.cloneNode(true);
      clone.removeAttribute('transform');
      clone.removeAttribute('data-u');
      if (whole) clone.querySelectorAll('[data-u]').forEach(n => n.removeAttribute('data-u'));
      frag.appendChild(clone);
      wrap.appendChild(frag);
      if (u) wrap.setAttribute('data-u', u);
      // Shapes keep their motion: like SVG mode, the animation drives the shape (and overrides its CSS opacity).
      if (el.hasAttribute('data-a') || el.hasAttribute('data-loop')) clone.setAttribute('data-hf-id', key(u));
      host.appendChild(wrap);
    }

    function text(el, host, u) {
      const raw = el.textContent;
      if (!raw.trim()) return;
      const cs = getComputedStyle(el);
      const size = parseFloat(el.getAttribute('font-size')) || parseFloat(cs.fontSize);
      const weight = el.getAttribute('font-weight') || cs.fontWeight;
      const family = cs.fontFamily;
      const anchor = el.getAttribute('text-anchor') || cs.textAnchor || 'start';
      const lines = Array.from(el.children).filter(n => n.tagName.toLowerCase() === 'tspan' && n.hasAttribute('y'));
      const rich = !lines.length && el.children.length > 0;
      const fm = fontMetrics(`${weight} ${size}px ${family}`);
      const lh = parseFloat(el.dataset.lh) || 1.35;
      const step = lines.length > 1 ? parseFloat(lines[1].getAttribute('y')) - parseFloat(lines[0].getAttribute('y')) : size * lh;
      let base;
      try { base = el.getStartPositionOfChar(0).y; } catch { return; }
      const ax = parseFloat((lines[0] || el).getAttribute('x')) || 0;
      const lineH = lines.length > 1 ? step : fm.a + fm.d;
      // The SVG anchor point is the first line's dominant baseline; an HTML line box centres its content.
      const db = el.getAttribute('dominant-baseline') || cs.dominantBaseline;
      const top = db === 'central' || db === 'middle' ? base - lineH / 2
        : db === 'hanging' || db === 'text-before-edge' ? base - (lineH - (fm.a + fm.d)) / 2
        : base - ((lineH - (fm.a + fm.d)) / 2 + fm.a);
      const d = document.createElement('div');
      d.setAttribute('data-hf-id', key(u));
      d.className = ['sd-text', el.getAttribute('class') || ''].join(' ').trim();
      const max = parseFloat(el.dataset.max) || 0, clamp = parseInt(el.dataset.lines, 10) || 0;
      const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
      // SVG presentation attributes rank below stylesheets: keep the authored typography as custom properties read
      // by a zero-specificity rule, so skin rules (dot: bold, mono tracking) win as in SVG mode, and editor edits win over both.
      const st = [`position:absolute`, `top:${q(top)}px`, `--fs:${size}px`, `--fw:${weight}`, `line-height:${q(lineH)}px`, `text-align:${align}`, `pointer-events:auto`];
      if (el.getAttribute('letter-spacing')) st.push(`--ls:${el.getAttribute('letter-spacing')}px`);
      if (el.hasAttribute('opacity')) st.push(`opacity:${el.getAttribute('opacity')}`);
      if (el.hasAttribute('data-upper')) st.push('text-transform:uppercase');
      const fill = el.style.fill || el.getAttribute('fill') || '';
      if (fill.startsWith('url(')) st.push('color:transparent', 'background:linear-gradient(90deg,var(--sd-fg) 45%,color-mix(in oklab,var(--sd-fg) 28%,transparent))', '-webkit-background-clip:text', 'background-clip:text');
      if (max && (lines.length > 1 || clamp)) {
        const left = anchor === 'middle' ? ax - max / 2 : anchor === 'end' ? ax - max : ax;
        st.push(`left:${q(left)}px`, `width:${q(max)}px`, 'white-space:normal', 'overflow-wrap:anywhere');
        if (clamp) st.push('display:-webkit-box', `-webkit-line-clamp:${clamp}`, '-webkit-box-orient:vertical', 'overflow:hidden');
      } else {
        st.push(`left:${q(ax)}px`, 'white-space:pre');
        if (anchor !== 'start') st.push(`transform:translateX(${anchor === 'middle' ? '-50%' : '-100%'})`);
      }
      d.style.cssText = st.join(';');
      if (rich) {
        // Runs with their own size or a counter (big figures): inline spans on one baseline.
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === 3) { d.appendChild(document.createTextNode(n.textContent)); continue; }
          const s = document.createElement('span');
          s.textContent = n.textContent;
          if (n.getAttribute('font-size')) s.style.fontSize = `${n.getAttribute('font-size')}px`;
          if (n.getAttribute('dx')) s.style.marginLeft = `${n.getAttribute('dx')}px`;
          if (n.getAttribute('class')) s.className = n.getAttribute('class');
          if (n.hasAttribute('data-count')) { s.setAttribute('data-count', n.getAttribute('data-count')); s.setAttribute('data-t', n.getAttribute('data-t') || '0'); s.setAttribute('data-hf-id', key(u)); }
          d.appendChild(s);
        }
      } else {
        d.textContent = max && (lines.length > 1 || clamp) ? (el.dataset.raw || raw) : lines.length ? lines.map(l => l.textContent).join('') : raw;
      }
      if (el.dataset.raw != null) d.setAttribute('data-raw', el.dataset.raw);
      if (el.hasAttribute('data-layout-allow-overflow')) d.setAttribute('data-layout-allow-overflow', '');
      if (u) d.setAttribute('data-u', u);
      if (el.hasAttribute('data-a')) {
        const mo = plane();
        mo.setAttribute('data-hf-id', key(u));
        const b = el.getBBox();
        mo.style.transformOrigin = `${q(b.x + b.width / 2)}px ${q(b.y + b.height / 2)}px`;
        moveMotion(el, mo);
        if (u) mo.setAttribute('data-u', u);
        mo.appendChild(d);
        host.appendChild(mo);
      } else host.appendChild(d);
    }

    walk(svg, root, null);
    const defs = svg.querySelector('defs');
    return { root, defs: defs ? defs.outerHTML : '' };
  }

  /** Render data with the engine into an off-screen element and convert it. */
  function render(type, data, attrs = {}, prefix) {
    SD.define();
    const host = document.createElement(SD.tag || 'stage-diagram');
    host.setAttribute('type', type);
    host.setAttribute('motion', 'none');
    host.setAttribute('autoplay', 'false');
    for (const [k, v] of Object.entries(attrs)) if (v != null) host.setAttribute(k, v);
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${W}px;visibility:hidden`;
    document.body.appendChild(host);
    host.renderNow(data);
    // Loop layers (comets, pulses) only display while live; measure them as they will play.
    host.setAttribute('data-live', '');
    // Two layers as in SVG mode: the diagram (camera moves it) and the overlay (sweep, vignette, grain, chrome).
    const main = convert(host.querySelector('.sd-main'), { prefix: prefix || 'sd' });
    const over = convert(host.querySelector('.sd-over'), { prefix: `${prefix || 'sd'}o` });
    const camera = host._camera && host._camera !== 'flat' ? host._camera : null;
    host.remove();
    return { root: main.root, over: over.root, defs: main.defs, camera };
  }

  /** Check the completed drawing with the actual project font, before touching live nodes. */
  function preflight(fresh, stage) {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:-99999px;top:0;width:${W}px;height:${H}px;visibility:hidden;transform:none`;
    probe.append(fresh.root, fresh.over); stage.appendChild(probe);
    const origin = probe.getBoundingClientRect(), scale = origin.width / W || 1, issues = [], cardBounds = new Map();
    try {
      for (const layer of [fresh.root, fresh.over]) {
      const texts = [];
      for (const node of layer.querySelectorAll('[data-layout-overflow]')) issues.push({ path: node.getAttribute('data-layout-overflow'), code: 'text_overflow', message: 'The scene title exceeds three lines; shorten it or split the scene.' });
      for (const node of layer.querySelectorAll('.sd-text')) {
        const raw = node.getAttribute('data-raw') ?? node.textContent;
        if (!raw || !raw.trim()) continue;
        const cs = getComputedStyle(node), clamp = Number(cs.webkitLineClamp) || 0;
        const path = node.getAttribute('data-var-text') || node.getAttribute('data-hf-id');
        if (clamp) {
          const old = node.style.webkitLineClamp;
          node.style.webkitLineClamp = 'unset';
          const height = node.scrollHeight;
          node.style.webkitLineClamp = old;
          if (height > parseFloat(cs.lineHeight) * clamp + 1) issues.push({ path, code: 'text_overflow', message: `“${raw}” exceeds ${clamp} lines; shorten it or split the scene.` });
        }
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        const b = { x: (Math.min(...rects.map(r => r.left)) - origin.left) / scale, y: (Math.min(...rects.map(r => r.top)) - origin.top) / scale,
          r: (Math.max(...rects.map(r => r.right)) - origin.left) / scale, b: (Math.max(...rects.map(r => r.bottom)) - origin.top) / scale };
        if (b.x < -1 || b.y < -1 || b.r > W + 1 || b.b > H + 1) issues.push({ path, code: 'out_of_canvas', message: `“${raw}” leaves the canvas; shorten it or reduce the detail count.` });
        const card = node.closest('[data-layout-box]');
        if (card && !node.hasAttribute('data-layout-allow-overflow')) {
          if (!cardBounds.has(card)) {
            const [x, y, w, h] = card.getAttribute('data-layout-box').split(' ').map(Number);
            // Box coordinates belong to the card's local plane. Measure its inset in the same
            // viewport as the text, including layout wrappers that translate or scale the diagram.
            const inset = document.createElement('div');
            inset.style.cssText = `position:absolute;left:${x + 3}px;top:${y + 2}px;width:${w - 6}px;height:${h - 4}px;pointer-events:none`;
            card.appendChild(inset);
            const rect = inset.getBoundingClientRect(); inset.remove();
            cardBounds.set(card, { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale,
              r: (rect.right - origin.left) / scale, b: (rect.bottom - origin.top) / scale });
          }
          const bounds = cardBounds.get(card), tolerance = .01;
          if (b.x < bounds.x - tolerance || b.r > bounds.r + tolerance || b.y < bounds.y - tolerance || b.b > bounds.b + tolerance) issues.push({ path, code: 'out_of_card', message: `“${raw}” does not fit its node; shorten it or split the scene.` });
        }
        texts.push({ node, raw, path, ...b });
      }
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (Math.min(a.r, b.r) - Math.max(a.x, b.x) > 3 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 2) {
          issues.push({ path: a.path, code: 'text_collision', message: `“${a.raw}” overlaps “${b.raw}”; shorten labels or separate positions.` });
        }
      }
      }
    } finally { probe.remove(); }
    return issues;
  }

  /* ------------------------------------------------------------- motion */
  const EASE = '.16,1,.3,1';
  function bezier(spec) {
    const [x1, y1, x2, y2] = String(spec).split(',').map(Number);
    const at = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    return x => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { if (at(t, x1, x2) < x) lo = t; else hi = t; t = (lo + hi) / 2; } return at(t, y1, y2); };
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const DECODE = '01<>/\\#%+=_▮▯:';
  const setter = write => { let v = 0; const o = {}; Object.defineProperty(o, 'p', { get: () => v, set: x => { v = x; write(x); } }); return o; };

  /**
   * Compile the declared motion of a native tree into a GSAP timeline.
   * shift(node) → seconds a node's motion moves by (content cues); end → composition length for finite loops.
   */
  function compile(gsap, root, o = {}) {
    const tl = o.into || gsap.timeline({ paused: true });
    const sp = o.speed || 1, end = o.end || 10, shift = o.shift || (() => 0);
    const at = (n, ms) => Math.max(0, (ms / 1000) / sp + shift(n));
    root.querySelectorAll('[data-a]').forEach(n => {
      let kind = n.getAttribute('data-a');
      const t = at(n, +n.getAttribute('data-t') || 0);
      let dur = 0.7, ease = bezier(EASE), from, to = {};
      if (kind === 'draw' && (typeof n.getTotalLength !== 'function' || (getComputedStyle(n).strokeDasharray || 'none') !== 'none')) kind = 'fade';
      switch (kind) {
        case 'fade': from = { opacity: 0 }; to = { opacity: 1 }; dur = 0.6; break;
        case 'rise': from = { opacity: 0, y: 14, filter: 'blur(6px)' }; to = { opacity: 1, y: 0, filter: 'blur(0px)' }; dur = 0.9; break;
        case 'blur': from = { opacity: 0, filter: 'blur(10px)' }; to = { opacity: 1, filter: 'blur(0px)' }; dur = 1; break;
        case 'pop': from = { opacity: 0, scale: 0.4 }; to = { opacity: 1, scale: 1 }; dur = 0.6; ease = bezier('.34,1.56,.64,1'); break;
        case 'zoom': from = { opacity: 0, scale: 0.82, filter: 'blur(8px)' }; to = { opacity: 1, scale: 1, filter: 'blur(0px)' }; dur = 1.3; break;
        case 'drop': from = { opacity: 0, y: -46 }; to = { opacity: 1, y: 0 }; dur = 1.1; break;
        case 'growx': if (!(n instanceof SVGElement)) n.style.transformOrigin = originOf(n, n.getAttribute('data-o') || 'left center'); from = { scaleX: 0 }; to = { scaleX: 1 }; dur = 0.9; break;
        case 'growy': if (!(n instanceof SVGElement)) n.style.transformOrigin = originOf(n, 'center bottom'); from = { scaleY: 0 }; to = { scaleY: 1 }; dur = 0.9; break;
        case 'sweep': {
          const d = (+n.getAttribute('data-dur') || 2200) / 1000 / sp;
          tl.fromTo(n, { x: 0, opacity: 0 }, { keyframes: { '0%': { x: 0, opacity: 0 }, '15%': { opacity: 1 }, '80%': { opacity: 1 }, '100%': { x: 1700, opacity: 0 }, easeEach: 'none' }, ease: bezier('.5,0,.3,1'), duration: d, immediateRender: true }, t);
          return;
        }
        case 'draw': {
          const len = Math.max(1, n.getTotalLength());
          n.style.strokeDasharray = `${len} ${len + 2}`;
          from = { strokeDashoffset: len }; to = { strokeDashoffset: 0 };
          dur = clampN(len * 1.15, 550, 1500) / 1000; ease = bezier('.65,0,.25,1');
          break;
        }
        default: return;
      }
      if (n.hasAttribute('data-dur')) dur = +n.getAttribute('data-dur') / 1000;
      if (n instanceof SVGElement) to.transformOrigin = kind === 'growx' ? svgOrigin(n.getAttribute('data-o') || 'left center') : kind === 'growy' ? '50% 100%' : '50% 50%';
      tl.fromTo(n, from, { ...to, duration: dur / sp, ease, immediateRender: true }, t);
    });

    // Mono labels decode in, counters count up — as in SVG mode, timed by their animated host.
    root.querySelectorAll('[data-a] .sd-text.mono, .sd-text.mono[data-a]').forEach((n, i) => {
      if (n.querySelector('[data-count]')) return;
      const host = n.closest('[data-a]'), final = n.textContent, len = final.length;
      const dur = Math.min(900, 300 + len * 40) / 1000 / sp;
      // A non-lazy property setter, not onUpdate: first and reverse event-suppressed seeks
      // apply the same text immediately, including synchronous frame capture.
      tl.fromTo(setter(pr => {
        const k = Math.floor(pr * (len + 3)) - 3, fr = Math.floor(pr * dur * 1000 / 45);
        let out = '';
        for (let j = 0; j < len; j++) { const ch = final[j]; out += j <= k || ch === ' ' ? ch : j <= k + 4 ? DECODE[(j * 13 + fr * 7 + i * 7 + 3) % DECODE.length] : (pr > 0 ? '\u00b7' : '\u2007'); }
        n.textContent = pr >= 1 ? final : out;
      }), { p: 0 }, { p: 1, duration: dur, ease: 'none', immediateRender: true, lazy: false }, at(host, (+host.getAttribute('data-t') || 0) + 120));
    });
    root.querySelectorAll('[data-count]').forEach(n => {
      const to = parseFloat(n.getAttribute('data-count')), dec = (String(n.getAttribute('data-count')).split('.')[1] || '').length;
      tl.fromTo(setter(v => { n.textContent = (v * to).toFixed(dec); }), { p: 0 }, { p: 1, duration: 1.7 / sp, ease: bezier('.2,.8,.2,1'), immediateRender: true, lazy: false }, at(n, +n.getAttribute('data-t') || 0));
    });

    // Ambient loops run to the end of the composition (finite, so the timeline stays seekable).
    root.querySelectorAll('[data-loop]').forEach(n => {
      const kind = n.getAttribute('data-loop');
      const t = at(n, n.hasAttribute('data-t') ? +n.getAttribute('data-t') : 1800);
      const ds = +n.getAttribute('data-dur') || 0;
      // Whole cycles that finish inside the scene, so the timeline never outlasts it.
      const reps = d => Math.max(0, Math.floor((end - t) / d) - 1);
      switch (kind) {
        case 'comet': {
          const len = Math.max(1, n.getTotalLength()), rev = n.hasAttribute('data-rev');
          let seg, from, to;
          if (n.hasAttribute('data-tail')) {
            const st = +n.getAttribute('data-tail'); seg = Math.min(+n.getAttribute('data-seg') || 8, st);
            n.style.strokeDasharray = `${seg} ${len + st + 20}`; from = rev ? -len : seg; to = rev ? st : -len - (st - seg);
          } else {
            seg = Math.min(+n.getAttribute('data-seg') || 110, len * 0.45);
            n.style.strokeDasharray = `${seg} ${len + seg}`; from = rev ? -len : seg; to = rev ? seg : -len;
          }
          const d = (ds || clampN(len * 5.2, 1800, 5200)) / 1000 / sp;
          tl.fromTo(n, { strokeDashoffset: from }, { keyframes: { '0%': { strokeDashoffset: from }, '62%': { strokeDashoffset: to }, '100%': { strokeDashoffset: to }, easeEach: 'none' }, ease: bezier('.45,.05,.55,.95'), duration: d, repeat: reps(d), immediateRender: false }, t);
          n.style.strokeDashoffset = from;
          break;
        }
        case 'push': {
          const d = (ds || 14000) / 1000 / sp;
          if (n instanceof SVGElement) tl.fromTo(n, { scale: 1 }, { scale: 1.035, svgOrigin: '600 337', duration: d, ease: bezier('.42,0,.58,1'), yoyo: true, repeat: reps(d), immediateRender: false }, t);
          else { n.style.transformOrigin = '600px 337px'; tl.fromTo(n, { scale: 1 }, { scale: 1.035, duration: d, ease: bezier('.42,0,.58,1'), yoyo: true, repeat: reps(d), immediateRender: false }, t); }
          break;
        }
        case 'drift': {
          const dx = +n.getAttribute('data-dx') || 0, dy = +n.getAttribute('data-dy') || -10, op = +n.getAttribute('data-op') || 0.5;
          const d = (ds || 6000) / 1000 / sp;
          tl.fromTo(n, { x: 0, y: 0, opacity: 0 }, { keyframes: { '0%': { x: 0, y: 0, opacity: 0 }, '30%': { opacity: op }, '70%': { opacity: op }, '100%': { x: dx, y: dy, opacity: 0 }, easeEach: 'none' }, ease: 'none', duration: d, repeat: reps(d), immediateRender: true }, t);
          break;
        }
        case 'pulse': {
          const d = (ds || 2600) / 1000 / sp;
          tl.fromTo(n, { opacity: 0.75, scale: 1 }, { opacity: 0, scale: 2.1, transformOrigin: '50% 50%', duration: d, ease: bezier('.2,.6,.3,1'), repeat: reps(d), immediateRender: false }, t);
          break;
        }
        case 'spin': {
          const d = (ds || 30000) / 1000 / sp, ox = n.getAttribute('data-ox'), oy = n.getAttribute('data-oy');
          if (n instanceof SVGElement) tl.fromTo(n, { rotation: 0 }, { rotation: (+n.getAttribute('data-dir') || 1) * 360, svgOrigin: `${ox} ${oy}`, duration: d, ease: 'none', repeat: reps(d), immediateRender: false }, t);
          else { n.style.transformOrigin = `${ox}px ${oy}px`; tl.fromTo(n, { rotation: 0 }, { rotation: (+n.getAttribute('data-dir') || 1) * 360, duration: d, ease: 'none', repeat: reps(d), immediateRender: false }, t); }
          break;
        }
        case 'march': {
          const d = (ds || 900) / 1000 / sp;
          tl.fromTo(n, { strokeDashoffset: 0 }, { strokeDashoffset: -(+n.getAttribute('data-len') || 14), duration: d, ease: 'none', repeat: reps(d), immediateRender: false }, t);
          break;
        }
        case 'breathe': {
          const d = (ds || 3200) / 1000 / sp;
          tl.fromTo(n, { opacity: 0.25 }, { keyframes: { '0%': { opacity: 0.25 }, '50%': { opacity: 1 }, '100%': { opacity: 0.25 }, easeEach: 'none' }, ease: bezier('.42,0,.58,1'), duration: d, repeat: reps(d), immediateRender: true }, t);
          break;
        }
        case 'float': {
          const d = (ds || 4200) / 1000 / sp, amp = +n.getAttribute('data-amp') || 6;
          tl.fromTo(n, { y: 0 }, { keyframes: { '0%': { y: 0 }, '50%': { y: -amp }, '100%': { y: 0 }, easeEach: 'none' }, ease: bezier('.42,0,.58,1'), duration: d, repeat: reps(d), immediateRender: false }, t);
          break;
        }
      }
    });
    return tl;
  }
  const svgOrigin = spec => { const [h, v] = spec.split(' '); return `${h === 'left' ? 0 : h === 'right' ? 100 : 50}% ${v === 'top' ? 0 : v === 'bottom' ? 100 : 50}%`; };
  // Transform origin keywords against the node's recorded box (fill-box semantics of SVG mode).
  function originOf(n, spec) {
    const [x, y, w, h] = (n.getAttribute('data-box') || `0 0 ${W} ${H}`).split(' ').map(Number);
    const [hx, vy] = spec.split(' ');
    const fx = hx === 'left' ? 0 : hx === 'right' ? 1 : 0.5, fy = vy === 'top' ? 0 : vy === 'bottom' ? 1 : 0.5;
    return `${q(x + w * fx)}px ${q(y + h * fy)}px`;
  }

  /* -------------------------------------------------------------- patch */
  /**
   * Give live native nodes the geometry of a fresh layout. Nodes are matched by key; a node absent from the
   * new layout is hidden (capacity is authored ahead). Only geometry and structure classes change — inline
   * typography, colours and other edits made in the editor stay on the live nodes.
   */
  function patch(live, fresh) {
    const byKey = new Map(Array.from(fresh.querySelectorAll('[data-hf-id]')).map(n => [n.getAttribute('data-hf-id'), n]));
    for (const n of live.querySelectorAll('[data-hf-id]')) {
      const id = n.getAttribute('data-hf-id');
      if (!id.startsWith('sd-')) continue;
      const f = byKey.get(id);
      if (!f) { n.style.visibility = 'hidden'; continue; }
      n.style.visibility = '';
      if (n.namespaceURI === SVGNS) {
        for (const a of GEOMETRY) { if (a === 'style') continue; f.hasAttribute(a) ? n.setAttribute(a, f.getAttribute(a)) : n.removeAttribute(a); }
        continue;
      }
      for (const p of ['left', 'top', 'width', 'height', 'transform', 'transformOrigin', 'opacity']) if (n.style[p] !== f.style[p]) n.style[p] = f.style[p];
      if (f.hasAttribute('data-box')) n.setAttribute('data-box', f.getAttribute('data-box'));
      if (n.classList.contains('sd-text')) {
        n.className = f.className;
        if (!n.hasAttribute('data-var-text') && n.textContent !== f.textContent) n.textContent = f.textContent;
      } else if (f.getAttribute('class') !== n.getAttribute('class')) n.className = f.className;
      const fs = f.querySelector(':scope > svg'), ns = n.querySelector(':scope > svg');
      if (fs && ns) {
        for (const a of ['viewBox', 'width', 'height']) ns.setAttribute(a, fs.getAttribute(a));
        // The shape inside a vector node takes the new geometry too (keyed shapes are patched on their own).
        const fShape = fs.firstElementChild, nShape = ns.firstElementChild;
        if (fShape && nShape && !nShape.hasAttribute('data-hf-id')) {
          if (fShape.tagName !== nShape.tagName || fShape.children.length || nShape.children.length) ns.replaceChildren(fShape.cloneNode(true));
          else for (const a of GEOMETRY) { if (a === 'style') continue; fShape.hasAttribute(a) ? nShape.setAttribute(a, fShape.getAttribute(a)) : nShape.removeAttribute(a); }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- css */
  /**
   * Engine CSS for native nodes: the element selector becomes `rootSel`, and every text paint rule gains an
   * HTML-text twin (fill → color, stroke halo → text stroke) so skins colour native text exactly as SVG text.
   */
  function css(rootSel = '.sd-root') {
    const base = SD.css.replace(/stage-diagram(?![\w-])/g, rootSel);
    const extra = [];
    const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(base))) {
      const decls = m[2];
      const fill = /(?:^|;)\s*fill\s*:\s*([^;!]+)(!important)?/.exec(decls);
      const stroke = /(?:^|;)\s*stroke\s*:\s*([^;!]+)/.exec(decls), sw = /stroke-width\s*:\s*([^;]+)/.exec(decls);
      const halo = /paint-order\s*:\s*stroke/.test(decls) && stroke;
      const type = /(?:^|[\s,>])text(?![\w-])[^,{]*$/.test(m[1].trim()) ? (decls.match(/(?:font-weight|font-size|letter-spacing|font-style)\s*:[^;]+/g) || []) : [];
      if ((!fill || fill[1].trim().startsWith('url(')) && !halo && !type.length) continue;
      const sels = m[1].split(',').map(s => s.trim()).filter(Boolean).map(sel => {
        const parts = sel.split(/(\s+|>)/), last = parts.pop();
        if (/(^|[^\w-])text(?![\w-])/.test(last)) return [...parts, last.replace(/(^|[^\w-.])text(?![\w-])/, '$1.sd-text')].join('');
        if (last.startsWith('.')) return [...parts, `.sd-text${last}`].join('');
        return null;
      }).filter(Boolean);
      if (!sels.length) continue;
      const body = [];
      if (fill && !fill[1].trim().startsWith('url(')) body.push(`color:${fill[1].trim()}${fill[2] ? ' !important' : ''}`);
      if (halo) body.push(`paint-order:stroke fill;-webkit-text-stroke:${sw ? sw[1].trim() : '6px'} ${stroke[1].trim()};stroke-linejoin:round`);
      body.push(...type);
      extra.push(`${sels.join(',')}{${body.join(';')}}`);
    }
    return `${base}\n/* native motion: GSAP owns SVG transform origins */\n${rootSel} svg [data-a],${rootSel} svg [data-loop]{transform-box:view-box;transform-origin:0 0}\n/* native text */\n:where(${rootSel} .sd-text){font-size:var(--fs);font-weight:var(--fw);letter-spacing:var(--ls,normal)}\n${rootSel} .sd-text{color:var(--sd-fg);font-family:var(--sd-sans)}\n${rootSel} .sd-text.mono{font-family:var(--sd-mono)}\n${rootSel} .sd-text.disp{font-family:var(--sd-display)}\n${extra.join('\n')}`;
  }

  SD.native = { convert, render, preflight, compile, patch, bezier, css };
})();
