/* Stage Diagrams — hero & narrative types: hub, stack, funnel, orbit, scurve, rings, stat, versus */
(() => {
  const SD = window.StageDiagrams;
  const { badge, elbow, pill, chip, disk, slab, circP, q, clamp, esc, A, pol, pts, up, url, measure, T, textW, icon, card, hcurve, line, smooth, edge, arrow, dot, pulse, halo, tag, rng } = SD.H;

  /* ================================================================ hub */
  function hexTile(px, py, nd, t, above) {
    const R = 46, f = 0.56, th = 13, top = py - 8, hl = nd.hl ? ' hl' : '';
    const P = [0, 1, 2, 3, 4, 5].map(k => pol(px, top, R, Math.PI / 6 + (k * Math.PI) / 3, R * f));
    const B = P.map(p => [p[0], p[1] + th]);
    const side = [P[0], P[1], P[2], B[2], B[1], B[0]];
    return `<g${A('rise', t)}>${nd.hl ? `<polygon points="${pts(P)}" class="gl" filter="${url('glow')}"/>` : ''}<polygon points="${pts(side)}" class="nd side${hl}"/><polygon points="${pts(P)}" class="nd${hl}"/><path d="M${q(P[1][0])} ${q(P[1][1])}V${q(B[1][1])}" class="ln faint"/>${icon(nd.icon || 'spark', px, top, { hl: nd.hl, size: 22 })}${T(px, above ? top - R * f - 18 : top + th + R * f + 20, nd.label, { mono: true, size: 12, anchor: 'middle', cls: nd.hl ? 'ac' : 'mu', max: 150, lines: 1 })}</g>`;
  }
  SD.register('hub', (d) => {
    const cx = 600, cy = 352, nodes = d.nodes || [], n = Math.max(1, nodes.length);
    const RX = 445, RY = 218, off = d.offset != null ? (d.offset * Math.PI) / 180 : 0;
    let wires = '', tiles = '';
    nodes.forEach((nd, i) => {
      const ang = -Math.PI / 2 + off + (i * 2 * Math.PI) / n;
      const [px, py] = pol(cx, cy, RX, ang, RY);
      const [ex, ey] = pol(cx, cy + 6, 132, ang, 50);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const tx = px - ux * 52, ty = py - 8 - uy * 30;
      const dx = tx - ex, dy = ty - ey, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      [-1, 0, 1].forEach(k => {
        const w = 15 * k + 9;
        const c1 = [ex + dx * 0.42 + nx * w * 1.7, ey + dy * 0.42 + ny * w * 1.7];
        const c2 = [ex + dx * 0.72 - nx * w, ey + dy * 0.72 - ny * w];
        const dd = `M${q(ex)} ${q(ey)}C${q(c1[0])} ${q(c1[1])} ${q(c2[0])} ${q(c2[1])} ${q(tx)} ${q(ty)}`;
        wires += edge(dd, { faint: k !== 0, soft: k === 0 && !nd.hl, hl: k === 0 && nd.hl, t: 500 + i * 70 + (k + 1) * 70, comet: k === 0, ct: 1900 + i * 420, rev: i % 2 === 1 });
      });
      wires += dot(tx, ty, { r: 2.8, hl: nd.hl, t: 1150 + i * 70 });
      wires += dot(ex, ey, { r: 2.2, hl: nd.hl, t: 650 + i * 70 });
      tiles += hexTile(px, py, nd, 850 + i * 90, Math.sin(ang) < -0.6);
    });
    const core = d.core || {};
    const cr = 132, cry = 50, ch = 24;
    let ticks = '';
    for (let k = 1; k < 30; k++) {
      const a = (k * Math.PI) / 30, x = cx - cr * Math.cos(a), y = cy + cry * Math.sin(a);
      ticks += `M${q(x)} ${q(y + 3)}V${q(y + ch - 2)}`;
    }
    const coreSvg = `<g${A('zoom', 200)}>
<ellipse cx="${cx}" cy="${cy + ch}" rx="${cr}" ry="${cry}" class="nd side"/>
<rect x="${cx - cr}" y="${cy}" width="${cr * 2}" height="${ch}" style="fill:var(--sd-surface-2)"/>
<path d="M${cx - cr} ${cy}V${cy + ch}M${cx + cr} ${cy}V${cy + ch}" class="ln soft"/>
<path d="${ticks}" class="ln faint"/>
<ellipse cx="${cx}" cy="${cy}" rx="${cr}" ry="${cry}" class="gl" filter="${url('glow')}"/>
<ellipse cx="${cx}" cy="${cy}" rx="${cr}" ry="${cry}" class="nd hl"/>
<ellipse cx="${cx}" cy="${cy}" rx="${cr * 0.78}" ry="${cry * 0.78}" class="ln hl" opacity=".45"/>
${core.icon ? icon(core.icon, cx, cy - 22, { hl: true, size: 18 }) : ''}
${T(cx, cy - (core.sub ? 7 : 0) + (core.icon ? 6 : 0), core.label || 'CORE', { mono: true, size: 14, weight: 500, anchor: 'middle', max: 170, lines: 2, lh: 1.25 })}
${core.sub ? T(cx, cy + 16 + (core.icon ? 6 : 0), core.sub, { mono: true, size: 9.5, anchor: 'middle', cls: 'ac', max: 170, lines: 1 }) : ''}
</g>`;
    return { grid: 'iso', mask: { cy: 0.53, r: 0.6 }, svg: halo(cx, cy, 330, 60) + wires + pulse(cx, cy, cry, 1700, cr) + coreSvg + tiles };
  }, { zh: '集成中枢', en: 'Integration Hub', group: 'systems', desc: '一个核心连接多个能力或第三方服务，适合发布会讲“平台/生态/集成”。' }, {
    headline: '连接一切的 Agent 中枢', lede: '一个核心，六种能力，开箱即用的集成生态。', figure: { value: '120', unit: '+', label: '可用连接器（示例）', progress: 0.8 },
    core: { label: 'Agent Core', sub: 'v2.0 · realtime', icon: 'agent' },
    nodes: [
      { label: '知识库', icon: 'book' }, { label: '代码仓库', icon: 'code' }, { label: '多模态', icon: 'image', hl: true },
      { label: '数据中台', icon: 'db' }, { label: '消息协同', icon: 'chat' }, { label: '安全网关', icon: 'shield' },
    ],
  });

  /* ============================================================== stack */
  SD.register('stack', (d) => {
    const L = d.layers || [], n = Math.max(1, L.length);
    const cx = 420, a = 210, b = a * 0.5, th = 14;
    const gap = n > 1 ? Math.min(150, (590 - 2 * b - th) / (n - 1)) : 0;
    const ys = L.map((_, i) => 352 - ((n - 1) * gap) / 2 + i * gap);
    const P = (yc, u, v) => [cx + ((u - v) * a) / 2, yc + ((u + v) * b) / 2];
    let s = '', right = '', brackets = '';
    const hlIdx = L.findIndex(l => l.hl);
    if (hlIdx >= 0) s += halo(cx, ys[hlIdx], 300, 100, 0.9);
    for (let i = n - 1; i >= 0; i--) {
      const yc = ys[i], ly = L[i] || {}, hl = ly.hl ? ' hl' : '';
      const t = 300 + (n - 1 - i) * 230;
      // connectors to the layer below + rising particles
      if (i < n - 1) {
        const yl = ys[i + 1];
        s += `<path d="M${q(cx - a)} ${q(yc + th)}V${q(yl)}M${q(cx + a)} ${q(yc + th)}V${q(yl)}M${q(cx)} ${q(yc + b + th)}V${q(yl + b)}" class="ln faint dash"${A('fade', t + 150)}/>`;
        s += `<path d="M${cx} ${q(yl)}V${q(yc + b + th)}" class="comet" data-loop="comet" data-seg="26" data-t="${2200 + i * 500}" data-dur="2400"/>`;
        s += `<path d="M${cx - 60} ${q(yl + 14)}V${q(yc + b + th - 8)}" class="comet" data-loop="comet" data-seg="18" data-t="${2900 + i * 500}" data-dur="2800"/>`;
        s += `<path d="M${cx + 60} ${q(yl + 14)}V${q(yc + b + th - 8)}" class="comet" data-loop="comet" data-seg="18" data-t="${3500 + i * 400}" data-dur="2600"/>`;
      }
      const Tp = [cx, yc - b], Rt = [cx + a, yc], Bm = [cx, yc + b], Lf = [cx - a, yc];
      const dn = p => [p[0], p[1] + th];
      let g = '';
      if (ly.hl) g += `<polygon points="${pts([Tp, Rt, Bm, Lf])}" class="gl" filter="${url('glow')}"/>`;
      g += `<polygon points="${pts([Lf, Bm, dn(Bm), dn(Lf)])}" class="nd side${hl}"/>`;
      g += `<polygon points="${pts([Bm, Rt, dn(Rt), dn(Bm)])}" class="nd side${hl}" style="filter:brightness(.82)"/>`;
      g += `<polygon points="${pts([Tp, Rt, Bm, Lf])}" class="nd plate${hl}"/>`;
      const m = 8;
      let grid = '';
      for (let k = 1; k < m; k++) {
        const u = -1 + (2 * k) / m;
        const p1 = P(yc, u, -1), p2 = P(yc, u, 1), p3 = P(yc, -1, u), p4 = P(yc, 1, u);
        grid += `M${q(p1[0])} ${q(p1[1])}L${q(p2[0])} ${q(p2[1])}M${q(p3[0])} ${q(p3[1])}L${q(p4[0])} ${q(p4[1])}`;
      }
      g += `<path d="${grid}" class="ln ${ly.hl ? 'soft' : 'faint'}"/>`;
      const rnd = rng(17 + i * 31);
      const lit = ly.hl ? 10 : 4;
      for (let c = 0; c < lit; c++) {
        const ci = Math.floor(rnd() * m), cj = Math.floor(rnd() * m);
        const u0 = -1 + (2 * ci) / m, v0 = -1 + (2 * cj) / m, du = 2 / m;
        const poly = [P(yc, u0, v0), P(yc, u0 + du, v0), P(yc, u0 + du, v0 + du), P(yc, u0, v0 + du)];
        g += `<polygon points="${pts(poly)}" class="${ly.hl ? 'f-mid' : 'f-faint'}"${ly.hl ? ` data-loop="breathe" data-t="${2000 + c * 380}" data-dur="${2600 + (c % 4) * 700}"` : ''}/>`;
      }
      s += `<g${A('drop', t)}>${g}</g>`;
      // right side label
      const lx = 790;
      right += edge(line(cx + a + 14, yc, lx - 22, yc), { faint: true, cls: 'dash', t: t + 500 });
      right += dot(lx - 22, yc, { r: 2.6, hl: ly.hl, t: t + 700 });
      const items = (ly.items || []).map(x => '→ ' + x).join('   ');
      const blockTop = yc - (ly.sub ? 26 : 14) - (items ? 10 : 0);
      right += `<g${A('rise', t + 450)}>`;
      if (ly.icon) right += `<g${A('rise', t + 450)}><rect x="${lx}" y="${q(blockTop - 2)}" width="30" height="30" rx="8" class="nd${ly.hl ? ' hl' : ''}" style="fill:${ly.hl ? url('af') : url('nf')}"/>${icon(ly.icon, lx + 15, blockTop + 13, { size: 16, hl: ly.hl })}</g>`;
      right += T(lx + (ly.icon ? 42 : 0), blockTop, ly.label, { size: 22, weight: 500, valign: 'top', max: 340, lines: 1 });
      if (ly.sub) right += T(lx, blockTop + 36, ly.sub, { mono: true, size: 10.5, cls: ly.hl ? 'ac' : 'mu', valign: 'top', max: 340, lines: 1 });
      if (items) right += T(lx, blockTop + (ly.sub ? 58 : 36), items, { mono: true, size: 10.5, cls: 'fa', valign: 'top', max: 340, lines: 2, upper: false });
      right += `</g>`;
      // left bracket
      const span = n > 1 ? gap / 2 - 10 : 110;
      const bx = 120;
      brackets += `<path d="M${bx + 8} ${q(yc - span)}H${bx}V${q(yc + span)}H${bx + 8}" class="ln soft"${A('fade', t + 300)}/>`;
      brackets += T(bx - 18, yc, String(n - i).padStart(2, '0'), { mono: true, size: 11, cls: ly.hl ? 'ac' : 'mu', anchor: 'end', a: 'fade', t: t + 300 });
    }
    return { grid: 'dots', mask: { cx: 0.35, r: 0.55 }, svg: brackets + s + right };
  }, { zh: '平台分层', en: 'Platform Stack', group: 'systems', desc: '等距悬浮的分层平台，适合讲“技术栈 / 平台架构 / 能力底座”。' }, {
    headline: '四层能力底座', lede: '从算力到应用，每一层都可独立扩展。', figure: { value: '4', unit: 'x', label: '模型迭代速度提升（示例）', progress: 0.7 },
    layers: [
      { label: 'AI 应用层', icon: 'spark', sub: 'Applications', items: ['智能助教', '自动批改', '学情分析'], hl: true },
      { label: '模型与智能体', icon: 'brain', sub: 'Models · Agents', items: ['多模态大模型', 'RAG', 'Agent 编排'] },
      { label: '数据层', icon: 'db', sub: 'Data Plane', items: ['题库', '课程', '学习行为'] },
      { label: '算力层', icon: 'cpu', sub: 'Compute', items: ['GPU 集群', '边缘设备'] },
    ],
  });

  /* ============================================================= funnel */
  SD.register('funnel', (d) => {
    const ins = d.inputs || [], outs = d.outputs || [], core = d.core || {};
    const cy = 362, x0 = 468, x1 = 732, xc = 600, rmin = 30, rmax = 136;
    const rr = x => rmin + (rmax - rmin) * ((x - xc) / (x1 - xc)) ** 2;
    let wh = '';
    const NR = 13;
    for (let k = 0; k < NR; k++) {
      const x = x0 + (k * (x1 - x0)) / (NR - 1), r = rr(x), mid = k === (NR - 1) / 2;
      wh += `<ellipse cx="${q(x)}" cy="${cy}" rx="${q(r * 0.2)}" ry="${q(r)}" class="ln ${mid ? 'hl' : 'faint'}"${A('fade', 300 + Math.abs(k - (NR - 1) / 2) * 60)}/>`;
    }
    for (let m = 0; m <= 8; m++) {
      const th = (m * Math.PI) / 8, P = [];
      for (let k = 0; k <= 30; k++) { const x = x0 + (k * (x1 - x0)) / 30; P.push([x, cy + rr(x) * Math.cos(th)]); }
      wh += `<path d="M${P.map(p => q(p[0]) + ' ' + q(p[1])).join('L')}" class="ln ${m === 4 ? 'soft' : 'faint'}"${A('draw', 500 + m * 40)}/>`;
    }
    wh += `<ellipse cx="${xc}" cy="${cy}" rx="${rmin * 0.2}" ry="${rmin}" class="gl" filter="${url('glow')}"${A('fade', 900)}/>`;
    const ni = ins.length, no = outs.length;
    const gI = ni > 1 ? Math.min(48, 480 / (ni - 1)) : 0, gO = no > 1 ? Math.min(110, 470 / (no - 1)) : 0;
    let left = '', right = '', comets = '';
    const outCards = outs.map((o, j) => card(1000, cy + (j - (no - 1) / 2) * gO, { label: o.label || o, sub: o.sub, icon: o.icon, hl: o.hl, maxW: 230, minW: 190, t: 1500 + j * 120 }));
    ins.forEach((it, i) => {
      const y = cy + (i - (ni - 1) / 2) * gI, label = it.label || it;
      const ym = cy + (ni > 1 ? (i - (ni - 1) / 2) * ((rmax * 1.25) / (ni - 1)) : 0);
      left += T(it.icon ? 280 : 286, y, label, { size: 14, anchor: 'end', cls: 'mu', a: 'rise', t: 200 + i * 60, max: 200, lines: 1 });
      left += it.icon ? `<g${A('pop', 300 + i * 60)}>${icon(it.icon, 300, y, { size: 15, mu: true })}</g>` : dot(300, y, { r: 2.6, t: 300 + i * 60 });
      left += edge(hcurve(306, y, x0, ym), { soft: true, t: 400 + i * 60 });
      const oc = outCards.length ? outCards[i % outCards.length] : null;
      const full = `M306 ${q(y)}C${q(387)} ${q(y)} ${q(387)} ${q(ym)} ${x0} ${q(ym)}C${q(530)} ${q(ym)} ${q(560)} ${cy} ${xc} ${cy}` + (oc ? `C${640} ${cy} ${670} ${q(oc.cy)} ${x1} ${q(oc.cy)}C${q(800)} ${q(oc.cy)} ${q(820)} ${q(oc.cy)} ${q(oc.l)} ${q(oc.cy)}` : '');
      comets += `<path d="${full}" class="comet" data-loop="comet" data-t="${2200 + i * 520}" data-dur="${4200}"/>`;
    });
    outCards.forEach((oc, j) => {
      const o = outs[j] || {};
      const ys = cy + (no > 1 ? (j - (no - 1) / 2) * ((rmax * 1.1) / (no - 1)) : 0);
      right += edge(hcurve(x1, ys, oc.l, oc.cy), { hl: o.hl, soft: !o.hl, t: 1300 + j * 100 });
      right += dot(oc.l, oc.cy, { r: 2.6, hl: o.hl, t: 1500 + j * 100 });
      right += oc.svg;
    });
    const head = (core.icon ? chip(xc - textW(core.label, { size: 22, weight: 500 }) / 2 - 34, cy - rmax - 66, { r: 18, icon: core.icon, hl: true, t: 650 }).svg : '') + T(xc, cy - rmax - 64, core.label, { size: 22, weight: 500, anchor: 'middle', a: 'rise', t: 700, max: 320, lines: 1 }) + T(xc, cy - rmax - 34, core.sub, { mono: true, size: 10.5, cls: 'ac', anchor: 'middle', a: 'rise', t: 800, max: 320, lines: 1 });
    const foot = T(150, cy - (ni - 1) * gI / 2 - 40, d.inputsLabel || '', { mono: true, size: 10.5, cls: 'fa', a: 'fade', t: 200 }) + (no ? T(1000, outCards[0].t - 34, d.outputsLabel || '', { mono: true, size: 10.5, cls: 'fa', anchor: 'middle', a: 'fade', t: 1400 }) : '');
    return { grid: 'dots', svg: halo(xc, cy, 230, 100) + wh + left + right + comets + head + foot };
  }, { zh: '汇聚转化', en: 'Convergence Funnel', group: 'process', desc: '多源输入经过核心引擎汇聚，转化为若干产出。适合讲“数据 → 引擎 → 价值”。' }, {
    inputsLabel: 'Sources',
    outputsLabel: 'Outcomes',
    inputs: [{ label: '课件 PDF', icon: 'doc' }, { label: '视频课程', icon: 'video' }, { label: '题库', icon: 'grid' }, { label: '学术论文', icon: 'book' }, { label: '网页资料', icon: 'globe' }, { label: '课堂笔记', icon: 'pen' }, { label: '师生对话', icon: 'chat' }],
    core: { label: '知识引擎', sub: 'Knowledge Engine', icon: 'brain' },
    outputs: [{ label: '个性化学习路径', icon: 'flow', hl: true }, { label: '7×24 智能答疑', icon: 'chat' }, { label: '自动出题与测评', icon: 'check' }],
  });

  /* ============================================================== orbit */
  SD.register('orbit', (d) => {
    const cx = 600, cy = 345, rings = d.rings || [], k = Math.max(1, rings.length);
    const R0 = 140, R1 = 300;
    let s = halo(cx, cy, 260, 50);
    const placed = [];
    rings.forEach((rg, j) => {
      const r = k === 1 ? 220 : R0 + (j * (R1 - R0)) / (k - 1);
      const t = 250 + j * 180;
      s += `<path d="${circP(cx, cy, q(r), -90)}" class="ln ${j === k - 1 ? 'faint' : 'soft'}"${A('draw', t)}/>`;
      if (j === k - 1) s += `<g data-loop="spin" data-ox="${cx}" data-oy="${cy}" data-dur="90000" data-t="0"><circle cx="${cx}" cy="${cy}" r="${q(r + 14)}" class="ln faint dash"${A('fade', t + 300)}/></g>`;
      // orbiting light
      const a1 = -Math.PI / 2 + 0.2 * j, a2 = a1 + 0.5;
      const p1 = pol(cx, cy, r, a1), p2 = pol(cx, cy, r, a2);
      s += `<g class="live-only" data-loop="spin" data-ox="${cx}" data-oy="${cy}" data-dur="${22000 + j * 9000}" data-dir="${j % 2 ? -1 : 1}" data-t="1200"><path d="M${q(p1[0])} ${q(p1[1])}A${q(r)} ${q(r)} 0 0 1 ${q(p2[0])} ${q(p2[1])}" class="ln hl thick" opacity=".55"/><circle cx="${q(p2[0])}" cy="${q(p2[1])}" r="7" class="glf" filter="${url('glow')}"/><circle cx="${q(p2[0])}" cy="${q(p2[1])}" r="3.4" class="f-hi"/></g>`;
      const items = rg.items || [], m = items.length;
      items.forEach((it, i) => {
        const o = typeof it === 'string' ? { label: it } : it;
        const base = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(1, m) + j * 0.42;
        const lw = textW(o.label, { size: 14, max: 150 }) + 8;
        let ang, px, py, c, sn, lx, ly, anchor, box;
        for (const dA of [0, 0.14, -0.14, 0.28, -0.28, 0.42, -0.42, 0.56, -0.56]) {
          ang = base + dA; [px, py] = pol(cx, cy, r, ang); c = Math.cos(ang); sn = Math.sin(ang);
          const g0 = o.icon ? 26 : 16; lx = px + c * g0; ly = py + sn * g0; anchor = c > 0.28 ? 'start' : c < -0.28 ? 'end' : 'middle';
          if (anchor === 'middle') ly += sn > 0 ? (o.icon ? 4 : 8) : (o.icon ? -4 : -8);
          const bx = anchor === 'start' ? lx : anchor === 'end' ? lx - lw : lx - lw / 2;
          box = [bx - 6, ly - 13, bx + lw + 6, ly + 13];
          if (!placed.some(p => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3])) && !(Math.abs(px - cx) < 50 && py < cy)) break;
        }
        placed.push(box, [px - 8, py - 8, px + 8, py + 8]);
        const tt = t + 400 + i * 70;
        s += o.icon ? `<g${A('pop', tt)}>${o.hl ? `<circle cx="${q(px)}" cy="${q(py)}" r="20" class="glf" filter="${url('glow')}"/>` : ''}<circle cx="${q(px)}" cy="${q(py + 4)}" r="16" class="nd side${o.hl ? ' hl' : ''}"/><circle cx="${q(px)}" cy="${q(py)}" r="16" class="nd${o.hl ? ' hl' : ''}" style="fill:${o.hl ? url('af') : url('nf')}"/>${icon(o.icon, px, py, { size: 15, hl: o.hl })}</g>` : `<g${A('pop', tt)}>${o.hl ? `<circle cx="${q(px)}" cy="${q(py)}" r="9" class="glf" filter="${url('glow')}"/>` : ''}<circle cx="${q(px)}" cy="${q(py)}" r="${o.hl ? 5 : 4}" class="ring${o.hl ? ' hl' : ''}"/></g>`;
        s += T(lx, ly, o.label, { size: 14, weight: o.hl ? 600 : 400, anchor, cls: 'ko' + (o.hl ? '' : ''), a: 'fade', t: tt + 120, max: 150, lines: 2 });
        if (o.hl) s += pulse(px, py, 5, 1800 + i * 300);
      });
      s += tag(cx, cy - r, rg.label, { t: t + 300 });
    });
    const core = d.core || {};
    s += pulse(cx, cy, 76, 1500);
    s += `<g${A('zoom', 120)}><circle cx="${cx}" cy="${cy}" r="76" class="gl" filter="${url('glow')}"/><circle cx="${cx}" cy="${cy}" r="76" class="nd hl"/><circle cx="${cx}" cy="${cy}" r="62" class="ln hl" opacity=".35"/>${core.icon ? icon(core.icon, cx, cy - 32, { hl: true, size: 18 }) : ''}${T(cx, cy - (core.sub ? 8 : 0), core.label, { size: 19, weight: 500, anchor: 'middle', max: 120, lines: 2, lh: 1.2 })}${core.sub ? T(cx, cy + 18, core.sub, { mono: true, size: 9.5, cls: 'ac', anchor: 'middle', max: 120, lines: 1 }) : ''}</g>`;
    return { grid: 'dots', camera: 'tilt', svg: s };
  }, { zh: '轨道生态', en: 'Central Orbit', group: 'editorial', desc: '核心 + 多层同心轨道，适合讲“生态 / 合作伙伴 / 能力圈层”。' }, {
    core: { label: 'Stage OS', sub: 'Platform', icon: 'layers' },
    rings: [
      { label: '核心能力', items: [{ label: '推理', icon: 'brain' }, { label: '记忆', icon: 'db' }, { label: '规划', icon: 'compass', hl: true }] },
      { label: '开发者', items: [{ label: 'SDK', icon: 'code' }, { label: '插件市场', icon: 'plug' }, { label: 'Open API', icon: 'api' }, { label: '模板库', icon: 'layers' }] },
      { label: '合作伙伴', items: ['高校', '出版社', '硬件厂商', '云服务商', '开源社区', '教育机构'] },
    ],
  });

  /* ============================================================= scurve */
  SD.register('scurve', (d) => {
    const X0 = 110, X1 = d.second ? 900 : 1040, YB = 560, YT = 150;
    const sig = u => 1 / (1 + Math.exp(-11 * (u - 0.5)));
    const g = u => (sig(u) - sig(0)) / (sig(1) - sig(0));
    const P1 = u => [X0 + u * (X1 - X0), YB - g(u) * (YB - YT) * (d.second ? 0.82 : 1)];
    const S0 = d.second ? [X0 + 0.5 * (X1 - X0), P1(0.5)[1] + 150] : null;
    const P2 = u => [S0[0] + u * (1130 - S0[0]), S0[1] - g(u) * (S0[1] - 72)];
    const sample = (P, n = 90) => Array.from({ length: n + 1 }, (_, i) => P(i / n));
    const toD = arr => 'M' + arr.map(p => q(p[0]) + ' ' + q(p[1])).join('L');
    const m1 = sample(P1), dm = toD(m1);
    let s = '';
    s += edge(`M${X0} ${YB}H1140`, { soft: true, t: 100 }) + arrow(1140, YB, 0, { t: 500 });
    s += edge(`M${X0} ${YB}V70`, { soft: true, t: 100 }) + arrow(X0, 70, -Math.PI / 2, { t: 500 });
    s += T(1140, YB + 24, d.xLabel || 'TIME', { mono: true, size: 10.5, cls: 'fa', anchor: 'end', a: 'fade', t: 400 });
    s += T(X0 + 14, 74, d.yLabel || 'GROWTH', { mono: true, size: 10.5, cls: 'fa', a: 'fade', t: 400 });
    const star = d.second ? 2 : 1;
    if (star === 1) s += `<path d="${dm}L${X1} ${YB}L${X0} ${YB}Z" fill="${url('fadev')}"${A('fade', 1000)}/>`;
    s += edge(dm, { hl: star === 1, soft: star !== 1, thick: star === 1, t: 300, comet: star === 1, ct: 2400 });
    if (star === 1) s += `<path d="${dm}" class="gl" filter="${url('glow')}"${A('fade', 1300)}/>`;
    let end = m1[m1.length - 1];
    if (d.second) {
      const m2 = sample(P2), d2 = toD(m2);
      s += `<path d="${d2}L1130 ${YB}L${q(S0[0])} ${YB}Z" fill="${url('fadev')}"${A('fade', 1600)}/>`;
      s += `<path d="${d2}" class="gl" filter="${url('glow')}"${A('fade', 1900)}/>`;
      s += edge(d2, { hl: true, thick: true, t: 1100, comet: true, ct: 2800 });
      end = m2[m2.length - 1];
      if (d.secondLabel) s += tag(S0[0] - 62, S0[1] - 2, d.secondLabel, { hl: true, t: 1500 });
      const e1 = m1[m1.length - 1];
      s += edge(`M${q(e1[0])} ${q(e1[1])}C${q(e1[0] + 90)} ${q(e1[1])} ${q(e1[0] + 150)} ${q(e1[1] + 20)} 1130 ${q(e1[1] + 70)}`, { soft: true, dash: true, t: 1000 });
    }
    s += halo(end[0], end[1], 90, 1800) + pulse(end[0], end[1], 6, 2000) + dot(end[0], end[1], { r: 5.5, hl: true, t: 1900 });
    const ph = d.phases || [], n = ph.length;
    ph.forEach((p, i) => {
      const on2 = p.curve === 2 && d.second;
      const u = p.at != null ? p.at : n > 1 ? 0.1 + (i * 0.82) / (n - 1) : 0.5;
      const [px, py] = on2 ? P2(u) : P1(u);
      const t = 900 + i * 260;
      s += edge(line(px, py + 8, px, YB), { faint: true, cls: 'dash', t });
      s += p.icon ? badge(px, py, { r: 16, icon: p.icon, hl: p.hl, t: t + 100 }) : `<g${A('pop', t + 100)}><circle cx="${q(px)}" cy="${q(py)}" r="6.5" class="ring${p.hl ? ' hl' : ''}"/>${p.hl ? '' : `<circle cx="${q(px)}" cy="${q(py)}" r="2.2" class="f-fg"/>`}</g>`;
      s += T(px, YB + 24, String(i + 1).padStart(2, '0'), { mono: true, size: 10.5, cls: p.hl ? 'ac' : 'mu', anchor: 'middle', a: 'fade', t: t + 100 });
      const tw = Math.max(textW(p.label, { size: 16, weight: 500 }), textW(p.desc, { size: 12.5, max: 190 }));
      const leftOK = px - (p.icon ? 30 : 18) - tw > X0 + 12;
      const go = p.icon ? 30 : 18, compact = n >= 4, ax = compact ? px : leftOK ? px - go : px + go, anchor = compact ? 'middle' : leftOK ? 'end' : 'start', ay = compact ? py - 62 : leftOK ? py - 30 : py - 52;
      s += `<g${A('rise', t + 200)}>${T(ax, ay - (p.desc ? 10 : 0), p.label, { size: 16, weight: 500, anchor, cls: 'ko', max: compact ? 170 : undefined, lines: 1 })}${p.desc ? T(ax, ay + 12, p.desc, { size: 12.5, cls: 'mu ko', anchor, max: compact ? 170 : 190, valign: 'top', lines: 2 }) : ''}</g>`;
    });
    return { grid: 'lines', mask: { cx: 0.55, cy: 0.45, r: 0.7 }, svg: s };
  }, { zh: '增长曲线', en: 'S-Curve / Second Curve', group: 'editorial', desc: 'S 型增长或“第二曲线”，适合讲阶段、拐点与新增长引擎。' }, {
    xLabel: '时间', yLabel: '用户规模', second: true, secondLabel: '第二曲线',
    phases: [
      { label: '探索期', desc: '找到 PMF，验证核心场景', at: 0.12, icon: 'compass' },
      { label: '爆发期', desc: '口碑驱动，用户指数级增长', at: 0.48, icon: 'rocket' },
      { label: '成熟期', desc: '增长放缓，进入存量竞争', at: 0.86, icon: 'trophy' },
      { label: 'AI 原生', desc: '新技术开启下一条增长曲线', at: 0.7, curve: 2, hl: true, icon: 'spark' },
    ],
  });

  /* ============================================================== rings */
  SD.register('rings', (d) => {
    const Rg = d.rings || [], n = Math.max(1, Rg.length), cx = 420, base = 630;
    const rOut = 292, rIn = n > 1 ? Math.max(84, rOut - (n - 1) * 74) : rOut;
    const rs = Rg.map((_, i) => (n > 1 ? rOut - (i * (rOut - rIn)) / (n - 1) : rOut));
    let s = '', right = '';
    Rg.forEach((rg, i) => {
      const r = rs[i], cy = base - r, last = i === n - 1, t = 200 + i * 220;
      let ly;
      if (last) {
        s += halo(cx, cy, r * 2, t) + pulse(cx, cy, r, 1800);
        s += `<g${A('zoom', t)}><circle cx="${cx}" cy="${q(cy)}" r="${q(r + 10)}" class="ln hl" opacity=".3"/><circle cx="${cx}" cy="${q(cy)}" r="${q(r)}" class="f-ac"/>${rg.icon ? icon(rg.icon, cx, cy - 24, { size: 20, inv: true }) : ''}${T(cx, cy + (rg.icon ? 6 : -4), rg.label, { size: 18, weight: 600, anchor: 'middle', cls: 'inv', max: r * 1.6, lines: 1 })}${rg.sub ? T(cx, cy + (rg.icon ? 28 : 18), rg.sub, { mono: true, size: 9, cls: 'inv', anchor: 'middle', max: r * 1.6, lines: 1 }) : ''}</g>`;
        ly = cy;
      } else {
        if (i === 0) s += `<circle cx="${cx}" cy="${q(cy)}" r="${q(r)}" fill="${url('dotf')}" opacity=".09"${A('fade', t)}/>`;
        else s += `<circle cx="${cx}" cy="${q(cy)}" r="${q(r)}" class="f-bg"${A('fade', t)}/>`;
        s += `<path d="${circP(cx, cy, r, 90)}" class="ln soft"${A('draw', t)}/>`;
        const top = base - 2 * r;
        if (rg.icon) s += badge(cx, top + 30, { r: 15, icon: rg.icon, t: t + 250 });
        ly = top + (rg.icon ? 66 : 40);
        s += T(cx, ly, rg.label, { size: 17, weight: 600, anchor: 'middle', a: 'rise', t: t + 300, max: 2 * r - 40, lines: 1 });
        if (rg.sub) s += T(cx, ly + 19, rg.sub, { mono: true, size: 9.5, cls: 'mu', anchor: 'middle', a: 'fade', t: t + 350 });
      }
      if (rg.desc) {
        const hw = last ? rs[i] : Math.max(textW(rg.label, { size: 17, weight: 600 }), textW(rg.sub, { mono: true, size: 9.5 })) / 2;
        right += edge(line(cx + hw + 16, ly, 800, ly), { faint: true, cls: 'dash', t: t + 500, glow: false });
        right += T(812, ly - 1, String(i + 1).padStart(2, '0'), { mono: true, size: 10, cls: last ? 'ac' : 'fa', a: 'fade', t: t + 600 });
        right += T(846, ly, rg.desc, { size: 13.5, cls: last ? '' : 'mu', max: 290, lines: 2, a: 'rise', t: t + 600 });
      }
    });
    return { grid: 'none', svg: s + right };
  }, { zh: '同心圈层', en: 'Nested Rings', group: 'editorial', desc: '由外到内逐层聚焦（如 Why/How/What），适合讲价值主张与内核。' },
  {"rings": [{"label": "生态", "icon": "globe", "sub": "Ecosystem", "desc": "开发者、内容方与硬件伙伴共同构建开放平台"}, {"label": "平台", "icon": "layers", "sub": "Platform", "desc": "统一的数据、模型与 Agent 编排底座"}, {"label": "产品", "icon": "cube", "sub": "Product", "desc": "面向学生、教师、学校的三端体验"}, {"label": "核心模型", "icon": "brain", "sub": "Core", "desc": "自研教育大模型：懂知识，更懂怎么教"}]});


  /* =============================================================== stat */
  SD.register('stat', (d) => {
    const cx = 380, cy = 345, R = 232, p = clamp(d.progress != null ? d.progress : 0.75);
    const a0 = (135 * Math.PI) / 180, sweep = (270 * Math.PI) / 180, N = 72;
    let s = halo(cx, cy, 300, 60, 0.8);
    let ticks = '';
    for (let k = 0; k < N; k++) {
      const a = a0 + (k * sweep) / (N - 1), major = k % 6 === 0, on = k / (N - 1) <= p + 1e-6;
      const [x1, y1] = pol(cx, cy, R, a), [x2, y2] = pol(cx, cy, R - (major ? 16 : 9), a);
      ticks += `<path d="${line(x1, y1, x2, y2)}" class="ln ${on ? 'hl' : 'faint'}"${A('fade', 250 + k * 14)}/>`;
    }
    s += ticks;
    const r2 = R - 34;
    const arc = (from, to) => { const [x1, y1] = pol(cx, cy, r2, from), [x2, y2] = pol(cx, cy, r2, to); return `M${q(x1)} ${q(y1)}A${r2} ${r2} 0 ${to - from > Math.PI ? 1 : 0} 1 ${q(x2)} ${q(y2)}`; };
    s += edge(arc(a0, a0 + sweep - 0.0001), { faint: true, t: 200 });
    const ae = a0 + sweep * Math.max(0.002, p);
    s += `<path d="${arc(a0, ae)}" class="gl" filter="${url('glow')}"${A('fade', 1100)}/>`;
    s += edge(arc(a0, ae), { hl: true, thick: true, t: 400 });
    const [ex, ey] = pol(cx, cy, r2, ae);
    s += dot(ex, ey, { r: 5, hl: true, t: 1400 }) + pulse(ex, ey, 5, 1900);
    const val = String(d.value != null ? d.value : '0');
    const num = parseFloat(val.replace(/[^\d.\-]/g, ''));
    const pre = (val.match(/^[^\d\-.]*/) || [''])[0];
    const ew = textW(d.eyebrow, { mono: true, size: 11 });
    if (d.icon) s += `<g${A('fade', 300)}>${icon(d.icon, cx - ew / 2 - 14, cy - 118, { size: 15, hl: true })}</g>`;
    s += T(cx + (d.icon ? 8 : 0), cy - 118, d.eyebrow, { mono: true, size: 11, cls: 'ac', anchor: 'middle', a: 'fade', t: 300 });
    s += `<text x="${cx}" y="${cy - 6}" font-size="128" font-weight="300" letter-spacing="-5" text-anchor="middle" dominant-baseline="central"${A('rise', 300)}>${esc(pre)}<tspan${isFinite(num) ? ` data-count="${esc(String(num))}" data-t="300"` : ''}>${esc(isFinite(num) ? String(num) : val)}</tspan><tspan font-size="46" class="mu" dx="6" letter-spacing="0">${esc(d.unit || '')}</tspan></text>`;
    s += T(cx, cy + 112, d.label, { mono: true, size: 11, cls: 'mu', anchor: 'middle', a: 'fade', t: 600, max: 260, lines: 2 });
    const notes = d.notes || [], nn = notes.length;
    notes.forEach((nt, k) => {
      const y = cy + (k - (nn - 1) / 2) * 132, x = 760, t = 900 + k * 180;
      const nv = String(nt.value), nnum = parseFloat(nv);
      s += `<g${A('rise', t)}>`;
      s += `<text x="${x}" y="${q(y - 18)}" font-size="50" font-weight="300" letter-spacing="-1.5" dominant-baseline="central"><tspan${isFinite(nnum) && /^[\d.]+$/.test(nv) ? ` data-count="${esc(nv)}" data-t="${t}"` : ''}>${esc(nv)}</tspan><tspan font-size="20" class="${nt.hl ? 'ac' : 'mu'}" dx="4" letter-spacing="0">${esc(nt.unit || '')}</tspan></text>`;
      s += T(x, y + 26, nt.label, { size: 13.5, cls: 'mu', max: 330, lines: 1 });
      if (nt.progress != null) { const N = 32, on = Math.round(clamp(nt.progress) * N); for (let k = 0; k < N; k++) s += `<circle cx="${x + 4 + k * 10.5}" cy="${q(y + 48)}" r="${k < on ? 2.6 : 2}" class="${k < on ? (nt.hl ? 'f-ac' : 'f-fg') : 'f-faint'}"/>`; }
      s += `<path d="M${x - 22} ${q(y - 40)}V${q(y - 0)}" class="ln ${nt.hl ? 'hl thick' : 'soft'}"/>`;
      s += `</g>`;
      if (k < nn - 1) s += edge(line(x - 22, y + 66, 1110, y + 66), { faint: true, t: t + 200 });
    });
    return { grid: 'dots', mask: { cx: 0.32, r: 0.55 }, svg: s };
  }, { zh: '数据高光', en: 'Hero Metric', group: 'editorial', desc: '一个大数字 + 仪表环 + 辅助指标，适合发布会的“性能提升/关键数据”页。' }, {
    eyebrow: '推理速度', icon: 'bolt', value: '3.2', unit: '×', label: '对比上一代模型 · 同等算力', progress: 0.78,
    notes: [
      { value: '48', unit: 'ms', label: '首 Token 延迟（P50）', hl: true },
      { value: '99.9', unit: '%', label: '服务可用性 SLA', progress: 0.999 },
      { value: '1.2', unit: 'M', label: '月活开发者' },
    ],
  });

  /* ============================================================= versus */
  SD.register('versus', (d) => {
    const L = d.left || {}, Rr = d.right || {};
    const rows = Math.max((L.items || []).length, (Rr.items || []).length, 1);
    const top = 70, bot = 610, pw = 470;
    const rowTop = 232, rowH = Math.min(64, ((L.metric || Rr.metric ? 470 : 560) - rowTop) / rows);
    let s = '';
    const panel = (x, side, hl, t0) => {
      let g = '';
      if (hl) g += `<rect x="${x}" y="${top}" width="${pw}" height="${bot - top}" rx="18" class="gl" filter="${url('glow')}" opacity=".5"/>`;
      g += `<rect x="${x}" y="${top}" width="${pw}" height="${bot - top}" rx="18" class="nd${hl ? ' hl' : ''}"/>`;
      if (hl) g += `<rect x="${x + 1}" y="${top + 1}" width="${pw - 2}" height="200" rx="17" fill="${url('fadev')}" opacity=".7"/>`;
      s += `<g${A('rise', t0)}>${g}</g>`;
      if (side.icon) s += `<g${A('fade', t0 + 200)}>${icon(side.icon, x + pw - 52, top + 46, { size: 22, hl, mu: !hl })}</g>`;
      s += T(x + 36, top + 46, side.tag, { mono: true, size: 11, cls: hl ? 'ac' : 'mu', a: 'fade', t: t0 + 200 });
      s += T(x + 36, top + 92, side.title, { size: 30, weight: 500, cls: hl ? '' : 'mu', a: 'rise', t: t0 + 250, max: pw - 72, lines: 1, ls: -0.5 });
      s += edge(line(x + 36, top + 134, x + pw - 36, top + 134), { faint: true, t: t0 + 300 });
      (side.items || []).forEach((it, i) => {
        const y = rowTop + i * rowH + rowH / 2 - 8, t = t0 + 450 + i * 110;
        const io = typeof it === 'string' ? { label: it } : it;
        let ic;
        if (io.icon) ic = icon(io.icon, x + 48, y, { size: 17, hl, mu: !hl });
        else if (hl) ic = `<circle cx="${x + 48}" cy="${q(y)}" r="11" class="f-soft"/><path d="M${x + 43} ${q(y)}l3.5 3.5 7-7" class="ln hl"/>`;
        else ic = `<path d="M${x + 44} ${q(y - 4)}l8 8M${x + 52} ${q(y - 4)}l-8 8" class="ln soft"/>`;
        s += T(x + pw - 40, y, String(i + 1).padStart(2, '0'), { mono: true, size: 10, cls: 'fa', anchor: 'end', a: 'fade', t });
        s += `<g${A('rise', t)}>${ic}${T(x + 74, y, io.label, { size: 16, cls: hl ? '' : 'mu', max: pw - 120, lines: 1 })}</g>`;
        if (i < rows - 1) s += edge(line(x + 36, y + rowH / 2, x + pw - 36, y + rowH / 2), { faint: true, a: 'fade', t: t + 50 });
      });
      if (side.metric) {
        const m = side.metric, t = t0 + 700;
        s += `<g${A('rise', t)}><text x="${x + 36}" y="${bot - 74}" font-size="46" font-weight="300" letter-spacing="-1.5" dominant-baseline="central" class="${hl ? '' : 'mu'}">${esc(m.value)}<tspan font-size="18" dx="4" class="${hl ? 'ac' : 'mu'}" letter-spacing="0">${esc(m.unit || '')}</tspan></text>${T(x + 36, bot - 36, m.label, { mono: true, size: 10.5, cls: 'mu', max: pw - 72, lines: 1 })}</g>`;
      }
    };
    panel(80, L, false, 100);
    panel(650, Rr, true, 350);
    s += `<g${A('pop', 900)}><circle cx="615" cy="${(top + bot) / 2}" r="24" class="ring"/><path d="M607 ${(top + bot) / 2}h15m-6-6 6 6-6 6" class="ln hl"/></g>`;
    s += `<path d="M590 ${(top + bot) / 2}H640" class="comet" data-loop="comet" data-seg="16" data-t="2000" data-dur="1800"/>`;
    return { grid: 'none', svg: s };
  }, { zh: '前后对比', en: 'Before / After', group: 'editorial', desc: '传统方式 vs 新方案的并列对照，适合发布会“为什么需要我们”。' }, {
    left: { tag: 'Before', icon: 'clock', title: '传统课堂', items: ['统一进度，一刀切', '作业批改耗时数天', '学情靠经验判断', '优质资源分布不均'], metric: { value: '72', unit: 'h', label: '平均反馈周期' } },
    right: { tag: 'With Stage AI', icon: 'spark', title: 'AI 自适应学习', items: ['千人千面的学习路径', '作业秒级反馈与讲解', '数据驱动的学情洞察', '名师经验无限复制'], metric: { value: '3', unit: 's', label: '平均反馈周期' } },
  });
})();
