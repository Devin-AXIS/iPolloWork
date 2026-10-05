/* Business diagrams — compile a rendered diagram into one paused, seekable GSAP timeline (HyperFrames). */
(() => {
  const SD = window.StageDiagrams;
  const { CAMERA_POSES, lerpPose } = SD.H;
  const BALANCED = { distance: 16, emphasisScale: 1.012, durationFactor: 1, ease: 'power2.out', resolveEase: 'power2.inOut' };

  /**
   * @param {HTMLElement} el rendered <stage-diagram>
   * @param {object} gsap GSAP instance
   * @param {{duration:number, cues?:Record<string,number>, motionStyle?:object, camera?:string, exit?:number, into?:object}} opts
   *   duration: scene seconds; cues: unit id → scene-relative seconds; exit: seconds of camera exit before the end (0 = none);
   *   into: an existing timeline to rebuild in place (e.g. after web fonts change text metrics)
   */
  function timeline(el, gsap, opts) {
    const style = { ...BALANCED, ...(opts.motionStyle || {}) };
    const k = style.durationFactor || 1, end = opts.duration;
    const units = el._units || [];
    const tl = opts.into ? opts.into.clear() : gsap.timeline({ paused: true }); // reuse keeps the registered timeline identity
    // unit id → seconds shift relative to its authored default
    const shift = {};
    for (const u of units) {
      const cue = opts.cues && opts.cues[u.id];
      shift[u.id] = typeof cue === 'number' ? cue - u.at / 1000 : 0;
    }
    const at = n => Math.max(0, (+n.dataset.t || 0) / 1000 * k + (shift[n.dataset.u] || 0));
    const root = el.querySelector('.sd-stage');
    el.setAttribute('data-live', ''); // ambient layers (comets, pulses) are driven by this timeline
    el.dataset.engine = 'gsap'; // GSAP owns SVG transform origins; disable the CSS fill-box origin used by the WAAPI player

    root.querySelectorAll('[data-a]').forEach(n => enter(tl, n, at(n), style, k));
    decodeAndCount(tl, root, at, k);
    loops(tl, root, end, k);
    camera(tl, root.querySelector('.sd-main'), opts.camera || el._camera || 'flat', end, opts.exit ?? 0.9, k);
    focus(tl, root, units, shift, k, end);
    return tl;
  }

  function enter(tl, n, t, style, k) {
    let kind = n.dataset.a;
    const d = (sec) => sec * k;
    if (kind === 'draw' && (typeof n.getTotalLength !== 'function' || getComputedStyle(n).strokeDasharray !== 'none')) kind = 'fade';
    const ease = style.ease;
    switch (kind) {
      case 'fade': return tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: d(0.6), ease }, t);
      case 'rise': return tl.fromTo(n, { opacity: 0, y: style.distance * 0.9, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: d(0.9), ease }, t);
      case 'blur': return tl.fromTo(n, { opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)', duration: d(1), ease }, t);
      case 'pop': return tl.fromTo(n, { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: d(0.6), ease: 'back.out(1.6)' }, t);
      case 'zoom': return tl.fromTo(n, { opacity: 0, scale: 0.82, transformOrigin: '50% 50%', filter: 'blur(8px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: d(1.3), ease: 'expo.out' }, t);
      case 'drop': return tl.fromTo(n, { opacity: 0, y: -46 }, { opacity: 1, y: 0, duration: d(1.1), ease: 'expo.out' }, t);
      case 'growx': return tl.fromTo(n, { scaleX: 0, transformOrigin: n.dataset.o === 'left center' || !n.dataset.o ? '0% 50%' : n.dataset.o }, { scaleX: 1, duration: d(0.9), ease: 'expo.out' }, t);
      case 'growy': return tl.fromTo(n, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: d(0.9), ease: 'expo.out' }, t);
      case 'sweep':
        tl.fromTo(n, { x: 0 }, { x: 1700, duration: d(2.2), ease: 'power2.inOut' }, t);
        return tl.fromTo(n, { opacity: 0 }, { keyframes: { '15%': { opacity: 1 }, '80%': { opacity: 1 }, '100%': { opacity: 0 } }, duration: d(2.2), ease: 'none' }, t);
      case 'draw': {
        const len = Math.max(1, n.getTotalLength());
        tl.set(n, { strokeDasharray: `${len} ${len + 2}` }, 0);
        return tl.fromTo(n, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: d(Math.min(1.5, Math.max(0.55, len * 0.00115))), ease: 'power2.inOut' }, t);
      }
      default: return null;
    }
  }

  function decodeAndCount(tl, root, at, k) {
    const G = '01<>/\\#%+=_▮▯:';
    root.querySelectorAll('.t.mono').forEach((el, i) => {
      const host = el.closest('[data-a]');
      if (!host) return;
      [...el.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()).forEach((node, j) => {
        const final = node.textContent, p = { v: 0 }, seed = i * 7 + j * 3;
        tl.to(p, {
          v: 1, duration: Math.min(0.9, 0.3 + final.length * 0.04) * k, ease: 'none',
          onUpdate() {
            const L = final.length, done = Math.floor(p.v * (L + 3)) - 3, fr = Math.floor(p.v * 40);
            node.textContent = p.v >= 1 ? final : [...final].map((ch, x) => (x <= done || ch === ' ' ? ch : x <= done + 4 ? G[(x * 13 + fr * 7 + seed) % G.length] : '·')).join('');
          },
        }, at(host) + 0.12);
      });
    });
    root.querySelectorAll('[data-count]').forEach(n => {
      const to = parseFloat(n.dataset.count), dec = (String(n.dataset.count).split('.')[1] || '').length, p = { v: 0 };
      const host = n.closest('[data-a]');
      tl.to(p, { v: to, duration: 1.7 * k, ease: 'power3.out', onUpdate() { n.textContent = p.v.toFixed(dec); } }, host ? at(host) : 0);
    });
  }

  /** Ambient motion, made finite so the composition has a measurable end. */
  function loops(tl, root, end, k) {
    root.querySelectorAll('[data-loop]').forEach(n => {
      const start = (n.dataset.t != null ? +n.dataset.t : 1800) / 1000;
      if (start >= end) return;
      const kind = n.dataset.loop, dur = (+n.dataset.dur || 0) / 1000;
      const reps = period => Math.max(0, Math.floor((end - start) / period) - 1);
      const fit = period => Math.min(period, end - start); // a cycle never runs past the scene end
      switch (kind) {
        case 'comet': {
          const len = Math.max(1, n.getTotalLength()), seg = Math.min(+n.dataset.seg || 110, len * 0.45), period = fit(dur || Math.min(5.2, Math.max(1.8, len * 0.0052)));
          tl.set(n, { strokeDasharray: `${seg} ${len + seg}`, strokeDashoffset: seg, opacity: 0.85 }, 0);
          tl.to(n, { strokeDashoffset: -len, duration: period * 0.62, ease: 'sine.inOut', repeat: reps(period), repeatDelay: period * 0.38 }, start);
          break;
        }
        case 'pulse': {
          const period = fit(dur || 2.6);
          tl.fromTo(n, { opacity: 0.75, scale: 1, transformOrigin: '50% 50%' }, { opacity: 0, scale: 2.1, duration: period, ease: 'power2.out', repeat: reps(period) }, start);
          break;
        }
        case 'spin': {
          const period = dur || 30, dir = +n.dataset.dir || 1;
          tl.to(n, { rotation: dir * 360 * ((end - start) / period), svgOrigin: `${n.dataset.ox} ${n.dataset.oy}`, duration: end - start, ease: 'none' }, start);
          break;
        }
        case 'drift': {
          const s0 = start % (dur || 6), period = Math.min(dur || 6, end - s0), dx = +n.dataset.dx || 0, dy = +n.dataset.dy || -10, op = +n.dataset.op || 0.5;
          const count = Math.max(0, Math.floor((end - s0) / period) - 1);
          tl.fromTo(n, { x: 0, y: 0 }, { x: dx, y: dy, duration: period, ease: 'none', repeat: count }, s0);
          tl.fromTo(n, { opacity: 0 }, { keyframes: { '30%': { opacity: op }, '70%': { opacity: op }, '100%': { opacity: 0 } }, duration: period, ease: 'none', repeat: count }, s0);
          break;
        }
        case 'breathe': {
          const period = fit(dur || 3.2);
          tl.fromTo(n, { opacity: 0.25 }, { opacity: 1, duration: period / 2, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, Math.floor((end - start) / (period / 2)) - 1) }, start);
          break;
        }
        case 'push': break; // the camera hold owns slow push-ins in deterministic hosts
        default: break;
      }
    });
  }

  /** Enter → hold drift → optional exit, all on the authoritative timeline. */
  function camera(tl, main, name, end, exit, k) {
    const c = CAMERA_POSES[name] || CAMERA_POSES.flat;
    const enterDur = name === 'flat' ? 0 : 2.8 * k, exitDur = exit > 0 ? Math.min(exit, end * 0.2) : 0;
    const holdEnd = end - exitDur;
    const p = { v: 0 };
    const apply = pose => { main.style.transform = c.tpl(pose); main.style.opacity = pose.o; };
    apply(c.from);
    tl.to(p, { v: 1, duration: enterDur || 0.001, ease: 'power3.inOut', onUpdate: () => apply(lerpPose(c.from, c.at, p.v)) }, 0);
    const q = { v: 0 };
    tl.to(q, { v: 1, duration: Math.max(0.001, holdEnd - enterDur), ease: 'sine.inOut', onUpdate: () => apply(lerpPose(c.at, c.drift, q.v)) }, enterDur);
    if (exitDur) {
      const r = { v: 0 };
      tl.to(r, { v: 1, duration: exitDur, ease: 'power2.in', onUpdate: () => apply({ ...lerpPose(c.drift, c.from, r.v), o: 1 - r.v }) }, holdEnd);
    }
  }

  /** While a unit is being revealed, earlier units step back; everything returns at the resolve cue. */
  function focus(tl, root, units, shift, k, end) {
    const order = units.filter(u => u.focus !== false && u.id !== 'resolve');
    if (order.length < 2) return;
    const startOf = u => u.at / 1000 * k + (shift[u.id] || 0);
    const resolve = units.find(u => u.id === 'resolve');
    const resolveAt = resolve ? startOf(resolve) : end;
    order.forEach((u, i) => {
      if (i === 0) return;
      const prev = order.slice(0, i).flatMap(p => [...root.querySelectorAll('[data-u="' + p.id + '"]')]);
      tl.to(prev, { opacity: 0.38, duration: 0.35, ease: 'power2.out' }, startOf(u));
    });
    const all = order.flatMap(p => [...root.querySelectorAll('[data-u="' + p.id + '"]')]);
    tl.to(all, { opacity: 1, duration: 0.55, ease: 'power2.inOut' }, resolveAt);
  }

  SD.timeline = timeline;
})();
