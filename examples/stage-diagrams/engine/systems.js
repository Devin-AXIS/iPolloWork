/* Stage Diagrams — process & systems: swimlane, cycle, pipeline, fishbone, architecture, sequence, state */
(() => {
  const SD = window.StageDiagrams;
  const { badge, elbow, pill, icon, chip, disk, slab, circP, q, clamp, esc, A, pol, pts, up, url, measure, T, textW, card, hcurve, vcurve, line, edge, arrow, dot, pulse, halo, tag } = SD.H;

  /* =========================================================== swimlane */
  SD.register('swimlane', (d) => {
    const lanes = (d.lanes || []).map(l => (typeof l === 'string' ? { label: l } : l)), nl = Math.max(1, lanes.length), steps = d.steps || [];
    const top = 52, bot = 628, lh = (bot - top) / nl, lx = 70, cx0 = 250, cx1 = 1130;
    const cols = Math.max(1, ...steps.map((st, i) => (st.col != null ? st.col : i) + 1)), cw = (cx1 - cx0) / cols;
    let s = '', nodes = '';
    lanes.forEach((lab, i) => {
      const y = top + i * lh;
      if (i % 2 === 0) s += `<rect x="${lx - 22}" y="${q(y)}" width="${cx1 - lx + 22}" height="${q(lh)}" rx="14" class="band"${A('fade', 100 + i * 60)}/>`;
      if (lab.icon) s += badge(lx + 16, y + lh / 2, { r: 16, icon: lab.icon, t: 200 + i * 80 });
      const ox = lab.icon ? 44 : 0;
      s += T(lx + ox, y + lh / 2 - (lab.sub ? 8 : 0), lab.label, { size: 15, weight: 600, a: 'rise', t: 200 + i * 80, max: 140 - ox, lines: 2 });
      if (lab.sub) s += T(lx + ox, y + lh / 2 + 13, lab.sub, { mono: true, size: 9.5, cls: 'mu', a: 'fade', t: 250 + i * 80, max: 140, lines: 1 });
    });
    s += edge(line(cx0 - 26, top + 12, cx0 - 26, bot - 12), { faint: true, t: 100 });
    // A step names its lane by position (lane1…lane3), so renaming a lane never detaches its steps; lane names still work.
    const laneIdx = l => { const m = /^lane(\d)$/.exec(String(l)); if (m) return Math.min(nl, +m[1]) - 1; const k = lanes.findIndex(x => (x.id || x.label) === l); return k >= 0 ? k : 0; };
    const byId = {}, R = 24;
    steps.forEach((st, i) => {
      const col = st.col != null ? st.col : i, li = laneIdx(st.lane), x = cx0 + (col + 0.5) * cw, y = top + (li + 0.5) * lh - 10, t = 500 + col * 170;
      nodes += badge(x, y, { r: R, icon: st.icon || 'spark', hl: st.hl, t });
      nodes += T(x, y + R + 18, st.label, { size: 13.5, weight: 600, anchor: 'middle', cls: 'ko', a: 'rise', t: t + 80, max: cw - 20, lines: 1 });
      if (st.sub) nodes += T(x, y + R + 35, st.sub, { mono: true, size: 9, cls: 'mu ko', anchor: 'middle', a: 'fade', t: t + 120, max: cw - 20, lines: 1 });
      byId[st.id != null ? st.id : i] = { x, y, col, li, hl: st.hl };
    });
    let raw = d.links;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
    // Links as objects {from, to, label?} or older [from, to, label] tuples; without links, steps chain in order.
    const links = (Array.isArray(raw) ? raw : steps.slice(1).map((st, i) => [steps[i].id != null ? steps[i].id : i, st.id != null ? st.id : i + 1]))
      .map(lk => (Array.isArray(lk) ? lk : [lk.from, lk.to, lk.label]));
    links.forEach((lk, k) => {
      const a = byId[lk[0]], b = byId[lk[1]];
      if (!a || !b) return;
      const hl = a.hl && b.hl, t = 650 + Math.max(a.col, b.col) * 170;
      let p, ex, ey, ang, mx, my;
      if (a.li === b.li) { p = line(a.x + R + 6, a.y, b.x - R - 8, b.y); ex = b.x - R - 8; ey = b.y; ang = 0; mx = (a.x + b.x) / 2; my = a.y; }
      else if (Math.abs(a.x - b.x) < 2) { const dn = b.y > a.y; p = line(a.x, a.y + (dn ? R + 44 : -R - 6), b.x, b.y + (dn ? -R - 8 : R + 46)); ex = b.x; ey = b.y + (dn ? -R - 8 : R + 46); ang = dn ? Math.PI / 2 : -Math.PI / 2; mx = a.x; my = (a.y + b.y) / 2; }
      else { const xt = (a.x + b.x) / 2; p = elbow(a.x + R + 6, a.y, xt, b.y, b.x - R - 8, 16); ex = b.x - R - 8; ey = b.y; ang = 0; mx = xt; my = (a.y + b.y) / 2; }
      s += edge(p, { hl, soft: !hl, t, comet: hl, ct: 2000 + k * 250, glow: false }) + arrow(ex, ey, ang, { hl, t: t + 350 });
      if (lk[2]) s += pill(mx, my, lk[2], { anchor: 'middle', size: 11.5, hl, t: t + 200 });
    });
    return { grid: 'none', svg: s + nodes };
  }, { zh: '泳道协作', en: 'Swimlanes', group: 'process', desc: '多个角色/系统之间的流程与交接，适合讲“人机协作如何发生”。' },
  {"lanes": [{"label": "学生", "sub": "Student", "icon": "user"}, {"label": "AI 助教", "sub": "Agent", "icon": "agent"}, {"label": "教师", "sub": "Teacher", "icon": "cap"}], "steps": [{"id": "a", "lane": "lane1", "col": 0, "label": "拍照上传作业", "icon": "image"}, {"id": "b", "lane": "lane2", "col": 1, "label": "识别 + 逐题批改", "icon": "eye", "hl": true}, {"id": "c", "lane": "lane2", "col": 2, "label": "生成错因分析", "icon": "brain", "hl": true}, {"id": "d", "lane": "lane3", "col": 2, "label": "抽查与点评", "icon": "check"}, {"id": "e", "lane": "lane1", "col": 3, "label": "收到个性化讲解", "icon": "chat", "hl": true}, {"id": "f", "lane": "lane3", "col": 3, "label": "调整下节课重点", "icon": "target"}], "links": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}, {"from": "c", "to": "d", "label": "低置信"}, {"from": "c", "to": "e"}, {"from": "d", "to": "f"}]});


  /* ============================================================== cycle */
  SD.register('cycle', (d) => {
    const st = d.stages || [], n = Math.max(1, st.length), cx = 600, cy = 345, R = 196;
    let s = halo(cx, cy, 200, 50, 0.8);
    s += `<path d="${circP(cx, cy, R, -90)}" class="ln faint"${A('draw', 100)}/>`;
    const step = (2 * Math.PI) / n, gapA = 34 / R;
    st.forEach((g, i) => {
      const a1 = -Math.PI / 2 + i * step + gapA, a2 = -Math.PI / 2 + (i + 1) * step - gapA;
      const p1 = pol(cx, cy, R, a1), p2 = pol(cx, cy, R, a2), t = 300 + i * 220;
      const hl = !!(g.hl || (st[(i + 1) % n] || {}).hl && g.hl);
      s += edge(`M${q(p1[0])} ${q(p1[1])}A${R} ${R} 0 ${a2 - a1 > Math.PI ? 1 : 0} 1 ${q(p2[0])} ${q(p2[1])}`, { soft: true, t, thick: false });
      s += arrow(p2[0], p2[1], a2 + Math.PI / 2, { t: t + 450 });
    });
    // orbiting light
    const o1 = pol(cx, cy, R, -Math.PI / 2), o2 = pol(cx, cy, R, -Math.PI / 2 + 0.9);
    s += `<g class="live-only" data-loop="spin" data-ox="${cx}" data-oy="${cy}" data-dur="${d.period || 9000}" data-t="1600"><path d="M${q(o1[0])} ${q(o1[1])}A${R} ${R} 0 0 1 ${q(o2[0])} ${q(o2[1])}" class="ln hl thick" opacity=".7"/><circle cx="${q(o2[0])}" cy="${q(o2[1])}" r="8" class="glf" filter="${url('glow')}"/><circle cx="${q(o2[0])}" cy="${q(o2[1])}" r="3.4" class="f-hi"/></g>`;
    st.forEach((g, i) => {
      const a = -Math.PI / 2 + i * step, [x, y] = pol(cx, cy, R, a), t = 250 + i * 220, hl = !!g.hl;
      s += badge(x, y, { r: 30, icon: g.icon, text: g.icon ? null : String(i + 1).padStart(2, '0'), hl, t });
      if (hl) s += pulse(x, y, 24, 2000 + i * 200);
      const c = Math.cos(a), sn = Math.sin(a);
      const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
      const [lx, ly0] = pol(cx, cy, R + 54, a);
      const lh = 16 * 1.35 + (g.desc ? 40 : 0);
      const ly = anchor === 'middle' ? (sn < 0 ? ly0 - lh / 2 : ly0 + lh / 2 - 6) : ly0;
      s += `<g${A('rise', t + 200)}>${T(lx, ly - (g.desc ? 12 : 0), g.label, { size: 17, weight: 500, anchor })}${g.desc ? T(lx, ly + 12, g.desc, { size: 12.5, cls: 'mu', anchor, max: 210, lines: 2, valign: 'top' }) : ''}</g>`;
    });
    s += `<g${A('zoom', 500)}><circle cx="${cx}" cy="${cy}" r="104" class="ln hl" opacity=".25"/><circle cx="${cx}" cy="${cy}" r="92" class="f-ac"/></g>`;
    if (d.icon) s += `<g${A('fade', 650)}>${icon(d.icon, cx, cy - 40, { size: 22, inv: true })}</g>`;
    s += `<g${A('zoom', 600)}>${T(cx, cy + (d.icon ? 2 : -8), d.center, { size: 19, weight: 600, anchor: 'middle', cls: 'inv', max: 150, lines: 2, lh: 1.2 })}${T(cx, cy + (d.icon ? 34 : 22), d.sub, { mono: true, size: 9, cls: 'inv', anchor: 'middle', max: 150, lines: 1 })}</g>`;
    return { grid: 'dots', svg: s };
  }, { zh: '循环飞轮', en: 'Cycle / Flywheel', group: 'process', desc: '首尾相接的循环阶段（飞轮、学习闭环、迭代循环）。' }, {
    center: '自适应学习闭环', sub: 'Learning Loop', icon: 'flow',
    stages: [
      { label: '诊断', desc: '5 分钟定位知识薄弱点', icon: 'search' },
      { label: '学习', desc: '按掌握度推送内容', hl: true, icon: 'book' },
      { label: '练习', desc: '难度实时自适应', icon: 'pen' },
      { label: '反馈', desc: '逐步讲解，而非只给答案', icon: 'chat' },
      { label: '复盘', desc: '更新能力画像', icon: 'chart' },
    ],
  });

  /* =========================================================== pipeline */
  SD.register('pipeline', (d) => {
    const N = d.nodes || [], L = (d.links || N.slice(1).map((x, i) => [N[i].id, x.id])).map(l => Array.isArray(l) ? l : [l.from, l.to, l.label]);
    const byId = {};
    N.forEach((nd, i) => { byId[nd.id != null ? nd.id : i] = Object.assign({ _in: [], _out: [] }, nd); });
    L.forEach(([a, b]) => { if (byId[a] && byId[b]) { byId[a]._out.push(b); byId[b]._in.push(a); } });
    const rank = {};
    const rk = id => { if (rank[id] != null) return rank[id]; rank[id] = 0; const v = byId[id]._in.length ? 1 + Math.max(...byId[id]._in.map(rk)) : 0; return (rank[id] = v); };
    Object.keys(byId).forEach(rk);
    const Rn = Math.max(0, ...Object.values(rank)) + 1;
    const cols = Array.from({ length: Rn }, () => []);
    Object.keys(byId).forEach(id => cols[rank[id]].push(id));
    const pos = {}, R = 28, colX = r => (Rn === 1 ? 600 : 120 + (r * 960) / (Rn - 1)), cw = Rn > 1 ? 960 / (Rn - 1) : 400;
    let nodes = '', ed = '', stages = '';
    cols.forEach((ids, r) => {
      const avg = arr => (arr.length ? arr.reduce((s, x) => s + (pos[x] ? pos[x].y : 330), 0) / arr.length : 330);
      if (r) ids.sort((a, b) => avg(byId[a]._in) - avg(byId[b]._in));
      const m = ids.length, gap = m > 1 ? Math.min(160, 440 / (m - 1)) : 0;
      stages += T(colX(r), 70, String(r + 1).padStart(2, '0'), { mono: true, size: 10, cls: 'fa', anchor: 'middle', a: 'fade', t: 100 + r * 80 });
      ids.forEach((id, k) => {
        const nd = byId[id], x = colX(r), y = 330 + (k - (m - 1) / 2) * gap, t = 200 + r * 260;
        pos[id] = { x, y };
        nodes += badge(x, y, { r: R, icon: nd.icon || 'spark', hl: nd.hl, t });
        nodes += T(x, y + R + 20, nd.label, { size: 14, weight: 600, anchor: 'middle', cls: 'ko', a: 'rise', t: t + 80, max: cw - 16, lines: 1 });
        if (nd.sub) nodes += T(x, y + R + 38, nd.sub, { mono: true, size: 9, cls: (nd.hl ? 'ac' : 'mu') + ' ko', anchor: 'middle', a: 'fade', t: t + 120, max: cw - 16, lines: 1 });
      });
    });
    stages += edge(line(80, 92, 1120, 92), { faint: true, t: 100 });
    L.forEach(([a, b, lab], k) => {
      const A_ = pos[a], B_ = pos[b];
      if (!A_ || !B_) return;
      const hl = byId[a].hl && byId[b].hl, t = 350 + rank[a] * 260;
      ed += edge(hcurve(A_.x + R + 6, A_.y, B_.x - R - 8, B_.y), { hl, soft: !hl, t, comet: hl, ct: 1900 + rank[a] * 450, glow: false });
      ed += arrow(B_.x - R - 8, B_.y, 0, { hl, t: t + 450 });
      if (lab) ed += pill((A_.x + B_.x) / 2, (A_.y + B_.y) / 2, lab, { anchor: 'middle', size: 11, hl, t: t + 300 });
    });
    return { grid: 'dots', svg: stages + ed + nodes };
  }, { zh: '流水线 / 依赖', en: 'Pipeline / DAG', group: 'process', desc: '自左向右的处理流程或依赖关系（自动分层），适合讲数据/模型 pipeline。' },
  {"headline": "从数据到上线，全自动", "lede": "七个阶段，一条流水线，每次迭代自动评测后灰度发布。", "points": [{"label": "Ingest → Embed", "desc": "多源数据实时入库"}, {"label": "Eval Gate", "desc": "自动评测不过线不上线", "hl": true}, {"label": "Ship", "desc": "灰度 1% → 100%"}], "nodes": [{"id": "src", "label": "多源数据", "sub": "Ingest", "icon": "db"}, {"id": "clean", "label": "清洗与标注", "sub": "Clean", "icon": "gear"}, {"id": "emb", "label": "向量化", "sub": "Embed", "icon": "grid", "hl": true}, {"id": "ft", "label": "领域微调", "sub": "Fine-tune", "icon": "cpu"}, {"id": "rag", "label": "检索增强", "sub": "RAG", "icon": "search", "hl": true}, {"id": "eval", "label": "自动评测", "sub": "Eval", "icon": "check", "hl": true}, {"id": "ship", "label": "灰度上线", "sub": "Deploy", "icon": "rocket", "hl": true}], "links": [["src", "clean"], ["clean", "emb"], ["clean", "ft"], ["emb", "rag"], ["ft", "eval"], ["rag", "eval"], ["eval", "ship"]]});


  /* =========================================================== fishbone */
  SD.register('fishbone', (d) => {
    const C = d.categories || [], n = C.length, sy = 340, hx = 1050, hr = 60;
    let s = '';
    let ruler = '';
    for (let x = 80; x < hx - hr - 20; x += 14) ruler += `M${x} ${sy + 10}V${sy + ((x - 80) % 70 === 0 ? 20 : 14)}`;
    s += `<path d="${ruler}" class="ln faint"${A('fade', 200)}/>`;
    s += edge(line(70, sy, hx - hr - 12, sy), { soft: true, thick: true, t: 100, comet: true, ct: 2000, dur: 3600 }) + arrow(hx - hr - 12, sy, 0, { s: 9, t: 900 });
    const per = Math.ceil(n / 2), x0 = 300, x1 = 860;
    C.forEach((c, i) => {
      const upSide = i % 2 === 0, j = Math.floor(i / 2), x = per > 1 ? x0 + (j * (x1 - x0)) / (per - 1) : (x0 + x1) / 2;
      const ex = x - 140, ey = upSide ? sy - 205 : sy + 205, t = 350 + i * 140, hl = !!c.hl;
      s += edge(line(x, sy, ex, ey + (upSide ? 30 : -30)), { hl, soft: !hl, t });
      s += dot(x, sy, { r: 4, hl, t: t + 50 });
      s += badge(ex, ey, { r: 27, icon: c.icon || 'target', hl, t: t + 250 });
      const ly = upSide ? ey - 50 : ey + 50;
      s += T(ex + 40, ey - (c.sub ? 8 : 0), c.label, { size: 17, weight: 600, a: 'rise', t: t + 300, max: 120, lines: 1 });
      if (c.sub) s += T(ex + 40, ey + 13, c.sub, { mono: true, size: 9.5, cls: hl ? 'ac' : 'mu', a: 'fade', t: t + 320, max: 120, lines: 1 });
      const its = c.items || [];
      its.forEach((it, k) => {
        const f = its.length > 1 ? 0.3 + (k * 0.38) / (its.length - 1) : 0.5, px = x + (ex - x) * f, py = sy + (ey - sy) * f;
        s += edge(line(px, py, px - 14, py), { soft: true, t: t + 400 + k * 80, glow: false });
        s += pill(px - 14, py, it, { anchor: 'end', size: 12, t: t + 450 + k * 80, hl: hl && k === 0 });
      });
      void ly;
    });
    // problem head
    s += halo(hx, sy, 190, 1200) + pulse(hx, sy, hr, 1800);
    s += `<g${A('zoom', 1200)}><circle cx="${hx}" cy="${sy}" r="${hr + 16}" class="ln hl" opacity=".25"/><circle cx="${hx}" cy="${sy}" r="${hr}" class="f-ac"/>${icon(d.problemIcon || 'target', hx, sy, { size: 40, inv: true })}</g>`;
    s += T(hx, sy + hr + 34, d.problem, { size: 18, weight: 600, anchor: 'middle', a: 'rise', t: 1400, max: 200, lines: 2 });
    if (d.problemSub) s += T(hx, sy + hr + 58, d.problemSub, { mono: true, size: 10, cls: 'ac', anchor: 'middle', a: 'fade', t: 1450 });
    return { grid: 'dots', svg: s };
  }, { zh: '鱼骨归因', en: 'Fishbone', group: 'process', desc: '把一个问题拆成多类原因，适合教学中讲“问题分析方法”。' }, {
    problem: '课程完成率低', problemSub: 'Problem', problemIcon: 'target',
    categories: [
      { label: '内容', icon: 'doc', sub: 'Content', items: ['视频过长', '难度跳跃'] },
      { label: '交互', icon: 'chat', sub: 'Interaction', items: ['缺少即时反馈', '无法提问'], hl: true },
      { label: '激励', icon: 'trophy', sub: 'Motivation', items: ['目标感弱', '缺少同伴'] },
      { label: '技术', icon: 'cpu', sub: 'Tech', items: ['加载慢', '多端不同步'] },
      { label: '时间', icon: 'clock', sub: 'Time', items: ['碎片化', '与作业冲突'] },
      { label: '评价', icon: 'check', sub: 'Assessment', items: ['只看分数', '反馈滞后'] },
    ],
  });

  /* ======================================================= architecture */
  SD.register('architecture', (d) => {
    const L = d.layers || [], nl = Math.max(1, L.length), top = 46, bot = 630, gap = 20;
    const bh = (bot - top - (nl - 1) * gap) / nl, x0 = 250, x1 = 1130;
    let s = '', nodes = '';
    const pos = {};
    L.forEach((ly, i) => {
      const y = top + i * (bh + gap), t = 100 + i * 200;
      s += `<rect x="${x0 - 14}" y="${q(y)}" width="${x1 - x0 + 28}" height="${q(bh)}" rx="14" class="band${ly.hl ? ' hl' : ''}"${A('fade', t)}/>`;
      if (ly.icon) s += `<g${A('rise', t + 100)}><rect x="70" y="${q(y + bh / 2 - 44)}" width="26" height="26" rx="8" class="nd${ly.hl ? ' hl' : ''}" style="fill:${ly.hl ? url('af') : url('nf')}"/>${icon(ly.icon, 83, y + bh / 2 - 31, { size: 14, hl: ly.hl })}</g>`;
      s += T(ly.icon ? 104 : 70, y + bh / 2 - (ly.icon ? 31 : 10), 'L' + (i + 1), { mono: true, size: 10.5, cls: ly.hl ? 'ac' : 'fa', a: 'fade', t: t + 100 });
      s += T(70, y + bh / 2 + 12, ly.label, { size: 15, weight: 500, a: 'rise', t: t + 100, max: 150, lines: 2 });
      const ns = ly.nodes || [], k = Math.max(1, ns.length), nw = Math.min(210, (x1 - x0 - (k - 1) * 16) / k);
      ns.forEach((nd, j) => {
        const o = typeof nd === 'string' ? { label: nd } : nd;
        const span = k * nw + (k - 1) * 16, cx = (x0 + x1) / 2 - span / 2 + nw / 2 + j * (nw + 16);
        const c = card(cx, y + bh / 2, { label: o.label, sub: o.sub, icon: nw > 150 ? o.icon : null, hl: o.hl, w: nw, h: Math.min(bh - 26, 64), size: 14, padX: 14, t: t + 250 + j * 60 });
        pos[o.id || o.label] = c;
        c.hl = o.hl;
        nodes += c.svg;
      });
    });
    let ed = '';
    (d.links || []).forEach((link, k) => {
      const [a, b, label] = Array.isArray(link) ? link : [link.from, link.to, link.label];
      const A_ = pos[a], B_ = pos[b];
      if (!A_ || !B_) return;
      const hl = A_.hl && B_.hl, dn = B_.cy > A_.cy, t = 900 + k * 60;
      const same = Math.abs(B_.cy - A_.cy) < 1, dir = B_.cx > A_.cx ? 1 : -1;
      const y1 = same ? A_.cy : dn ? A_.b : A_.t, y2 = same ? B_.cy : dn ? B_.t - 3 : B_.b + 3;
      const x1 = same ? (dir > 0 ? A_.r : A_.l) : A_.cx, x2 = same ? (dir > 0 ? B_.l : B_.r) : B_.cx;
      ed += edge(same ? hcurve(x1, y1, x2, y2) : vcurve(x1, y1, x2, y2), { hl, soft: !hl, t, comet: hl, ct: 2000 + k * 300 }) + arrow(x2, y2, same ? (dir > 0 ? 0 : Math.PI) : dn ? Math.PI / 2 : -Math.PI / 2, { hl, s: 6, t: t + 400 });
      if (label) ed += pill((x1 + x2) / 2, (y1 + y2) / 2, label, { anchor: 'middle', size: 10, hl, t: t + 200 });
    });
    return { grid: 'none', camera: 'iso', svg: s + ed + nodes };
  }, { zh: '系统架构', en: 'System Architecture', group: 'systems', desc: '分层系统架构（接入/服务/模型/数据），可连接跨层调用。' }, {
    headline: '一个底座，承载所有智能', lede: '四层解耦架构：任何终端接入，Agent 统一编排，模型与数据可替换。', points: [{ label: 'Any Device', desc: 'Web · App · 硬件 · API' }, { label: 'Any Model', desc: '自研与第三方模型热切换', hl: true }, { label: 'Any Data', desc: '向量、题库与学情统一治理' }],
    layers: [
      { label: '接入层', icon: 'globe', nodes: [{ label: 'Web', icon: 'globe' }, { label: 'iOS / Android', icon: 'phone' }, { label: '智能硬件', icon: 'mic' }, { label: 'Open API', icon: 'api' }] },
      { label: '服务层', icon: 'server', nodes: [{ label: 'API 网关', icon: 'shield' }, { label: 'Agent 编排', icon: 'agent', hl: true }, { label: '会话与记忆', icon: 'chat' }] },
      { label: '模型层', icon: 'brain', hl: true, nodes: [{ label: '教育大模型', icon: 'spark', hl: true }, { label: '语音 ASR/TTS', icon: 'sound' }, { label: 'Embedding', icon: 'grid' }] },
      { label: '数据层', icon: 'db', nodes: [{ label: '向量库', icon: 'db', hl: true }, { label: '题库与课程', icon: 'book' }, { label: '学情数仓', icon: 'chart' }] },
    ],
    links: [['Open API', 'API 网关'], ['Web', 'API 网关'], ['API 网关', 'Agent 编排'], ['Agent 编排', '教育大模型'], ['会话与记忆', 'Embedding'], ['教育大模型', '向量库'], ['Embedding', '向量库']],
  });

  /* =========================================================== sequence */
  SD.register('sequence', (d) => {
    const ac = (d.actors || []).map(a => (typeof a === 'string' ? { label: a } : a)), n = Math.max(1, ac.length), M = d.messages || [];
    const xs = ac.map((_, i) => (n > 1 ? 170 + (i * 900) / (n - 1) : 600));
    // Messages name participants by position (actor1…actor5), so renaming a participant keeps its messages; names still work.
    const idx = v => { const m = /^actor(\d)$/.exec(String(v)); if (m) return Math.min(n, +m[1]) - 1; const k = ac.findIndex(a => a.label === v || a.id === v); return k >= 0 ? k : +v || 0; };
    const y0 = 182, step = Math.min(56, 440 / Math.max(1, M.length)), yEnd = y0 + M.length * step + 6;
    let s = '', lanes = '';
    ac.forEach((a, i) => {
      lanes += `<path d="M${q(xs[i])} 128V${q(yEnd)}" class="ln soft dash"${A('fade', 300 + i * 80)}/>`;
      const touches = M.map((m, k) => ((idx(m.from) === i || idx(m.to) === i) ? k : -1)).filter(k => k >= 0);
      if (touches.length) {
        const a0 = y0 + touches[0] * step + step / 2 - 10, a1 = y0 + touches[touches.length - 1] * step + step / 2 + 10;
        lanes += `<rect x="${q(xs[i] - 3)}" y="${q(a0)}" width="6" height="${q(a1 - a0)}" rx="3" class="${a.hl ? 'f-soft' : 'f-faint'}" style="${a.hl ? 'stroke:var(--sd-accent);stroke-width:.8' : ''}"${A('growy', 600 + i * 80)}/>`;
      }
      s += badge(xs[i], 70, { r: 24, icon: a.icon || 'user', hl: a.hl, t: 100 + i * 90 });
      s += T(xs[i], 112, a.label, { size: 14, weight: 600, anchor: 'middle', a: 'rise', t: 150 + i * 90, max: 160, lines: 1 });
    });
    s = lanes + s;
    M.forEach((m, k) => {
      const fi = idx(m.from), ti = idx(m.to), y = y0 + k * step + step / 2, t = 800 + k * 190, hl = !!m.hl;
      s += badge(70, y, { r: 11, text: String(k + 1).padStart(2, '0'), textSize: 8.5, hl, t });
      if (fi === ti) {
        const x = xs[fi], p = `M${x + 3} ${q(y - 10)}H${x + 44}V${q(y + 10)}H${x + 6}`;
        s += edge(p, { hl, soft: !hl, t, glow: false }) + arrow(x + 6, y + 10, Math.PI, { hl, t: t + 300, s: 6 });
        s += pill(x + 54, y, m.label, { size: 11.5, hl, t: t + 200 });
      } else {
        const x1 = xs[fi], x2 = xs[ti], dir = x2 > x1 ? 1 : -1, e = x2 - dir * 6;
        s += edge(line(x1 + dir * 3, y, e, y), { hl, soft: !hl && !m.reply, faint: m.reply && !hl, dash: m.reply, t, comet: hl, ct: 2200 + k * 300 });
        s += arrow(e, y, dir > 0 ? 0 : Math.PI, { hl, t: t + 350, s: 6 });
        s += pill((x1 + x2) / 2, y, m.label, { anchor: 'middle', size: 11.5, hl, t: t + 200 });
      }
    });
    return { grid: 'dots', svg: s };
  }, { zh: '时序交互', en: 'Sequence', group: 'systems', desc: '参与者之间按时间顺序的消息往来，适合讲一次请求的完整链路。' },
  {"actors": [{"label": "学生", "icon": "user"}, {"label": "学习 App", "icon": "phone"}, {"label": "Agent", "icon": "agent", "hl": true}, {"label": "知识库", "icon": "db"}, {"label": "大模型", "icon": "spark"}], "messages": [{"from": "actor1", "to": "actor2", "label": "拍一道几何题"}, {"from": "actor2", "to": "actor3", "label": "图像 + 上下文", "hl": true}, {"from": "actor3", "to": "actor4", "label": "检索相似题与考点"}, {"from": "actor4", "to": "actor3", "label": "3 个相关知识点", "reply": true}, {"from": "actor3", "to": "actor5", "label": "生成分步引导", "hl": true}, {"from": "actor5", "to": "actor3", "label": "讲解草稿", "reply": true}, {"from": "actor3", "to": "actor3", "label": "安全与正确性校验"}, {"from": "actor3", "to": "actor1", "label": "先给提示，不直接给答案", "hl": true}]});

  /* ============================================================== state */
  SD.register('state', (d) => {
    const St = d.states || [], n = Math.max(1, St.length), y = 320, R = 32;
    const xs = St.map((_, i) => (n > 1 ? 210 + (i * 820) / (n - 1) : 600));
    const idx = id => St.findIndex(x => (x.id || x.label) === id);
    let s = '', nodes = '';
    St.forEach((st, i) => {
      const t = 200 + i * 150;
      if (st.final) nodes += `<circle cx="${q(xs[i])}" cy="${y}" r="${R + 8}" class="ln soft"${A('fade', t + 200)}/>`;
      nodes += badge(xs[i], y, { r: R, icon: st.icon || 'spark', hl: st.hl, t });
      nodes += T(xs[i], y + R + 26, st.label, { size: 15, weight: 600, anchor: 'middle', a: 'rise', t: t + 100, max: 150, lines: 1 });
      if (st.sub || st.final) nodes += T(xs[i], y + R + 46, st.sub || 'Final', { mono: true, size: 9.5, cls: 'mu', anchor: 'middle', a: 'fade', t: t + 150 });
    });
    const ini = idx(d.initial != null ? d.initial : (St[0] || {}).id || (St[0] || {}).label);
    if (ini >= 0) s += dot(xs[ini] - 100, y, { r: 6, hl: true, t: 100 }) + edge(line(xs[ini] - 94, y, xs[ini] - R - 8, y), { soft: true, t: 200 }) + arrow(xs[ini] - R - 8, y, 0, { t: 450 });
    // Transitions as objects {from, to, label?, highlighted?} or the older [from, to, label, highlighted] tuples.
    let raw = d.transitions || [];
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
    const E = (Array.isArray(raw) ? raw : []).map((t, k) => (Array.isArray(t) ? { a: t[0], b: t[1], lab: t[2], hl: t[3], k } : { a: t.from, b: t.to, lab: t.label, hl: t.highlighted, k }))
      .map(e => ({ ...e, i: idx(e.a), j: idx(e.b) })).filter(e => e.i >= 0 && e.j >= 0);
    // Routing: the next state on the line is a straight segment; a self-transition loops above its state; other
    // forward transitions arc above, backward ones below. Arcs on a side are stacked in tiers so arcs whose spans
    // overlap never share a height, and every state spreads its arc ends across its rim so arrows never meet.
    const straight = new Set(), above = [], below = [], loops = [];
    E.forEach(e => {
      if (e.i === e.j) loops.push(e);
      else if (e.j === e.i + 1 && !straight.has(e.i)) { straight.add(e.i); e.kind = 'line'; }
      else (e.j > e.i ? above : below).push(e);
    });
    // taken: intervals already holding the lowest tier (self-loops sit just above their state).
    const tiers = (list, taken = []) => {
      const rows = taken.length ? [taken] : [];
      list.sort((p, r) => Math.abs(p.j - p.i) - Math.abs(r.j - r.i) || Math.min(p.i, p.j) - Math.min(r.i, r.j)).forEach(e => {
        const lo = Math.min(e.i, e.j), hi = Math.max(e.i, e.j);
        let t = 0;
        while ((rows[t] || []).some(o => lo < o.hi && o.lo < hi)) t++;
        (rows[t] = rows[t] || []).push({ lo, hi }); e.tier = t;
      });
    };
    tiers(above, loops.map(l => ({ lo: l.i - .45, hi: l.i + .45 })));
    tiers(below);
    // Rim ports: arc ends at a state, ordered by where the arc goes so neighbours never cross.
    const ports = {};
    const claim = (side, n, e, other) => (ports[side + n] = ports[side + n] || []).push({ e, other });
    above.forEach(e => { claim('u', e.i, e, e.j); claim('u', e.j, e, e.i); });
    below.forEach(e => { claim('d', e.i, e, e.j); claim('d', e.j, e, e.i); });
    // A lone arc leaves a state on the side it travels toward; several share the rim from -20 to +20 px.
    const offset = (side, n, e, end) => {
      const list = (ports[side + n] || []).slice().sort((p, r) => p.other - r.other || (p.e.tier ?? 0) - (r.e.tier ?? 0));
      const m = list.length, k = list.findIndex(x => x.e === e);
      return m < 2 ? (end === (side === 'u') ? -12 : 12) : -20 + (40 * k) / (m - 1);
    };
    const draw = (e, p, ex, ey, ang, lx, ly) => {
      const hl = !!e.hl || (St[e.i].hl && St[e.j].hl), t = 700 + e.k * 130;
      s += edge(p, { hl, soft: !hl, t, comet: hl, ct: 2000 + e.k * 300, glow: false }) + arrow(ex, ey, ang, { hl, t: t + 400, s: 6 });
      if (e.lab) s += pill(lx, ly, e.lab, { anchor: 'middle', size: 11.5, hl, t: t + 250 });
    };
    E.filter(e => e.kind === 'line').forEach(e => draw(e, line(xs[e.i] + R + 6, y, xs[e.j] - R - 8, y), xs[e.j] - R - 8, y, 0, (xs[e.i] + xs[e.j]) / 2, y));
    loops.forEach(e => {
      const x = xs[e.i];
      draw(e, `M${q(x - 14)} ${q(y - R - 2)}C${q(x - 40)} ${q(y - R - 54)} ${q(x + 40)} ${q(y - R - 54)} ${q(x + 14)} ${q(y - R - 4)}`, x + 14, y - R - 4, Math.atan2(50, -26), x, y - R - 46);
    });
    [[above, 'u', -1], [below, 'd', 1]].forEach(([list, side, sg]) => list.forEach(e => {
      const ox1 = offset(side, e.i, e, false), ox2 = offset(side, e.j, e, true);
      const x1 = xs[e.i] + ox1, x2 = xs[e.j] + ox2;
      const rim = ox => Math.sqrt(Math.max(0, (R + 4) ** 2 - ox * ox));
      // Arcs above leave from the rim; arcs below start under the state's name so they never cross it.
      const under = n => y + R + (St[n].sub || St[n].final ? 62 : 44);
      const maxTier = Math.max(1, ...list.map(x => x.tier));
      const b1 = side === 'u' ? y - rim(ox1) : under(e.i), b2 = side === 'u' ? y - rim(ox2) - 4 : under(e.j) + 4;
      // Keep the densest allowed routing inside the diagram, including the label pills.
      const available = side === 'u' ? (Math.min(b1, b2) - 92) / .75 : (604 - Math.max(b1, b2)) / .75;
      const spacing = Math.min(side === 'u' ? 50 : 38, Math.max(22, (available - 56) / maxTier));
      const hgt = 56 + spacing * e.tier;
      const p = `M${q(x1)} ${q(b1)}C${q(x1)} ${q(b1 + sg * hgt)} ${q(x2)} ${q(b2 + sg * hgt)} ${q(x2)} ${q(b2)}`;
      draw(e, p, x2, b2, side === 'u' ? Math.PI / 2 : -Math.PI / 2, (x1 + x2) / 2, (b1 + b2) / 2 + sg * hgt * .75);
    }));
    return { grid: 'dots', svg: s + nodes };
  }, { zh: '状态流转', en: 'State Machine', group: 'systems', desc: '对象在不同状态之间的转换及触发条件。' },
  {"states": [{"label": "草稿", "id": "draft", "icon": "pen"}, {"label": "AI 审校", "id": "review", "icon": "spark", "hl": true}, {"label": "教师确认", "id": "confirm", "icon": "user", "hl": true}, {"label": "已发布", "id": "pub", "icon": "rocket", "hl": true}, {"label": "已归档", "id": "arch", "icon": "db", "final": true}], "initial": "draft", "transitions": [["draft", "review", "提交"], ["review", "confirm", "通过"], ["confirm", "pub", "发布"], ["pub", "arch", "学期结束"], ["review", "draft", "需修改"], ["confirm", "draft", "驳回"], ["review", "review", "自动重试"]]});

})();
