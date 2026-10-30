/* Stage Diagrams — frameworks & models: disc, diamond, valley, capsule, bridge, zones, radial, bowtie, cube, loops, nested */
(() => {
  const SD = window.StageDiagrams;
  const { badge, elbow, pill, icon, chip, disk, slab, circP, q, clamp, esc, A, pol, pts, up, url, measure, T, textW, textH, lines, card, hcurve, vcurve, line, smooth, edge, arrow, dot, pulse, halo, tag, rng } = SD.H;
  const meta = (zh, en, desc) => ({ zh, en, group: 'frameworks', desc });
  /** Curved dashed annotation arrow from (x1,y1) to (x2,y2), bending by k. */
  const note = (x1, y1, x2, y2, k = 0.35, o = {}) => {
    const mx = (x1 + x2) / 2 - (y2 - y1) * k, my = (y1 + y2) / 2 + (x2 - x1) * k;
    const ang = Math.atan2(y2 - my, x2 - mx);
    return edge(`M${q(x1)} ${q(y1)}Q${q(mx)} ${q(my)} ${q(x2)} ${q(y2)}`, { soft: true, cls: 'dash', t: o.t || 0, glow: false }) + arrow(x2, y2, ang, { s: 5, t: (o.t || 0) + 300 });
  };

  /* ================================================================ disc */
  // 3D segmented disc: equal wedges, one label each. Optional second disc for "isn't / is".
  function oneDisc(cx, cy, rx, ry, th, segs, o) {
    const n = Math.max(1, segs.length), a0 = -Math.PI / 2 - Math.PI / n;
    const P = a => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    let s = '';
    // side band (front half)
    s += `<path d="M${q(cx - rx)} ${q(cy)}A${rx} ${ry} 0 0 0 ${q(cx + rx)} ${q(cy)}V${q(cy + th)}A${rx} ${ry} 0 0 1 ${q(cx - rx)} ${q(cy + th)}Z" class="nd side"${A('fade', o.t)}/>`;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * 2 * Math.PI) / n, sn = Math.sin(a);
      if (sn > 0.02) { const [x, y] = P(a); s += `<path d="M${q(x)} ${q(y)}V${q(y + th)}" class="ln soft"${A('fade', o.t + 200)}/>`; }
    }
    s += `<ellipse cx="${cx}" cy="${q(cy)}" rx="${rx}" ry="${ry}" class="nd" style="fill:${url('nf')};stroke:${url('ns')}"${A('fade', o.t)}/>`;
    segs.forEach((g, k) => {
      const s1 = a0 + (k * 2 * Math.PI) / n, s2 = s1 + (2 * Math.PI) / n, [x1, y1] = P(s1), [x2, y2] = P(s2), t = o.t + 300 + k * 90;
      if (g.hl) s += `<path d="M${cx} ${q(cy)}L${q(x1)} ${q(y1)}A${rx} ${ry} 0 0 1 ${q(x2)} ${q(y2)}Z" class="f-soft" style="stroke:var(--sd-accent);stroke-width:1.2"${A('fade', t)}/>`;
      s += `<path d="M${cx} ${q(cy)}L${q(x1)} ${q(y1)}" class="ln soft"${A('draw', t)}/>`;
      const am = (s1 + s2) / 2, lx = cx + rx * 0.6 * Math.cos(am), ly = cy + ry * 0.6 * Math.sin(am);
      const lab = typeof g === 'string' ? { label: g } : g;
      if (lab.icon) s += `<g${A('fade', t + 100)}>${icon(lab.icon, lx, ly - 22, { size: 16, hl: lab.hl, mu: !lab.hl })}</g>`;
      s += T(lx, ly + (lab.icon ? 4 : 0), lab.label, { size: o.size || 15, weight: 500, anchor: 'middle', cls: lab.hl ? '' : o.muted ? 'mu' : '', max: (rx * 2) / Math.max(3, n * 0.55), lines: 2, lh: 1.2, a: 'rise', t: t + 120 });
    });
    return s;
  }
  SD.register('disc', (d) => {
    const G = (d.groups || [{ segments: d.segments || [] }]).slice(0, 2);
    let s = '';
    if (G.length === 2) {
      G.forEach((g, i) => {
        const cy = i ? 470 : 175, t = 150 + i * 700;
        s += T(600, cy - 128, g.title, { size: 36, weight: 600, anchor: 'middle', cls: 'disp' + (i ? '' : ' mu'), a: 'rise', t, ls: -0.8 });
        s += oneDisc(600, cy, i ? 400 : 330, i ? 110 : 82, i ? 40 : 32, g.segments || [], { t: t + 150, muted: !i, size: i ? 14 : 14.5 });
      });
    } else {
      const g = G[0] || {};
      if (g.title) s += T(600, 92, g.title, { size: 36, weight: 600, anchor: 'middle', cls: 'disp', a: 'rise', t: 100, ls: -0.8 });
      s += oneDisc(600, g.title ? 370 : 330, 450, 160, 56, g.segments || [], { t: 250, size: 16 });
    }
    return { grid: 'none', svg: s };
  }, meta('立体分区盘', 'Segmented Disc', '一个整体均分成若干组成部分；双盘可做“不是 / 是”对照。扇区等分，不表示占比。'), {
    groups: [
      { title: 'AI 教育不是：', segments: ['替代老师', '刷题机器', '标准答案库'] },
      { title: 'AI 教育是：', segments: [{ label: '因材施教', icon: 'target' }, { label: '即时反馈', icon: 'bolt', hl: true }, { label: '激发提问', icon: 'chat' }, { label: '看见过程', icon: 'eye' }, { label: '解放教师', icon: 'cap' }, { label: '公平获取', icon: 'globe' }, { label: '持续成长', icon: 'chart' }, { label: '保护隐私', icon: 'lock' }] },
    ],
  });

  /* ============================================================= diamond */
  // Ikigai-style rotated 3×3 framework: 4 outer drivers, 4 pairwise intersections, 1 centre.
  SD.register('diamond', (d) => {
    const cx = 600, cy = 360, h = 80, inner = d.inner || [], outer = d.outer || [], notes = d.notes || [];
    const cell = (X, Y, cls, t, st) => `<polygon points="${pts([[X, Y - h], [X + h, Y], [X, Y + h], [X - h, Y]])}" class="${cls}"${st ? ` style="${st}"` : ''}${A('pop', t)}/>`;
    let s = '';
    const O = [[cx, cy - 2 * h], [cx + 2 * h, cy], [cx, cy + 2 * h], [cx - 2 * h, cy]];
    const I = [[cx - h, cy - h], [cx + h, cy - h], [cx - h, cy + h], [cx + h, cy + h]];
    O.forEach(([X, Y], i) => { s += cell(X, Y, 'nd', 200 + i * 80, `fill:none;stroke:${url('ns')}`); });
    I.forEach(([X, Y], i) => { s += cell(X, Y, 'nd', 500 + i * 80, `fill:${url('nf')}`); });
    s += halo(cx, cy, 160, 800) + cell(cx, cy, 'f-ac', 900) + pulse(cx, cy, 40, 1900);
    O.forEach(([X, Y], i) => {
      const o = typeof outer[i] === 'string' ? { label: outer[i] } : outer[i] || {}, oy = [Y - 30, Y, Y + 30, Y][i], ox = [X, X + 22, X, X - 22][i];
      if (o.icon) s += `<g${A('fade', 450 + i * 80)}>${icon(o.icon, ox, oy - 18, { size: 15, mu: true })}</g>`;
      s += T(ox, oy + (o.icon ? 6 : 0), o.label, { size: 13, cls: 'mu', anchor: 'middle', max: 104, lines: 2, lh: 1.2, a: 'fade', t: 450 + i * 80 });
    });
    I.forEach(([X, Y], i) => {
      const o = typeof inner[i] === 'string' ? { label: inner[i] } : inner[i] || {};
      s += T(X, Y, o.label, { size: 17, weight: 600, anchor: 'middle', max: 110, lines: 1, a: 'rise', t: 650 + i * 80 });
    });
    const c = d.center || {};
    s += `<g${A('fade', 1000)}>${c.icon ? icon(c.icon, cx, cy - 18, { size: 18, inv: true }) : ''}${T(cx, cy + (c.icon ? 8 : 0), c.label, { size: 19, weight: 700, anchor: 'middle', cls: 'inv', max: 100, lines: 1 })}</g>`;
    const spots = { tl: [70, 150, 'start', I[0]], tr: [1130, 150, 'end', I[1]], bl: [70, 560, 'start', I[2]], br: [1130, 560, 'end', I[3]] };
    notes.forEach((nt, k) => {
      const sp = spots[nt.at || ['tl', 'tr', 'bl', 'br'][k]];
      if (!sp) return;
      const [x, y, an, [X, Y]] = sp, top = y < 300, t = 1200 + k * 140;
      s += T(x, y, nt.text, { size: 13, cls: 'mu', anchor: an, max: 230, lines: 4, lh: 1.45, valign: 'middle', a: 'fade', t });
      const tx = an === 'start' ? x + 120 : x - 120, ty = top ? y + 52 : y - 52;
      s += note(X + (an === 'start' ? -10 : 10), Y + (top ? -10 : 10), tx, ty, an === 'start' ? (top ? -0.35 : 0.35) : (top ? 0.35 : -0.35), { t });
    });
    return { grid: 'none', svg: s };
  }, meta('菱形框架', 'Diamond Framework', 'Ikigai 式框架：四个驱动因素两两相交形成四个区域，中心是全部满足的理想点。'), {
    outer: [{ label: '学生热爱', icon: 'heart' }, { label: '社会需要', icon: 'globe' }, { label: '可以持续', icon: 'chart' }, { label: '技术可行', icon: 'cpu' }],
    inner: ['兴趣', '使命', '方法', '产品'],
    center: { label: '好教育', icon: 'spark' },
    notes: [
      { at: 'tl', text: '有热情、被需要，但还缺少可落地的方法。' },
      { at: 'tr', text: '社会需要又可持续，但学生未必真心喜欢。' },
      { at: 'bl', text: '技术能做、学生喜欢，但还没有解决真问题。' },
      { at: 'br', text: '可持续、技术可行，却缺少使命与温度。' },
    ],
  });

  /* ============================================================== valley */
  // Narrative curve with labelled moments, a hatched critical zone and branching outcomes.
  SD.register('valley', (d) => {
    const X0 = 90, X1 = 1000, Y0 = 590, Y1 = 150;
    const P = p => [X0 + clamp(p.x) * (X1 - X0), Y0 - clamp(p.y) * (Y0 - Y1)];
    const pts_ = (d.points || []).slice().sort((a, b) => a.x - b.x);
    let s = '';
    s += edge(`M${X0} ${Y0}H1140`, { soft: true, t: 100 }) + arrow(1140, Y0, 0, { t: 500 }) + edge(`M${X0} ${Y0}V110`, { soft: true, t: 100 }) + arrow(X0, 110, -Math.PI / 2, { t: 500 });
    s += T(X0 + 2, 92, d.yLabel, { size: 13, weight: 600, a: 'fade', t: 400 }) + T(1140, Y0 + 24, d.xLabel, { size: 13, weight: 600, anchor: 'end', a: 'fade', t: 400 });
    if (d.zone) {
      const zx0 = X0 + d.zone.from * (X1 - X0), zx1 = X0 + d.zone.to * (X1 - X0);
      s += `<g${A('fade', 300)}><rect x="${q(zx0)}" y="125" width="${q(zx1 - zx0)}" height="${Y0 - 125}" rx="6" fill="${url('hatch')}" opacity=".16"/><rect x="${q(zx0)}" y="125" width="${q(zx1 - zx0)}" height="${Y0 - 125}" rx="6" class="ln soft"/></g>`;
      s += T((zx0 + zx1) / 2, 142, d.zone.label, { size: 13, weight: 600, anchor: 'middle', a: 'fade', t: 400 });
    }
    const PP = pts_.map(P), ext = PP.length ? [[X0 - 10, PP[0][1] - 60], ...PP] : [];
    const dd = smooth(ext);
    s += `<path d="${dd}" class="gl" filter="${url('glow')}"${A('fade', 1400)}/>` + edge(dd, { hl: true, thick: true, t: 500, comet: true, ct: 2300, glow: false });
    pts_.forEach((p, i) => {
      const [x, y] = PP[i], prev = PP[i - 1], next = PP[i + 1], peak = (!prev || y <= prev[1]) && (!next || y <= next[1]);
      const t = 800 + i * 220, above = peak || (next && y < next[1] && !prev);
      s += `<g${A('pop', t)}><circle cx="${q(x)}" cy="${q(y)}" r="${p.hl ? 10 : 8}" class="${p.hl ? 'f-ac' : 'ring'}" style="${p.hl ? '' : 'fill:var(--sd-surface);stroke:var(--sd-fg);stroke-width:1.4'}"/></g>`;
      if (p.hl) s += pulse(x, y, 10, 2000);
      const by = above ? y - 22 : y + 26;
      if (above) {
        s += T(x, by, p.label, { size: 15, weight: 600, anchor: 'middle', cls: 'ko', valign: 'bottom', a: 'rise', t: t + 100 });
        if (p.quote) s += T(x, by - 22, `“${p.quote}”`, { size: 12.5, cls: 'mu ko', anchor: 'middle', max: 170, lines: 2, valign: 'bottom', a: 'fade', t: t + 150 });
      } else {
        s += T(x, by, p.label, { size: 15, weight: 600, anchor: 'middle', cls: 'ko', valign: 'top', a: 'rise', t: t + 100 });
        if (p.quote) s += T(x, by + 22, `“${p.quote}”`, { size: 12.5, cls: 'mu ko', anchor: 'middle', max: 170, lines: 2, valign: 'top', a: 'fade', t: t + 150 });
      }
    });
    (d.branches || []).forEach((b, k) => {
      const from = PP[b.from != null ? b.from : PP.length - 1];
      if (!from) return;
      const [ex, ey] = P(b.to || { x: 1, y: 0.2 }), t = 1600 + k * 200;
      const pth = `M${q(from[0])} ${q(from[1])}C${q(from[0] + (ex - from[0]) * 0.5)} ${q(from[1])} ${q(ex - (ex - from[0]) * 0.4)} ${q(ey)} ${q(ex)} ${q(ey)}`;
      s += edge(pth, { soft: true, cls: 'dash', t, glow: false }) + arrow(ex + 12, ey, 0, { t: t + 300, s: 6 });
      s += `<g${A('pop', t + 200)}><circle cx="${q(ex)}" cy="${q(ey)}" r="7" style="fill:var(--sd-surface);stroke:var(--sd-line-3);stroke-width:1.2"/></g>`;
      s += T(ex + 26, ey - (b.quote ? 10 : 0), b.label, { size: 14, weight: 600, a: 'rise', t: t + 250, max: 120, lines: 1 });
      if (b.quote) s += T(ex + 26, ey + 10, `“${b.quote}”`, { size: 11.5, cls: 'mu', a: 'fade', t: t + 300, max: 130, lines: 2, valign: 'top' });
    });
    return { grid: 'none', svg: s };
  }, meta('关键拐点曲线', 'Valley Curve', '一段起伏的历程：关键时刻、原话引述、需要催化的关键区间，以及不同结局的分叉。'), {
    yLabel: '团队投入度', xLabel: '时间',
    zone: { label: '需要催化剂', from: 0.56, to: 0.74 },
    points: [
      { x: 0.05, y: 0.12, label: '现状', quote: '这不是什么大问题' },
      { x: 0.3, y: 0.72, label: '早期兴奋', quote: '用 AI 重做一切' },
      { x: 0.64, y: 0.3, label: '死亡谷', quote: '太难了，再评估一下', hl: true },
      { x: 0.92, y: 0.9, label: '规模化成功', quote: '已经看到结果了' },
    ],
    branches: [
      { from: 2, to: { x: 0.92, y: 0.3 }, label: '平庸', quote: '先这样吧' },
      { from: 2, to: { x: 0.92, y: 0.04 }, label: '失败', quote: '够用就行' },
    ],
  });

  /* ============================================================= capsule */
  // Stage groups: a single circle or a capsule of stacked circles; feedback arcs between stages.
  SD.register('capsule', (d) => {
    const St = d.stages || [], n = Math.max(1, St.length), cy = 350, X0 = 130, X1 = 1070;
    const xs = St.map((_, i) => (n > 1 ? X0 + (i * (X1 - X0)) / (n - 1) : 600));
    let s = '';
    const geo = St.map((g, i) => {
      const its = g.items || [], m = its.length, r = m ? 52 : 60, H = m ? m * r * 1.55 + 40 : 0;
      return { x: xs[i], r, H, m, half: m ? H / 2 : r };
    });
    // group headers with rules
    (d.groups || []).forEach((g, k) => {
      const a = xs[g.from] - geo[g.from].r - 10, b = xs[g.to] + geo[g.to].r + 10, t = 100 + k * 100;
      s += edge(line(a, 78, b, 78), { soft: true, t, glow: false }) + T(a, 102, g.label, { size: 16, weight: 600, a: 'rise', t: t + 100 });
      if (g.desc) s += T(a, 600, g.desc, { size: 12, cls: 'mu', max: b - a, lines: 2, lh: 1.5, valign: 'top', a: 'fade', t: 1500 + k * 100 });
    });
    for (let i = 0; i < n - 1; i++) {
      const a = geo[i], b = geo[i + 1], x1 = a.x + (a.m ? 92 : a.r) + 8, x2 = b.x - (b.m ? 92 : b.r) - 8;
      s += edge(line(x1, cy, x2, cy), { soft: true, t: 400 + i * 150, glow: false }) + arrow(x2, cy, 0, { t: 700 + i * 150, s: 6 });
    }
    St.forEach((g, i) => {
      const G_ = geo[i], t = 250 + i * 160, x = G_.x;
      if (G_.m) {
        const w = 184;
        s += T(x, cy - G_.half - 22, g.label, { size: 14, weight: 600, anchor: 'middle', max: 170, lines: 1, a: 'rise', t });
        s += `<g${A('rise', t)}><rect x="${q(x - w / 2)}" y="${q(cy - G_.H / 2)}" width="${w}" height="${q(G_.H)}" rx="${w / 2}" class="nd${g.hl ? ' hl' : ''}" style="fill:none;stroke:${g.hl ? url('as') : url('ns')}"/></g>`;
        g.items.forEach((it, k) => {
          const o = typeof it === 'string' ? { label: it } : it, y = cy + (k - (G_.m - 1) / 2) * G_.r * 1.55;
          s += `<g${A('pop', t + 150 + k * 90)}><circle cx="${q(x)}" cy="${q(y)}" r="${G_.r}" class="${o.hl ? 'f-soft' : 'f-faint'}" style="${o.hl ? 'stroke:var(--sd-accent);stroke-width:1.2' : ''}"/>${o.icon ? icon(o.icon, x, y - 14, { size: 16, hl: o.hl, mu: !o.hl }) : ''}${T(x, y + (o.icon ? 10 : 0), o.label, { size: 14, weight: 600, anchor: 'middle', max: 90, lines: 2, lh: 1.2 })}</g>`;
        });
      } else {
        s += `<g${A('pop', t)}>${g.hl ? `<circle cx="${q(x)}" cy="${cy}" r="${G_.r + 9}" class="ln hl" opacity=".3"/>` : ''}<circle cx="${q(x)}" cy="${cy}" r="${G_.r}" class="${g.hl ? 'f-ac' : 'f-faint'}"/>${g.icon ? icon(g.icon, x, cy - 16, { size: 18, inv: g.hl, mu: !g.hl }) : ''}${T(x, cy + (g.icon ? 10 : 0), g.label, { size: 14.5, weight: 600, anchor: 'middle', cls: g.hl ? 'inv' : '', max: 96, lines: 2, lh: 1.2 })}</g>`;
      }
      if (g.caption) s += T(x, cy + G_.half + 26, g.caption, { size: 12.5, cls: 'mu', anchor: 'middle', a: 'fade', t: t + 200, max: 170, lines: 1 });
    });
    (d.loops || []).forEach(([i, j, lab], k) => {
      const a = geo[i], b = geo[j];
      if (!a || !b) return;
      const above = k % 2 === 0, ya = cy + (above ? -a.half - 14 : a.half + 14), yb = cy + (above ? -b.half - 14 : b.half + 14), lift = above ? -90 : 90;
      const p = `M${q(a.x + 24)} ${q(ya)}C${q(a.x + 80)} ${q(ya + lift)} ${q(b.x - 80)} ${q(yb + lift)} ${q(b.x - 24)} ${q(yb)}`;
      s += edge(p, { hl: true, t: 1300 + k * 200, comet: true, ct: 2400, glow: false }) + arrow(b.x - 24, yb, above ? 1.1 : -1.1, { hl: true, t: 1600, s: 6 }) + arrow(a.x + 24, ya, above ? 2.05 : -2.05, { hl: true, t: 1600, s: 6 });
      if (lab) s += pill((a.x + b.x) / 2, (ya + yb) / 2 + lift * 0.75, lab, { anchor: 'middle', size: 11.5, hl: true, t: 1500 });
    });
    return { grid: 'none', svg: s };
  }, meta('胶囊流程', 'Capsule Flow', '阶段分组的流程：单个节点或一组并列要素（胶囊），阶段之间可有双向回流。'), {
    groups: [{ label: '需求', from: 0, to: 0, desc: '来自 300 所学校的课堂一线需求。' }, { label: '设计', from: 1, to: 2, desc: '把需求拆成结构、定义与验证，设计面向师生的体验。' }, { label: '交付', from: 3, to: 4, desc: '小步快跑，验证、测试与灰度控制形成闭环。' }],
    stages: [
      { label: '课堂需求', icon: 'users' },
      { label: '设计', items: [{ label: '体验结构', icon: 'layers' }, { label: '能力定义', icon: 'doc' }, { label: '原型验证', icon: 'check' }] },
      { label: 'AI 学伴', icon: 'spark', hl: true, caption: '核心体验' },
      { label: '交付', items: [{ label: '验证', icon: 'eye' }, { label: '测试', icon: 'gear' }, { label: '灰度', icon: 'flow' }] },
      { label: '规模应用', icon: 'globe' },
    ],
    loops: [[1, 3, '双向迭代'], [3, 1, '反馈回流']],
  });

  /* ============================================================== bridge */
  // Two cores with satellite badges, a numbered derivation in between.
  SD.register('bridge', (d) => {
    const L = d.left || {}, Rr = d.right || {}, mid = d.middle || [], cy = 350, lx = 290, rx = 910, R = 84, orbit = R + 56;
    // Labels outside the satellites get the room left before the frame edge (never past it).
    let s = '';
    const sat = (cx, side, items, hl, t0) => {
      const n = items.length, span = Math.min(2.2, 0.55 * (n - 1) + 0.01);
      items.forEach((it, k) => {
        const o = typeof it === 'string' ? { label: it } : it, a = (side < 0 ? Math.PI : 0) + (n > 1 ? (k / (n - 1) - 0.5) * span : 0) * (side < 0 ? -1 : 1);
        const [x, y] = pol(cx, cy, orbit, a), t = t0 + k * 90;
        s += edge(line(cx + (R + 6) * Math.cos(a), cy + (R + 6) * Math.sin(a), x - 22 * Math.cos(a), y - 22 * Math.sin(a)), { faint: true, t, glow: false });
        s += o.icon ? badge(x, y, { r: 20, icon: o.icon, hl: hl && o.hl, t }) : pill(x, y, o.label, { anchor: 'middle', size: 12, hl: hl && o.hl, t });
        if (o.icon) s += T(x + side * 32, y, o.label, { size: 13.5, weight: 500, anchor: side < 0 ? 'end' : 'start', a: 'fade', t: t + 80, max: Math.max(60, Math.min(140, side < 0 ? x - 52 : SD.H.W - x - 52)), lines: 1 });
      });
    };
    s += `<path d="${circP(lx, cy, orbit, 0)}" class="ln faint dash2"${A('fade', 200)}/><path d="${circP(rx, cy, orbit, 0)}" class="ln faint dash2"${A('fade', 200)}/>`;
    sat(lx, -1, L.items || [], false, 500);
    sat(rx, 1, Rr.items || [], true, 900);
    s += `<g${A('zoom', 200)}><circle cx="${lx}" cy="${cy}" r="${R}" class="nd" style="fill:${url('nf')};stroke:${url('ns')}"/>${L.icon ? icon(L.icon, lx, cy - 24, { size: 20 }) : ''}${T(lx, cy + (L.icon ? 6 : -6), L.label, { size: 18, weight: 700, anchor: 'middle', max: 140, lines: 2 })}${T(lx, cy + (L.icon ? 28 : 18), L.sub, { mono: true, size: 9.5, cls: 'mu', anchor: 'middle' })}</g>`;
    s += halo(rx, cy, 200, 700) + pulse(rx, cy, R, 1900) + `<g${A('zoom', 700)}><circle cx="${rx}" cy="${cy}" r="${R + 10}" class="ln hl" opacity=".3"/><circle cx="${rx}" cy="${cy}" r="${R}" class="f-ac"/>${Rr.icon ? icon(Rr.icon, rx, cy - 24, { size: 20, inv: true }) : ''}${T(rx, cy + (Rr.icon ? 6 : -6), Rr.label, { size: 18, weight: 700, anchor: 'middle', cls: 'inv', max: 140, lines: 2 })}${T(rx, cy + (Rr.icon ? 28 : 18), Rr.sub, { mono: true, size: 9.5, cls: 'inv', anchor: 'middle' })}</g>`;
    const m = mid.length, gap = m > 1 ? Math.min(110, 340 / (m - 1)) : 0;
    mid.forEach((it, k) => {
      const y = cy + (k - (m - 1) / 2) * gap, t = 400 + k * 160;
      s += T(600, y - 12, `${String(k + 1).padStart(2, '0')}  ${it.title}`, { size: 19, weight: 700, anchor: 'middle', a: 'rise', t, max: 240, lines: 1 });
      if (it.desc) s += T(600, y + 14, it.desc, { size: 12.5, cls: 'mu', anchor: 'middle', a: 'fade', t: t + 80, max: 240, lines: 1 });
    });
    s += edge(line(lx + orbit + 14, cy, 470, cy), { soft: true, t: 300, glow: false }) + arrow(470, cy, 0, { t: 600, s: 7 });
    s += edge(line(730, cy, rx - orbit - 14, cy), { hl: true, t: 900, comet: true, ct: 2200, glow: false }) + arrow(rx - orbit - 14, cy, 0, { hl: true, t: 1200, s: 7 });
    return { grid: 'dots', svg: s };
  }, meta('双核映射', 'Bridge', '从一个核心（目标/输入）经过几层推导到另一个核心（方案/输出），两端各带要素。'), {
    left: { label: '设计目标', sub: 'Goal', icon: 'target', items: [{ label: '学情数据', icon: 'chart' }, { label: '课程标准', icon: 'book' }, { label: '学生特征', icon: 'user' }, { label: '教师反馈', icon: 'chat' }] },
    middle: [{ title: '视觉层', desc: '轻松识别 · 简化信息 · 优化展示' }, { title: '操作层', desc: '简化流程 · 降低操作成本' }, { title: '认知层', desc: '无需记忆 · 视频引导 · 常驻入口' }],
    right: { label: '设计方案', sub: 'Solution', icon: 'spark', items: [{ label: '简化信息', icon: 'grid' }, { label: '强化对比', icon: 'eye', hl: true }, { label: '流程精简', icon: 'flow' }, { label: '入口固定', icon: 'target' }] },
  });

  /* =============================================================== zones */
  // Tangent zones that expand along an axis (comfort → growth).
  SD.register('zones', (d) => {
    const Z = d.zones || [], n = Math.max(1, Z.length), x0 = 70, cy = 345;
    const ry = Z.map((_, i) => 120 + (i * (290 - 120)) / Math.max(1, n - 1)), rx = ry.map(r => r * 1.75);
    let s = '';
    for (let i = n - 1; i >= 0; i--) {
      const t = 200 + i * 180, last = i === n - 1;
      s += `<ellipse cx="${q(x0 + rx[i])}" cy="${cy}" rx="${q(rx[i])}" ry="${q(ry[i])}" class="${i === 0 ? 'f-soft' : 'f-bg'}" style="stroke:${i === 0 ? 'var(--sd-accent)' : last ? 'var(--sd-line-3)' : 'var(--sd-line-2)'};stroke-width:${last ? 1.6 : 1.2}"${A('zoom', t)}/>`;
    }
    s += edge(line(x0 + 30, cy, 1160, cy), { soft: true, t: 300, comet: true, ct: 2000, glow: false }) + arrow(1160, cy, 0, { t: 700 });
    s += dot(x0 + 30, cy, { r: 5, hl: true, t: 300 });
    Z.forEach((z, i) => {
      const a = i ? x0 + 2 * rx[i - 1] : x0 + 30, b = x0 + 2 * rx[i], mx = (a + b) / 2, t = 500 + i * 180, o = typeof z === 'string' ? { label: z } : z;
      s += T(mx, cy - 18, o.label, { size: 16, weight: 700, anchor: 'middle', cls: (i === 0 ? 'ac' : '') + ' ko', a: 'rise', t, max: b - a - 10, lines: 1 });
      if (o.sub) s += T(mx, cy + 20, o.sub, { mono: true, size: 9.5, cls: 'mu ko', anchor: 'middle', a: 'fade', t, max: b - a - 10, lines: 1 });
      const above = (o.notes || []).slice(0, 2), below = (o.notes || []).slice(2, 4);
      above.forEach((nt, k) => { s += T(mx, cy - 70 - k * 58 - (i * 18), nt, { mono: true, size: 10, cls: 'mu', anchor: 'middle', max: Math.max(90, b - a - 16), lines: 2, a: 'fade', t: t + 150 + k * 60 }); });
      below.forEach((nt, k) => { s += T(mx, cy + 70 + k * 58 + (i * 18), nt, { mono: true, size: 10, cls: 'mu', anchor: 'middle', max: Math.max(90, b - a - 16), lines: 2, a: 'fade', t: t + 200 + k * 60 }); });
    });
    return { grid: 'none', svg: s };
  }, meta('圈层扩张', 'Expanding Zones', '相切于起点的同心圈层沿一条轴扩张，适合讲“舒适区 → 成长区”或能力进阶。'), {
    zones: [
      { label: '舒适区', sub: 'Comfort', notes: ['熟悉的教法', '安全可控', '低风险低回报'] },
      { label: '焦虑区', sub: 'Fear', notes: ['担心被替代', '找借口', '受他人看法影响'] },
      { label: '学习区', sub: 'Learning', notes: ['尝试 AI 备课', '解决真实问题', '掌握新技能', '舒适区变大'] },
      { label: '成长区', sub: 'Growth', notes: ['找到教育初心', '重塑课堂', '设定新目标', '影响更多老师'] },
    ],
  });

  /* ============================================================== radial */
  // Centre → key capabilities (inner ring) → focus areas (mid ring) → concrete items (outer ring).
  SD.register('radial', (d) => {
    const cx = 640, cy = 345, R0 = 112, R1 = 168, R2 = 238, R3 = 300, K = d.keys || [], nk = Math.max(1, K.length);
    let s = `<path d="${circP(cx, cy, R1, 0)}" class="ln faint dash2"${A('fade', 200)}/><path d="${circP(cx, cy, R3, -90)}" class="ln soft"${A('draw', 300)}/>`;
    s += `<g class="live-only" data-loop="spin" data-ox="${cx}" data-oy="${cy}" data-dur="60000" data-t="0"><path d="${circP(cx, cy, R2 - 30, 0)}" class="ln faint dash"/></g>`;
    let nodes = '';
    K.forEach((k, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / nk + (d.rotate || 0) * Math.PI / 180, [kx, ky] = pol(cx, cy, R1, a), t = 400 + i * 200;
      nodes += `<g${A('pop', t)}><circle cx="${q(kx)}" cy="${q(ky)}" r="36" class="f-ac"/>${k.icon ? icon(k.icon, kx, ky - 10, { size: 15, inv: true }) : ''}${T(kx, ky + (k.icon ? 10 : 0), k.label, { size: 15, weight: 700, anchor: 'middle', cls: 'inv', max: 64, lines: 1 })}</g>`;
      const C = k.children || [], m = C.length;
      C.forEach((c, j) => {
        const ca = a + (m > 1 ? (j / (m - 1) - 0.5) * 0.95 : 0), [mx, my] = pol(cx, cy, R2, ca), tt = t + 200 + j * 100;
        s += edge(line(kx + 36 * Math.cos(ca), ky + 36 * Math.sin(ca), mx - 10 * Math.cos(ca), my - 10 * Math.sin(ca)), { soft: true, t: tt, glow: false });
        nodes += `<g${A('pop', tt)}><circle cx="${q(mx)}" cy="${q(my)}" r="9" style="fill:var(--sd-bg);stroke:var(--sd-accent);stroke-width:1.8"/></g>`;
        const cos = Math.cos(ca), an = cos > 0.25 ? 'end' : cos < -0.25 ? 'start' : 'middle';
        nodes += T(mx - cos * 16, my - Math.sin(ca) * 16 + (an === 'middle' ? (Math.sin(ca) > 0 ? -6 : 6) : 0), c.label, { size: 12.5, weight: 600, anchor: an, cls: 'ko', a: 'fade', t: tt + 80, max: 90, lines: 1 });
        const its = c.items || [], ni = its.length;
        its.forEach((it, q2) => {
          const ia = ca + (ni > 1 ? (q2 / (ni - 1) - 0.5) * 0.36 : 0), [ox, oy] = pol(cx, cy, R3, ia), t3 = tt + 150 + q2 * 70;
          s += edge(line(mx + 9 * Math.cos(ia), my + 9 * Math.sin(ia), ox, oy), { faint: true, t: t3, glow: false });
          nodes += dot(ox, oy, { r: 5, cls: 'f-fg', t: t3 });
          const co = Math.cos(ia), sn = Math.sin(ia);
          nodes += T(ox + co * 14, oy + sn * 14, it, { size: 12, cls: 'mu', anchor: co > 0.2 ? 'start' : co < -0.2 ? 'end' : 'middle', a: 'fade', t: t3 + 60, max: 120, lines: 1 });
        });
      });
    });
    const c = d.center || {};
    s += `<g${A('zoom', 150)}><circle cx="${cx}" cy="${cy}" r="${R0}" class="nd" style="fill:${url('nf')};stroke:${url('ns')}"/>${T(cx, cy - 18, c.sub, { size: 14, cls: 'mu', anchor: 'middle' })}${T(cx, cy + 12, c.label, { size: 24, weight: 700, anchor: 'middle', max: 190, lines: 1 })}</g>`;
    if (d.title) s += T(70, 300, d.title, { size: 34, weight: 700, a: 'rise', t: 100, max: 220, lines: 2, ls: -0.8 }) + T(70, 382, d.tagline, { size: 14, cls: 'mu', a: 'fade', t: 200, max: 200, lines: 2 });
    return { grid: 'lines', svg: s + nodes };
  }, meta('环形生态', 'Radial Ecosystem', '中心模型 → 关键维度 → 关注点 → 具体落点，四层放射，适合讲体验模型或能力体系。'), {
    title: '基于教学场景', tagline: '打造电影级的课堂体验',
    center: { label: '教学场景', sub: 'AI 课堂模型' },
    keys: [
      { label: '技术', icon: 'cpu', children: [{ label: '多模态', items: ['语音', '手写', '图像'] }, { label: '交互', items: ['多屏联动', 'AR 演示', '体感'] }] },
      { label: '效率', icon: 'bolt', children: [{ label: '备课赋能', items: ['教案生成', '资源推荐'] }, { label: '学情提效', items: ['自动批改', '数据看板', '错因分析'] }] },
      { label: '体验', icon: 'heart', children: [{ label: '设计语言', items: ['动效', '数据可视化'] }, { label: '课堂氛围', items: ['即时反馈', '游戏化', '协作'] }] },
    ],
  });

  /* ============================================================== bowtie */
  // Many inputs converge into one constriction, then fan out into outcomes.
  SD.register('bowtie', (d) => {
    const Lf = d.left || {}, Rt = d.right || {}, li = Lf.items || [], ri = Rt.items || [], cx = 600, cy = 350;
    const ly = li.map((_, i) => cy + (i - (li.length - 1) / 2) * Math.min(56, 420 / Math.max(1, li.length - 1)));
    const ry = ri.map((_, i) => cy + (i - (ri.length - 1) / 2) * Math.min(62, 440 / Math.max(1, ri.length - 1)));
    let s = '';
    s += T(80, 92, Lf.title, { size: 15, weight: 700, a: 'rise', t: 100 }) + T(80, 112, Lf.sub, { mono: true, size: 9.5, cls: 'mu', a: 'fade', t: 150 });
    s += T(1120, 92, Rt.title, { size: 15, weight: 700, anchor: 'end', a: 'rise', t: 100 }) + T(1120, 112, Rt.sub, { mono: true, size: 9.5, cls: 'ac', anchor: 'end', a: 'fade', t: 150 });
    const strands = 3;
    li.forEach((it, i) => {
      const o = typeof it === 'string' ? { label: it } : it, y = ly[i], t = 300 + i * 70;
      s += `<g${A('rise', t)}><rect x="80" y="${q(y - (o.desc ? 24 : 17))}" width="200" height="${o.desc ? 48 : 34}" rx="8" class="nd" style="fill:${url('nf')};stroke:${url('ns')}"/>${o.icon ? icon(o.icon, 100, y, { size: 14, mu: true }) : ''}${T(o.icon ? 118 : 96, y - (o.desc ? 8 : 0), o.label, { size: 13, weight: 500, max: 150, lines: 1 })}${o.desc ? T(o.icon ? 118 : 96, y + 11, o.desc, { size: 10, cls: 'mu', max: 150, lines: 1 }) : ''}</g>`;
      for (let k = 0; k < strands; k++) {
        const off = (k - 1) * 3, ty = cy + ((i - (li.length - 1) / 2) * 3) + off * 0.5;
        s += edge(`M280 ${q(y + off)}C${q(440)} ${q(y + off)} ${q(500)} ${q(ty)} ${cx} ${q(ty)}`, { faint: k !== 1, soft: k === 1, t: t + 100, glow: false });
      }
    });
    ri.forEach((it, i) => {
      const o = typeof it === 'string' ? { label: it } : it, y = ry[i], t = 1100 + i * 80, hl = o.hl !== false;
      for (let k = 0; k < strands; k++) {
        const off = (k - 1) * 3, ty = cy + ((i - (ri.length - 1) / 2) * 3) + off * 0.5;
        s += edge(`M${cx} ${q(ty)}C${q(700)} ${q(ty)} ${q(760)} ${q(y + off)} 900 ${q(y + off)}`, { hl: hl && k === 1, soft: k !== 1, t, glow: false, comet: hl && k === 1, ct: 2200 + i * 200 });
      }
      s += badge(918, y, { r: 15, icon: o.icon || 'spark', hl: o.hl, t: t + 200 });
      s += T(944, y - (o.desc ? 8 : 0), o.label, { size: 13.5, weight: 600, a: 'rise', t: t + 250, max: 180, lines: 1 });
      if (o.desc) s += T(944, y + 11, o.desc, { size: 11, cls: 'mu', a: 'fade', t: t + 300, max: 180, lines: 1 });
    });
    const c = d.center || {};
    s += halo(cx, cy, 120, 900) + `<g${A('zoom', 900)}><circle cx="${cx}" cy="${cy}" r="30" class="f-ac"/>${icon(c.icon || 'spark', cx, cy, { size: 20, inv: true })}</g>` + pulse(cx, cy, 30, 1900);
    s += T(cx, cy - 58, c.label, { size: 16, weight: 700, anchor: 'middle', a: 'rise', t: 1000, max: 180, lines: 1 });
    s += T(cx, cy + 56, c.sub, { mono: true, size: 9.5, cls: 'mu', anchor: 'middle', a: 'fade', t: 1050, max: 200, lines: 1 });
    if (Lf.figure) s += T(80, 620, Lf.figure, { size: 30, weight: 700, cls: 'mu', a: 'rise', t: 1500 }) + T(80 + textW(Lf.figure, { size: 30, weight: 700 }) + 10, 620, Lf.figureLabel, { size: 11, cls: 'mu', a: 'fade', t: 1550, max: 220, lines: 2 });
    if (Rt.figure) s += T(1120, 620, Rt.figure, { size: 30, weight: 700, cls: 'ac', anchor: 'end', a: 'rise', t: 1600 }) + T(1120 - textW(Rt.figure, { size: 30, weight: 700 }) - 10, 620, Rt.figureLabel, { size: 11, cls: 'mu', anchor: 'end', a: 'fade', t: 1650, max: 220, lines: 2 });
    return { grid: 'none', svg: s };
  }, meta('汇聚发散', 'Bow-tie', '许多输入收束到一个关键转变，再发散为新的价值或角色，适合讲“演进 / 转型”。'), {
    left: { title: '传统教学', sub: 'Execution', items: [{ label: '讲授知识', icon: 'mic' }, { label: '布置作业', icon: 'doc' }, { label: '批改试卷', icon: 'pen' }, { label: '统计成绩', icon: 'chart' }, { label: '统一进度', icon: 'calendar' }, { label: '经验判断', icon: 'eye' }], figure: '80%', figureLabel: '时间花在重复性事务（示例）' },
    center: { label: 'AI 转折点', sub: 'From execution to impact', icon: 'spark' },
    right: { title: 'AI 时代的教师', sub: 'Impact', items: [{ label: '学习设计师', desc: '设计个性化学习路径' }, { label: '成长教练', desc: '关注动机与习惯', icon: 'heart' }, { label: '数据洞察', desc: '读懂学情做决策', icon: 'chart' }, { label: '情感连接', desc: 'AI 做不到的部分', icon: 'users' }, { label: '课程创新', desc: '跨学科与项目制', icon: 'rocket' }], figure: '80%', figureLabel: '时间回到育人本身（示例）' },
  });

  /* ================================================================ cube */
  // 2×2 qualitative matrix with an extruded third dimension.
  SD.register('cube', (d) => {
    const x0 = 230, y0 = 175, S = 380, h = S / 2, dx = 250, dy = -130, X = d.x || {}, Y = d.y || {}, Z = d.z || {}, C = d.cells || [], E = d.extra || {};
    let s = '';
    s += `<g${A('fade', 600)}><path d="M${x0} ${y0}L${x0 + dx} ${y0 + dy}H${x0 + S + dx}L${x0 + S} ${y0}M${x0 + S + dx} ${y0 + dy}V${y0 + S + dy}L${x0 + S} ${y0 + S}" class="ln soft"/></g>`;
    const ex = x0 + S + dx - 190, ey = y0 + dy;
    s += `<g${A('rise', 1300)}><rect x="${ex}" y="${ey}" width="190" height="190" rx="4" class="f-soft" style="stroke:var(--sd-accent);stroke-width:1.2"/><rect x="${ex}" y="${ey}" width="190" height="190" rx="4" fill="${url('hatch')}" opacity=".1"/>${T(ex + 170, ey + 60, E.title, { size: 16, weight: 700, anchor: 'end', cls: 'ac' })}${T(ex + 170, ey + 84, E.desc, { size: 12.5, cls: 'mu', anchor: 'end', max: 150, lines: 4, valign: 'top' })}</g>`;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j], k) => {
      const c = C[k] || {}, cx = x0 + i * h, cy = y0 + j * h, t = 300 + k * 120;
      s += `<g${A('rise', t)}><rect x="${cx}" y="${cy}" width="${h}" height="${h}" class="${c.hl ? 'f-soft' : 'f-bg'}" style="stroke:${c.hl ? 'var(--sd-accent)' : 'var(--sd-line-3)'};stroke-width:1"/><rect x="${cx}" y="${cy}" width="${h}" height="${h}" fill="${url('hatch')}" opacity="${c.hl ? 0.12 : 0.06}"/>${c.icon ? icon(c.icon, cx + 26, cy + 30, { size: 17, hl: c.hl, mu: !c.hl }) : ''}${T(cx + 18, cy + 64, c.title, { size: 16, weight: 700, cls: c.hl ? 'ac' : '' })}${T(cx + 18, cy + 88, c.desc, { size: 12.5, cls: 'mu', max: h - 36, lines: 4, valign: 'top' })}</g>`;
    });
    s += T(x0 - 30, y0 + 8, Y.high, { size: 12.5, weight: 600, anchor: 'end', a: 'fade', t: 900 }) + T(x0 - 30, y0 + S - 4, Y.low, { size: 12.5, weight: 600, anchor: 'end', a: 'fade', t: 900 });
    s += `<g${A('fade', 900)}><text x="${x0 - 46}" y="${y0 + h}" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="middle" dominant-baseline="central" transform="rotate(-90 ${x0 - 46} ${y0 + h})">${esc(Y.label)}</text></g>`;
    s += edge(`M${x0 - 46} ${y0 + 40}V${y0 + h - 60}M${x0 - 46} ${y0 + h + 60}V${y0 + S - 30}`, { soft: true, cls: 'dash', t: 900, glow: false });
    s += T(x0, y0 + S + 30, X.low, { size: 12.5, weight: 600, a: 'fade', t: 900 }) + T(x0 + S, y0 + S + 30, X.high, { size: 12.5, weight: 600, anchor: 'end', a: 'fade', t: 900 }) + T(x0 + h, y0 + S + 30, X.label, { size: 13, weight: 700, anchor: 'middle', a: 'fade', t: 900 });
    const zx = x0 + S + 40, zy = y0 + S + 6, ang = Math.atan2(dy, dx) * 180 / Math.PI, zl = Math.hypot(dx, dy);
    s += `<g${A('fade', 1000)}><g transform="translate(${zx} ${zy}) rotate(${q(ang)})"><path d="M10 0H${q(zl - 30)}" class="ln soft dash"/><text x="${q(zl / 2)}" y="-10" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="middle">${esc(Z.label)}</text><text x="0" y="-10" font-size="12" font-weight="600" class="mu">${esc(Z.low || '')}</text><text x="${q(zl - 20)}" y="-10" font-size="12" font-weight="600" class="mu" text-anchor="end">${esc(Z.high || '')}</text></g></g>`;
    return { grid: 'none', svg: s };
  }, meta('立体象限', 'Matrix Cube', '2×2 定性矩阵 + 第三个维度的延伸，适合讲战略环境、能力组合。位置为定性判断。'), {
    y: { label: '不确定性', low: '低', high: '高' }, x: { label: '可塑性', low: '低', high: '高' }, z: { label: '资源约束', low: '低', high: '高' },
    cells: [
      { title: '适应', desc: '无法预测也无法改变：快速试错', icon: 'flow' },
      { title: '塑造', desc: '无法预测但能改变：主动定义新标准', icon: 'spark', hl: true },
      { title: '经典', desc: '能预测难改变：规模化与效率', icon: 'chart' },
      { title: '远见', desc: '能预测能改变：提前布局', icon: 'eye' },
    ],
    extra: { title: '重塑', desc: '资源严重受限时，先保生存再重建能力。' },
  });

  /* =============================================================== loops */
  // Ring of stages, with overlapping ellipses for cross-stage work streams.
  SD.register('loops', (d) => {
    const St = d.stages || [], n = Math.max(1, St.length), cx = 600, cy = 345, R = 205;
    const P = St.map((_, i) => pol(cx, cy, R, -Math.PI / 2 + (i * 2 * Math.PI) / n));
    let s = `<path d="${circP(cx, cy, R, -90)}" class="ln hl" style="stroke-width:1.4"${A('draw', 200)}/>`;
    s += `<g${A('fade', 300)}><path d="${circP(cx, cy, R + 70, -60)}" class="ln soft dash" style="stroke-dasharray:4 6"/></g>`;
    for (let k = 0; k < 4; k++) { const a = -Math.PI / 3 + k * Math.PI / 2, [x, y] = pol(cx, cy, R + 70, a); s += arrow(x, y, a + Math.PI / 2, { s: 6, t: 600 }); }
    (d.phases || []).forEach((ph, k) => {
      const a = P[ph.from], b = P[ph.to];
      if (!a || !b) return;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 48, ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, t = 900 + k * 220;
      s += `<g${A('fade', t)}><g transform="translate(${q(mx)} ${q(my)}) rotate(${q(ang)})"><ellipse rx="${q(len)}" ry="${ph.width || 50}" class="${ph.hl ? 'f-soft' : ''}" style="fill:${ph.hl ? '' : 'none'};stroke:${ph.hl ? 'var(--sd-accent)' : 'var(--sd-line-3)'};stroke-width:1.3"/><text y="${-(ph.width || 50) + 18}" font-size="12.5" font-weight="600" text-anchor="middle" class="${ph.hl ? 'ac' : 'mu'}">${esc(ph.label)}</text></g></g>`;
    });
    (d.edges || []).forEach((lab, i) => {
      if (!lab) return;
      const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n, [x, y] = pol(cx, cy, R - 62, a), deg = (a * 180) / Math.PI + 90, flip = Math.cos(a + Math.PI / 2) < 0 ? 0 : 0;
      s += `<g${A('fade', 700)}><text x="${q(x)}" y="${q(y)}" font-size="11.5" class="mu" text-anchor="middle" dominant-baseline="central" transform="rotate(${q(Math.sin(a) > 0 ? deg + 180 : deg) + flip} ${q(x)} ${q(y)})">${esc(lab)}</text></g>`;
    });
    St.forEach((st, i) => {
      const [x, y] = P[i], a = -Math.PI / 2 + (i * 2 * Math.PI) / n, o = typeof st === 'string' ? { label: st } : st, t = 400 + i * 120;
      s += badge(x, y, { r: 14, icon: o.icon, text: o.icon ? null : '', hl: o.hl, t });
      const c = Math.cos(a), an = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle', [lx, ly] = pol(cx, cy, R + 34, a);
      s += T(lx, ly + (an === 'middle' ? (Math.sin(a) < 0 ? -6 : 6) : 0), `${i + 1}. ${o.label}`, { size: 17, weight: 600, anchor: an, cls: 'ko', a: 'rise', t: t + 80, max: 170, lines: 2 });
    });
    return { grid: 'lines', svg: s };
  }, meta('迭代回路', 'Iteration Loops', '一圈阶段 + 跨阶段的工作组（椭圆），适合讲设计方法论、研发迭代。'), {
    stages: ['沉浸调研', '问题定义', '原型', '测试', '交付', '战略对齐'],
    edges: ['洞察', '问题', '概念', '验证', '方案', '价值'],
    phases: [{ label: '理解', from: 0, to: 2, hl: true }, { label: '发现', from: 2, to: 3, width: 44 }, { label: '交付', from: 2, to: 4, width: 60 }],
  });

  /* ============================================================== nested */
  // Concentric capsules (each contains the previous) with hatched annotation columns.
  SD.register('nested', (d) => {
    const It = d.items || [], n = Math.max(1, It.length), x0 = 80, cy = 352, segW = (1110 - x0) / n;
    let s = '';
    It.forEach((it, i) => {
      const o = typeof it === 'string' ? { label: it } : it, cx = x0 + segW * (i + 0.5), up_ = o.side ? o.side === 'up' : i % 2 === 0, t = 900 + i * 160;
      if (!o.note) return;
      const top = up_ ? 110 : cy + 44, bot = up_ ? cy - 44 : 610;
      s += `<g${A(up_ ? 'growy' : 'fade', t)}><rect x="${q(cx - 62)}" y="${top}" width="124" height="${bot - top}" fill="${url('hatch')}" opacity=".13"/></g>`;
      s += T(cx, up_ ? top + 54 : bot - 64, o.note, { size: 14, anchor: 'middle', cls: 'mu', max: 160, lines: 2, a: 'fade', t: t + 100 });
      s += edge(up_ ? line(cx, top + 82, cx, cy - 64) : line(cx, cy + 64, cx, bot - 96), { soft: true, cls: 'dash', t: t + 150, glow: false });
    });
    for (let i = n - 1; i >= 0; i--) {
      const hgt = 96 + i * 26, w = segW * (i + 1) + 28 + i * 8, x = x0 - 14 - i * 6, t = 200 + i * 150, o = typeof It[i] === 'string' ? { label: It[i] } : It[i] || {};
      s += `<g${A('growx', t)} data-o="left center"><rect x="${q(x)}" y="${q(cy - hgt / 2)}" width="${q(w)}" height="${hgt}" rx="${hgt / 2}" class="${o.hl ? 'f-soft' : 'f-bg'}" style="stroke:${o.hl ? 'var(--sd-accent)' : 'var(--sd-line-3)'};stroke-width:1.2"/></g>`;
    }
    It.forEach((it, i) => {
      const o = typeof it === 'string' ? { label: it } : it, cx = x0 + segW * (i + 0.5);
      if (o.icon) s += `<g${A('fade', 700 + i * 120)}>${icon(o.icon, cx, cy - 24, { size: 18, hl: o.hl, mu: !o.hl })}</g>`;
      s += T(cx, cy + (o.icon ? 8 : 0), up(o.label), { size: 18, weight: 700, anchor: 'middle', cls: o.hl ? 'ac' : '', a: 'rise', t: 700 + i * 120, max: segW - 20, lines: 1, ls: 0.5 });
    });
    return { grid: 'none', svg: s };
  }, meta('嵌套胶囊', 'Nested Capsules', '层层包含的阶段或角色（每一层都包含前一层），上下挂注释，适合讲参与深度、能力进阶。'), {
    items: [
      { label: '使用', icon: 'user', note: '用 AI 完成作业辅导', side: 'up' },
      { label: '理解', icon: 'brain', note: '知道 AI 擅长与不擅长', side: 'down' },
      { label: '共创', icon: 'pen', note: '和 AI 一起设计项目', side: 'up', hl: true },
      { label: '创造', icon: 'rocket', note: '自己搭建 AI 工具', side: 'down' },
    ],
  });

})();
