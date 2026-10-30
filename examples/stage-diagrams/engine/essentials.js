/* Stage Diagrams — essentials: decision, mindmap, timeline, venn, journey, roadmap, quadrant, matrix, tree */
(() => {
  const SD = window.StageDiagrams;
  const { unit, badge, elbow, pill, chip, disk, slab, circP, q, clamp, esc, A, pol, pts, up, url, measure, T, textW, textH, lines, icon, card, hcurve, vcurve, line, smooth, edge, arrow, dot, pulse, halo, tag } = SD.H;

  /* =========================================================== decision */
  SD.register('decision', (d) => {
    const br = d.branches || [], n = Math.max(1, br.length), cy = 372;
    const cols = d.columns || ['Input', 'Decide', 'Act', 'Outcome'];
    const HX = [150, 420, 790, 1045];
    let s = '';
    cols.slice(0, 4).forEach((c, i) => {
      s += T(HX[i], 66, String(i + 1).padStart(2, '0'), { mono: true, size: 10, cls: 'fa', anchor: 'middle', a: 'fade', t: 80 + i * 70 });
      s += T(HX[i], 94, c, { size: 22, weight: 600, anchor: 'middle', a: 'rise', t: 100 + i * 70, max: 220, lines: 1, ls: -0.4 });
      if (i < 3) s += T((HX[i] + HX[i + 1]) / 2, 94, '»', { size: 20, cls: 'fa', anchor: 'middle', a: 'fade', t: 200 + i * 70 });
    });
    s += edge(line(60, 128, 1140, 128), { faint: true, t: 120 });
    // input
    s += `<circle cx="150" cy="${cy}" r="96" class="ln faint dash2"${A('fade', 300)}/><circle cx="150" cy="${cy}" r="80" class="ln faint"${A('draw', 250)}/>`;
    s += badge(150, cy, { r: 62, icon: d.startIcon || 'user', iconSize: 40, t: 200, a: 'zoom' });
    s += T(150, cy + 120, d.start, { size: 17, weight: 600, anchor: 'middle', a: 'rise', t: 400, max: 220, lines: 1 });
    if (d.startSub) s += T(150, cy + 142, d.startSub, { mono: true, size: 10, cls: 'mu', anchor: 'middle', a: 'fade', t: 450 });
    s += edge(line(214, cy, 356, cy), { soft: true, t: 500 }) + arrow(356, cy, 0, { t: 800 });
    // decision node
    s += badge(420, cy, { r: 58, dash: true, t: 550, a: 'zoom' });
    s += `<g${A('fade', 750)}>${icon(d.questionIcon || 'compass', 420, cy - 26, { size: 18, mu: true })}${T(420, cy + 8, d.question, { size: 13.5, weight: 600, anchor: 'middle', max: 92, lines: 2, lh: 1.25 })}</g>`;
    if (d.questionTag) s += T(420, cy + 90, d.questionTag, { mono: true, size: 10, cls: 'fa', anchor: 'middle', a: 'fade', t: 700 });
    // branches
    const gap = n > 1 ? Math.min(150, 420 / (n - 1)) : 0, xt = 528;
    br.forEach((b, i) => {
      const y = cy + (i - (n - 1) / 2) * gap, t = 900 + i * 180, hl = !!b.hl;
      s += edge(elbow(478, cy, xt, y, 664), { hl, soft: !hl, t, comet: hl, ct: 2100 });
      s += tag(604, y, b.when, { hl, t: t + 250 });
      s += badge(700, y, { r: 30, icon: b.icon || 'bolt', hl, t: t + 300 });
      s += T(746, y - (b.actionSub ? 8 : 0), b.action, { size: 15, weight: 600, a: 'rise', t: t + 350, max: 170, lines: 2, lh: 1.25 });
      if (b.actionSub) s += T(746, y + 14, b.actionSub, { mono: true, size: 9.5, cls: 'mu', a: 'fade', t: t + 400, max: 170, lines: 1 });
      const oc = card(1045, y, { label: b.outcome, sub: b.outcomeSub, icon: b.outcomeIcon, round: true, hl, maxW: 210, t: t + 550, ticks: false });
      s += edge(line(925, y, oc.l - 5, y), { hl, faint: !hl, dash: !hl, t: t + 500, comet: hl, ct: 2700 }) + arrow(oc.l - 5, y, 0, { hl, t: t + 800 });
      s += oc.svg;
    });
    return { grid: 'dots', svg: s };
  }, { zh: '决策流程', en: 'Decision Flow', group: 'essentials', desc: '一个判断条件把流程分到不同动作与结果。适合讲“系统如何做决定”。' }, {
    columns: ['输入', '判断', '行动', '结果'],
    start: '学生提问', startSub: 'Input', startIcon: 'chat',
    question: '需要实时信息吗？', questionIcon: 'clock',
    branches: [
      { when: '是', action: '联网检索 + 交叉验证', icon: 'search', outcome: '带引用的回答', outcomeIcon: 'link', hl: true },
      { when: '否', action: '检索课程知识库', icon: 'book', outcome: '结构化讲解', outcomeIcon: 'doc' },
      { when: '不确定', action: '追问澄清意图', icon: 'chat', outcome: '补充后再判断', outcomeIcon: 'flow' },
    ],
  });

  /* ============================================================ mindmap */
  SD.register('mindmap', (d) => {
    const B = d.branches || [], n = B.length, cx = 600, cy = 337.5;
    if (n < 2 || n > 6) throw Error('Mind map requires 2–6 branches; split the topic instead of discarding branches.');
    let s = `<ellipse cx="${cx}" cy="${cy}" rx="262" ry="172" class="ln faint"${A('fade', 150)}/>`;
    const leftCount = Math.ceil(n / 2);
    B.forEach((b, i) => {
      const left = i < leftCount, index = left ? i : i - leftCount, count = left ? leftCount : n - leftCount;
      const bx = left ? 350 : 850, by = count === 1 ? cy : 145 + index * 385 / (count - 1), t = 450 + i * 160, hl = !!b.hl;
      const direction = left ? -1 : 1, dx = bx - cx, dy = by - cy, norm = Math.hypot(dx, dy);
      unit(`r${i}`);
      s += edge(`M${q(cx + dx * 84 / norm)} ${q(cy + dy * 84 / norm)}Q${q(cx + dx * .62)} ${q(by)} ${q(bx - direction * 34)} ${q(by)}`, { hl, soft: !hl, t, glow: false });
      // Constant native shape slots keep highlighter/icon changes from shifting text identities.
      unit(`r${i}badge`);
      s += `<g${A('pop', t + 150)}><circle cx="${bx}" cy="${q(by)}" r="38" class="ln hl" opacity="${hl ? .3 : 0}"/><circle cx="${bx}" cy="${q(by)}" r="31" class="nd${hl ? ' hl' : ''}"/>${icon(b.icon || 'spark', bx, by, { size: 29, hl })}</g>`;
      unit(`r${i}label`);
      s += T(bx, by - 55, b.label, { size: 17, weight: 600, anchor: 'middle', cls: 'ko', a: 'rise', t: t + 200, max: 180, lines: 1 });
      unit(`r${i}sub`);
      if (b.sub) s += T(bx, by - 32, b.sub, { mono: true, size: 9.5, cls: (hl ? 'ac' : 'mu') + ' ko', anchor: 'middle', a: 'fade', t: t + 250, max: 200, lines: 1 });
      const its = b.items || [];
      if (its.length > 4) throw Error(`Branch ${i + 1} supports at most 4 leaves; no leaves were discarded.`);
      its.forEach((it, k) => {
        const io = typeof it === 'string' ? { label: it } : it, lx = left ? 245 : 955, ly = by + (k - (its.length - 1) / 2) * 28, tt = t + 350 + k * 50;
        unit(`r${i}l${k}`);
        s += edge(`M${q(bx + direction * 34)} ${q(by)}Q${q(bx + direction * 70)} ${q(ly)} ${lx} ${q(ly)}`, { faint: !hl, soft: hl, t: tt, glow: false });
        s += io.icon ? badge(lx, ly, { r: 12, icon: io.icon, hl: io.hl, t: tt + 150 }) : dot(lx, ly, { r: 4, hl: hl || io.hl, t: tt + 150 });
        s += T(left ? 130 : 1070, ly, io.label, { size: 13.5, weight: hl ? 500 : 400, cls: (hl ? '' : 'mu') + ' ko', anchor: 'middle', a: 'fade', t: tt + 200, max: 180, lines: 1 });
      });
      unit(null);
    });
    unit('center');
    let c = `<circle cx="${cx}" cy="${cy}" r="92" class="glf" filter="${url('glow')}" opacity=".25"/><circle cx="${cx}" cy="${cy}" r="96" class="ln hl" opacity=".25"/><circle cx="${cx}" cy="${cy}" r="82" class="f-ac"/>`;
    c += icon(d.icon || 'brain', cx, cy - 28, { size: 22, inv: true });
    unit('centerLabel');
    c += T(cx, cy + 4, d.center, { size: 19, weight: 600, anchor: 'middle', cls: 'inv', max: 140, lines: 2, lh: 1.15 });
    unit('centerSub');
    if (d.sub) c += T(cx, cy + 40, d.sub, { mono: true, size: 9, cls: 'inv', anchor: 'middle', max: 140, lines: 1 });
    unit('center');
    s += `<g${A('pop', 0)}>${c}</g>`;
    unit(null);
    return { grid: 'dots', svg: s };
  }, { zh: '思维导图', en: 'Mind Map', group: 'essentials', desc: '一个主题向外发散成若干方向与要点，表达联想而非层级。' }, {
    center: 'AI × 教育', sub: 'Learning Reimagined', icon: 'brain',
    branches: [
      { label: '教', sub: 'Teach', icon: 'cap', items: ['备课助手', '课件生成', '分层教学'] },
      { label: '学', sub: 'Learn', icon: 'book', hl: true, items: ['个性化路径', '苏格拉底式答疑', '错题本', '口语陪练'] },
      { label: '评', sub: 'Assess', icon: 'check', items: ['自动批改', '能力画像', '过程性评价'] },
      { label: '管', sub: 'Manage', icon: 'chart', items: ['学情看板', '资源调度'] },
    ],
  });

  /* =========================================================== timeline */
  SD.register('timeline', (d) => {
    const it = d.items || [], n = Math.max(1, it.length), y = 372, X0 = 70, X1 = 1130;
    const sp = n > 1 ? (X1 - X0 - 170) / (n - 1) : 0;
    const xs = it.map((_, i) => (n > 1 ? X0 + 85 + i * sp : 600));
    const hi = it.findIndex(x => x.hl || x.now);
    let s = slab(X0, y + 12, X1 - X0, 9, { k: 12, t: 100 });
    let ruler = '';
    for (let x = X0 + 10; x < X1; x += 16) ruler += `M${x} ${y + 27}V${y + ((x - X0 - 10) % 80 === 0 ? 37 : 31)}`;
    s += `<path d="${ruler}" class="ln faint"${A('fade', 300)}/>`;
    if (hi >= 0) {
      unit('cur');
      s += slab(X0, y + 12, xs[hi] - X0, 9, { k: 12, hl: true, t: 700 });
      s += `<path d="M${X0 + 6} ${y + 6}H${q(xs[hi])}" class="comet" data-loop="comet" data-t="2400" data-dur="3600" data-u="cur"/>`;
      unit(null);
    }
    const maxW = Math.min(220, sp * 1.75 || 300);
    it.forEach((m, i) => {
      const x = xs[i], up_ = i % 2 === 0, cur = i === hi, t = 400 + i * 170;
      unit(`r${i}`);
      unit(`r${i}node`);
      const c = chip(x, y - 6, { r: 30, icon: m.icon || (cur ? 'flag' : 'spark'), t });
      unit(`r${i}`);
      if (cur) { unit('cur'); s += halo(x, y, 130, t) + pulse(x, y - 6, 17, 1900, 30); unit(`r${i}`); }
      const stem = 58;
      let g = '';
      if (up_) {
        s += edge(line(x, c.top - 6, x, c.top - stem), { faint: !cur, hl: cur, t: t + 150, glow: false });
        const blockH = 46 + (m.desc ? 22 * Math.min(2, textH(m.desc, { size: 12.5, max: maxW, lines: 2, lh: 1.4 }) / 17.5) : 0);
        const top = c.top - stem - 10 - blockH;
        unit(`r${i}date`);
        g += T(x, top + 6, m.date, { mono: true, size: 10.5, cls: cur ? 'ac' : 'mu', anchor: 'middle' });
        unit(`r${i}title`);
        g += T(x, top + 30, m.title, { size: 17, weight: 600, anchor: 'middle', max: maxW, lines: 1 });
        unit(`r${i}desc`);
        if (m.desc) g += T(x, top + 48, m.desc, { size: 12.5, cls: 'mu', anchor: 'middle', max: maxW, lines: 2, lh: 1.4, valign: 'top' });
      } else {
        s += edge(line(x, y + 44, x, y + 44 + stem - 20), { faint: !cur, hl: cur, t: t + 150, glow: false });
        const top = y + 44 + stem - 8;
        unit(`r${i}date`);
        g += T(x, top + 6, m.date, { mono: true, size: 10.5, cls: cur ? 'ac' : 'mu', anchor: 'middle' });
        unit(`r${i}title`);
        g += T(x, top + 30, m.title, { size: 17, weight: 600, anchor: 'middle', max: maxW, lines: 1 });
        unit(`r${i}desc`);
        if (m.desc) g += T(x, top + 48, m.desc, { size: 12.5, cls: 'mu', anchor: 'middle', max: maxW, lines: 2, lh: 1.4, valign: 'top' });
      }
      unit(`r${i}content`);
      s += c.svg + `<g${A('rise', t + 250)}>${g}</g>`;
    });
    unit(null);
    s += arrow(X1 + 14, y + 10, 0, { t: 900 });
    return { grid: 'iso', mask: { cy: 0.55, r: 0.66 }, svg: s };
  }, { zh: '里程碑时间线', en: 'Milestone Timeline', group: 'essentials', desc: '按时间排列的关键节点，可标记“当前”。线长不代表时长。' }, {
    items: [
      { date: '2024.03', title: '项目立项', desc: '组建 12 人核心团队', icon: 'rocket' },
      { date: '2024.11', title: '封闭内测', desc: '30 所学校参与共创', icon: 'lock' },
      { date: '2025.06', title: '公开测试', desc: '10 万教师开始使用', icon: 'users' },
      { date: '2026.01', title: '1.0 正式发布', desc: '全学段、全学科覆盖', icon: 'flag', hl: true },
      { date: '2026.09', title: '国际化', desc: '支持 12 种语言', icon: 'globe' },
      { date: '2027', title: '开放平台', desc: '向开发者开放 Agent 能力', icon: 'plug' },
    ],
  });

  /* =============================================================== venn */
  SD.register('venn', (d) => {
    const S = (d.sets || []).slice(0, 3), ov = d.overlap || {}, n = S.length;
    const id = url('x').slice(5, -3);
    let s = '';
    const pills = (x, y0, items, gap = 38, o = {}) => items.map((it, k) => pill(x, y0 + (k - (items.length - 1) / 2) * gap, typeof it === 'string' ? it : it.label, { anchor: 'middle', size: o.size || 12.5, hl: o.hl, t: (o.t || 900) + k * 80 })).join('');
    if (n === 3) {
      const r = 168, C = [[505, 285], [695, 285], [600, 450]];
      s += `<defs><clipPath id="${id}-c0"><circle cx="${C[0][0]}" cy="${C[0][1]}" r="${r}"/></clipPath><clipPath id="${id}-c1"><circle cx="${C[1][0]}" cy="${C[1][1]}" r="${r}"/></clipPath></defs>`;
      C.forEach((c, i) => { s += `<circle cx="${c[0]}" cy="${c[1]}" r="${r}" fill="${url('dotf')}" opacity=".1"${A('fade', 200 + i * 150)}/><path d="${circP(c[0], c[1], r, -90 + i * 120)}" class="ln soft"${A('draw', 200 + i * 200)}/>`; });
      s += `<g clip-path="url(#${id}-c0)"><g clip-path="url(#${id}-c1)"><circle cx="${C[2][0]}" cy="${C[2][1]}" r="${r}" class="f-soft" style="stroke:var(--sd-accent);stroke-width:1.4"${A('fade', 1100)}/></g></g>`;
      C.forEach((c, i) => {
        const st = S[i] || {}, ang = [-2.45, -0.69, Math.PI / 2][i], [lx, ly] = pol(c[0], c[1], r + 44, ang), an = i === 0 ? 'end' : i === 1 ? 'start' : 'middle';
        const bx = i === 2 ? lx - textW(st.label, { size: 17, weight: 600 }) / 2 - 30 : i === 0 ? lx - textW(st.label, { size: 17, weight: 600 }) - 30 : lx + textW(st.label, { size: 17, weight: 600 }) + 30;
        if (st.icon) s += badge(bx, ly, { r: 18, icon: st.icon, t: 500 + i * 150 });
        s += T(lx, ly - (st.sub ? 8 : 0), st.label, { size: 17, weight: 600, anchor: an, a: 'rise', t: 550 + i * 150 });
        if (st.sub) s += T(lx, ly + 13, st.sub, { mono: true, size: 9.5, cls: 'mu', anchor: an, a: 'fade', t: 600 + i * 150 });
        const [ix, iy] = pol(c[0], c[1], r * 0.5, ang);
        s += pills(ix, iy, (st.items || []).slice(0, 3), 32, { size: 11.5, t: 900 + i * 120 });
      });
      s += badge(600, 338, { r: 24, icon: ov.icon || 'spark', hl: true, t: 1300 }) + pulse(600, 338, 24, 2000);
      s += T(600, 378, ov.label, { size: 14, weight: 600, cls: 'ac ko', anchor: 'middle', a: 'rise', t: 1400, max: 120, lines: 1 });
      return { grid: 'none', svg: s };
    }
    const r = 228, cy = 372, C = [[480, cy], [720, cy]], hy = Math.sqrt(r * r - 120 * 120);
    C.forEach((c, i) => { s += `<circle cx="${c[0]}" cy="${c[1]}" r="${r}" fill="${url('dotf')}" opacity=".1"${A('fade', 200 + i * 200)}/><path d="${circP(c[0], c[1], r, i ? 0 : 180)}" class="ln soft"${A('draw', 200 + i * 250)}/>`; });
    s += `<g${A('fade', 1000)}><path d="M600 ${q(cy - hy)}A${r} ${r} 0 0 1 600 ${q(cy + hy)}A${r} ${r} 0 0 1 600 ${q(cy - hy)}Z" class="f-bg"/><path d="M600 ${q(cy - hy)}A${r} ${r} 0 0 1 600 ${q(cy + hy)}A${r} ${r} 0 0 1 600 ${q(cy - hy)}Z" class="f-soft" style="stroke:var(--sd-accent);stroke-width:1.4"/></g>`;
    C.forEach((c, i) => {
      const st = S[i] || {}, hx = c[0] + (i ? 110 : -110);
      if (st.icon) s += badge(hx, 74, { r: 22, icon: st.icon, t: 500 + i * 150 });
      s += T(hx, 118, st.label, { size: 19, weight: 600, anchor: 'middle', a: 'rise', t: 550 + i * 150, max: 220, lines: 1 });
      s += T(hx, 140, st.sub, { mono: true, size: 9.5, cls: 'mu', anchor: 'middle', a: 'fade', t: 600 + i * 150, max: 220, lines: 1 });
      s += pills(c[0] + (i ? 108 : -108), cy, st.items || [], 40, { t: 900 + i * 120 });
    });
    const oi = ov.items || [];
    s += badge(600, cy - 96, { r: 26, icon: ov.icon || 'spark', hl: true, t: 1250 }) + pulse(600, cy - 96, 26, 2000);
    s += T(600, cy - 48, ov.label, { size: 17, weight: 600, cls: 'ac ko', anchor: 'middle', a: 'rise', t: 1350, max: 180, lines: 1 });
    s += pills(600, cy + 18 + ((oi.length - 1) * 36) / 2 - 6, oi, 36, { size: 12, hl: false, t: 1450 });
    return { grid: 'none', svg: s };
  }, { zh: '交集关系', en: 'Venn Overlap', group: 'essentials', desc: '两到三个领域的交集，适合讲“我们站在 A 与 B 的交汇处”。面积不代表数量。' },
  {"sets": [{"label": "人工智能", "icon": "brain", "sub": "AI", "items": ["大模型", "多模态", "智能体"]}, {"label": "教育科学", "icon": "cap", "sub": "Learning Science", "items": ["认知负荷", "刻意练习", "形成性评价"]}], "overlap": {"label": "Stage Learn", "icon": "spark", "items": ["自适应学习", "智能导学", "精准测评"]}});


  /* ============================================================ journey */
  SD.register('journey', (d) => {
    const st = d.stages || [], n = st.length, X0 = 90, X1 = 1110;
    if (n < 2 || n > 6) throw Error('User journey requires 2–6 stages; split the journey instead of dropping stages.');
    if (st.some(g => typeof g.level !== 'number' || !Number.isFinite(g.level) || g.level < 0 || g.level > 1)) throw Error('Every journey stage requires a numeric level from 0 to 1; no value was clamped or replaced.');
    const cw = (X1 - X0) / n, xs = st.map((_, i) => X0 + cw * (i + .5));
    const P = st.map((g, i) => [xs[i], 340 - g.level * 140]);
    let s = '';
    st.forEach((g, i) => {
      const [x, y] = P[i], t = 450 + i * 160;
      unit(`r${i}band`);
      s += `<rect x="${q(X0 + cw * i)}" y="58" width="${q(cw)}" height="574" style="fill:color-mix(in oklab,var(--sd-fg) ${i % 2 ? 0 : 2}%,transparent)"${A('fade', t)}/>`;
      unit(`r${i}index`);
      s += T(x - 36, 82, String(i + 1).padStart(2, '0'), { mono: true, size: 10.5, cls: g.hl ? 'ac' : 'fa', a: 'fade', t: t + 100 });
      unit(`r${i}label`);
      s += T(x, 106, g.label, { size: 18, weight: 600, cls: g.hl ? 'ac' : '', anchor: 'middle', a: 'rise', t: t + 150, max: cw - 30, lines: 1 });
      // Each stage owns the segment leading to it, so narration builds a real continuous journey.
      const [px, py] = i ? P[i - 1] : [X0, y], span = (x - px) * .5;
      unit(`r${i}path`);
      s += `<path d="M${q(px)} ${q(py)}C${q(px + span)} ${q(py)} ${q(x - span)} ${q(y)} ${q(x)} ${q(y)}" class="ln ${g.hl ? 'hl thick' : 'soft'}" data-dur="650"${A('draw', t)}/>`;
      unit(`r${i}node`);
      const c = chip(x, y - 22, { r: 22, icon: g.icon || 'user', t: t + 200 });
      s += c.svg;
      unit(`r${i}emphasis`);
      s += `<g${A('pop', t + 200)}><ellipse cx="${q(x)}" cy="${q(y - 22)}" rx="29" ry="18" class="ln hl" opacity="${g.hl ? .5 : 0}"/></g>`;
      // A fixed note band reserves enough room for both level endpoints and maximum-length prose.
      unit(`r${i}note`);
      if (g.note) s += T(x, 388, g.note, { size: 12.5, cls: g.hl ? 'ac' : 'mu', anchor: 'middle', max: cw - 24, lines: 2, a: 'fade', t: t + 250 });
      unit(`r${i}action`);
      s += T(x, 488, g.action, { size: 14, weight: 500, anchor: 'middle', max: cw - 30, lines: 2, a: 'rise', t: t + 250 });
      unit(`r${i}touch`);
      s += T(x, 588, g.touch, { size: 14, cls: 'mu', anchor: 'middle', max: cw - 30, lines: 2, a: 'rise', t: t + 400 });
      unit(null);
    });
    const rows = [['action', d.actionLabel, 'pen'], ['touch', d.touchLabel, 'link']];
    rows.forEach(([key, label, iconName], index) => {
      const y = 432 + index * 100;
      unit(`axis${key}`);
      s += edge(line(X0, y, X1, y), { faint: true, a: 'fade', t: 100 });
      s += `<g${A('fade', 200)}>${icon(iconName, X0 + 12, y + 18, { size: 13, mu: true })}${T(X0 + 26, y + 18, label, { mono: true, size: 10, cls: 'fa', max: 140, lines: 1 })}</g>`;
    });
    unit(null);
    return { grid: 'none', svg: s };
  }, { zh: '用户旅程', en: 'User Journey', group: 'essentials', desc: '用户按阶段经历的行为、触点与体验起伏。体验值为定性描述。' }, {
    actionLabel: '用户行为', touchLabel: '触点',
    stages: [
      { label: '发现', level: 0.5, note: '被朋友圈案例吸引', action: '看到发布会短视频', touch: '社交媒体', icon: 'eye' },
      { label: '注册', level: 0.3, note: '表单太长，略有犹豫', action: '手机号一键注册', touch: '官网 / App', icon: 'key' },
      { label: '首次体验', level: 0.88, note: '“30 秒生成了整堂课”', action: '导入课件，生成教案', touch: '桌面端', icon: 'bolt', hl: true },
      { label: '深度使用', level: 0.68, note: '形成每周备课习惯', action: '班级学情分析', touch: '教师工作台', icon: 'chart' },
      { label: '推荐', level: 0.94, note: '主动推荐给教研组', action: '分享模板到社区', touch: '模板市场', icon: 'heart' },
    ],
  });

  /* ============================================================ roadmap */
  SD.register('roadmap', (d) => {
    const U = d.units || ['Q1', 'Q2', 'Q3', 'Q4'], tasks = d.tasks || [], nu = U.length, nt = Math.max(1, tasks.length);
    const x0 = 340, x1 = 1100, uw = (x1 - x0) / nu, rowH = Math.min(66, 470 / nt), top = Math.max(130, 365 - (nt * rowH) / 2), hy = top - 18;
    const X = v => x0 + v * uw, yb = top + nt * rowH + 8;
    let s = '';
    U.forEach((u, i) => {
      if (i % 2 === 0) s += `<rect x="${q(X(i))}" y="${q(hy - 46)}" width="${q(uw)}" height="${q(yb - hy + 46)}" style="fill:color-mix(in oklab,var(--sd-fg) 2.5%,transparent)"${A('fade', 100)}/>`;
      s += T(X(i) + 12, hy - 22, u, { mono: true, size: 11, cls: 'mu', a: 'fade', t: 100 + i * 60 });
      s += edge(line(X(i), hy - 46, X(i), yb), { faint: true, a: 'fade', t: 100 });
    });
    s += edge(line(X(nu), hy - 46, X(nu), yb), { faint: true, a: 'fade', t: 100 });
    s += edge(line(70, hy, x1, hy), { soft: true, t: 150 });
    tasks.forEach((tk, i) => {
      const y = top + i * rowH + rowH / 2, t = 300 + i * 110, hl = !!tk.hl;
      if (i) s += edge(line(70, y - rowH / 2, x1, y - rowH / 2), { faint: true, a: 'fade', t });
      s += `<g${A('rise', t)}><rect x="70" y="${q(y - 15)}" width="30" height="30" rx="8" class="nd${hl ? ' hl' : ''}" style="fill:${hl ? url('af') : url('nf')}"/>${icon(tk.icon || 'spark', 85, y, { size: 15, hl })}</g>`;
      s += T(114, y - (tk.owner ? 8 : 0), tk.label, { size: 15, weight: hl ? 600 : 500, a: 'rise', t, max: 200, lines: 1 });
      if (tk.owner) s += T(114, y + 12, tk.owner, { mono: true, size: 9.5, cls: 'fa', a: 'fade', t, max: 200, lines: 1 });
      const a = X(tk.start), b = X(tk.end != null ? tk.end : tk.start);
      if (Math.abs(b - a) < 1) {
        const c = chip(a, y - 4, { r: 15, hl, t: t + 300, th: 6 });
        s += c.svg + (hl ? pulse(a, y - 4, 8, 2000, 15) : '');
        if (tk.note) s += T(a + 24, y - 2, tk.note, { mono: true, size: 10, cls: hl ? 'ac' : 'mu', a: 'fade', t: t + 400 });
      } else {
        s += slab(a, y - 6, b - a, 13, { k: 7, hl, t: t + 200 });
        if (tk.note) s += T(b + 18, y - 1, tk.note, { mono: true, size: 10, cls: hl ? 'ac' : 'mu', a: 'fade', t: t + 700 });
      }
    });
    (d.links || []).forEach(([i, j], k) => {
      const A_ = tasks[i], B_ = tasks[j];
      if (!A_ || !B_) return;
      const ax = X(A_.end != null ? A_.end : A_.start), ay = top + i * rowH + rowH / 2 + 8, bx = X(B_.start), by = top + j * rowH + rowH / 2 - 12;
      const mx = Math.max(ax + 10, bx - 10);
      s += edge(`M${q(ax)} ${q(ay)}H${q(mx)}V${q(by)}`, { soft: true, t: 1400 + k * 100, cls: 'dash' }) + arrow(mx, by, Math.PI / 2, { s: 5, t: 1700 + k * 100 });
    });
    if (d.now != null) {
      const nx = X(d.now);
      s += `<rect x="${q(nx)}" y="${q(hy)}" width="${q(x1 - nx)}" height="${q(yb - hy)}" style="fill:color-mix(in oklab,var(--sd-bg) 45%,transparent)"${A('fade', 1300)}/>`;
      s += edge(line(nx, hy, nx, yb), { hl: true, t: 1200 });
      s += tag(nx, hy, d.nowLabel || 'Now', { hl: true, t: 1500 }) + pulse(nx, yb, 4, 2000) + dot(nx, yb, { r: 4, hl: true, t: 1500 });
    }
    return { grid: 'none', svg: s };
  }, { zh: '产品路线图', en: 'Roadmap', group: 'essentials', desc: '任务在真实时间刻度上的排期（甘特），条形长度遵循时间刻度。' }, {
    units: ['Q1 2026', 'Q2', 'Q3', 'Q4'], now: 2.35, nowLabel: '今天',
    tasks: [
      { label: '模型训练 v2', owner: 'AI Lab', icon: 'cpu', start: 0, end: 1.4 },
      { label: '教师端内测', owner: '产品', icon: 'cap', start: 1.1, end: 2.1 },
      { label: '秋季发布会', owner: '市场', icon: 'rocket', start: 2.5, note: 'Sept 18', hl: true },
      { label: '学生端公测', owner: '产品', icon: 'book', start: 2.5, end: 3.6, hl: true, note: 'Beta' },
      { label: '开放平台 API', owner: '平台', icon: 'api', start: 3, end: 4 },
      { label: '海外市场', owner: '增长', icon: 'globe', start: 3.4, end: 4 },
    ],
    links: [[0, 1], [1, 3]],
  });

  /* =========================================================== quadrant */
  SD.register('quadrant', (d) => {
    const px0 = 280, px1 = 920, py0 = 78, py1 = 600, cx = (px0 + px1) / 2, cy = (py0 + py1) / 2;
    const X = d.x || {}, Y = d.y || {}, Qn = d.quadrants || [];
    let s = '';
    if (d.focus != null) {
      const f = d.focus, rx = f === 1 || f === 3 ? cx : px0, ry = f >= 2 ? cy : py0;
      s += `<g${A('fade', 900)}><rect x="${rx}" y="${ry}" width="${cx - px0}" height="${cy - py0}" class="f-soft"/><rect x="${rx}" y="${ry}" width="${cx - px0}" height="${cy - py0}" fill="${url('dotf')}" opacity=".12"/></g>`;
    }
    [[px0 + 26, py0 + 40, 'start'], [px1 - 26, py0 + 40, 'end'], [px0 + 26, py1 - 30, 'start'], [px1 - 26, py1 - 30, 'end']].forEach(([x, y, an], i) => {
      s += T(x, y, Qn[i], { size: 30, weight: 500, cls: 'disp ' + (d.focus === i ? 'ac' : 'fa'), anchor: an, a: 'fade', t: 600 + i * 60, ls: -0.6 });
    });
    let tk = '';
    for (let x = px0; x <= px1; x += 16) tk += `M${x} ${cy - ((x - px0) % 80 === 0 ? 6 : 3)}V${cy + ((x - px0) % 80 === 0 ? 6 : 3)}`;
    for (let y = py0; y <= py1; y += 16) tk += `M${cx - ((y - py0) % 80 === 0 ? 6 : 3)} ${y}H${cx + ((y - py0) % 80 === 0 ? 6 : 3)}`;
    s += `<path d="${tk}" class="ln faint"${A('fade', 300)}/>`;
    s += edge(line(px0, cy, px1, cy), { soft: true, t: 100 }) + arrow(px1, cy, 0, { t: 600 });
    s += edge(line(cx, py1, cx, py0), { soft: true, t: 100 }) + arrow(cx, py0, -Math.PI / 2, { t: 600 });
    s += T(px0 - 14, cy, X.low, { mono: true, size: 10, cls: 'mu', anchor: 'end', a: 'fade', t: 500 });
    s += T(px1 + 14, cy, X.high, { mono: true, size: 10, cls: 'mu', a: 'fade', t: 500 });
    s += T(px1 + 14, cy + 20, X.label, { size: 14, weight: 600, a: 'fade', t: 600 });
    s += T(cx, py0 - 24, Y.high, { mono: true, size: 10, cls: 'mu', anchor: 'middle', a: 'fade', t: 500 });
    s += T(cx, py1 + 24, Y.low, { mono: true, size: 10, cls: 'mu', anchor: 'middle', a: 'fade', t: 500 });
    s += T(cx + 14, py0 + 2, Y.label, { size: 14, weight: 600, a: 'fade', t: 600 });
    (d.points || []).forEach((p, i) => {
      const x = px0 + clamp(p.x) * (px1 - px0), y = py1 - clamp(p.y) * (py1 - py0), t = 1000 + i * 120, r = p.hl ? 24 : 15;
      if (p.hl) s += edge(`M${q(x)} ${q(y + r)}V${cy}M${q(x - r)} ${q(y)}H${cx}`, { hl: true, cls: 'dash', t: t + 200, glow: false }) + halo(x, y, 90, t) + pulse(x, y, r, 1900);
      s += badge(x, y, { r, icon: p.icon, text: p.icon ? null : String(p.label || '?').trim()[0], textSize: p.hl ? 13 : 11, hl: p.hl, t });
      const right = x < px1 - 160, off = r + 12;
      s += T(right ? x + off : x - off, y - (p.sub ? 8 : 0), p.label, { size: p.hl ? 17 : 14, weight: p.hl ? 600 : 500, cls: 'ko', anchor: right ? 'start' : 'end', a: 'fade', t: t + 100 });
      if (p.sub) s += T(right ? x + off : x - off, y + 12, p.sub, { mono: true, size: 9.5, cls: (p.hl ? 'ac' : 'mu') + ' ko', anchor: right ? 'start' : 'end', a: 'fade', t: t + 150 });
    });
    return { grid: 'none', svg: s };
  }, { zh: '定位象限', en: 'Positioning Quadrant', group: 'essentials', desc: '两条定性维度上的产品定位。位置为定性判断，非精确得分。' },
  {"x": {"low": "难上手", "high": "易上手", "label": "易用性"}, "y": {"low": "单一功能", "high": "全链路", "label": "能力覆盖"}, "quadrants": ["专业工具", "全能伙伴", "轻量小工具", "入门应用"], "focus": 1, "points": [{"label": "Stage Learn", "sub": "Ours", "x": 0.8, "y": 0.8, "hl": true, "icon": "spark"}, {"label": "竞品 A", "x": 0.3, "y": 0.76}, {"label": "竞品 B", "x": 0.66, "y": 0.38}, {"label": "传统 LMS", "x": 0.18, "y": 0.55}, {"label": "题库 App", "x": 0.72, "y": 0.16}]});


  /* ============================================================= matrix */
  SD.register('matrix', (d) => {
    const C = (d.columns || []).map(c => (typeof c === 'string' ? { label: c } : c)), Rw = d.rows || [], nc = Math.max(1, C.length), nr = Math.max(1, Rw.length);
    const lx = 80, c0 = 470, c1 = 1120, cw = (c1 - c0) / nc, top = 178, rh = Math.min(54, 360 / nr);
    const hc = d.highlight != null ? d.highlight : 0, score = d.score !== false;
    const sy = top + nr * rh + 44, bot = score ? sy + 44 : top + nr * rh + 16;
    let s = '';
    const bx = c0 + hc * cw + 8, bw = cw - 16;
    s += `<g${A('rise', 200)}><rect x="${q(bx)}" y="36" width="${q(bw)}" height="${q(bot - 36)}" rx="22" class="nd hl" style="fill:${url('af')};stroke:${url('as')}"/><rect x="${q(bx + bw / 2 - 28)}" y="36" width="56" height="3" rx="1.5" class="f-ac"/></g>`;
    C.forEach((c, j) => {
      const x = c0 + (j + 0.5) * cw, hl = j === hc;
      s += badge(x, 84, { r: 22, icon: c.icon || 'cube', hl, t: 250 + j * 80 });
      s += T(x, 128, c.label, { size: 16, weight: 600, anchor: 'middle', cls: hl ? '' : 'mu', a: 'rise', t: 300 + j * 80, max: cw - 30, lines: 1 });
      if (hl && d.tag) s += T(x, 150, d.tag, { mono: true, size: 9.5, cls: 'ac', anchor: 'middle', a: 'fade', t: 400 });
    });
    s += edge(line(lx, top, c1, top), { soft: true, t: 300 });
    Rw.forEach((r, i) => {
      const y = top + i * rh + rh / 2, t = 500 + i * 90;
      let g = '';
      const ox = r.icon ? 36 : 0;
      if (r.icon) g += badge(lx + 13, y, { r: 13, icon: r.icon, a: '' });
      g += T(lx + ox, y - (r.sub ? 8 : 0), r.label, { size: 15, weight: 500, max: 330, lines: 1 });
      if (r.sub) g += T(lx + ox, y + 11, r.sub, { mono: true, size: 9, cls: 'fa', max: 330, lines: 1 });
      (r.values || []).forEach((v, j) => {
        const x = c0 + (j + 0.5) * cw, hl = j === hc;
        if (v === 2 || v === true) g += `<circle cx="${q(x)}" cy="${q(y)}" r="12" class="${hl ? 'f-ac' : 'f-ln'}"/><path d="M${q(x - 5)} ${q(y)}l3.5 3.5 6.5-6.5" style="stroke:var(--sd-bg);stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round"/>`;
        else if (v === 1) g += `<circle cx="${q(x)}" cy="${q(y)}" r="11" class="ln${hl ? ' hl' : ''}"/><path d="M${q(x)} ${q(y - 11)}A11 11 0 0 0 ${q(x)} ${q(y + 11)}Z" class="${hl ? 'f-ac' : 'f-ln'}"/>`;
        else if (v === 0 || v === false || v == null) g += `<circle cx="${q(x)}" cy="${q(y)}" r="4" class="ln faint"/>`;
        else g += T(x, y, v, { size: 15, weight: hl ? 600 : 500, cls: hl ? 'ac' : 'mu', anchor: 'middle', max: cw - 20, lines: 1 });
      });
      s += `<g${A('rise', t)}>${g}</g>`;
      if (i < nr - 1) s += edge(line(lx, y + rh / 2, c1, y + rh / 2), { faint: true, a: 'fade', t: t + 50 });
    });
    if (score) {
      s += edge(line(lx, sy - 26, c1, sy - 26), { soft: true, t: 1200 });
      s += T(lx, sy, d.scoreLabel || 'Fully supported', { mono: true, size: 10, cls: 'mu', a: 'fade', t: 1250 });
      C.forEach((c, j) => {
        const x = c0 + (j + 0.5) * cw, hl = j === hc, cnt = Rw.filter(r => (r.values || [])[j] === 2 || (r.values || [])[j] === true).length;
        s += `<text x="${q(x)}" y="${q(sy)}" font-size="30" font-weight="600" letter-spacing="-1" text-anchor="middle" dominant-baseline="central" class="disp${hl ? ' ac' : ' mu'}"${A('rise', 1300 + j * 80)}><tspan data-count="${cnt}" data-t="${1300 + j * 80}">${cnt}</tspan><tspan font-size="13" class="fa" dx="3" letter-spacing="0">/${nr}</tspan></text>`;
      });
    }
    if (d.legend !== false) s += T(lx, bot + 22, d.legend || '●  全面支持      ◐  部分支持      ○  不支持', { mono: true, size: 9.5, cls: 'fa', a: 'fade', t: 1400, upper: false });
    return { grid: 'none', svg: s };
  }, { zh: '能力对比', en: 'Comparison Matrix', group: 'essentials', desc: '方案 × 能力的对照表，适合发布会“与竞品对比”。评分需有依据。' }, {
    columns: [{ label: 'Stage Learn', icon: 'spark' }, { label: '竞品 A', icon: 'cube' }, { label: '竞品 B', icon: 'cube' }], highlight: 0, tag: 'New', scoreLabel: '全面支持项',
    rows: [
      { label: '多模态输入', icon: 'image', sub: '图片 · 语音 · 手写', values: [2, 2, 1] },
      { label: '本地私有化部署', icon: 'server', values: [2, 0, 1] },
      { label: '实时课堂协作', icon: 'users', values: [2, 1, 0] },
      { label: '学情数据看板', icon: 'chart', values: [2, 1, 1] },
      { label: '插件与开放 API', icon: 'plug', values: [2, 0, 0] },
      { label: '起步价格', icon: 'cart', values: ['免费', '¥99/月', '¥199/月'] },
    ],
  });

  /* =============================================================== tree */
  SD.register('tree', (d) => {
    const root = d.root || { label: '' };
    let leaves = 0, depth = 0;
    const walk = (nd, dep) => {
      nd._d = dep; depth = Math.max(depth, dep);
      const ch = nd.children || [];
      if (!ch.length) { nd._x = leaves++; return nd._x; }
      const xs = ch.map(c => walk(c, dep + 1));
      nd._x = (xs[0] + xs[xs.length - 1]) / 2;
      return nd._x;
    };
    walk(root, 0);
    const X0 = 70, X1 = 1130, slot = (X1 - X0) / Math.max(1, leaves);
    const RAD = [38, 27, 19, 15], levelH = depth ? Math.min(205, 470 / depth) : 0, Y0 = 118;
    let edges = '', nodes = '';
    const place = (nd, parent, k) => {
      const cx = X0 + (nd._x + 0.5) * slot, cy = Y0 + nd._d * levelH, t = 150 + nd._d * 380 + k * 60, r = RAD[Math.min(nd._d, 3)], isRoot = nd === root, hl = !!nd.hl;
      nd._p = { cx, cy, r, b: cy + r + (nd._d === 0 ? 0 : 44) };
      if (isRoot) {
        nodes += pulse(cx, cy, r, 1600) + `<g${A('zoom', t)}><circle cx="${q(cx)}" cy="${q(cy)}" r="${r + 10}" class="ln hl" opacity=".25"/><circle cx="${q(cx)}" cy="${q(cy)}" r="${r}" class="f-ac"/>${icon(nd.icon || 'layers', cx, cy, { size: 26, inv: true })}</g>`;
        nodes += T(cx + r + 18, cy - (nd.sub ? 9 : 0), nd.label, { size: 20, weight: 600, a: 'rise', t: t + 100, max: 300, lines: 1, ls: -0.3 });
        if (nd.sub) nodes += T(cx + r + 18, cy + 15, nd.sub, { mono: true, size: 10, cls: 'ac', a: 'fade', t: t + 150 });
      } else {
        nodes += badge(cx, cy, { r, icon: nd.icon || 'spark', hl, t: t + 200 });
        nodes += T(cx, cy + r + 20, nd.label, { size: nd._d === 1 ? 15.5 : 13, weight: 600, anchor: 'middle', cls: 'ko', a: 'rise', t: t + 250, max: Math.max(80, slot * (nd._d === 1 ? 1.8 : 1) - 12), lines: 1 });
        if (nd.sub) nodes += T(cx, cy + r + 38, nd.sub, { mono: true, size: 9, cls: (hl ? 'ac' : 'mu') + ' ko', anchor: 'middle', a: 'fade', t: t + 300, max: slot - 10, lines: 1 });
      }
      if (parent) {
        const p = parent._p, y0 = p.cy + p.r + 6, y1 = cy - r - 6, m = parent === root ? y0 + (y1 - y0) * 0.45 : p.b + (y1 - p.b) * 0.5, rr = 12;
        let path;
        if (Math.abs(p.cx - cx) < 1) path = `M${q(cx)} ${q(parent === root ? y0 : p.b)}V${q(y1)}`;
        else { const sg = cx > p.cx ? 1 : -1, ys = parent === root ? y0 : p.b; path = `M${q(p.cx)} ${q(ys)}V${q(m - rr)}Q${q(p.cx)} ${q(m)} ${q(p.cx + sg * rr)} ${q(m)}H${q(cx - sg * rr)}Q${q(cx)} ${q(m)} ${q(cx)} ${q(m + rr)}V${q(y1)}`; }
        edges += edge(path, { hl, soft: !hl, t, comet: hl, ct: 2200 + k * 200, glow: false });
      }
      (nd.children || []).forEach((ch, i) => place(ch, nd, i));
    };
    place(root, null, 0);
    return { grid: 'dots', svg: edges + nodes };
  }, { zh: '层级结构', en: 'Hierarchy Tree', group: 'essentials', desc: '自上而下的层级（产品矩阵、组织、模块划分）。表达从属关系。' },
  {"root": {"label": "Stage 教育平台", "icon": "layers", "sub": "Platform", "children": [{"label": "教师端", "icon": "cap", "sub": "Teacher", "children": [{"label": "智能备课", "icon": "doc"}, {"label": "课堂互动", "icon": "chat"}]}, {"label": "学生端", "icon": "book", "sub": "Student", "hl": true, "children": [{"label": "AI 学伴", "icon": "agent", "hl": true}, {"label": "错题本", "icon": "book"}, {"label": "口语陪练", "icon": "mic"}]}, {"label": "学校端", "icon": "chart", "sub": "School", "children": [{"label": "学情看板", "icon": "chart"}, {"label": "教务管理", "icon": "calendar"}]}]}});

})();
