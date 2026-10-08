/* Stage Diagrams — video component runtime (iPolloWork / HyperFrames).
 * The authored native nodes are the component. This runtime only keeps them in step with the component's
 * variables: rows → engine layout → geometry patched onto the same nodes; one paused GSAP timeline whose
 * row beats follow motionCueTimes (narration) and whose lifecycle is enter → hold → exit.
 */
(() => {
  'use strict';
  const SD = window.StageDiagrams;

  /** The shared data-form contract for a spec's rows (the editor's table, validation and AI input). */
  function contract(spec) {
    const r = spec.rows, icons = Object.keys(SD.icons).map(v => ({ value: v, label: v }));
    return {
      version: 1, kind: 'category-value', mode: 'replace', rowId: 'id',
      binding: { variable: r.variable, encoding: 'json' }, minRows: r.min, maxRows: r.max,
      columns: [
        { id: 'id', label: 'ID', labelZh: '标识', type: 'string', role: 'id', required: true },
        ...r.columns.map(c => ({ id: c.id, label: c.label, labelZh: c.labelZh, type: c.type || 'string', role: c.role || 'value', ...(c.min !== undefined ? { min: c.min } : {}), ...(c.max !== undefined ? { max: c.max } : {}), ...(c.integer ? { integer: true } : {}), ...(c.required ? { required: true } : {}), ...(c.maxLength ? { maxLength: c.maxLength } : {}), ...(c.list ? { list: c.list } : {}), ...(c.icon ? { options: icons } : c.options ? { options: c.options } : {}) })),
      ],
    };
  }

  // Variables → engine data. Columns and fields address engine data by path ("children.0.label"):
  // `bool` cells read yes/no, `list` cells split on their separators, `level` cells keep 0/1/2 as numbers.
  const split = (c, v) => window.StageComponentContent.parseComponentTextList(String(v), c.list.separators);
  const convert = (c, v) => c.type === 'number' ? Number(v) : c.bool ? v === 'yes' || v === true : c.list ? split(c, v) : c.level && /^[012]$/.test(String(v)) ? Number(v) : v;
  // An empty child slot with only flags (emphasis "no") is not content and is dropped.
  const flagsOnly = x => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every(y => typeof y === 'boolean');
  const compact = v => Array.isArray(v) ? v.filter(x => x !== undefined && !flagsOnly(x)).map(compact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)])) : v;
  function rowItems(spec, data) {
    const r = spec.rows;
    return r ? (r.keys ? r.keys.map(key => getPath(data, key)) : getPath(data, r.field) || []) : [];
  }
  function posterEntries(r, rows) {
    const texts = r.columns.filter(c => (c.type || 'string') === 'string' && !c.icon && !c.bool && !c.level && !c.options && !String(c.field || '').includes('.') && (c.role === 'label' || !c.required));
    const label = texts.find(c => c.role === 'label') || texts[0], room = c => c.list ? c.list.maxItems * c.list.itemMaxLength : c.maxLength || 0;
    const desc = texts.filter(c => c !== label).sort((a, b) => room(b) - room(a))[0];
    const say = (c, row) => (c && row[c.id] != null ? String(row[c.id]).split('\n').map(x => x.trim()).filter(Boolean).join(' · ') : '');
    return label ? rows.map(row => ({ label: say(label, row), desc: say(desc, row) })) : [];
  }
  function toData(spec, values, parse) {
    const data = JSON.parse(JSON.stringify(spec.base || {}));
    const r = spec.rows, rows = r ? parse(contract(spec), String(values[r.variable] ?? '')) : [];
    if (r) {
      const items = rows.map(row => {
        const item = {};
        for (const c of r.columns) {
          const v = row[c.id];
          if (v == null || v === '') continue;
          setPath(item, c.field || c.id, convert(c, v));
        }
        return compact(item);
      });
      // Fixed slots retain authored decoration, but editable subtrees come entirely from saved rows.
      // Clearing a point or figure must not resurrect the example's text.
      if (r.keys) r.keys.forEach((key, i) => {
        const fixed = { ...getPath(data, key) };
        for (const c of r.columns) delete fixed[(c.field || c.id).split('.')[0]];
        setPath(data, key, { ...fixed, ...items[i] });
      });
      else setPath(data, r.field, items);
    }
    // Poster: what each row says in one line — its label cell and its roomiest descriptive cell (keys such as ids
    // and sender / receiver names are structure, not description).
    const entries = r ? posterEntries(r, rows) : [];
    for (const v of spec.vars || []) {
      const value = values[v.id], field = v.field || v.id;
      if (v.type === 'boolean') { setPath(data, field, value === true); continue; }
      if (v.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${v.label} must be a number.`);
        setPath(data, field, value);
        continue;
      }
      if (typeof value !== 'string' || (v.required && !value.trim())) throw Error(`${v.label} is required and must be text.`);
      if (v.maxLength && Array.from(value).length > v.maxLength) throw Error(`${v.label} supports at most ${v.maxLength} Unicode characters; no text was truncated.`);
      if (v.json) {
        let parsed;
        try { parsed = JSON.parse(value); } catch { throw Error(`${v.label} must be valid JSON.`); }
        setPath(data, field, parsed);
        continue;
      }
      if (v.icon && !Object.hasOwn(SD.icons, value)) throw Error(`Unknown ${v.label}: ${value}`);
      if (v.options && !v.options.some(option => option.value === value)) throw Error(`Unknown ${v.label}: ${value}`);
      setPath(data, field, v.list ? split(v, value) : value);
    }
    const problem = spec.check && spec.check(data);
    if (problem) throw Error(problem);
    if (entries.length) setPath(data, 'poster.items', entries);
    return { data, count: rows.length, entries, ids: rows.map(row => String(row.id ?? '')) };
  }
  const keys = root => Array.from(root.querySelectorAll('[data-hf-id^="sd"]'), n => n.getAttribute('data-hf-id'));
  function patchable(live, fresh) {
    const have = new Set(keys(live)), next = keys(fresh);
    if (next.some(key => !have.has(key))) return false;
    return have.size === next.length || !!fresh.querySelector('[data-u^="r"]');
  }
  // Same rule as authoring: in document order each text node binds to the first unused row cell or field
  // with exactly its text, so canvas edits keep writing the variables after a rebuild.
  function bind(root, spec, values) {
    const r = spec.rows, pointers = [];
    if (r) {
      let rows = [];
      try { rows = JSON.parse(String(values[r.variable] ?? '')).rows || []; } catch { rows = []; }
      rows.forEach((row, i) => r.columns.filter(c => !c.bool && !c.icon && !c.list && c.type !== 'number')
        .forEach(c => row[c.id] != null && row[c.id] !== '' && pointers.push({ raw: String(row[c.id]), pointer: `/${r.variable}/rows/${i}/${c.id}` })));
    }
    for (const v of spec.vars || []) if (!v.icon && !v.list && v.type !== 'number' && values[v.id]) pointers.push({ raw: String(values[v.id]), pointer: `/${v.id}` });
    const used = new Set();
    for (const t of root.querySelectorAll('.sd-text')) {
      const raw = t.getAttribute('data-raw') ?? t.textContent;
      const p = pointers.find(candidate => !used.has(candidate) && candidate.raw === raw);
      if (p) { used.add(p); t.setAttribute('data-var-text', p.pointer); }
    }
  }

  // "/items/rows/2/title" → that cell of a JSON data variable (or a scalar variable for "/name").
  function cell(values, pointer) {
    const [id, ...rest] = pointer.replace(/^\//, '').split('/');
    let v = values[id];
    if (rest.length) { try { v = JSON.parse(String(v)); } catch { return null; } }
    for (const k of rest) { if (v == null) return null; v = v[k]; }
    return v;
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    keys.slice(0, -1).reduce((o, k, i) => (o[k] = o[k] || (/^\d+$/.test(keys[i + 1]) ? [] : {})), obj)[keys.at(-1)] = value;
  }
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // Project theme tokens supply the colors and determine light/dark contrast.
  function attrs(values, root) {
    const a = { skin: values.skin || 'keynote', chrome: values.chrome ? null : 'none', fx: values.fx === false ? 'none' : null, layout: values.layout && values.layout !== 'full' ? values.layout : null };
    if (values.camera && values.camera !== 'auto') a.camera = values.camera;
    const bg = getComputedStyle(root).getPropertyValue('--ipw-color-bg').trim();
    if (bg) {
      const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = bg;
      const m = /^#(..)(..)(..)$/.exec(c.fillStyle);
      const l = m ? (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255 : 0;
      a.theme = l > 0.5 ? 'light' : 'dark';
    }
    return a;
  }

  /**
   * Row beats keep the exact motionRecipe defaults; measured motionCueTimes override them. A cue is keyed by the row's
   * id (stable when rows are reordered) or by step-N (its position); "resolve" times the conclusion (totals, outputs,
   * an intersection). Motion is never stretched: a cue that does not fit is an error naming the key.
   */
  function beats(count, duration, cues, spec, factor = 1, ids = []) {
    const events = spec.motionRecipe.events.slice(0, count);
    if (!cues || typeof cues !== 'object' || Array.isArray(cues)) throw Error('motionCueTimes must be a JSON object, e.g. {"<row id>": 1.2, "resolve": 9.5}.');
    const at = Array(events.length).fill(undefined);
    let resolve;
    for (const [key, value] of Object.entries(cues)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error(`motionCueTimes.${key} must be a non-negative number of seconds.`);
      if (key === 'resolve') { resolve = value; continue; }
      const step = /^step-(\d+)$/.exec(key), i = step ? Number(step[1]) - 1 : ids.indexOf(key);
      if (i < 0 || i >= events.length) throw Error(`motionCueTimes.${key} names no current row; use a row id or step-1…step-${events.length}.`);
      if (at[i] !== undefined) throw Error(`motionCueTimes sets row ${i + 1} twice (${key}); give each row one cue.`);
      at[i] = value;
    }
    // Rows without a cue sit evenly between the cued rows around them (after the last cue: one beat apart), so a
    // narration only needs to cue the rows it names.
    const times = events.map(event => event.time);
    const anchors = at.map((t, i) => (t === undefined ? -1 : i)).filter(i => i >= 0);
    if (anchors.length) {
      anchors.forEach(i => { times[i] = at[i]; });
      for (let i = 0; i < events.length; i++) {
        if (at[i] !== undefined) continue;
        const prev = anchors.filter(k => k < i).pop(), next = anchors.find(k => k > i);
        if (prev === undefined) times[i] = Math.min(events[i].time, times[next] - (next - i) * events[i].duration * factor);
        else if (next === undefined) times[i] = times[prev] + (i - prev) * events[i].duration * factor;
        else times[i] = times[prev] + ((times[next] - times[prev]) * (i - prev)) / (next - prev);
      }
    }
    for (let i = 0; i < events.length; i++) {
      const finish = times[i] + events[i].duration * factor;
      if (finish > duration - spec.motionRecipe.minHoldSeconds + .001 || (i && times[i] + .001 < times[i - 1] + events[i - 1].duration * factor)) throw Error(`Row ${i + 1}${ids[i] ? ` (${ids[i]})` : ''} at ${times[i]}s does not fit: rows need ${events[i].duration * factor}s each, in order, and ${spec.motionRecipe.minHoldSeconds}s of full view before ${duration}s. Shorten the narration gaps or the row count; motion is never stretched.`);
    }
    if (resolve !== undefined) {
      const last = times.length ? times[times.length - 1] : 0;
      if (resolve < last + .7 || resolve > duration - 1.6) throw Error(`motionCueTimes.resolve must fall between ${(last + .7).toFixed(1)}s (after the last row) and ${(duration - 1.6).toFixed(1)}s.`);
    }
    times.resolve = resolve;
    return times;
  }

  /* Complete camera moves. Each one owns the whole scene: open → move (or follow the explained rows) → reveal the
   * full diagram → hold (readable, at least 1s) → close. Users only pick the move; timing adapts to the rows,
   * the scene length and the narration cues. State: x/y in diagram px, s scale, rx/rz degrees, o opacity. */
  // Four camera moves; open and close always show the whole diagram at its normal size. 平稳 / 俯视 / 立体 are one
  // continuous, eased move across the scene (dolly, crane, orbit) and never chase rows. 聚焦 is its own shot, offered
  // only where the content unfolds along a path (spec.focus): it follows the explanation stop by stop.
  const CAMERAS = {
    // 平稳: rises in from below, one slow dolly-in through the scene, drifts up as it fades.
    steady: { open: { y: 36, s: .97, o: 0 }, rest: {}, travel: { s: 1.08, y: -16 }, close: { y: -24, o: 0 } },
    // 俯视: a crane shot — starts tilted, rises toward frontal across the scene with a slight turn, tilts away.
    overhead: { open: { rx: 42, s: .94, y: 30, o: 0 }, rest: { rx: 28, s: .93 }, travel: { rx: 8, rz: 3, s: .99, y: -8 }, close: { rx: 24, y: 18, o: 0 } },
    // 立体: turns from the front into an isometric view, then one slow orbit around the structure, turns back.
    dimension: { open: { o: 0 }, rest: { rx: 50, rz: -38, s: .86 }, travel: { rx: 46, rz: -12, s: .89 }, close: { rx: 0, rz: 0, s: 1, o: 0 } },
    // 聚焦: opens on the whole diagram, then follows the explanation (see direct()).
    focus: { open: { o: 0 }, rest: {}, travel: {}, close: { o: 0 } },
  };
  // 聚焦: a gentle push (scale), the lead before each beat so the camera arrives as the row lands, the longest glide,
  // the margin the diagram keeps to the frame edges, and how far explained rows recede.
  const FOCUS = { s: 1.3, lead: .45, glide: 1.25, edge: 40, soften: .7 };
  // Earlier saved values keep working.
  const LEGACY = { flat: 'steady', tilt: 'overhead', iso: 'dimension', unfold: 'dimension', dolly: 'steady' };
  const NEUTRAL = { x: 0, y: 0, s: 1, rx: 0, rz: 0, o: 1 };
  const W = 1200, H = 675;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function mount(o) {
    const { root, spec, gsap, id } = o;
    const duration = Number(root.closest('[data-source-duration]')?.getAttribute('data-source-duration') || root.parentElement?.closest('[data-hf-authored-duration]')?.getAttribute('data-hf-authored-duration') || root.getAttribute('data-duration') || o.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw Error('The native component requires a positive host scene duration.');
    const stage = root.querySelector('.sd-root'), main = root.querySelector('.sd-native'), over = root.querySelector('.sd-over-native'), cam = root.querySelector('.sd-cam');
    const hf = window.__hyperframes || {};
    const read = () => hf.getVariables ? hf.getVariables() : (window.__hfVariablesByComp && window.__hfVariablesByComp[id]) || {};
    const parse = (contract, value) => {
      if (!hf.parseVisualComponentData) throw Error('This native component requires the shared HyperFrames visual data parser; row capacity and text constraints cannot be bypassed.');
      const r = hf.parseVisualComponentData(contract, value);
      if (r.issues.length) throw Error(r.issues.map(i => i.message).join('; '));
      return r.document.rows;
    };
    window.__timelines = window.__timelines || {};
    const tl = window.__timelines[id] && window.__timelines[id].clear ? window.__timelines[id].clear() : gsap.timeline({ paused: true });
    let count = 0, cameraName = null, items = [], entries = [], lastValidValues = null;


    function layout(values, prepared) {
      const { data, count: n, entries: said } = prepared || toData(spec, { ...o.defaults, ...values }, parse);
      count = n; entries = said || [];
      items = rowItems(spec, data);
      const a = attrs({ ...o.defaults, ...values }, root);
      for (const k of ['skin', 'chrome', 'fx', 'layout', 'camera', 'theme']) a[k] ? stage.setAttribute(k, a[k]) : stage.removeAttribute(k);
      const fresh = SD.native.render(spec.type, data, a, 'sd');
      if (o.model) {
        bind(fresh.root, spec, { ...o.defaults, ...values });
        const issues = SD.native.preflight(fresh, stage);
        if (issues.length) throw Error(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
      }
      const chosen = LEGACY[values.camera] || values.camera;
      cameraName = CAMERAS[chosen] && (chosen !== 'focus' || spec.focus) ? chosen : spec.camera || (fresh.camera === 'iso' ? 'dimension' : fresh.camera === 'tilt' ? 'overhead' : 'steady');
      const merged = { ...o.defaults, ...values };
      // Renderers without per-row units key nodes in drawing order, so a changed row or item count would shift
      // every later key. Then the diagram is rebuilt from the fresh drawing and its text re-bound to the variables.
      const rebuildMain = !patchable(main, fresh.root), rebuildOver = !!(over && fresh.over) && !patchable(over, fresh.over);
      // Rebuilt nodes reference the fresh render's patterns and gradients; ids are unique per render, so adding them
      // keeps both patched (older) and rebuilt (newer) references valid.
      const defs = stage.querySelector(':scope > svg[width="0"]');
      if ((rebuildMain || rebuildOver) && defs && fresh.defs) defs.insertAdjacentHTML('beforeend', fresh.defs);
      if (rebuildMain) { main.replaceChildren(...fresh.root.childNodes); bind(main, spec, merged); }
      else SD.native.patch(main, fresh.root);
      if (over && fresh.over) rebuildOver ? over.replaceChildren(...fresh.over.childNodes) : SD.native.patch(over, fresh.over);
      // Bound text shows its cell now, so motion that reads the text (decode) starts from the right value.
      for (const t of main.querySelectorAll('[data-var-text]')) {
        const v = cell(merged, t.getAttribute('data-var-text'));
        if (v != null && t.textContent !== String(v)) t.textContent = String(v);
      }
    }

    function motionPlan(values, n, ids) {
      let cues;
      try { cues = JSON.parse(String(values.motionCueTimes)); } catch { throw Error('motionCueTimes is invalid JSON; keep the last valid cue map and supply step-N numbers.'); }
      const motionStyle=typeof values.motionStyle === 'string' && values.motionStyle.startsWith('{') ? JSON.parse(values.motionStyle) : { preset: values.motionStyle || 'balanced' };
      const factor = motionStyle.durationFactor ?? ({ restrained: 1.15, balanced: 1, energetic: .85 }[motionStyle.preset] ?? 1);
      if (!Number.isFinite(factor) || factor <= 0) throw Error('Invalid motion style duration factor.');
      return { times: beats(n, duration, cues, spec, factor, ids), speed: 1 / factor };
    }

    // Diagram-space bounds of every explained row: its bound text cells plus its native row unit, if any.
    function rowBounds(count) {
      const saved = cam.style.transform;
      cam.style.transform = 'none';
      const frame = cam.getBoundingClientRect(), k = frame.width / W || 1;
      const out = Array.from({ length: count }, (_, i) => {
        const nodes = [
          ...main.querySelectorAll('[data-var-text*="/rows/' + i + '/"]'),
          ...Array.from(main.querySelectorAll('[data-u]')).filter(n => new RegExp(`^r${i}(?!\\d)`).test(n.getAttribute('data-u'))),
        ].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
        if (!nodes.length) return null;
        // Vector wrappers span the whole frame: measure what they draw (their shapes and text).
        const rects = nodes.flatMap(n => {
          if (n.classList.contains('sd-text')) return [n.getBoundingClientRect()];
          const parts = Array.from(n.querySelectorAll('svg > :not(defs), .sd-text')).map(x => x.getBoundingClientRect()).filter(r => r.width || r.height);
          return parts.length ? parts : [n.getBoundingClientRect()];
        });
        const r = rects.reduce((a, b) => ({ l: Math.min(a.l, b.left), t: Math.min(a.t, b.top), r: Math.max(a.r, b.right), b: Math.max(a.b, b.bottom) }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
        return { x: (r.l - frame.left) / k, y: (r.t - frame.top) / k, w: (r.r - r.l) / k, h: (r.b - r.t) / k, nodes };
      });
      cam.style.transform = saved;
      return out;
    }

    // Poster: the left column follows the right. Each row beat swaps in that row's label and line, the progress
    // graphic lights up to the current row, and the closing hold lists every row. Setters repaint on every seek.
    function link(times, settleAt, openEnd) {
      if (!over) return;
      const text = u => over.querySelector('.sd-text[data-u="' + u + '"], [data-u="' + u + '"] .sd-text');
      const item = text('poster-item'), desc = text('poster-desc'), sum = text('poster-sum');
      const marks = Array.from(over.querySelectorAll('[data-u="poster-g"]')), n = times.length, m = marks.length;
      const opts = { immediateRender: false, lazy: false };
      const fade = (nodes, from, to, at, dur) => nodes.length && tl.fromTo(nodes, { opacity: from }, { opacity: to, duration: dur, ease: 'sine.inOut', ...opts }, Math.max(0, at));
      if (item && n && entries.length) {
        let shown = -1;
        const P = {};
        Object.defineProperty(P, 'k', {
          get: () => Math.max(0, shown),
          set: v => {
            const i = clamp(Math.round(v), 0, Math.min(n, entries.length) - 1);
            if (i === shown) return;
            shown = i;
            item.textContent = entries[i].label;
            if (desc) desc.textContent = entries[i].desc;
          },
        });
        const both = [item, desc].filter(Boolean);
        tl.fromTo(P, { k: 0 }, { k: 0, duration: .01, ...opts }, 0);
        tl.set(both, { opacity: 0, lazy: false }, 0);
        // The left column lands just after the row it describes, never ahead of it.
        fade(both, 0, 1, times[0] + .15, .45);
        for (let i = 1; i < n; i++) {
          const gap = Math.min(.3, (times[i] - times[i - 1]) / 3);
          fade(both, 1, 0, times[i] - gap, gap);
          tl.fromTo(P, { k: i - 1 }, { k: i, duration: .01, ease: 'none', ...opts }, times[i] - .01);
          fade(both, 0, 1, times[i] + .15, .4);
        }
        // The closing list follows the last row's own moment, even when narration places it late.
        const close = Math.max(times[n - 1] + .6, Math.min(Math.max(settleAt, times[n - 1] + 1.2), duration - 1.6));
        fade(both, 1, 0, close, .4);
        if (sum) { tl.set(sum, { opacity: 0, lazy: false }, 0); fade([sum], 0, 1, close + .3, .6); }
      } else if (sum) tl.set(sum, { opacity: 0, lazy: false }, 0);
      if (m) {
        // Progress 0 → 1 across the explained rows (or across the shot when the diagram has no rows).
        let p = -1;
        const G = {};
        Object.defineProperty(G, 'p', {
          get: () => Math.max(0, p),
          set: v => { p = v; marks.forEach((mark, j) => { mark.style.opacity = String(.22 + .78 * clamp(v * m - j, 0, 1)); }); },
        });
        tl.fromTo(G, { p: 0 }, { p: 0, duration: .01, ...opts }, 0);
        if (n) times.forEach((t, i) => tl.fromTo(G, { p: i / n }, { p: (i + 1) / n, duration: Math.max(.3, Math.min(1.2, (times[i + 1] ?? settleAt) - t)), ease: 'sine.inOut', ...opts }, t));
        else tl.fromTo(G, { p: 0 }, { p: 1, duration: Math.max(.5, settleAt - openEnd), ease: 'sine.inOut', ...opts }, openEnd);
      }
    }

    // One writer for the camera so seeks in either direction always land on the same frame.
    function direct(times, speed, bounds) {
      const shot = CAMERAS[cameraName] || CAMERAS.steady, n = times.length;
      // Camera state lives behind setters: seeks suppress tween callbacks, so writing a value must repaint.
      const V = { ...NEUTRAL, ...shot.open }, S = {};
      for (const key of Object.keys(NEUTRAL)) Object.defineProperty(S, key, { enumerable: true, get: () => V[key], set: value => { V[key] = value; paint(); } });
      const paint = () => {
        // The camera pivots on the diagram's own region, so card and poster layouts keep it on its side of the frame.
        cam.style.transformOrigin = `${origin.x.toFixed(1)}px ${origin.y.toFixed(1)}px`;
        cam.style.transform = `perspective(1700px) translate(${S.x.toFixed(2)}px, ${S.y.toFixed(2)}px) rotateX(${S.rx.toFixed(2)}deg) rotateZ(${S.rz.toFixed(2)}deg) scale(${S.s.toFixed(4)})`;
        // No CSS blur on the stage: a blurred full-frame 3D layer stalls headless rendering and export.
        cam.style.opacity = String(S.o);
        if (over) over.style.opacity = String(S.o);
      };
      const rest = { ...NEUTRAL, ...shot.rest };
      const known = bounds.filter(Boolean);
      const whole = known.length ? known.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.x + b.w), b: Math.max(a.b, b.y + b.h) }), { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity }) : { x: 0, y: 0, r: W, b: H };
      whole.w = whole.r - whole.x; whole.h = whole.b - whole.y;
      const origin = known.length ? { x: whole.x + whole.w / 2, y: whole.y + whole.h / 2 } : { x: W / 2, y: H / 2 };

      // Every shot ends the same way: settle back to the normal frontal full view, hold it so the whole diagram can be
      // read, then only fade. Before that: one continuous move.
      const fade = Math.min(.7, duration * .08), minHold = 1, settle = 1.2;
      const openEnd = Math.min(1.4 / speed, duration * .16);
      const settleAt = Math.max(openEnd, duration - fade - minHold - settle);
      const front = { ...NEUTRAL };
      const keys = [];
      // Poster: the diagram shares the frame with the left column, so pushes are half as strong and the diagram's
      // left edge (its box starts at x 436, core POSTER.tx) never crosses the divider.
      const poster = stage.getAttribute('layout') === 'poster';
      const guard = to => {
        if (!poster || to.s === undefined) return to;
        const s = 1 + (to.s - 1) * .5, left = origin.x + (Math.min(whole.x, 436) - origin.x) * s;
        return { ...to, s, x: Math.max(to.x ?? 0, 440 - left) };
      };
      const go = (at, dur, to, ease) => keys.push({ at, dur: Math.max(.05, dur), to: guard(to), ease });
      const following = cameraName === 'focus' && known.length > 1 && n > 1;
      if (following) {
        // The frame the diagram owns in this layout.
        const lay = stage.getAttribute('layout');
        const R = lay === 'poster' ? { x: 440, y: 0, w: W - 440, h: H } : lay === 'card' ? { x: 96, y: 106, w: W * .84, h: H * .84 } : { x: 0, y: 0, w: W, h: H };
        const e = FOCUS.edge;
        // Center the row in the frame, but never let the diagram's edge come inside the frame's margin.
        const axis = (c, o, lo, hi, a, size, s) => {
          const want = a + size / 2 - o - (c - o) * s;
          const min = a + size - e - (o + (hi - o) * s), max = a + e - (o + (lo - o) * s);
          return min <= max ? clamp(want, min, max) : (min + max) / 2;
        };
        // Edges come from everything readable (headers, axis names, rows), so a push never crops a label.
        const saved = cam.style.transform;
        cam.style.transform = 'none';
        const fr = cam.getBoundingClientRect(), kk = fr.width / W || 1;
        const all = Array.from(main.querySelectorAll('.sd-text')).filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => n.getBoundingClientRect());
        cam.style.transform = saved;
        const ink = all.reduce((a, r) => ({ x: Math.min(a.x, (r.left - fr.left) / kk), y: Math.min(a.y, (r.top - fr.top) / kk), r: Math.max(a.r, (r.right - fr.left) / kk), b: Math.max(a.b, (r.bottom - fr.top) / kk) }), { x: whole.x, y: whole.y, r: whole.r, b: whole.b });
        // Push only as far as the whole stop (its name, its shape, its detail) still fits the frame comfortably.
        const aim = b => {
          const s = clamp(Math.min(R.w * .86 / Math.max(b.w, 1), R.h * .86 / Math.max(b.h, 1)), 1, FOCUS.s);
          return { ...NEUTRAL, s, x: axis(b.x + b.w / 2, origin.x, ink.x, ink.r, R.x, R.w, s), y: axis(b.y + b.h / 2, origin.y, ink.y, ink.b, R.y, R.h, s) };
        };
        const stops = times.map((t, i) => [t, bounds[i]]).filter(([, b]) => b);
        go(0, openEnd, front, 'power2.out');
        let at = openEnd, last = at;
        stops.forEach(([t, b], i) => {
          const start = Math.max(last, i ? t - FOCUS.lead / speed : at);
          const end = Math.max(start + .6, Math.min(start + FOCUS.glide, i ? t + .8 / speed : t + .9 / speed, settleAt - .2));
          go(start, end - start, aim(b), i ? 'sine.inOut' : 'power2.inOut');
          last = end;
        });
        const back = Math.max(last, Math.min(times[n - 1] + 1.2 / speed, settleAt - .4));
        go(back, Math.max(.8, settleAt + settle - back), front, 'power2.inOut');
        go(Math.max(back + .8, settleAt + settle), Math.max(.05, duration - Math.max(back + .8, settleAt + settle)), front, 'none');
        // Rows already explained recede a little while the camera follows; all return for the full view.
        const texts = bounds.map(b => (b ? b.nodes.filter(node => node.classList.contains('sd-text')) : []));
        const opts = { immediateRender: false, lazy: false };
        times.forEach((t, i) => i && texts.slice(0, i).flat().forEach(node => tl.to(node, { filter: `opacity(${FOCUS.soften})`, duration: .6, ease: 'sine.inOut', ...opts }, t)));
        texts.flat().forEach(node => tl.to(node, { filter: 'opacity(1)', duration: .8, ease: 'sine.inOut', ...opts }, back));
      } else {
        go(0, openEnd, rest, 'power2.out');
        go(openEnd, settleAt - openEnd, { ...rest, ...shot.travel }, 'sine.inOut');
        go(settleAt, settle, front, 'sine.inOut');
        go(settleAt + settle, duration - settleAt - settle, front, 'none');
      }

      // Sequential, explicit from → to tweens: deterministic in both seek directions.
      let from = { ...S };
      // lazy: false — every seek writes the camera immediately, as frame-by-frame export requires.
      tl.set(S, { ...from, lazy: false }, 0);
      const { o: opened, ...start } = from;
      from = { ...start };
      for (const k of keys) {
        const { o: _, ...target } = { ...NEUTRAL, ...from, ...k.to };
        tl.fromTo(S, { ...from }, { ...target, duration: k.dur, ease: k.ease, immediateRender: false, lazy: false }, k.at);
        from = target;
      }
      // Opacity fades on its own, so the opening and closing moves keep their full speed.
      tl.fromTo(S, { o: opened }, { o: 1, duration: fade, ease: 'sine.out', immediateRender: false, lazy: false }, 0);
      tl.fromTo(S, { o: 1 }, { o: shot.close.o ?? 0, duration: fade, ease: 'sine.in', immediateRender: false, lazy: false }, duration - fade);
      paint();
      link(times, settleAt, openEnd);

    }

    function motion(values, plan) {
      const v = { ...o.defaults, ...values };
      const { times, speed } = plan;
      // Each row's authored motion keeps its internal rhythm and moves as one beat.
      const base = new Map();
      main.querySelectorAll('[data-t]').forEach(n => {
        const u = n.closest('[data-u]')?.getAttribute('data-u');
        if (!u) return;
        const t = (+n.getAttribute('data-t') || 0) / 1000;
        const row = /^r(\d+)/.exec(u), key = row ? `r${row[1]}` : u;
        if (!base.has(key) || t < base.get(key)) base.set(key, t);
      });
      const current = items.findIndex(x => x && (x.hl || x.now));
      // Renderers without per-row units are grouped semantically, so every row arrives whole on its own beat:
      //  1. structure — an animated group holding one row's text (its card, chip or node) is that row;
      //  2. connectors — a drawn line belongs to the row it leads into, and draws just before that row lands;
      //  3. marks — a small shape (icon, dot, ring) belongs to the nearest row;
      //  4. summaries — counters that belong to no row (totals, scores) resolve the scene after the last row.
      // Everything else (axes, spines, frames, backgrounds) is the skeleton and enters first.
      const bounds = rowBounds(times.length), owner = new Map(), summary = new Set(), spines = [];
      if (!main.querySelector('[data-u^="r"]') && bounds.some(Boolean)) {
        const saved = cam.style.transform;
        cam.style.transform = 'none';
        const frame = cam.getBoundingClientRect(), k = frame.width / W || 1;
        const box = r => ({ x: (r.left - frame.left) / k, y: (r.top - frame.top) / k, w: r.width / k, h: r.height / k });
        // What a node actually draws: vector wrappers span the whole frame, so measure their shapes and text.
        const drawn = node => {
          const parts = Array.from(node.querySelectorAll('svg > :not(defs), .sd-text')).concat(node.matches('.sd-text, svg > *') ? [node] : []);
          const rs = parts.map(n => n.getBoundingClientRect()).filter(r => r.width || r.height);
          if (!rs.length) return box(node.getBoundingClientRect());
          const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), rr = Math.max(...rs.map(r => r.right)), bb = Math.max(...rs.map(r => r.bottom));
          return box({ left: l, top: t, width: rr - l, height: bb - t });
        };
        const claim = (node, i) => {
          owner.set(node, i);
          const t = (+node.getAttribute('data-t') || 0) / 1000;
          if (!base.has(`g${i}`) || t < base.get(`g${i}`)) base.set(`g${i}`, t);
        };
        const grow = (i, b) => {
          const a = bounds[i];
          if (!a || (!b.w && !b.h)) return;
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          a.w = Math.max(a.x + a.w, b.x + b.w) - x; a.h = Math.max(a.y + a.h, b.y + b.h) - y; a.x = x; a.y = y;
        };
        const gap = (b, x, y) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
        const owned = node => { for (let p = node; p && p !== main; p = p.parentElement) if (owner.has(p)) return true; return false; };
        // List cells and list fields are not bound to canvas text; their items still say which row or field they are.
        const listed = new Map();
        if (spec.rows) {
          let rows = [];
          try { rows = JSON.parse(String(v[spec.rows.variable] ?? '')).rows || []; } catch {}
          rows.forEach((row, i) => spec.rows.columns.filter(c => c.list && row[c.id]).forEach(c => split(c, row[c.id]).forEach(item => listed.has(item) || listed.set(item, { row: i }))));
        }
        for (const f of spec.vars || []) if (f.list && v[f.id]) split(f, v[f.id]).forEach(item => listed.has(item) || listed.set(item, { field: f.id }));
        const texts = node => [node, ...node.querySelectorAll('.sd-text')].filter(n => n.classList.contains('sd-text'));
        const rowOf = node => [
          ...[node, ...node.querySelectorAll('[data-var-text*="/rows/"]')].map(n => /\/rows\/(\d+)\//.exec(n.getAttribute('data-var-text') || '')).filter(Boolean).map(m => +m[1]),
          ...texts(node).filter(n => !n.hasAttribute('data-var-text')).map(n => listed.get(n.textContent.trim())).filter(x => x && x.row != null).map(x => x.row),
        ];
        const animated = Array.from(main.querySelectorAll('[data-t]'));
        // Declared conclusions (spec.resolve: field ids) wait for every row.
        const resolve = spec.resolve ? new RegExp(spec.resolve) : null;
        const concludes = node => !!resolve && ([node, ...node.querySelectorAll('[data-var-text]')].some(n => { const p = n.getAttribute('data-var-text'); return p && !p.includes('/rows/') && resolve.test(p.slice(1)); })
          || texts(node).some(n => { const x = listed.get(n.textContent.trim()); return x && x.field && resolve.test(x.field); }));
        const summaryBoxes = [];
        const rest = [];
        for (const node of animated) {
          const own = new Set(rowOf(node).filter(i => i < bounds.length && bounds[i]));
          if (own.size === 1) { const i = [...own][0]; claim(node, i); grow(i, drawn(node)); }
          else if (!own.size && concludes(node)) { summary.add(node); summaryBoxes.push(drawn(node)); }
          else if (!own.size) rest.push(node);
        }
        const rowBoxes = bounds.map(b => b && { ...b });
        const area = rowBoxes.filter(Boolean).reduce((m, b) => Math.max(m, b.w * b.h), 0);
        const floor = rowBoxes.filter(Boolean).reduce((m, b) => Math.max(m, b.y + b.h), 0);
        const lines = [], large = [], marks = [], ends = [], fills = [];
        const lineOf = node => {
          const path = node.matches('path, line, polyline') ? node : node.querySelector(':scope > svg > path, :scope > svg > line, :scope > svg > polyline');
          return path && typeof path.getTotalLength === 'function' && getComputedStyle(path).fill === 'none' ? path : null;
        };
        for (const node of rest) {
          if (owned(node)) continue;
          const r = drawn(node), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          // Totals and scores: counters, or fixed figures set below every row.
          const figure = !node.querySelector('[data-var-text]') && !node.hasAttribute('data-var-text') && /\d/.test(node.textContent) && r.y > floor;
          if (node.querySelector('[data-count]') || node.hasAttribute('data-count') || figure) { summary.add(node); summaryBoxes.push(r); continue; }
          const path = lineOf(node);
          if (path) { lines.push([node, path]); continue; }
          // Named parts of the structure (axis and quadrant names, titles) are the skeleton, wherever they sit.
          if ([node, ...node.querySelectorAll('[data-var-text]')].some(n => { const p = n.getAttribute('data-var-text'); return p && !p.includes('/rows/'); })) continue;
          if (r.w * r.h > Math.max(area * 2.5, 6000)) {
            // A large shape level with exactly one row (a layer slab beside its label) belongs to that row.
            const level = rowBoxes.map((b, i) => (b && cy >= b.y - b.h * .5 && cy <= b.y + b.h * 1.5 && r.h <= Math.max(b.h * 3, 120) ? i : -1)).filter(i => i >= 0);
            if (level.length === 1) { claim(node, level[0]); continue; }
            large.push([node, r]); continue;
          }
          let best = -1, near = 60;
          rowBoxes.forEach((b, i) => { if (b) { const d = gap(b, cx, cy); if (d < near) { near = d; best = i; } } });
          if (best >= 0) { claim(node, best); grow(best, r); continue; }
          // Marks on a conclusion (its icon, its frame) conclude with it.
          if (summaryBoxes.some(b => gap(b, cx, cy) < 36)) summary.add(node);
          else marks.push([node, cx, cy]);
        }
        // Connectors last, against rows grown by their marks: a line belongs to the row it arrives at.
        for (const [node, path] of lines) {
          if (owned(node)) continue;
          let end = null, start = null;
          try {
            const L = path.getTotalLength(), m = path.getScreenCTM();
            const at = d => { const pt = path.getPointAtLength(d); return { x: (m.a * pt.x + m.c * pt.y + m.e - frame.left) / k, y: (m.b * pt.x + m.d * pt.y + m.f - frame.top) / k }; };
            end = at(L); start = at(0);
          } catch {}
          if (!end) continue;
          // A line that starts or ends at a conclusion (the second curve, the flow into an output) concludes too.
          if (summaryBoxes.some(b => gap(b, end.x, end.y) < 40 || gap(b, start.x, start.y) < 40)) { summary.add(node); ends.push(end); fills.push(drawn(node)); continue; }
          // A line through several rows (a spine, a trend curve) draws across their beats, row by row.
          if (node.getAttribute('data-a') === 'draw') {
            const L = path.getTotalLength(), m = path.getScreenCTM(), hit = new Set();
            for (let j = 0; j <= 24; j++) {
              const pt = path.getPointAtLength(L * j / 24), x = (m.a * pt.x + m.c * pt.y + m.e - frame.left) / k, y = (m.b * pt.x + m.d * pt.y + m.f - frame.top) / k;
              bounds.forEach((b, i) => { if (b && gap(b, x, y) < 30) hit.add(i); });
            }
            if (hit.size > 1) { spines.push([node, Math.min(...hit), Math.max(...hit)]); continue; }
          }
          let best = -1, near = 40;
          bounds.forEach((b, i) => { if (b) { const d = gap(b, end.x, end.y); if (d < near) { near = d; best = i; } } });
          if (best >= 0) claim(node, best);
        }
        // A large shape lying on a concluding line (the area under a curve) concludes with it.
        const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        for (const [node, r] of large) if (!owned(node) && fills.some(b => overlap(r, b) > .6 * r.w * r.h)) summary.add(node);
        // A mark at the end of a concluding line (its arrowhead or end dot) concludes with it.
        for (const [node, cx, cy] of marks) if (!owned(node) && ends.some(e => Math.hypot(e.x - cx, e.y - cy) < 20)) summary.add(node);
        cam.style.transform = saved;
      }
      // Conclusions follow the last row and keep enough of the scene to be read before the closing move.
      const last = times.length ? times[times.length - 1] : 0;
      const summaryAt = times.resolve ?? (times.length ? Math.max(last + .7 / speed, Math.min(last + 1.1 / speed, duration - 2.6)) : 0);
      const summaryBase = Math.min(...Array.from(summary, n => (+n.getAttribute('data-t') || 0) / 1000), Infinity);
      const shift = node => {
        // A row (or the conclusion) lands on its beat and keeps its own rhythm, compressed to under a second.
        const own = ((+node.getAttribute('data-t') || 0) / 1000) / speed;
        const land = (at, from) => at + Math.min(Math.max(0, own - from), .9) - own;
        for (let p = node; p && p !== main; p = p.parentElement) {
          if (owner.has(p)) { const i = owner.get(p); return land(times[i], (base.get(`g${i}`) ?? 0) / speed); }
          if (summary.has(p)) return land(summaryAt, summaryBase / speed);
        }
        const u = node.closest('[data-u]') && node.closest('[data-u]').getAttribute('data-u');
        const row = u && /^r(\d+)/.exec(u);
        if (row) { const i = +row[1]; return i < times.length ? times[i] - (base.get(`r${i}`) ?? 0) / speed : 0; }
        if (u === 'cur' && current >= 0 && current < times.length) return times[current] - ((+node.getAttribute('data-t') || 0) / 1000) / speed;
        return 0;
      };
      tl.clear();
      // Rebuilding cues must keep authored line drawing; only clear dash styling created by this compiler.
      const drawDashes = new Map();
      stage.querySelectorAll('svg [data-a="draw"]').forEach(node => {
        if (node.hasAttribute('data-sd-dash') && node.style.strokeDasharray === node.getAttribute('data-sd-dash')) { node.style.strokeDasharray = ''; node.style.strokeDashoffset = ''; }
        drawDashes.set(node, node.style.strokeDasharray);
      });
      // Unused authored capacity stays in the editor, but contributes no invisible motion or decoder.
      const inactive = [];
      const hidden = node => { for (let p = node; p && p !== stage; p = p.parentElement) if (p.style.visibility === 'hidden') return true; return false; };
      stage.querySelectorAll('[data-a], [data-loop], [data-count], .sd-text.mono').forEach(node => {
        if (!hidden(node)) return;
        const attrs = ['data-a', 'data-loop', 'data-count'].filter(key => node.hasAttribute(key)).map(key => [key, node.getAttribute(key)]), mono = node.classList.contains('mono');
        attrs.forEach(([key]) => node.removeAttribute(key));
        if (mono) node.classList.remove('mono');
        inactive.push({ node, attrs, mono });
      });
      try { SD.native.compile(gsap, stage, { into: tl, end: duration, speed, shift }); }
      finally { inactive.forEach(({ node, attrs, mono }) => { attrs.forEach(([key, value]) => node.setAttribute(key, value)); if (mono) node.classList.add('mono'); }); }
      for (const [node, first, end] of spines) {
        const draws = tl.getTweensOf(node).filter(tw => 'strokeDashoffset' in (tw.vars || {}));
        if (!draws.length) continue;
        draws.forEach(tw => tw.kill());
        const len = Math.max(1, node.getTotalLength());
        tl.fromTo(node, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: Math.max(.6, times[end] - times[first] + .5 / speed), ease: 'none', immediateRender: true, lazy: false }, Math.max(0, times[first] - .1 / speed));
      }
      drawDashes.forEach((before, node) => {
        if (!before && node.style.strokeDasharray) node.setAttribute('data-sd-dash', node.style.strokeDasharray);
        else node.removeAttribute('data-sd-dash');
      });
      // Attach semantic events to the actual native geometry/tweens, not just the manifest.
      main.querySelectorAll('[data-u]').forEach(node => {
        const row = /^r(\d+)/.exec(node.getAttribute('data-u'));
        const i = row ? Number(row[1]) : node.getAttribute('data-u') === 'cur' ? current : -1;
        if (i < 0) return;
        node.setAttribute('data-ipw-motion-event', `step-${i + 1}`);
        node.setAttribute('data-ipw-animation-reference', `step-${i + 1}`);
      });
      tl.getChildren(true, true, false).forEach(tween => {
        const target = tween.targets().find(node => node instanceof Element && !node.hasAttribute('data-loop'));
        const unit = target && target.closest('[data-u]');
        const row = unit && /^r(\d+)/.exec(unit.getAttribute('data-u'));
        const decoder = !target && tween.targets().some(value => value && Object.getOwnPropertyDescriptor(value, 'p')?.set);
        const decoderRow = decoder ? times.findLastIndex(time => tween.startTime() + .001 >= time && tween.startTime() < time + 1.4 / speed) : -1;
        let owned = -1;
        for (let p = target; p && p !== main && owned < 0; p = p.parentElement) if (owner.has(p)) owned = owner.get(p);
        const i = row ? Number(row[1]) : unit && unit.getAttribute('data-u') === 'cur' ? current : owned >= 0 ? owned : decoderRow;
        if (i >= 0) { tween.data = `component:${spec.name}#step-${i + 1}`; tween.vars.data = tween.data; }
      });
      direct(times, speed, bounds);
      // Pad the authored duration without capturing an inactive host's visibility.
      tl.to({}, { duration: 0 }, duration);
      // Rebuilt tweens must render from zero before apply() restores the saved playhead.
      // Seeking to the unchanged time alone can leave new text setters unrendered.
      tl.seek(0);
    }

    function apply(values = read()) {
      const merged = { ...o.defaults, ...values };
      try {
        if (o.model) {
          const validation = window.StageComponentContent.validateComponentVariables({ ...o.model, duration }, merged);
          if (validation.errors.length) throw Error(validation.errors.map(i => `${i.path}: ${i.message}`).join('\n'));
        }
        const prepared = toData(spec, merged, parse), plan = motionPlan(merged, prepared.count, prepared.ids);
        const time = tl.time();
        layout(merged, prepared); motion(merged, plan); tl.seek(time);
        lastValidValues = merged;
      } catch (error) {
        if (lastValidValues) {
          const prepared = toData(spec, lastValidValues, parse), plan = motionPlan(lastValidValues, prepared.count, prepared.ids), time = tl.time();
          layout(lastValidValues, prepared); motion(lastValidValues, plan); tl.seek(time);
        }
        throw error;
      }
    }
    apply();
    window.__timelines[id] = tl;
    if (hf.onVariablesChange) hf.onVariablesChange(root, values => apply(values));
    return tl;
  }

  SD.component = { mount, toData, beats, contract };
})();
