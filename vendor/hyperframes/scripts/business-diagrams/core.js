/*!
 * Stage Diagrams — minimal, animated, themeable diagrams for product launches,
 * product explainers and tech education.  <stage-diagram type="hub" accent="#7C8CFF">
 * MIT License
 */
(() => {
  'use strict';
  // Several diagram blocks can share one page (HyperFrames inlines sub-compositions): the first core owns the
  // element and helper state; later copies only add their renderers to it.
  if (window.StageDiagrams) return;

  const W = 1200, H = 675;
  const SANS = '"Geist", "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
  const MONO = '"Geist Mono", "JetBrains Mono", "SF Mono", ui-monospace, "PingFang SC", monospace';
  const FONT_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&family=Inter+Tight:wght@500;600;700;800&family=Doto:wght@500;700;900&family=DotGothic16&family=Instrument+Serif:ital@0;1&display=swap';
  const EASE = 'cubic-bezier(.16,1,.3,1)';

  /* ------------------------------------------------------------------ CSS */
  const CSS = `
stage-diagram{
  display:block;position:relative;outline:none;
  --sd-accent:var(--ipw-color-accent,#7C8CFF);
  --sd-bg:var(--ipw-color-bg,#050507);
  --sd-fg:var(--ipw-color-text,#EDEDF0);
  --sd-sans:var(--ipw-font-body,${SANS});--sd-mono:${MONO};
  --sd-display:var(--ipw-font-display,"Inter Tight",${SANS});
  --sd-surface:var(--ipw-color-surface,color-mix(in oklab,var(--sd-fg) 5%,var(--sd-bg)));
  --sd-surface-2:color-mix(in oklab,var(--sd-fg) 10%,var(--sd-bg));
  --sd-line:color-mix(in oklab,var(--sd-fg) 8%,transparent);
  --sd-line-2:var(--ipw-color-border,color-mix(in oklab,var(--sd-fg) 17%,transparent));
  --sd-line-3:color-mix(in oklab,var(--sd-fg) 32%,transparent);
  --sd-muted:var(--ipw-color-muted,color-mix(in oklab,var(--sd-fg) 58%,var(--sd-bg)));
  --sd-faint:color-mix(in oklab,var(--sd-fg) 36%,var(--sd-bg));
  --sd-acc-hi:color-mix(in oklab,var(--sd-accent) 72%,white);
  --sd-acc-soft:color-mix(in oklab,var(--sd-accent) 16%,transparent);
  --sd-acc-mid:color-mix(in oklab,var(--sd-accent) 45%,transparent);
  --sd-acc-node:color-mix(in oklab,var(--sd-accent) 13%,var(--sd-surface));
  background:var(--sd-bg);color:var(--sd-fg);
}
/* Standalone light theme; inside iPolloWork the --ipw-* tokens decide and data-tone follows their luminance. */
stage-diagram[theme=light]{
  --sd-bg:var(--ipw-color-bg,#F6F6F3);--sd-fg:var(--ipw-color-text,#111113);
  --sd-surface:var(--ipw-color-surface,color-mix(in oklab,#fff 78%,var(--sd-bg)));
}
stage-diagram[data-tone=light]{
  --sd-surface-2:color-mix(in oklab,var(--sd-fg) 7%,var(--sd-bg));
  --sd-line-3:color-mix(in oklab,var(--sd-fg) 38%,transparent);
  --sd-acc-hi:color-mix(in oklab,var(--sd-accent) 82%,black);
  --sd-acc-soft:color-mix(in oklab,var(--sd-accent) 12%,transparent);
  --sd-acc-node:color-mix(in oklab,var(--sd-accent) 9%,var(--sd-surface));
}
stage-diagram[bg=none]{background:transparent}
stage-diagram .disp{font-family:var(--sd-display)}
stage-diagram .ex{fill:color-mix(in oklab,var(--sd-fg) 14%,var(--sd-bg))}
stage-diagram .ex.ac{fill:color-mix(in oklab,var(--sd-accent) 40%,var(--sd-bg))}
stage-diagram .ex-top.ac{fill:var(--sd-accent)}
stage-diagram .bar{fill:var(--sd-line-3)}
stage-diagram .bar.hl{fill:var(--sd-accent)}
/* ---------- skin: keynote — calm Silicon Valley demo look ---------- */
stage-diagram[skin=keynote]{--sd-sans:var(--ipw-font-body,"Inter Tight","Geist","PingFang SC",system-ui,sans-serif);--sd-display:var(--ipw-font-display,"Instrument Serif","Songti SC","Noto Serif SC",Georgia,serif)}
stage-diagram[skin=keynote]:not([theme=dark]){
  --sd-bg:var(--ipw-color-bg,#F4F3EE);--sd-fg:var(--ipw-color-text,#1A1A19);
  --sd-surface:var(--ipw-color-surface,#FFFFFF);--sd-surface-2:color-mix(in oklab,var(--sd-fg) 6%,var(--sd-bg));
  --sd-line:color-mix(in oklab,var(--sd-fg) 7%,transparent);--sd-line-2:var(--ipw-color-border,color-mix(in oklab,var(--sd-fg) 14%,transparent));--sd-line-3:color-mix(in oklab,var(--sd-fg) 30%,transparent);
  --sd-muted:var(--ipw-color-muted,color-mix(in oklab,var(--sd-fg) 55%,var(--sd-bg)));--sd-faint:color-mix(in oklab,var(--sd-fg) 38%,var(--sd-bg));
}
stage-diagram[skin=keynote] rect.nd,stage-diagram[skin=keynote] polygon.nd:not(.side),stage-diagram[skin=keynote] ellipse.nd:not(.side){fill:var(--sd-surface)!important;stroke:var(--sd-line-2)!important;filter:drop-shadow(0 1px 1px rgba(0,0,0,.04)) drop-shadow(0 10px 24px rgba(0,0,0,.07))}
stage-diagram[skin=keynote][data-tone=dark] rect.nd,stage-diagram[skin=keynote][data-tone=dark] polygon.nd:not(.side),stage-diagram[skin=keynote][data-tone=dark] ellipse.nd:not(.side){fill:var(--sd-surface-2)!important;filter:none}
stage-diagram[skin=keynote] .nd.hl{fill:var(--sd-acc-node)!important;stroke:var(--sd-accent)!important;stroke-width:1.4}
stage-diagram[skin=keynote] .nd.side{fill:var(--sd-surface-2)!important;stroke:var(--sd-line-2)!important}
stage-diagram[skin=keynote] rect.nd.ghost{fill:none!important;filter:none}
stage-diagram[skin=keynote] .gl,stage-diagram[skin=keynote] .gl-line,stage-diagram[skin=keynote] .glf,stage-diagram[skin=keynote] .halo,stage-diagram[skin=keynote] .pt,stage-diagram[skin=keynote] .vig,stage-diagram[skin=keynote] .grain,stage-diagram[skin=keynote] .ex{display:none}
stage-diagram[skin=keynote] .disp{font-weight:400!important;letter-spacing:-.01em}
stage-diagram[skin=keynote] .ex-top{font-weight:400}
stage-diagram[skin=keynote] .ln.hl{stroke-width:1.6}
stage-diagram[skin=keynote] .comet{opacity:.8}
stage-diagram[skin=keynote] .band{fill:color-mix(in oklab,var(--sd-fg) 2.5%,transparent);stroke:none}
/* ---------- skin: dot — dot-matrix / electronic display ---------- */
stage-diagram[skin=dot]{
  --sd-sans:"Doto","DotGothic16","PingFang SC",ui-monospace,monospace;
  --sd-mono:"Doto","DotGothic16","PingFang SC",ui-monospace,monospace;
  --sd-display:"Doto","DotGothic16","PingFang SC",monospace;
  background:radial-gradient(120% 95% at 0% 0%,color-mix(in oklab,var(--sd-accent) 26%,var(--sd-bg)) 0%,var(--sd-bg) 58%),var(--sd-bg);
}
stage-diagram[skin=dot][bg=none]{background:transparent}
stage-diagram[skin=dot] text,stage-diagram[skin=dot] .t{font-weight:700}
stage-diagram[skin=dot] .mono{letter-spacing:.06em}
stage-diagram[skin=dot] .ln{stroke-dasharray:0 5.2;stroke-width:2.3}
stage-diagram[skin=dot] .ln.faint{stroke-dasharray:0 7;stroke-width:1.8;stroke:var(--sd-line-2)}
stage-diagram[skin=dot] .ln.hl{stroke-width:2.8;stroke-dasharray:0 4.6}
stage-diagram[skin=dot] .ln.thick{stroke-width:3.4;stroke-dasharray:0 5}
stage-diagram[skin=dot] .ico{stroke-dasharray:0 2.6;stroke-width:1.9}
stage-diagram[skin=dot] .nd{stroke-dasharray:0 4;stroke-width:1.6;stroke-linecap:round}
stage-diagram[skin=dot] .nd.hl{stroke-width:2.2}
stage-diagram[skin=dot] .gl,stage-diagram[skin=dot] .gl-line{opacity:.35}
stage-diagram[skin=dot] .comet{stroke-width:3.2}
stage-diagram[skin=dot] .chrome-ln{stroke-dasharray:0 3.5;stroke-linecap:round;stroke-width:1.6}
/* ---------- skin: editorial — Swiss / magazine print ---------- */
stage-diagram[skin=editorial]{
  --sd-sans:"Inter Tight","Geist","PingFang SC",system-ui,sans-serif;
  --sd-line-2:color-mix(in oklab,var(--sd-fg) 30%,transparent);
  --sd-line-3:color-mix(in oklab,var(--sd-fg) 70%,transparent);
}
stage-diagram[skin=editorial] rect.nd{rx:0;ry:0;fill:var(--sd-bg)!important;stroke:var(--sd-fg)!important;stroke-width:1}
stage-diagram[skin=editorial] rect.nd.hl{fill:var(--sd-fg)!important;stroke:var(--sd-fg)!important}
stage-diagram[skin=editorial] rect.nd.ghost{fill:none!important;stroke:var(--sd-line-3)!important}
stage-diagram[skin=editorial] .nd.side,stage-diagram[skin=editorial] polygon.nd{fill:var(--sd-bg)!important;stroke:var(--sd-fg)!important}
stage-diagram[skin=editorial] polygon.nd.hl{fill:var(--sd-accent)!important}
stage-diagram[skin=editorial] .hlg text{fill:var(--sd-bg)}
stage-diagram[skin=editorial] .hlg .t{color:var(--sd-bg)}
stage-diagram[skin=editorial] .hlg .ico{stroke:var(--sd-bg)}
stage-diagram[skin=editorial] .gl,stage-diagram[skin=editorial] .gl-line,stage-diagram[skin=editorial] .glf,stage-diagram[skin=editorial] .halo,stage-diagram[skin=editorial] .pt{display:none}
stage-diagram[skin=editorial] .ln.hl{stroke-width:2}
stage-diagram[skin=editorial] .band{fill:none;stroke:var(--sd-line-2)}
stage-diagram[skin=editorial] .band.hl{fill:var(--sd-acc-soft);stroke:var(--sd-accent)}
stage-diagram[skin=editorial] .vig{display:none}
stage-diagram[skin=editorial] text{font-weight:500}
stage-diagram[skin=editorial] .disp{font-weight:700}

stage-diagram:focus-visible{box-shadow:0 0 0 2px var(--sd-accent)}
stage-diagram .sd-stage{position:relative;overflow:hidden;aspect-ratio:16/9}
stage-diagram .sd-main{transform-origin:50% 56%;will-change:transform}
stage-diagram .sd-over{position:absolute;inset:0;pointer-events:none}
stage-diagram .gl-line{fill:none;stroke:var(--sd-accent);stroke-width:6;opacity:.16;stroke-linecap:round}
stage-diagram .comet-head{fill:none;stroke:color-mix(in oklab,var(--sd-acc-hi) 55%,white);stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 0 3px var(--sd-accent)) drop-shadow(0 0 8px var(--sd-accent))}
stage-diagram .pt{fill:var(--sd-fg)}
stage-diagram .chrome{fill:var(--sd-faint)}
stage-diagram .chrome-ln{fill:none;stroke:var(--sd-line-3);stroke-width:1}
stage-diagram:not([data-live]) .comet-head{display:none}
stage-diagram svg{display:block;width:100%;height:auto;overflow:visible;font-family:var(--sd-sans);-webkit-font-smoothing:antialiased}
stage-diagram text{fill:var(--sd-fg)}
stage-diagram text.mu{fill:var(--sd-muted)}
stage-diagram text.fa{fill:var(--sd-faint)}
stage-diagram text.ac{fill:var(--sd-acc-hi)}
stage-diagram text.inv{fill:var(--sd-bg)}
stage-diagram .mono{font-family:var(--sd-mono);letter-spacing:.08em}
stage-diagram .tf{overflow:visible}
stage-diagram .t{margin:0;color:var(--sd-fg);font-family:var(--sd-sans);white-space:nowrap}
stage-diagram .t.mono{font-family:var(--sd-mono)}
stage-diagram .t.disp{font-family:var(--sd-display)}
stage-diagram .t.mu{color:var(--sd-muted)}
stage-diagram .t.fa{color:var(--sd-faint)}
stage-diagram .t.ac{color:var(--sd-acc-hi)}
stage-diagram .t.inv{color:var(--sd-bg)}
stage-diagram .t.ko{text-shadow:0 0 3px var(--sd-bg),0 0 6px var(--sd-bg),0 0 12px var(--sd-bg)}
stage-diagram .ko{paint-order:stroke;stroke:var(--sd-bg);stroke-width:6px;stroke-linejoin:round}
stage-diagram .nd{fill:var(--sd-surface);stroke:var(--sd-line-2);stroke-width:1}
stage-diagram .nd.hl{fill:var(--sd-acc-node);stroke:var(--sd-accent)}
stage-diagram .nd.side{fill:var(--sd-surface-2)}
stage-diagram .nd.side.hl{fill:color-mix(in oklab,var(--sd-accent) 26%,var(--sd-bg))}
stage-diagram .nd.ghost{fill:none}
stage-diagram .nd.plate{fill:color-mix(in oklab,var(--sd-surface) 86%,transparent)}
stage-diagram .nd.plate.hl{fill:color-mix(in oklab,var(--sd-acc-node) 90%,transparent)}
stage-diagram .band{fill:color-mix(in oklab,var(--sd-fg) 3%,transparent);stroke:var(--sd-line);stroke-width:1}
stage-diagram .band.hl{fill:var(--sd-acc-soft);stroke:color-mix(in oklab,var(--sd-accent) 55%,transparent)}
stage-diagram .gl{fill:none;stroke:var(--sd-accent);stroke-width:4;opacity:.3}
stage-diagram .glf{fill:var(--sd-accent);opacity:.3}
stage-diagram .ln{fill:none;stroke:var(--sd-line-3);stroke-width:1.1;stroke-linecap:round;stroke-linejoin:round}
stage-diagram .ln.soft{stroke:var(--sd-line-2)}
stage-diagram .ln.faint{stroke:var(--sd-line)}
stage-diagram .ln.hl{stroke:var(--sd-accent);stroke-width:1.6}
stage-diagram .ln.thick{stroke-width:2.4}
stage-diagram .ln.dash{stroke-dasharray:2 5}
stage-diagram .ln.dash2{stroke-dasharray:6 6}
stage-diagram .ico{fill:none;stroke:var(--sd-fg);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
stage-diagram .ico.hl{stroke:var(--sd-acc-hi)}
stage-diagram .ico.mu{stroke:var(--sd-muted)}
stage-diagram .ico.inv{stroke:var(--sd-bg)}
stage-diagram[skin=keynote] circle.nd{fill:var(--sd-surface)!important;stroke:var(--sd-line-2)!important;filter:drop-shadow(0 1px 1px rgba(0,0,0,.05)) drop-shadow(0 8px 20px rgba(0,0,0,.08))}
stage-diagram[skin=keynote][data-tone=dark] circle.nd{fill:var(--sd-surface-2)!important;filter:none}
stage-diagram .f-ac{fill:var(--sd-accent)}
stage-diagram .f-hi{fill:var(--sd-acc-hi)}
stage-diagram .f-fg{fill:var(--sd-fg)}
stage-diagram .f-ln{fill:var(--sd-line-3)}
stage-diagram .f-bg{fill:var(--sd-bg)}
stage-diagram .f-soft{fill:var(--sd-acc-soft)}
stage-diagram .f-mid{fill:var(--sd-acc-mid)}
stage-diagram .f-faint{fill:var(--sd-line)}
stage-diagram .ring{fill:var(--sd-bg);stroke:var(--sd-line-3);stroke-width:1.2}
stage-diagram .ring.hl{fill:var(--sd-accent);stroke:var(--sd-accent)}
stage-diagram .tagbg{fill:var(--sd-bg);stroke:var(--sd-line-2);stroke-width:1}
stage-diagram .tagbg.hl{stroke:var(--sd-accent)}
stage-diagram .comet{fill:none;stroke:var(--sd-acc-hi);stroke-width:2;stroke-linecap:round;stroke-dasharray:0 99999;opacity:.6}
stage-diagram .pulse{fill:none;stroke:var(--sd-accent);stroke-width:1.2;opacity:0}
stage-diagram [data-a],stage-diagram [data-loop]{transform-box:fill-box;transform-origin:center}
stage-diagram[data-engine=gsap] [data-a],stage-diagram[data-engine=gsap] [data-loop]{transform-box:view-box;transform-origin:0 0}
stage-diagram:not([data-live]) .comet,stage-diagram:not([data-live]) .pulse,stage-diagram:not([data-live]) .live-only{display:none}
`;

  /* -------------------------------------------------------------- helpers */
  const q = n => Math.round(n * 10) / 10;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let CUR_U = null; // reveal unit currently being authored (see unit())
  const A = (a, t = 0) => (a ? ` data-a="${a}" data-t="${Math.round(t)}"${CUR_U ? ` data-u="${CUR_U}"` : ''}` : '');
  /** Open a reveal unit: elements created until the next unit() call move together when the unit is cued. */
  const unit = id => { CUR_U = id || null; };
  const pol = (cx, cy, r, ang, ry = r) => [cx + r * Math.cos(ang), cy + ry * Math.sin(ang)];
  const pts = arr => arr.map(p => q(p[0]) + ',' + q(p[1])).join(' ');
  const up = s => String(s ?? '').toUpperCase();
  let CUR = 'sd'; // id of the diagram currently being rendered (renders are synchronous)
  const url = name => `url(#${CUR}-${name})`;

  let _ctx;
  const FAMILY = { sans: SANS, mono: MONO }; // replaced per render by the resolved --sd-sans/--sd-mono
  function measure(s, size, weight = 400, mono = false) {
    _ctx = _ctx || document.createElement('canvas').getContext('2d');
    _ctx.font = `${weight} ${size}px ${mono ? FAMILY.mono : FAMILY.sans}`;
    s = String(s ?? '');
    return _ctx.measureText(s).width + (mono ? s.length * size * 0.08 : 0);
  }
  const TOK = /[⺀-鿿豈-﫿＀-￯　-〿][，。、；：！？）》」』,.;:!?)]*|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|\s+/g;
  function wrap(s, max, size, weight = 400, mono = false) {
    s = String(s ?? '');
    if (!max) return s.split('\n');
    const out = [];
    for (const para of s.split('\n')) {
      const toks = para.match(TOK) || [''];
      let line = '';
      for (const tk of toks) {
        const test = line + tk;
        if (line.trim() && measure(test.trimEnd(), size, weight, mono) > max) {
          out.push(line.trimEnd());
          line = tk.trimStart();
        } else line = test;
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  function lines(s, o = {}) {
    const mono = !!o.mono;
    let L = wrap(mono && o.upper !== false ? up(s) : s, o.max || 0, o.size || 14, o.weight || 400, mono);
    if (o.lines && L.length > o.lines) {
      L = L.slice(0, o.lines);
      L[o.lines - 1] = L[o.lines - 1].replace(/.$/, '…');
    }
    return L;
  }
  function textW(s, o = {}) {
    return Math.max(0, ...lines(s, o).map(l => measure(l, o.size || 14, o.weight || 400, !!o.mono)));
  }
  function textH(s, o = {}) {
    return lines(s, o).length * (o.size || 14) * (o.lh || 1.35);
  }
  /** Multi-line HTML text placed in SVG space. valign: middle | top | bottom relative to y. */
  function T(x, y, s, o = {}) {
    if (s == null || s === '') return '';
    const size = o.size || 14, wt = o.weight || 400, mono = !!o.mono, lh = o.lh || 1.35;
    const L = lines(s, o), step = size * lh, h = L.length * step;
    const w = Math.ceil(Math.max(1, ...L.map(l => measure(l, size, wt, mono)))) + 6;
    const va = o.valign || 'middle', an = o.anchor || 'start';
    const top = va === 'middle' ? y - h / 2 : va === 'bottom' ? y - h : y;
    const left = an === 'middle' ? x - w / 2 : an === 'end' ? x - w : x;
    const cls = ['t', mono ? 'mono' : '', o.cls || ''].join(' ').trim();
    const style = `font-size:${size}px;font-weight:${wt};line-height:${q(step)}px;text-align:${an === 'middle' ? 'center' : an === 'end' ? 'right' : 'left'}${o.ls != null ? `;letter-spacing:${o.ls}px` : ''}${o.style ? ';' + o.style : ''}`;
    return `<foreignObject class="tf" x="${q(left)}" y="${q(top)}" width="${q(w)}" height="${q(h + 2)}"${A(o.a, o.t)}><div xmlns="http://www.w3.org/1999/xhtml" class="${cls}" style="${style}">${L.map(esc).join('<br/>')}</div></foreignObject>`;
  }

  /* --------------------------------------------------------------- icons */
  const ICONS = {
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
    ai: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
    cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    cloud: 'M7 18h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 9.3 4.4 4.4 0 0 0 7 18z',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    shield: 'M12 3l8 3v6c0 4.8-3.4 7.9-8 9-4.6-1.1-8-4.2-8-9V6zM9 12l2 2 4-4',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.5 2.4 3.5 5.2',
    chat: 'M4 5h16v11H10l-5 4v-4H4z',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    chart: 'M4 20V11M10 20V4M16 20v-6M3 20h18',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3.4 3 14.6 0 18M12 3c-3 3.4-3 14.6 0 18',
    lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M4.9 4.9l2.5 2.5M16.6 16.6l2.5 2.5M4.9 19.1l2.5-2.5M16.6 7.4l2.5-2.5',
    book: 'M3 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3zM21 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z',
    cap: 'M2 9l10-5 10 5-10 5zM6 11v5c3.3 2.3 8.7 2.3 12 0v-5M22 9v6',
    cube: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM3.5 7.3L12 12l8.5-4.7M12 12v9.5',
    phone: 'M7 2.5h10v19H7zM11 18.5h2',
    laptop: 'M5 5h14v10H5zM2 19h20',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v4',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5l-4.5-4.5',
    image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9h.01',
    video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
    doc: 'M6 2.5h8l4 4v15H6zM14 2.5v4h4M9 12.5h6M9 16.5h6',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    agent: 'M5 8h14v11H5zM12 4v4M9.5 13h.01M14.5 13h.01M9.5 16h5M2.5 12v3M21.5 12v3',
    wave: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0',
    rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-5-5zM9 11l-4 1 2-4 4-1M13 15l-1 4 4-2 1-4',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    flow: 'M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 7v4a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4',
    play: 'M7 4l13 8-13 8z',
    heart: 'M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20z',
    star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
    calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    cart: 'M3 4h2l2.5 11h11L21 8H6.5M9 20h.01M17 20h.01',
    key: 'M8 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM11.5 11H21M18 11v3M15 11v2',
    brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z',
    trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6',
    compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    api: 'M4 12h4M16 12h4M12 4v4M12 16v4M9 9h6v6H9z',
    edge: 'M4 18h16M7 18V9l5-4 5 4v9M10 18v-5h4v5',
    pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
    sound: 'M4 9h4l5-4v14l-5-4H4zM17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12',
  };
  let CUR_ICONS = {}; // per-diagram overrides from data.icons
  const isImg = v => /^(img:|https?:|data:image|\.{0,2}\/)/.test(v);
  const ICON = name => {
    if (!name) return null;
    const v = CUR_ICONS[name] || ICONS[name] || name;
    if (isImg(v) || /^[Mm]/.test(v)) return v;
    return ICONS.spark;
  };
  function icon(name, cx, cy, o = {}) {
    const d = ICON(name);
    if (!d) return '';
    if (isImg(d)) {
      const z = (o.size || 22) * 1.1;
      return `<image href="${esc(d.replace(/^img:/, ''))}" x="${q(cx - z / 2)}" y="${q(cy - z / 2)}" width="${q(z)}" height="${q(z)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    const s = (o.size || 22) / 24;
    return `<g transform="translate(${q(cx - 12 * s)} ${q(cy - 12 * s)}) scale(${q(s * 100) / 100})"><path d="${d}" class="ico${o.inv ? ' inv' : o.hl ? ' hl' : ''}${o.mu ? ' mu' : ''}" style="stroke-width:${q(1.5 / s * 10) / 10}"/></g>`;
  }

  /* ---------------------------------------------------------- primitives */
  /** Node card centred at (cx, cy). Returns geometry + svg. */
  function card(cx, cy, o = {}) {
    const size = o.size || 15, wt = o.weight || 500, padX = o.padX ?? 18, padY = o.padY ?? 13;
    const ic = ICON(o.icon), iconW = ic ? 30 : 0;
    const maxW = o.maxW || 240;
    const maxT = maxW - padX * 2 - iconW;
    const L = wrap(o.label, maxT, size, wt);
    const S = o.sub ? wrap(up(o.sub), maxT, 10, 400, true) : [];
    const lw = Math.max(0, ...L.map(l => measure(l, size, wt)), ...S.map(l => measure(l, 10, 400, true)));
    const w = o.w || Math.max(o.minW || 0, Math.min(maxW, Math.ceil(lw + padX * 2 + iconW)));
    const th = L.length * size * 1.28 + (S.length ? 5 + S.length * 13 : 0);
    const h = o.h || Math.max(o.minH || 0, Math.ceil(th + padY * 2));
    const x = cx - w / 2, y = cy - h / 2, r = o.round ? h / 2 : o.r ?? 10;
    const hl = !!o.hl;
    let s = '';
    if (hl && o.glow !== false) s += `<rect x="${q(x)}" y="${q(y)}" width="${q(w)}" height="${q(h)}" rx="${q(r)}" class="gl" filter="${url('glow')}"/>`;
    if (o.double) s += `<rect x="${q(x - 5)}" y="${q(y - 5)}" width="${q(w + 10)}" height="${q(h + 10)}" rx="${q(r + 5)}" class="ln ${hl ? 'hl' : 'soft'}"/>`;
    const ghost = o.cls === 'ghost', dep = o.depth != null ? o.depth : 0;
    if (!ghost && dep) s += `<rect x="${q(x)}" y="${q(y + dep)}" width="${q(w)}" height="${q(h)}" rx="${q(r)}" class="nd side${hl ? ' hl' : ''}"/>`;
    s += `<rect x="${q(x)}" y="${q(y)}" width="${q(w)}" height="${q(h)}" rx="${q(r)}" class="nd${hl ? ' hl' : ''}${o.cls ? ' ' + o.cls : ''}" style="${ghost ? `fill:none;stroke:${url('ns')}` : hl ? `fill:${url('af')};stroke:${url('as')}` : `fill:${url('nf')};stroke:${url('ns')}`}"/>`;
    if (!ghost) s += `<path d="M${q(x + r)} ${q(y + 0.75)}H${q(x + w - r)}" style="stroke:url(#${CUR}-hiline)" stroke-width="1" fill="none"/>`;
    if (hl && o.ticks !== false) {
      const k = 7, g = 5, X0 = x - g, Y0 = y - g, X1 = x + w + g, Y1 = y + h + g;
      s += `<path d="M${q(X0)} ${q(Y0 + k)}V${q(Y0)}H${q(X0 + k)}M${q(X1 - k)} ${q(Y0)}H${q(X1)}V${q(Y0 + k)}M${q(X1)} ${q(Y1 - k)}V${q(Y1)}H${q(X1 - k)}M${q(X0 + k)} ${q(Y1)}H${q(X0)}V${q(Y1 - k)}" class="ln hl" style="stroke-width:1.2"/>`;
    }
    if (o.idx != null) s += `<text class="mono ${hl ? 'ac' : 'fa'}" x="${q(x + 2)}" y="${q(y - 12)}" font-size="9.5" dominant-baseline="central">${esc(String(o.idx).padStart(2, '0'))}</text>`;
    const tx = ic ? x + padX + iconW : cx, anchor = ic ? 'start' : 'middle';
    if (ic) s += icon(o.icon, x + padX + 10, cy, { hl, size: 20 });
    s += T(tx, cy - th / 2, o.label, { size, weight: wt, anchor, max: maxT, lh: 1.28, valign: 'top' });
    if (o.sub) s += T(tx, cy - th / 2 + L.length * size * 1.28 + 5, o.sub, { mono: true, size: 10, cls: hl ? 'ac' : 'mu', anchor, max: maxT, lh: 1.3, valign: 'top' });
    return { svg: `<g${hl ? ' class="hlg"' : ''}${A(o.a ?? 'rise', o.t || 0)}>${s}</g>`, w, h, x, y, cx, cy, l: x, r: x + w, t: y, b: y + h };
  }
  const hcurve = (x1, y1, x2, y2, k = 0.5) => {
    const dx = (x2 - x1) * k;
    return `M${q(x1)} ${q(y1)}C${q(x1 + dx)} ${q(y1)} ${q(x2 - dx)} ${q(y2)} ${q(x2)} ${q(y2)}`;
  };
  const vcurve = (x1, y1, x2, y2, k = 0.5) => {
    const dy = (y2 - y1) * k;
    return `M${q(x1)} ${q(y1)}C${q(x1)} ${q(y1 + dy)} ${q(x2)} ${q(y2 - dy)} ${q(x2)} ${q(y2)}`;
  };
  /** Full circle as a path starting at angle deg (so stroke-draw begins where we want). */
  const circP = (cx, cy, r, deg = -90) => {
    const a = (deg * Math.PI) / 180, [x1, y1] = [cx + r * Math.cos(a), cy + r * Math.sin(a)], [x2, y2] = [cx - r * Math.cos(a), cy - r * Math.sin(a)];
    return `M${q(x1)} ${q(y1)}A${q(r)} ${q(r)} 0 1 1 ${q(x2)} ${q(y2)}A${q(r)} ${q(r)} 0 1 1 ${q(x1)} ${q(y1)}`;
  };
  const line = (x1, y1, x2, y2) => `M${q(x1)} ${q(y1)}L${q(x2)} ${q(y2)}`;
  function smooth(P) {
    let d = `M${q(P[0][0])} ${q(P[0][1])}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      d += `C${q(p1[0] + (p2[0] - p0[0]) / 6)} ${q(p1[1] + (p2[1] - p0[1]) / 6)} ${q(p2[0] - (p3[0] - p1[0]) / 6)} ${q(p2[1] - (p3[1] - p1[1]) / 6)} ${q(p2[0])} ${q(p2[1])}`;
    }
    return d;
  }
  /** Connector path with optional travelling comet. */
  function edge(d, o = {}) {
    const cls = ['ln', o.hl && 'hl', o.soft && 'soft', o.faint && 'faint', o.dash && 'dash', o.thick && 'thick', o.cls].filter(Boolean).join(' ');
    let s = o.hl && o.glow !== false ? `<path d="${d}" class="gl-line" filter="${url('glow')}"${A('fade', (o.t || 0) + 500)}/>` : '';
    s += `<path d="${d}" class="${cls}"${A(o.a ?? 'draw', o.t || 0)}/>`;
    if (o.comet) s += `<path d="${d}" class="comet" data-loop="comet"${o.ct != null ? ` data-t="${Math.round(o.ct)}"` : ''}${o.dur ? ` data-dur="${o.dur}"` : ''}${o.rev ? ' data-rev=""' : ''}/>`;
    return s;
  }
  function arrow(x, y, ang, o = {}) {
    const s = o.s || 7, c = Math.cos(ang), n = Math.sin(ang);
    const p1 = [x - s * c - 0.6 * s * n, y - s * n + 0.6 * s * c];
    const p2 = [x - s * c + 0.6 * s * n, y - s * n - 0.6 * s * c];
    return `<path d="M${q(p1[0])} ${q(p1[1])}L${q(x)} ${q(y)}L${q(p2[0])} ${q(p2[1])}" class="ln${o.hl ? ' hl' : ''}"${A(o.a ?? 'fade', o.t || 0)}/>`;
  }
  const dot = (cx, cy, o = {}) => `<circle cx="${q(cx)}" cy="${q(cy)}" r="${o.r || 3}" class="${o.ring ? 'ring' + (o.hl ? ' hl' : '') : o.hl ? 'f-ac' : o.cls || 'f-ln'}"${A(o.a ?? 'pop', o.t || 0)}/>`;
  const pulse = (cx, cy, r, t = 1500, rx) =>
    rx ? `<ellipse class="pulse" cx="${q(cx)}" cy="${q(cy)}" rx="${q(rx)}" ry="${q(r)}" data-loop="pulse" data-t="${t}"/>` : `<circle class="pulse" cx="${q(cx)}" cy="${q(cy)}" r="${q(r)}" data-loop="pulse" data-t="${t}"/>`;
  const halo = (cx, cy, r, t = 100, op = 1) => `<circle class="halo" cx="${q(cx)}" cy="${q(cy)}" r="${q(r)}" fill="${url('halo')}" opacity="${op}"${A('fade', t)}/>`;
  function tag(cx, cy, s, o = {}) {
    if (!s) return '';
    const size = o.size || 10, w = measure(up(s), size, 500, true) + 16, h = size + 10;
    return `<g${A(o.a ?? 'fade', o.t || 0)}><rect x="${q(cx - w / 2)}" y="${q(cy - h / 2)}" width="${q(w)}" height="${h}" rx="${h / 2}" class="tagbg${o.hl ? ' hl' : ''}"/><text class="mono ${o.hl ? 'ac' : 'mu'}" x="${q(cx)}" y="${q(cy + 0.5)}" font-size="${size}" font-weight="500" text-anchor="middle" dominant-baseline="central">${esc(up(s))}</text></g>`;
  }
  /** Isometric hexagonal prism ("chip") — top face centred at (cx, cy). */
  function chip(cx, cy, o = {}) {
    const R = o.r || 40, f = 0.56, th = o.th ?? Math.max(3, Math.round(R * 0.13)), hl = o.hl ? ' hl' : '';
    const P = [0, 1, 2, 3, 4, 5].map(k => pol(cx, cy, R, Math.PI / 6 + (k * Math.PI) / 3, R * f));
    const B = P.map(p => [p[0], p[1] + th]);
    const side = [P[0], P[1], P[2], B[2], B[1], B[0]];
    let g = '';
    if (o.hl) g += `<polygon points="${pts(P)}" class="gl" filter="${url('glow')}"/>`;
    g += `<polygon points="${pts(side)}" class="nd side${hl}"/><polygon points="${pts(P)}" class="nd${hl}${o.ghost ? ' ghost' : ''}" style="${o.ghost ? '' : o.hl ? `fill:${url('af')}` : `fill:${url('nf')}`}"/>`;
    g += `<path d="M${q(P[1][0])} ${q(P[1][1])}V${q(B[1][1])}M${q(P[0][0])} ${q(P[0][1])}V${q(B[0][1])}M${q(P[2][0])} ${q(P[2][1])}V${q(B[2][1])}" class="ln faint"/>`;
    g += `<polygon points="${pts(P.map(p => [cx + (p[0] - cx) * 0.72, cy + (p[1] - cy) * 0.72]))}" class="ln ${o.hl ? 'hl' : 'faint'}" opacity="${o.hl ? 0.5 : 1}"/>`;
    if (o.icon) g += icon(o.icon, cx, cy, { hl: o.hl, size: o.iconSize || Math.round(R * 0.5) });
    else if (o.text) g += T(cx, cy, o.text, { mono: true, size: o.textSize || Math.round(R * 0.32), weight: 500, anchor: 'middle', cls: o.hl ? 'ac' : '' });
    const bot = cy + R * f + th, topY = cy - R * f;
    if (o.label) {
      const above = o.labelPos === 'above';
      g += T(cx, above ? topY - 16 - (o.sub ? 16 : 0) : bot + 18, o.label, { size: o.labelSize || 14, weight: 600, anchor: 'middle', max: o.labelMax || 160, lines: 1, cls: 'ko' });
      if (o.sub) g += T(cx, above ? topY - 16 : bot + 36, o.sub, { mono: true, size: 10, anchor: 'middle', cls: (o.hl ? 'ac' : 'mu') + ' ko', max: o.labelMax || 160, lines: 1 });
    }
    return { svg: `<g${A(o.a ?? 'rise', o.t || 0)}>${g}</g>`, cx, cy, top: topY, bottom: bot, r: R };
  }
  /** Circular icon badge (map-pin head). hl = solid accent with inverted icon. */
  function badge(cx, cy, o = {}) {
    const r = o.r || 22, hl = !!o.hl;
    let g = '';
    if (hl) g += `<circle cx="${q(cx)}" cy="${q(cy)}" r="${q(r + 7)}" class="ln hl" opacity=".3"/><circle cx="${q(cx)}" cy="${q(cy)}" r="${q(r + 10)}" class="glf" filter="${url('glow')}" opacity=".25"/>`;
    if (o.dash) g += `<circle cx="${q(cx)}" cy="${q(cy)}" r="${q(r + 9)}" class="ln soft dash2"/>`;
    g += hl ? `<circle cx="${q(cx)}" cy="${q(cy)}" r="${q(r)}" class="f-ac"/>` : `<circle cx="${q(cx)}" cy="${q(cy)}" r="${q(r)}" class="nd" style="fill:${url('nf')};stroke:${url('ns')}"/>`;
    if (o.icon) g += icon(o.icon, cx, cy, { size: o.iconSize || Math.round(r * 0.95), inv: hl });
    else if (o.text) g += T(cx, cy, o.text, { mono: true, size: o.textSize || Math.round(r * 0.55), weight: 500, anchor: 'middle', cls: hl ? '' : '' });
    return `<g${A(o.a ?? 'pop', o.t || 0)}>${g}</g>`;
  }
  /** Rounded orthogonal connector: horizontal → vertical (at xt) → horizontal. */
  function elbow(x0, y0, xt, y1, x1, r = 14) {
    if (Math.abs(y1 - y0) < 1) return `M${q(x0)} ${q(y0)}H${q(x1)}`;
    const sg = y1 > y0 ? 1 : -1, rr = Math.min(r, Math.abs(y1 - y0) / 2);
    return `M${q(x0)} ${q(y0)}H${q(xt - rr)}Q${q(xt)} ${q(y0)} ${q(xt)} ${q(y0 + sg * rr)}V${q(y1 - sg * rr)}Q${q(xt)} ${q(y1)} ${q(xt + rr)} ${q(y1)}H${q(x1)}`;
  }
  /** Small rounded label pill. */
  function pill(x, cy, s, o = {}) {
    const size = o.size || 12.5, w = measure(s, size, 500) + 22, h = size + 13, anchor = o.anchor || 'start';
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return `<g${A(o.a ?? 'rise', o.t || 0)}><rect x="${q(x0)}" y="${q(cy - h / 2)}" width="${q(w)}" height="${q(h)}" rx="${q(h / 2)}" class="nd${o.hl ? ' hl' : ''}" style="fill:${o.hl ? 'var(--sd-acc-node)' : 'var(--sd-surface)'};stroke:${o.hl ? url('as') : url('ns')}"/>${T(x0 + w / 2, cy, s, { size, weight: 500, anchor: 'middle', cls: o.hl ? '' : 'mu' })}</g>`;
  }
  /** Glowing cylinder ("core disk") — top ellipse centred at (cx, cy). */
  function disk(cx, cy, o = {}) {
    const cr = o.r || 120, cry = cr * 0.38, ch = o.h ?? Math.round(cr * 0.08);
    let ticks = '';
    for (let k = 1; k < 30; k++) { const a = (k * Math.PI) / 30, x = cx - cr * Math.cos(a), y = cy + cry * Math.sin(a); ticks += `M${q(x)} ${q(y + 3)}V${q(y + ch - 2)}`; }
    const g = `<ellipse cx="${q(cx)}" cy="${q(cy + ch)}" rx="${cr}" ry="${q(cry)}" class="nd side"/>
<rect x="${q(cx - cr)}" y="${q(cy)}" width="${cr * 2}" height="${ch}" style="fill:var(--sd-surface-2)"/>
<path d="M${q(cx - cr)} ${q(cy)}V${q(cy + ch)}M${q(cx + cr)} ${q(cy)}V${q(cy + ch)}" class="ln soft"/><path d="${ticks}" class="ln faint"/>
<ellipse cx="${q(cx)}" cy="${q(cy)}" rx="${cr}" ry="${q(cry)}" class="gl" filter="${url('glow')}"/>
<ellipse cx="${q(cx)}" cy="${q(cy)}" rx="${cr}" ry="${q(cry)}" class="nd hl" style="fill:${url('af')}"/>
<ellipse cx="${q(cx)}" cy="${q(cy)}" rx="${q(cr * 0.78)}" ry="${q(cry * 0.78)}" class="ln hl" opacity=".45"/>
${o.icon ? icon(o.icon, cx, cy - (o.label ? 14 : 0), { hl: true, size: 20 }) : ''}
${T(cx, cy + (o.icon ? 10 : 0) - (o.sub ? 7 : 0), o.label, { size: o.size || 15, weight: 600, anchor: 'middle', max: cr * 1.4, lines: 2, lh: 1.2 })}
${o.sub ? T(cx, cy + (o.icon ? 10 : 0) + 14, o.sub, { mono: true, size: 9.5, anchor: 'middle', cls: 'ac', max: cr * 1.4, lines: 1 }) : ''}`;
    return { svg: halo(cx, cy, cr * 2.3, 60) + pulse(cx, cy, cry, 1700, cr) + `<g${A(o.a ?? 'zoom', o.t ?? 150)}>${g}</g>`, rx: cr, ry: cry, h: ch };
  }
  /** Extruded bar: front face plus an oblique top and right side (k = depth). */
  function slab(x, y, w, h, o = {}) {
    const k = Math.min(o.k ?? 3, 3), hl = o.hl ? ' hl' : '';
    const top = [[x, y], [x + w, y], [x + w + k, y - k], [x + k, y - k]];
    const side = [[x + w, y], [x + w + k, y - k], [x + w + k, y + h - k], [x + w, y + h]];
    let g = o.hl ? `<rect x="${q(x)}" y="${q(y)}" width="${q(w)}" height="${q(h)}" class="glf" filter="${url('glow')}" opacity=".55"/>` : '';
    g += `<polygon points="${pts(side)}" class="nd side${hl}"/><polygon points="${pts(top)}" class="nd${hl}" style="fill:${o.hl ? 'var(--sd-acc-hi)' : 'var(--sd-surface-2)'}"/>`;
    g += `<rect x="${q(x)}" y="${q(y)}" width="${q(w)}" height="${q(h)}" class="nd${hl}" style="fill:${o.hl ? 'var(--sd-accent)' : url('nf')}"/>`;
    return `<g${A(o.a ?? 'growx', o.t || 0)} data-o="left center">${g}</g>`;
  }
  /** Extruded 3D type: stacked offset layers behind a solid face. Supports count-up via o.count. */
  function extrude(x, y, str, o = {}) {
    const size = o.size || 120, wt = o.weight || 700, depth = o.depth != null ? Math.min(o.depth, 5) : 4, dx = o.dx ?? 0.8, dy = o.dy ?? 0.8;
    const cnt = o.count != null && isFinite(parseFloat(o.count)) ? ` data-count="${esc(String(o.count))}" data-t="${o.t || 0}"` : '';
    const body = (cls) => `<tspan${cnt}>${esc(str)}</tspan>${o.unit ? `<tspan font-size="${q(size * 0.36)}" dx="${q(size * 0.04)}" letter-spacing="0">${esc(o.unit)}</tspan>` : ''}`;
    const base = `font-size="${size}" font-weight="${wt}" letter-spacing="${q(-size * (o.track ?? 0.045))}" text-anchor="${o.anchor || 'start'}" dominant-baseline="${o.baseline || 'alphabetic'}"`;
    let s = '';
    for (let i = depth; i >= 1; i--) s += `<text class="disp ex${o.hl ? ' ac' : ''}" x="${q(x + i * dx)}" y="${q(y + i * dy)}" ${base} opacity="${q(0.18 + 0.4 * (1 - i / depth))}">${body()}</text>`;
    s += `<text class="disp ex-top${o.hl ? ' ac' : ''}" x="${q(x)}" y="${q(y)}" ${base}>${body()}</text>`;
    return `<g${A(o.a ?? 'rise', o.t || 0)}>${s}</g>`;
  }
  /** Simple seeded RNG for deterministic decoration. */
  const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  /* ------------------------------------------------------------ registry */
  const R = {};
  const META = {};
  const SAMPLES = {};
  const H$ = { unit, badge, elbow, pill, chip, disk, slab, extrude, circP, W, H, q, clamp, esc, A, pol, pts, up, url, measure, wrap, lines, textW, textH, T, ICONS, ICON, icon, card, hcurve, vcurve, line, smooth, edge, arrow, dot, pulse, halo, tag, rng };

  function defs(id, grid) {
    return `<defs>
<filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="${id}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
<radialGradient id="${id}-halo"><stop offset="0" style="stop-color:var(--sd-accent);stop-opacity:.2"/><stop offset=".42" style="stop-color:var(--sd-accent);stop-opacity:.05"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:0"/></radialGradient>
<linearGradient id="${id}-fadev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sd-accent);stop-opacity:.26"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:0"/></linearGradient>
<linearGradient id="${id}-fadeh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--sd-accent);stop-opacity:0"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:1"/></linearGradient>
<linearGradient id="${id}-nf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sd-fg);stop-opacity:.085"/><stop offset="1" style="stop-color:var(--sd-fg);stop-opacity:.02"/></linearGradient>
<linearGradient id="${id}-ns" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--sd-fg);stop-opacity:.42"/><stop offset=".5" style="stop-color:var(--sd-fg);stop-opacity:.1"/><stop offset="1" style="stop-color:var(--sd-fg);stop-opacity:.24"/></linearGradient>
<linearGradient id="${id}-af" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sd-accent);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:.07"/></linearGradient>
<linearGradient id="${id}-as" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--sd-acc-hi);stop-opacity:1"/><stop offset=".55" style="stop-color:var(--sd-accent);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:.9"/></linearGradient>
<linearGradient id="${id}-hiline" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--sd-fg);stop-opacity:0"/><stop offset=".5" style="stop-color:var(--sd-fg);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--sd-fg);stop-opacity:0"/></linearGradient>
<linearGradient id="${id}-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--sd-accent);stop-opacity:0"/><stop offset=".85" style="stop-color:var(--sd-accent);stop-opacity:.10"/><stop offset=".97" style="stop-color:var(--sd-acc-hi);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--sd-accent);stop-opacity:0"/></linearGradient>
<radialGradient id="${id}-vig" cx=".5" cy=".5" r=".75"><stop offset=".55" style="stop-color:var(--sd-bg);stop-opacity:0"/><stop offset="1" style="stop-color:var(--sd-bg);stop-opacity:.92"/></radialGradient>
<filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .9"/></feComponentTransfer></filter>
<pattern id="${id}-lines" width="40" height="40" patternUnits="userSpaceOnUse" x="0" y="17.5"><path d="M40 0H0V40" fill="none" style="stroke:var(--sd-line)" stroke-width="1"/></pattern>
<pattern id="${id}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V7" style="stroke:var(--sd-fg)" stroke-width="1"/></pattern>
<linearGradient id="${id}-tfade" x1="0" y1="0" x2="1" y2="0"><stop offset=".45" style="stop-color:var(--sd-fg)"/><stop offset="1" style="stop-color:var(--sd-fg);stop-opacity:.28"/></linearGradient>
<pattern id="${id}-dotf" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="4.5" cy="4.5" r=".85" style="fill:var(--sd-fg)"/></pattern>
<pattern id="${id}-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1" style="fill:var(--sd-line-2)"/></pattern>
<pattern id="${id}-iso" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="translate(600 352) scale(1 .5) rotate(45)"><path d="M46 0H0V46" fill="none" style="stroke:var(--sd-line-2)" stroke-width="1"/></pattern>
<radialGradient id="${id}-vg" cx="${grid && grid.cx != null ? grid.cx : 0.5}" cy="${grid && grid.cy != null ? grid.cy : 0.52}" r="${grid && grid.r ? grid.r : 0.62}"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="${id}-mask" maskContentUnits="userSpaceOnUse"><rect width="${W}" height="${H}" fill="url(#${id}-vg)"/></mask>
</defs>`;
  }

  /* --------------------------------------------------------------- poster */
  // Editorial composition: a typographic column on the left, the diagram scaled into the right 2/3.
  const POSTER = { tx: 436, ty: 124, s: 0.63 };
  const CARD = { tx: 96, ty: 106, s: 0.84 };
  /** Editorial annotation layer: bold heading, a grey line that explains how to read it, and a mono caption. */
  function annotate(d, meta, ctx) {
    let s = T(56, 60, d.heading || meta.zh, { size: 22, weight: 700, a: 'rise', t: 100, max: 760, lines: 1, ls: -0.4, style: 'background:linear-gradient(90deg,var(--sd-fg) 45%,color-mix(in oklab,var(--sd-fg) 28%,transparent));-webkit-background-clip:text;background-clip:text;color:transparent' });
    s += T(56, 86, d.subheading || meta.desc, { size: 13, cls: 'mu', a: 'fade', t: 200, max: 820, lines: 1 });
    s += T(56, 648, d.caption || ctx, { mono: true, size: 9.5, cls: 'fa', a: 'fade', t: 300, max: 900, lines: 1 });
    return s;
  }
  const ORDER = ['decision', 'mindmap', 'timeline', 'venn', 'journey', 'roadmap', 'quadrant', 'matrix', 'tree', 'swimlane', 'cycle', 'pipeline', 'funnel', 'fishbone', 'hub', 'stack', 'architecture', 'sequence', 'state', 'orbit', 'scurve', 'rings', 'stat', 'versus', 'disc', 'diamond', 'valley', 'capsule', 'bridge', 'zones', 'radial', 'bowtie', 'cube', 'loops', 'nested'];
  function poster(d, meta, idx, skin) {
    const serif = skin === 'keynote';
    const x0 = 56, x1 = 392, cjk = /[⺀-鿿]/.test(d.headline || meta.zh || '');
    const head = d.headline || meta.zh || '';
    const num = String(idx).padStart(2, '0');
    const section = d.section || `${num} / ${ORDER.length}`;
    let s = `<path d="M420 70V605" class="chrome-ln"${A('fade', 100)}/>`;
    s += T(x0, 84, d.eyebrow || meta.en, { mono: true, size: 10, cls: 'ac', a: 'fade', t: 150 });
    s += T(x1, 84, section, { mono: true, size: 10, cls: 'mu', anchor: 'end', a: 'fade', t: 150 });
    const hs = serif ? (cjk ? 48 : 60) : cjk ? 46 : 50;
    const L = lines(cjk || serif ? head : up(head), { size: hs, weight: serif ? 400 : 800, max: x1 - x0, lines: 3 });
    L.forEach((l, i) => {
      s += T(x0, 140 + i * hs * 1.04, l, { size: hs, weight: serif ? 400 : 800, cls: 'disp', lh: 1.04, ls: q(-hs * (serif ? 0.01 : 0.035)), valign: 'top', a: 'rise', t: 300 + i * 110 });
    });
    let y = 140 + L.length * hs * 1.04 + 22;
    s += `<path d="M${x0} ${q(y)}H${x1}" class="chrome-ln"${A('growx', 500)} data-o="left center"/>`;
    y += 22;
    if (d.lede !== false) s += T(x0, y, d.lede || meta.desc, { size: 13, cls: 'mu', max: x1 - x0 - 20, lines: 4, lh: 1.55, valign: 'top', a: 'fade', t: 650 });
    const pts_ = d.points || [];
    if (pts_.length) {
      const rows = pts_.slice(0, 4), rh = 40, top = 604 - rows.length * rh;
      rows.forEach((p, i) => {
        const yy = top + i * rh, t = 800 + i * 110, o = typeof p === 'string' ? { label: p } : p;
        s += `<g${A('rise', t)}><path d="M${x0} ${yy}H${x1}" class="chrome-ln"/>`;
        s += T(x0, yy + 20, String(i + 1).padStart(2, '0') + '.', { mono: true, size: 10, cls: o.hl ? 'ac' : 'fa' });
        s += T(x0 + 44, yy + (o.desc ? 14 : 20), cjk ? o.label : up(o.label), { size: 12.5, weight: 600, max: x1 - x0 - 44, lines: 1 });
        if (o.desc) s += T(x0 + 44, yy + 29, o.desc, { size: 10.5, cls: 'fa', max: x1 - x0 - 44, lines: 1 });
        s += `</g>`;
      });
    } else {
      const f = d.figure || { value: num };
      const v = String(f.value);
      let bars = '';
      for (let i = 0; i < 26; i++) {
        const h = 8 + ((i * 37) % 23), on = i < 26 * (f.progress != null ? f.progress : 0.62);
        bars += `<rect x="${x0 + i * 13}" y="${q(468 - h)}" width="2" height="${h}" class="bar${on ? ' hl' : ''}"${A('growy', 700 + i * 22)}/>`;
      }
      s += bars;
      s += extrude(x0 - 4, 586, /^[\d.]+$/.test(v) ? v : v, { size: v.length > 4 ? 96 : 124, weight: 700, depth: 16, count: /^[\d.]+$/.test(v) && d.figure ? parseFloat(v) : null, unit: f.unit, t: 700, hl: !!f.hl });
      if (f.label) s += T(x0, 610, f.label, { mono: true, size: 10, cls: 'mu', a: 'fade', t: 900, max: x1 - x0, lines: 1 });
    }
    return s;
  }

  /* --------------------------------------------------------------- camera */
  // [from, to, fromOpacity] — the whole diagram plane moves like a camera shot
  // Camera poses: enter goes from → at, the hold drifts at → drift, an exit returns to from.
  const CAMERA_POSES = {
    flat: { tpl: p => `scale(${p.s})`, from: { s: 1, o: 1 }, at: { s: 1, o: 1 }, drift: { s: 1.025, o: 1 } },
    tilt: { tpl: p => `perspective(1400px) rotateX(${p.rx}deg) scale(${p.s}) translateY(${p.ty}%)`, from: { rx: 64, s: 0.82, ty: 6, o: 0 }, at: { rx: 42, s: 1.02, ty: -3, o: 1 }, drift: { rx: 39, s: 1.04, ty: -3.5, o: 1 } },
    iso: { tpl: p => `perspective(2400px) rotateX(${p.rx}deg) rotateZ(${p.rz}deg) scale(${p.s}) translateY(${p.ty}%)`, from: { rx: 0, rz: 0, s: 1, ty: 0, o: 1 }, at: { rx: 54, rz: -30, s: 0.86, ty: -6, o: 1 }, drift: { rx: 52, rz: -26, s: 0.88, ty: -6, o: 1 } },
    unfold: { tpl: p => `perspective(2400px) rotateX(${p.rx}deg) rotateZ(${p.rz}deg) scale(${p.s}) translateY(${p.ty}%)`, from: { rx: 58, rz: -32, s: 0.8, ty: 0, o: 0 }, at: { rx: 0, rz: 0, s: 1, ty: 0, o: 1 }, drift: { rx: 0, rz: 0, s: 1.025, ty: 0, o: 1 } },
    dolly: { tpl: p => `perspective(1200px) translateZ(${p.z}px)`, from: { z: -420, o: 0 }, at: { z: 0, o: 1 }, drift: { z: 60, o: 1 } },
  };
  const lerpPose = (a, b, k) => Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * k]));
  Object.assign(H$, { CAMERA_POSES, lerpPose });
  const CAMERAS = Object.fromEntries(Object.entries(CAMERA_POSES).filter(([k]) => k !== 'flat').map(([k, c]) => [k, [c.tpl(c.from), c.tpl(c.at), c.from.o]]));

  /* --------------------------------------------------------------- motion */
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function intro(n, sp) {
    let kind = n.dataset.a;
    const t = (+n.dataset.t || 0) / sp;
    let kf, dur = 700, ease = EASE;
    if (kind === 'draw') {
      const cs = getComputedStyle(n).strokeDasharray;
      if ((cs && cs !== 'none') || typeof n.getTotalLength !== 'function') kind = 'fade';
    }
    switch (kind) {
      case 'fade': kf = [{ opacity: 0 }, { opacity: 1 }]; dur = 600; break;
      case 'rise': kf = [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }]; dur = 900; break;
      case 'blur': kf = [{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)' }]; dur = 1000; break;
      case 'sweep': kf = [{ transform: 'translateX(0px)', opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { transform: 'translateX(1700px)', opacity: 0 }]; dur = 2200; ease = 'cubic-bezier(.5,0,.3,1)'; break;
      case 'pop': kf = [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }]; dur = 600; ease = 'cubic-bezier(.34,1.56,.64,1)'; break;
      case 'zoom': kf = [{ opacity: 0, transform: 'scale(.82)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }]; dur = 1300; break;
      case 'drop': kf = [{ opacity: 0, transform: 'translateY(-46px)' }, { opacity: 1, transform: 'none' }]; dur = 1100; break;
      case 'growx': n.style.transformOrigin = n.dataset.o || 'left center'; kf = [{ transform: 'scaleX(0)' }, { transform: 'none' }]; dur = 900; break;
      case 'growy': n.style.transformOrigin = 'center bottom'; kf = [{ transform: 'scaleY(0)' }, { transform: 'none' }]; dur = 900; break;
      case 'draw': {
        const len = Math.max(1, n.getTotalLength());
        n.style.strokeDasharray = `${len} ${len + 2}`;
        kf = [{ strokeDashoffset: len }, { strokeDashoffset: 0 }];
        dur = clamp(len * 1.15, 550, 1500);
        ease = 'cubic-bezier(.65,0,.25,1)';
        break;
      }
      default: return null;
    }
    if (n.dataset.dur) dur = +n.dataset.dur;
    return n.animate(kf, { duration: dur / sp, delay: t, easing: ease, fill: 'both' });
  }
  function loop(n, sp) {
    const kind = n.dataset.loop;
    const t = (n.dataset.t != null ? +n.dataset.t : 1800) / sp;
    const dur = +n.dataset.dur || 0;
    switch (kind) {
      case 'comet': {
        const len = Math.max(1, n.getTotalLength());
        const rev = n.hasAttribute('data-rev');
        let seg, from, to;
        if (n.dataset.tail) {
          const st = +n.dataset.tail;
          seg = Math.min(+n.dataset.seg || 8, st);
          n.style.strokeDasharray = `${seg} ${len + st + 20}`;
          // head rides on the leading edge of the tail
          from = rev ? -len : seg; to = rev ? st : -len - (st - seg);
        } else {
          seg = Math.min(+n.dataset.seg || 110, len * 0.45);
          n.style.strokeDasharray = `${seg} ${len + seg}`;
          from = rev ? -len : seg; to = rev ? seg : -len;
        }
        return n.animate(
          [{ strokeDashoffset: from, offset: 0 }, { strokeDashoffset: to, offset: 0.62 }, { strokeDashoffset: to, offset: 1 }],
          { duration: (dur || clamp(len * 5.2, 1800, 5200)) / sp, delay: t, iterations: Infinity, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'backwards' }
        );
      }
      case 'push':
        n.style.transformBox = 'view-box'; n.style.transformOrigin = '600px 337px';
        return n.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }], { duration: (dur || 14000) / sp, delay: t, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      case 'drift': {
        const dx = +n.dataset.dx || 0, dy = +n.dataset.dy || -10;
        return n.animate([{ transform: 'none', opacity: 0 }, { opacity: +n.dataset.op || 0.5, offset: 0.3 }, { opacity: +n.dataset.op || 0.5, offset: 0.7 }, { transform: `translate(${dx}px,${dy}px)`, opacity: 0 }], { duration: (dur || 6000) / sp, delay: t, iterations: Infinity, easing: 'linear', fill: 'backwards' });
      }
      case 'pulse':
        return n.animate([{ opacity: 0.75, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.1)' }], { duration: (dur || 2600) / sp, delay: t, iterations: Infinity, easing: 'cubic-bezier(.2,.6,.3,1)' });
      case 'spin': {
        n.style.transformBox = 'view-box';
        n.style.transformOrigin = `${n.dataset.ox}px ${n.dataset.oy}px`;
        const dir = +n.dataset.dir || 1;
        return n.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 360}deg)` }], { duration: (dur || 30000) / sp, delay: t, iterations: Infinity });
      }
      case 'march':
        return n.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -(+n.dataset.len || 14) }], { duration: (dur || 900) / sp, delay: t, iterations: Infinity });
      case 'breathe':
        return n.animate([{ opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }], { duration: (dur || 3200) / sp, delay: t, iterations: Infinity, easing: 'ease-in-out', fill: 'backwards' });
      case 'float':
        return n.animate([{ transform: 'none' }, { transform: `translateY(${-(+n.dataset.amp || 6)}px)` }, { transform: 'none' }], { duration: (dur || 4200) / sp, delay: t, iterations: Infinity, easing: 'ease-in-out' });
      default: return null;
    }
  }

  /* ------------------------------------------------------------- fonts */
  let fontsP;
  function fontsReady() {
    if (fontsP) return fontsP;
    fontsP = new Promise(res => {
      const done = () => res();
      setTimeout(done, 1800);
      if (window.STAGE_DIAGRAMS_FONTS === false || !document.fonts) return done();
      const load = () => Promise.all(['500 16px Geist', '300 64px Geist', '400 16px Geist', '400 12px "Geist Mono"', '500 12px "Geist Mono"', '700 40px "Inter Tight"', '800 40px "Inter Tight"', '700 16px Doto', '900 40px Doto', '400 16px DotGothic16', '400 48px "Instrument Serif"'].map(f => document.fonts.load(f))).then(done, done);
      let link = document.querySelector('link[href*="family=Geist"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = FONT_URL;
        link.onload = load;
        link.onerror = done;
        document.head.appendChild(link);
      } else if (link.sheet) load();
      else { link.addEventListener('load', load); link.addEventListener('error', done); }
    });
    return fontsP;
  }
  function ensureStyle() {
    if (document.getElementById('stage-diagrams-css')) return;
    const s = document.createElement('style');
    s.id = 'stage-diagrams-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /** Relative luminance (0–1) of any CSS colour string; unknown values count as dark. */
  function luminance(color) {
    _ctx = _ctx || document.createElement('canvas').getContext('2d');
    _ctx.fillStyle = '#000'; _ctx.fillStyle = color || '#000';
    const hex = _ctx.fillStyle, m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** Tag every rendered text with the data path it came from, so editors and text presets can target it. */
  function annotatePaths(stage, data) {
    const norm = v => String(v).replace(/\s+/g, '').toUpperCase();
    const index = new Map();
    const walk = (v, path) => {
      if (typeof v === 'string' || typeof v === 'number') { const k = norm(v); if (k && !index.has(k)) index.set(k, path); }
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i)));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'icons') walk(x, path ? `${path}.${k}` : k);
    };
    walk(data, '');
    stage.querySelectorAll('.t').forEach(el => {
      const raw = el.textContent.replace(/^“|”$/g, '');
      const path = index.get(norm(raw)) || index.get(norm(raw.replace(/…$/, '')));
      if (!path) return;
      el.dataset.sdPath = path;
      el.dataset.slot = path.split('.').filter(p => !/^\d+$/.test(p)).pop() || path;
    });
  }

  /* ------------------------------------------------------------- element */
  let UID = 0;
  class StageDiagram extends HTMLElement {
    static get observedAttributes() { return ['type', 'accent', 'motion', 'src', 'data', 'grid', 'speed', 'camera', 'chrome', 'fx', 'layout', 'skin']; }
    constructor() { super(); this._anims = []; this._counts = []; this._intro = 0; this._tk = 0; }
    connectedCallback() {
      ensureStyle();
      if (!this._uid) this._uid = 'sd' + ++UID;
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      if (!this._bound) {
        this._bound = true;
        this.addEventListener('click', () => this.replay());
        this.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.replay(); } });
      }
      this._applyAccent();
      this._queue();
    }
    disconnectedCallback() { this._io && this._io.disconnect(); clearInterval(this._ticker); }
    attributeChangedCallback(n, o, v) {
      if (o === v) return;
      if (n === 'accent') return this._applyAccent();
      if (this.isConnected && this._uid) this._queue();
    }
    get data() { return this._data; }
    set data(v) { this._dataProp = v; if (this.isConnected) this._queue(); }
    get introDuration() { return this._intro; }
    /** Render synchronously with the given data and no autoplay — used by deterministic hosts such as HyperFrames. */
    renderNow(data) {
      ensureStyle();
      if (!this._uid) this._uid = 'sd' + ++UID;
      this._tk++;
      this._render(data);
    }
    _applyAccent() {
      const a = this.getAttribute('accent');
      if (a) this.style.setProperty('--sd-accent', a); else this.style.removeProperty('--sd-accent');
    }
    async _queue() {
      const tk = ++this._tk;
      await fontsReady();
      if (tk !== this._tk) return;
      let data = null;
      try { data = await this._load(); } catch (e) { console.error('[stage-diagram] bad data', e); }
      if (tk !== this._tk) return;
      this._render(data);
    }
    async _load() {
      if (this._dataProp) return this._dataProp;
      const sc = this.querySelector(':scope > script[type="application/json"]');
      if (sc) return JSON.parse(sc.textContent);
      const at = this.getAttribute('data');
      if (at) return JSON.parse(at);
      const src = this.getAttribute('src');
      if (src) return (await fetch(src)).json();
      return null;
    }
    _render(data) {
      const type = this.getAttribute('type') || 'hub';
      let stage = this.querySelector(':scope > .sd-stage');
      if (!stage) { stage = document.createElement('div'); stage.className = 'sd-stage'; this.appendChild(stage); }
      const fn = R[type];
      if (!fn) { stage.textContent = `Unknown stage-diagram type "${type}"`; return; }
      this._data = data || SAMPLES[type] || {};
      this._resolveTokens();
      const id = (CUR = this._uid);
      CUR_ICONS = Object.assign({}, this._data.icons || {});
      let out;
      CUR_U = null;
      try { out = fn(this._data, H$); } catch (e) { console.error(e); stage.textContent = 'Render error: ' + e.message; return; } finally { CUR_U = null; }
      this._units = out.units || [];
      const cam = this.getAttribute('camera') || out.camera || 'flat';
      const grid = this.getAttribute('grid') || (cam === 'iso' || cam === 'tilt' ? 'lines' : out.grid) || 'lines';
      const meta = META[type] || {};
      const title = this._data.title || meta.zh || type;
      const desc = this._data.desc || meta.desc || '';
      const bg = grid === 'none' ? '' : `<g${A('fade', 0)}><rect x="-300" y="-200" width="${W + 600}" height="${H + 400}" fill="url(#${id}-${grid})" mask="url(#${id}-mask)"/></g>`;
      const fx = this.getAttribute('fx') !== 'none';
      // drifting particle field (deterministic)
      let parts = '';
      if (fx) {
        const rnd = rng(type.length * 977 + 13);
        for (let i = 0; i < 18; i++) {
          const x = rnd() * W, y = rnd() * H, r = 0.5 + rnd() * 1.1;
          parts += `<circle class="pt" cx="${q(x)}" cy="${q(y)}" r="${q(r)}" opacity="${q(0.1 + rnd() * 0.2)}" data-loop="drift" data-dx="${q((rnd() - 0.5) * 30)}" data-dy="${q(-12 - rnd() * 34)}" data-op="${q(0.2 + rnd() * 0.45)}" data-dur="${Math.round(5000 + rnd() * 7000)}" data-t="${Math.round(rnd() * 6000)}"/>`;
        }
      }
      const chrome = this.getAttribute('chrome') !== 'none';
      let ch = '';
      if (chrome) {
        const k = this._data.kicker || meta.en || type, mt = this._data.meta || meta.zh || '';
        const fig = this._data.fig != null ? `FIG.${String(this._data.fig).padStart(2, '0')} — ` : '';
        const c = 14;
        ch += `<path class="chrome-ln" d="M20 ${20 + c}V20H${20 + c}M${W - 20 - c} 20H${W - 20}V${20 + c}M${W - 20} ${H - 20 - c}V${H - 20}H${W - 20 - c}M${20 + c} ${H - 20}H20V${H - 20 - c}"${A('fade', 0)}/>`;
        if (this.getAttribute('layout') !== 'card') ch += `<text class="mono chrome" x="44" y="27" font-size="9.5" dominant-baseline="central"${A('fade', 200)}>${esc(up(fig + k))}</text>`;
        ch += `<text class="mono chrome" x="${W - 44}" y="27" font-size="9.5" text-anchor="end" dominant-baseline="central"${A('fade', 200)}>${esc(up(mt))}</text>`;
        if (this.getAttribute('chrome') === 'full') {
        let rl = 'M44 651H164';
        for (let i = 0; i <= 20; i++) rl += `M${44 + i * 6} 651V${i % 10 === 0 ? 643 : i % 5 === 0 ? 646 : 648}`;
        ch += `<path class="chrome-ln" d="${rl}"${A('fade', 300)}/><text class="mono chrome" x="172" y="648" font-size="8.5" dominant-baseline="central"${A('fade', 300)}>${esc(up(this._data.scale || 'SCALE 1:1'))}</text>`;
        ch += `<text class="mono chrome" x="${W - 44}" y="648" font-size="8.5" text-anchor="end" dominant-baseline="central"${A('fade', 300)}>${esc(up(this._data.coord || 'X 0600 · Y 0337'))}</text>`;
        ch += `<path class="chrome-ln" d="M${W / 2 - 5} 648H${W / 2 + 5}M${W / 2} 643V653"${A('fade', 300)}/>`;
        }
      }
      const lay = this.getAttribute('layout'), isPoster = lay === 'poster', isCard = lay === 'card';
      const ctx = [meta.en, this.getAttribute('skin') || 'cinematic', this._data.context || ''].filter(Boolean).join(' · ');
      const post = isCard ? annotate(this._data, meta, ctx) : isPoster ? poster(this._data, meta, ORDER.indexOf(type) + 1, this.getAttribute('skin')) : '';
      const over = `${fx ? `<rect x="-420" y="0" width="420" height="${H}" fill="url(#${id}-sweep)"${A('sweep', 150)}/><rect class="vig" width="${W}" height="${H}" fill="url(#${id}-vig)"/><rect width="${W}" height="${H}" class="grain" filter="url(#${id}-grain)" opacity=".035" style="mix-blend-mode:overlay"/>` : ''}${ch}${post}`;
      stage.innerHTML = `<svg class="sd-main" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>${defs(id, out.mask)}${bg}${parts}${isPoster ? `<g transform="translate(${POSTER.tx} ${POSTER.ty}) scale(${POSTER.s})">` : isCard ? `<g transform="translate(${CARD.tx} ${CARD.ty}) scale(${CARD.s})">` : '<g>'}<g data-loop="push" data-t="0">${out.svg}</g></g></svg><svg class="sd-over" viewBox="0 0 ${W} ${H}" aria-hidden="true">${over}</svg>`;
      this._camera = cam;
      annotatePaths(stage, this._data);
      stage.querySelector('.sd-main').style.transformOrigin = isPoster ? '68% 52%' : '';
      this._setup();
      this.setAttribute('data-ready', '');
      this.dispatchEvent(new CustomEvent('stage:ready', { bubbles: true }));
    }
    /** Measure with the fonts the theme actually resolves to, and derive light/dark tone from the background token. */
    _resolveTokens() {
      const cs = getComputedStyle(this);
      FAMILY.sans = cs.getPropertyValue('--sd-sans').trim() || SANS;
      FAMILY.mono = cs.getPropertyValue('--sd-mono').trim() || MONO;
      if (this.hasAttribute('theme')) { this.dataset.tone = this.getAttribute('theme') === 'light' ? 'light' : 'dark'; return; }
      this.dataset.tone = luminance(cs.getPropertyValue('--sd-bg').trim()) > 0.5 ? 'light' : 'dark';
    }
    _setup() {
      this._anims.forEach(a => a.cancel());
      this._anims = []; this._counts = []; this._decodes = []; this._started = false; this._intro = 0;
      this.removeAttribute('data-live');
      this._io && this._io.disconnect();
      const mode = this.getAttribute('motion') || 'loop';
      const cam0 = CAMERAS[this._camera], m0 = this.querySelector('.sd-main');
      if (m0) m0.style.transform = cam0 ? cam0[1] : '';
      if (mode === 'none' || reduced() || typeof Element.prototype.animate !== 'function') return;
      const svg = this.querySelector('.sd-stage');
      const sp = parseFloat(this.getAttribute('speed')) || 1;
      const cam = CAMERAS[this._camera];
      const main = svg.querySelector('.sd-main');
      if (cam) {
        main.style.transform = cam[1];
        const a = main.animate([{ transform: cam[0], opacity: cam[2] }, { transform: cam[1], opacity: 1 }], { duration: 2800 / sp, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'both' });
        this._anims.push(a);
      }
      // bright heads riding on each comet tail
      svg.querySelectorAll('.comet').forEach(c => {
        const h = c.cloneNode();
        h.setAttribute('class', 'comet-head');
        h.dataset.tail = Math.min(+c.dataset.seg || 110, c.getTotalLength() * 0.45);
        h.dataset.seg = '9';
        c.after(h);
      });
      svg.querySelectorAll('[data-a]').forEach(n => {
        const a = intro(n, sp);
        if (!a) return;
        this._anims.push(a);
        const tm = a.effect.getComputedTiming();
        this._intro = Math.max(this._intro, tm.endTime);
      });
      [...svg.querySelectorAll('.t.mono')].flatMap(el => [...el.childNodes].filter(c => c.nodeType === 3)).forEach((n, i) => {
        if (!n.textContent.trim()) return;
        const host = n.parentNode.closest('[data-a]');
        if (!host) return;
        const final = n.textContent;
        const a = n.animate([{ opacity: 1 }, { opacity: 1 }], { duration: Math.min(900, 300 + final.length * 40) / sp, delay: (+host.dataset.t || 0) / sp + 120, fill: 'both' });
        this._anims.push(a);
        this._decodes.push({ n, a, final, seed: i * 7 + 3 });
      });
      svg.querySelectorAll('[data-count]').forEach(n => {
        const to = parseFloat(n.dataset.count), dec = (String(n.dataset.count).split('.')[1] || '').length;
        const a = n.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1700 / sp, delay: (+n.dataset.t || 0) / sp, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
        this._anims.push(a);
        this._counts.push({ n, a, to, dec });
        this._intro = Math.max(this._intro, a.effect.getComputedTiming().endTime);
      });
      if (mode !== 'intro') {
        this.setAttribute('data-live', '');
        svg.querySelectorAll('[data-loop]').forEach(n => { const a = loop(n, sp); if (a) this._anims.push(a); });
      }
      this._anims.forEach(a => a.pause());
      this._tick();
      if (this.getAttribute('autoplay') === 'false') return;
      this._io = new IntersectionObserver(es => {
        for (const e of es) {
          if (e.isIntersecting) this._started ? this.play() : this.replay();
          else if (this._started) this.pause();
        }
      }, { threshold: 0.2 });
      this._io.observe(this);
    }
    _tick() {
      const G = '01<>/\\#%+=_▮▯:';
      for (const c of this._decodes) {
        const p = c.a.effect.getComputedTiming().progress;
        const pr = p == null ? 1 : p, L = c.final.length, k = Math.floor(pr * (L + 3)) - 3;
        if (pr >= 1) { if (c.n.textContent !== c.final) c.n.textContent = c.final; continue; }
        const fr = Math.floor((c.a.currentTime || 0) / 45);
        let out = '';
        for (let i = 0; i < L; i++) {
          const ch = c.final[i];
          out += i <= k || ch === ' ' ? ch : i <= k + 4 ? G[(i * 13 + fr * 7 + c.seed) % G.length] : (pr > 0 ? '·' : '\u2007');
        }
        c.n.textContent = out;
      }
      for (const c of this._counts) {
        const p = c.a.effect.getComputedTiming().progress;
        const v = (p == null ? 1 : p) * c.to;
        c.n.textContent = v.toFixed(c.dec);
      }
    }
    // Standalone (WAAPI) playback only; HyperFrames drives counters through GSAP onUpdate.
    _loopCounts() {
      clearInterval(this._ticker);
      if (!this._counts.length && !this._decodes.length) return;
      this._ticker = setInterval(() => {
        this._tick();
        if (!this._counts.some(c => c.a.playState === 'running') && !this._decodes.some(c => c.a.playState === 'running')) clearInterval(this._ticker);
      }, 33);
    }
    play() { this._started = true; this._anims.forEach(a => a.play()); this._loopCounts(); }
    pause() { this._anims.forEach(a => a.pause()); clearInterval(this._ticker); }
    replay() {
      if (!this._anims.length) return;
      this._started = true;
      this._anims.forEach(a => { a.currentTime = 0; a.play(); });
      this._loopCounts();
    }
    /** Jump to an absolute time in ms (deterministic — used for video export). */
    seek(ms) {
      this._started = true;
      this._anims.forEach(a => { a.pause(); a.currentTime = ms; });
      this._tick();
    }
  }

  const define = () => { if (!customElements.get('stage-diagram')) customElements.define('stage-diagram', StageDiagram); };
  const API = { define, R, META, SAMPLES, H: H$, icons: ICONS, registerIcon(name, d) { ICONS[name] = d; }, register(type, fn, meta, sample) { R[type] = fn; if (meta) META[type] = meta; if (sample) SAMPLES[type] = sample; }, version: '1.0.0' };
  window.StageDiagrams = API;
  // Define after the current task so that renderer files concatenated below have registered.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', define); else Promise.resolve().then(define);
})();
