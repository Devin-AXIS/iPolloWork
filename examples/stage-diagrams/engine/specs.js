/* Stage Diagrams — component specs: how each diagram's content becomes component variables.
 * rows: the main list (shared data form: add/remove/reorder rows, pick icons); vars: single fields.
 * min/max are the counts the layout is designed for; the native nodes are authored at max.
 */
(() => {
  'use strict';
  const SD = window.StageDiagrams;
  const yes = { bool: true, options: [{ value: 'no', label: '否' }, { value: 'yes', label: '是' }] };
  const recipe = (max, pattern, useWhen, avoidWhen, rules, narration, exampleValues = {}) => ({
    version: 1, pattern, minHoldSeconds: 1,
    events: Array.from({ length: max }, (_, i) => ({ id: `step-${i + 1}`, target: `[data-ipw-motion-event="step-${i + 1}"]`, time: .6 + i * 1.4, duration: 1.4, action: 'Draw the relation, reveal the named item, then unfold its local details' })),
    usage: {
      intent: 'Explain supplied content in its semantic order while keeping the final diagram readable.',
      useWhen, avoidWhen, inputRules: rules,
      readingOrder: ['Orient to the shared subject or route', 'Introduce each named row in narration order', 'Read the completed diagram and its retained relationships'],
      cueBindings: Object.fromEntries(Array.from({ length: max }, (_, i) => [`step-${i + 1}`, `The measured phrase introducing row ${i + 1}; its local details unfold within the same event.`])),
      fallback: {
        overflow: 'Split at a meaningful topic boundary or shorten the supplied labels; never discard rows or leaves.',
        missingInput: 'Ask for the missing required subject or row labels; do not substitute demonstration content.',
        timingMismatch: 'Use measured phrase cues and duration. For fewer rows shorten the scene (2 rows: about 4.4–6s); keep 1.4s per event and at least 1s for reading. Do not stretch motion.',
        inapplicable: 'Choose a component matching the intended relationship instead of forcing a qualitative diagram to encode measurements.',
      },
      example: { values: exampleValues, narration },
      acceptance: ['Every supplied row and detail is present without clipping or truncation', 'Actual native geometry follows the named cue, with local detail progression', 'The final result remains sharp for at least one second', 'Direct and reverse seeking preserve the same visible state'],
    },
  });
  SD.specs = {
    timeline: {
      type: 'timeline', name: 'stage-timeline', focus: true, subcategory: 'essentials', duration: 13,
      rows: {
        variable: 'items', field: 'items', min: 2, max: 8, label: '里程碑',
        columns: [
          { id: 'title', label: 'Title', labelZh: '标题', role: 'label', required: true, maxLength: 10 },
          { id: 'date', label: 'Date', labelZh: '日期', role: 'value', maxLength: 18 },
          { id: 'desc', label: 'Detail', labelZh: '说明', role: 'value', maxLength: 28 },
          { id: 'icon', label: 'Icon', labelZh: '图标', role: 'value', icon: true },
          { id: 'current', label: 'Current', labelZh: '当前进度', role: 'value', field: 'hl', ...yes },
        ],
      },
      motionRecipe: { ...recipe(8, 'path-journey', ['Explain 2–8 supplied milestones in time order', 'Introduce dates, titles and details with measured narration cues'], ['Measured intervals or precise duration comparisons', 'More than eight milestones in one scene'], { items: 'Shared JSON rows: 2–8 milestones; title ≤10 characters, date ≤18, detail ≤28. Mark exactly one current row if needed. Dates are labels, not proportional spacing.' }, '项目立项。封闭内测。公开测试。正式发布。国际化。开放平台。'), capacity: { variable: 'items', encoding: 'json', minItems: 2, maxItems: 8 } },
      ai: 'Milestones in time order. Mark exactly one row current to show progress up to it. Spacing does not encode duration. Cue rows to the narration with motionCueTimes keyed by row id, e.g. {"<row id>": 1.2, "resolve": 9.5}.',
    },
    journey: {
      type: 'journey', name: 'stage-journey', focus: true, subcategory: 'essentials', duration: 10,
      vars: [
        { id: 'actionLabel', label: '行为行名称', type: 'string', default: '用户行为', maxLength: 10, required: true },
        { id: 'touchLabel', label: '触点行名称', type: 'string', default: '触点', maxLength: 10, required: true },
      ],
      rows: {
        variable: 'stages', field: 'stages', min: 2, max: 6, label: '旅程阶段',
        columns: [
          { id: 'label', label: 'Stage', labelZh: '阶段名称', role: 'label', required: true, maxLength: 7 },
          { id: 'level', label: 'Experience', labelZh: '体验高低', role: 'value', type: 'number', required: true, min: 0, max: 1 },
          { id: 'note', label: 'Note', labelZh: '体验描述', role: 'value', maxLength: 20 },
          { id: 'action', label: 'Action', labelZh: '用户行为', role: 'value', required: true, maxLength: 16 },
          { id: 'touch', label: 'Touchpoint', labelZh: '触点', role: 'value', required: true, maxLength: 16 },
          { id: 'icon', label: 'Icon', labelZh: '图标', role: 'value', icon: true },
          { id: 'highlighted', label: 'Emphasized', labelZh: '强调', role: 'value', field: 'hl', ...yes },
        ],
      },
      motionRecipe: {
        ...recipe(6, 'path-journey', ['Explain 2–6 stages in an actual user journey', 'Introduce the stage, its experience, action and touchpoint with measured narration cues'], ['Statistical scores, proportions or measured durations', 'More than six stages or an unsupported field length'], { stages: 'Shared JSON rows: 2–6; label ≤7 characters, optional note ≤20, required action/touch ≤16. Required numeric level is 0–1 and controls qualitative curve height; never clamp invalid input.', actionLabel: 'Required behavior-row label, at most 10 Unicode characters.', touchLabel: 'Required touchpoint-row label, at most 10 Unicode characters.' }, '用户发现产品。完成注册。获得首次成果。进入深度使用。主动推荐给同伴。'),
        capacity: { variable: 'stages', encoding: 'json', minItems: 2, maxItems: 6 },
        textLimits: { actionLabel: { maxLines: 1, maxLineLength: 10 }, touchLabel: { maxLines: 1, maxLineLength: 10 } },
      },
      ai: 'Supply an actual ordered journey using the shared stages JSON rows. Each stage needs label, numeric level 0–1, action and touch; note is optional. Level is a qualitative experience position, never a measured claim. Bind each Cue each row by its id in motionCueTimes to the narration introducing that stage: its native curve segment, marker, note and two row cells form one event. Use measured narration duration and retain final reading time.',
    },
    mindmap: {
      type: 'mindmap', name: 'stage-mindmap', subcategory: 'essentials', duration: 10,
      vars: [
        { id: 'center', label: '中心主题', type: 'string', default: 'AI × 教育', maxLength: 14, required: true },
        { id: 'sub', label: '中心副标题', type: 'string', default: '', maxLength: 14 },
        { id: 'icon', label: '中心图标', type: 'enum', default: 'brain', icon: true, central: true },
      ],
      rows: {
        variable: 'branches', field: 'branches', min: 2, max: 6, label: '主题分支',
        columns: [
          { id: 'label', label: 'Branch', labelZh: '分支主题', role: 'label', required: true, maxLength: 10 },
          { id: 'sub', label: 'Subtitle', labelZh: '分支副标题', role: 'value', maxLength: 18 },
          { id: 'icon', label: 'Icon', labelZh: '图标', role: 'value', icon: true },
          { id: 'highlighted', label: 'Emphasized', labelZh: '强调', role: 'value', field: 'hl', ...yes },
          { id: 'leaves', label: 'Details', labelZh: '叶子要点', role: 'value', field: 'items', list: { maxItems: 4, itemMaxLength: 12, separators: '、,，\n' } },
        ],
      },
      motionRecipe: {
        ...recipe(6, 'progressive-build', ['Explain one central theme with 2–6 distinct directions', 'Introduce each branch and its 0–4 details with measured narration'], ['Precise numeric proportions or causal hierarchy', 'More than six branches or four leaves per branch'], { branches: 'Shared JSON rows: 2–6 branches; label ≤10 characters, subtitle ≤18; leaves use 、 comma or newline, 0–4 items each ≤12 characters.', center: 'Required central subject, at most 14 Unicode characters over two lines.', sub: 'Optional central subtitle, at most 14 Unicode characters on one line; empty hides it.', icon: 'Choose a registered icon name; retain the central subject.' }, '围绕人工智能与教育，分别看教学、学习、评价与管理。', { sub: '四个方向协同学习' }),
        capacity: { variable: 'branches', encoding: 'json', minItems: 2, maxItems: 6 },
        textLimits: { center: { maxLines: 2, maxLineLength: 14 }, sub: { maxLines: 1, maxLineLength: 14 } },
      },
      ai: 'One central theme fans into 2–6 qualitative directions, not measured proportions. Supply real center, subtitle and icon variables plus shared branches JSON rows. Each branch has 0–4 leaves. Cue each row by its id in motionCueTimes to the phrase introducing that branch; its native connection, badge and leaves unfold as one local event. Shorten sparse scenes to their measured narration rather than extending entrances.',
    },
  };

  // Shared vocabulary for the remaining diagrams: every visible text, icon and emphasis is a variable.
  // Row cells and fields address the engine data by path; structure without a field stays as authored (base).
  const C = (id, labelZh, max = 24, extra = {}) => ({ id, label: id, labelZh, role: 'value', maxLength: max, ...extra });
  const L = (id, labelZh, max = 12, extra = {}) => ({ id, label: id, labelZh, role: 'label', required: true, maxLength: max, ...extra });
  const I = (id = 'icon', labelZh = '图标', field) => ({ id, label: 'Icon', labelZh, role: 'value', icon: true, ...(field ? { field } : {}) });
  const HL = { id: 'highlighted', label: 'Emphasized', labelZh: '强调', role: 'value', field: 'hl', ...yes };
  const B = (id, labelZh, field) => ({ id, label: id, labelZh, role: 'value', field, ...yes });
  const N = (id, labelZh, min, max, field) => ({ id, label: id, labelZh, role: 'value', type: 'number', required: true, min, max, ...(field ? { field } : {}) });
  // Sentence-like lists (which may contain commas) separate items by line only.
  const LIST = (id, labelZh, maxItems, itemMaxLength, field, separators = '、,，\n') => ({ id, label: id, labelZh, role: 'value', ...(field ? { field } : {}), list: { maxItems, itemMaxLength, separators } });
  const V = (id, label, field, maxLength = 24) => ({ id, label, type: 'string', field, maxLength });
  const VI = (id, label, field, central) => ({ id, label, type: 'enum', field, icon: true, ...(central ? { central: true } : {}) });
  const VL = (id, label, field, maxItems, itemMax) => ({ id, label, type: 'string', field, maxLength: maxItems * (itemMax + 1), list: { maxItems, itemMaxLength: itemMax, separators: '、,，\n' } });
  const VN = (id, label, field) => ({ id, label, type: 'number', field });
  const relation = (id, label, min, max) => ({ id, label, field: id, type: 'string', json: true, maxLength: 4000,
    jsonSchema: { type: 'array', minItems: min, maxItems: max, items: { type: 'object', additionalProperties: false,
      required: ['from', 'to'], properties: {
        from: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' },
        to: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' },
        label: { type: 'string', maxLength: 12, widthBudget: 6 }, highlighted: { type: 'boolean' },
      } } }, description: `JSON 数组，${min}～${max} 条：from / to 用稳定 id，label 为短说明。` });
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  // Limits never reject the authored content: each one is raised to fit the sample it ships with.
  const get = (v, path) => path.split('.').reduce((x, k) => (x == null ? undefined : typeof x === 'string' && k === 'label' ? x : x[k]), v);
  const chars = v => Array.from(String(v ?? '')).length;
  const fit = (limits, values) => {
    if (limits.list) {
      const lists = values.filter(Array.isArray);
      limits.list = { ...limits.list, maxItems: Math.max(limits.list.maxItems, ...lists.map(l => l.length)), itemMaxLength: Math.max(limits.list.itemMaxLength, ...lists.flat().map(x => chars(x && typeof x === 'object' ? x.label : x))) };
      if (limits.maxLength) limits.maxLength = Math.max(limits.maxLength, limits.list.maxItems * (limits.list.itemMaxLength + 1));
    } else if (limits.maxLength) limits.maxLength = Math.max(limits.maxLength, ...values.map(chars));
    return limits;
  };
  const define = (type, o) => {
    const sample = SD.SAMPLES && SD.SAMPLES[type], r = o.rows, variable = r.variable || 'items';
    const items = sample ? (r.keys ? r.keys.map(key => get(sample, key)) : get(sample, r.field) || []) : [];
    const labelColumn = r.columns.find(c => c.role === 'label');
    const sampleNarration = items.map(item => get(item, labelColumn?.field || labelColumn?.id || 'label')).filter(Boolean).join('。');
    if (sample) {
      r.columns = r.columns.map(c => fit({ ...c }, items.map(item => get(item, c.field || c.id))));
      o.vars = (o.vars || []).map(v => (v.type === 'number' || v.icon ? v : fit({ ...v }, [get(sample, v.field)])));
    }
    SD.specs[type] = {
      type, name: `stage-${type}`, subcategory: o.subcategory, group: o.group, duration: o.duration || 10,
      base: SD.SAMPLES && SD.SAMPLES[type], vars: o.vars || [],
      rows: { variable, field: r.field, keys: r.keys, min: r.min, max: r.max, label: r.label, columns: r.columns },
      // Fields that conclude the scene (outputs, an intersection, a second curve): they land after the last row.
      ...(o.resolve ? { resolve: o.resolve } : {}),
      // Cross-field rules the column limits cannot express (references between rows and fields).
      ...(o.check ? { check: o.check } : {}),
      // 聚焦 shot: only where the content unfolds along a path the camera can follow stop by stop.
      ...(o.focus ? { focus: true } : {}),
      motionRecipe: {
        ...recipe(r.max, o.pattern || 'progressive-build', o.useWhen, o.avoidWhen || ['Measured quantities this qualitative layout does not encode', `More than ${r.max} ${r.label} in one scene`],
          { [variable]: `Shared JSON rows: ${r.min}–${r.max} ${r.label}. Respect each column's character limit; never truncate.` }, o.narration || (sampleNarration ? `${sampleNarration}。` : '')),
        capacity: { variable, encoding: 'json', minItems: r.min, maxItems: r.max },
      },
      ai: `${o.ai} Every visible label is a variable: edit rows in the shared data form and single fields in the component form or on the canvas. Cue rows by their id in motionCueTimes (step-N also works) to the narration introducing row N.`,
    };
  };

  define('decision', { subcategory: 'essentials', pattern: 'focus-transfer', useWhen: ['Explain one question that routes to 2–3 actions and outcomes'],
    ai: 'A start input, one decision question, and branches of condition → action → outcome.',
    rows: { variable: 'branches', field: 'branches', label: '判断分支', min: 2, max: 3, columns: [L('when', '条件', 6), C('action', '行动', 14), I(), C('outcome', '结果', 12), I('outcomeIcon', '结果图标', 'outcomeIcon'), HL] },
    vars: [V('start', '起点', 'start', 10), V('startSub', '起点副标题', 'startSub', 14), VI('startIcon', '起点图标', 'startIcon'), V('question', '判断问题', 'question', 14), VI('questionIcon', '问题图标', 'questionIcon'), ...range(4, i => V(`column${i + 1}`, `列标题 ${i + 1}`, `columns.${i}`, 8))] });

  define('venn', { resolve: '^overlap', subcategory: 'essentials', useWhen: ['Explain two domains and what their overlap creates'],
    ai: 'Two sets and their overlap; circles are qualitative, not proportional.',
    rows: { variable: 'sets', field: 'sets', label: '集合', min: 2, max: 2, columns: [L('label', '名称', 8), C('sub', '副标题', 18), I(), LIST('items', '要点', 4, 8)] },
    vars: [V('overlapLabel', '交集名称', 'overlap.label', 14), VI('overlapIcon', '交集图标', 'overlap.icon', true), VL('overlapItems', '交集要点', 'overlap.items', 4, 8)] });

  define('roadmap', { focus: true, subcategory: 'essentials', pattern: 'path-journey', useWhen: ['Show 2–6 workstreams planned across periods'],
    ai: 'Tasks placed on period units; start/end are positions in units (0 = first period), not dates.',
    rows: { variable: 'tasks', field: 'tasks', label: '任务', min: 2, max: 6, columns: [L('label', '任务', 10), C('owner', '负责方', 8), I(), N('start', '开始位置', 0, 4), { id: 'end', label: 'end', labelZh: '结束位置（空为里程碑）', role: 'value', type: 'number', min: 0, max: 4 }, C('note', '备注', 10), HL] },
    vars: [...range(4, i => V(`unit${i + 1}`, `周期 ${i + 1}`, `units.${i}`, 10)), V('nowLabel', '当前标记', 'nowLabel', 6), { ...VN('now', '当前位置', 'now'), min: 0, max: 4 }] });

  define('quadrant', { subcategory: 'essentials', useWhen: ['Position 2–5 items on two qualitative axes'],
    ai: 'Points on two axes from 0 to 1; positions are qualitative.',
    rows: { variable: 'points', field: 'points', label: '定位点', min: 2, max: 5, columns: [L('label', '名称', 10), C('sub', '副标题', 8), I(), N('x', '横轴位置', 0, 1), N('y', '纵轴位置', 0, 1), HL] },
    vars: [V('xLabel', '横轴名称', 'x.label', 8), V('xLow', '横轴低端', 'x.low', 8), V('xHigh', '横轴高端', 'x.high', 8), V('yLabel', '纵轴名称', 'y.label', 8), V('yLow', '纵轴低端', 'y.low', 8), V('yHigh', '纵轴高端', 'y.high', 8), ...range(4, i => V(`quadrant${i + 1}`, `象限 ${i + 1}`, `quadrants.${i}`, 8))] });

  define('matrix', { subcategory: 'essentials', useWhen: ['Compare 2–6 capabilities across three offerings'],
    ai: 'Each cell is 2 (full), 1 (partial), 0 (none) or short text such as a price.',
    rows: { variable: 'items', field: 'rows', label: '对比项', min: 2, max: 6, columns: [L('label', '功能', 12), C('sub', '说明', 18), I(), ...range(3, i => C(`value${i + 1}`, `第 ${i + 1} 列（2 全部／1 部分／0 不支持，或文字）`, 8, { required: true, field: `values.${i}`, level: true }))] },
    vars: [...range(3, i => V(`column${i + 1}`, `列 ${i + 1} 名称`, `columns.${i}.label`, 12)), V('tag', '高亮标签', 'tag', 6), V('scoreLabel', '统计说明', 'scoreLabel', 12), { ...V('legend', '图例', 'legend', 40), default: '●  全面支持      ◐  部分支持      ○  不支持' }] });

  define('tree', { subcategory: 'essentials', useWhen: ['Explain one root and its 2–3 branches with up to three children each'],
    ai: 'A root, its branches, and each branch\'s children.',
    rows: { variable: 'branches', field: 'root.children', label: '分支', min: 2, max: 3, columns: [L('label', '分支', 8), C('sub', '副标题', 10), I(), HL, ...range(3, i => [C(`child${i + 1}`, `子项 ${i + 1}`, 8, { field: `children.${i}.label` }), I(`child${i + 1}Icon`, `子项 ${i + 1} 图标`, `children.${i}.icon`), B(`child${i + 1}Highlighted`, `子项 ${i + 1} 强调`, `children.${i}.hl`)]).flat()] },
    vars: [V('rootLabel', '根节点', 'root.label', 12), V('rootSub', '根节点副标题', 'root.sub', 12), VI('rootIcon', '根节点图标', 'root.icon')] });

  define('hub', { subcategory: 'systems', useWhen: ['Explain one core connected to 3–6 capabilities'],
    ai: 'A core and the capabilities around it; use copy for an optional scene heading.',
    rows: { variable: 'nodes', field: 'nodes', label: '能力节点', min: 3, max: 6, columns: [L('label', '名称', 8), I(), HL] },
    vars: [V('coreLabel', '核心名称', 'core.label', 12), V('coreSub', '核心副标题', 'core.sub', 18), VI('coreIcon', '核心图标', 'core.icon', true)] });

  define('stack', { subcategory: 'systems', useWhen: ['Explain 2–4 layers that build on each other'],
    ai: 'Layers from top to bottom, each with up to three parts.',
    rows: { variable: 'layers', field: 'layers', label: '层级', min: 2, max: 4, columns: [L('label', '层名', 10), C('sub', '副标题', 16), I(), LIST('items', '组成部分', 3, 8), HL] },
    vars: [] });

  define('funnel', { resolve: '^(output|outputsLabel)', subcategory: 'process', duration: 12, useWhen: ['Explain 3–7 sources converging through one core into outcomes'],
    ai: 'Sources converge into a core that produces three outcomes.',
    rows: { variable: 'inputs', field: 'inputs', label: '来源', min: 3, max: 7, columns: [L('label', '来源', 8), I()] },
    vars: [V('inputsLabel', '来源标题', 'inputsLabel', 12), V('outputsLabel', '产出标题', 'outputsLabel', 12), V('coreLabel', '核心名称', 'core.label', 10), V('coreSub', '核心副标题', 'core.sub', 18), VI('coreIcon', '核心图标', 'core.icon', true), ...range(3, i => V(`output${i + 1}`, `产出 ${i + 1}`, `outputs.${i}.label`, 12))] });

  define('orbit', { subcategory: 'narrative', group: 'editorial', useWhen: ['Explain a core platform and 2–3 rings of participants'],
    ai: 'A core with rings of members from inner to outer.',
    rows: { variable: 'rings', field: 'rings', label: '圈层', min: 2, max: 3, columns: [L('label', '圈层名称', 8), ...range(6, i => [C(`member${i + 1}`, `成员 ${i + 1}`, 8, { field: `items.${i}.label` }), I(`member${i + 1}Icon`, `成员 ${i + 1} 图标`, `items.${i}.icon`)]).flat()] },
    vars: [V('coreLabel', '核心名称', 'core.label', 12), V('coreSub', '核心副标题', 'core.sub', 12), VI('coreIcon', '核心图标', 'core.icon', true)] });

  define('scurve', { focus: true, resolve: '^secondLabel', subcategory: 'narrative', group: 'editorial', pattern: 'path-journey', useWhen: ['Explain growth phases along an S-curve and an optional second curve'],
    ai: 'Phases placed along the curve (at 0–1); curve 2 places a phase on the second curve.',
    rows: { variable: 'phases', field: 'phases', label: '阶段', min: 2, max: 4, columns: [L('label', '阶段', 6), C('desc', '说明', 16), I(), N('at', '曲线位置', 0, 1), { ...N('curve', '所在曲线（1 或 2）', 1, 2), integer: true, required: false }, HL] },
    vars: [V('xLabel', '横轴名称', 'xLabel', 8), V('yLabel', '纵轴名称', 'yLabel', 8), { id: 'second', label: '显示第二曲线', field: 'second', type: 'boolean', bool: true }, V('secondLabel', '第二曲线名称', 'secondLabel', 8)] });

  define('rings', { subcategory: 'narrative', group: 'editorial', useWhen: ['Explain 2–4 concentric layers from outside in'],
    ai: 'Concentric layers from the outermost to the core.',
    rows: { variable: 'rings', field: 'rings', label: '圈层', min: 2, max: 4, columns: [L('label', '圈层名称', 6), C('sub', '副标题', 12), C('desc', '说明', 22), I()] } });

  define('stat', { subcategory: 'narrative', group: 'editorial', useWhen: ['Highlight one headline figure with up to three supporting figures'],
    ai: 'One key figure and supporting figures; never invent numbers.',
    rows: { variable: 'notes', field: 'notes', label: '辅助数据', min: 1, max: 3, columns: [L('value', '数值', 6), C('unit', '单位', 4), C('label', '说明', 14), { id: 'progress', label: 'progress', labelZh: '进度（0–1，可空）', role: 'value', type: 'number', min: 0, max: 1 }, HL] },
    vars: [V('eyebrow', '眉标', 'eyebrow', 10), VI('icon', '图标', 'icon', true), V('value', '主数值', 'value', 6), V('unit', '主单位', 'unit', 4), V('label', '主说明', 'label', 20), { ...VN('progress', '主进度', 'progress'), min: 0, max: 1 }] });

  define('versus', { subcategory: 'narrative', group: 'editorial', pattern: 'state-transformation', useWhen: ['Contrast a before state with an after state'],
    ai: 'Two fixed sides; each has a tag, title, up to four points and one figure.',
    rows: { variable: 'sides', keys: ['left', 'right'], label: '对比双方', min: 2, max: 2, columns: [L('title', '标题', 10), C('tag', '标签', 14), I(), LIST('items', '要点', 4, 12, undefined, '\n'), C('metricValue', '数字', 6, { field: 'metric.value' }), C('metricUnit', '单位', 4, { field: 'metric.unit' }), C('metricLabel', '数字说明', 10, { field: 'metric.label' })] } });

  const SWIM_LINKS = [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}, {"from": "c", "to": "d", "label": "低置信"}, {"from": "c", "to": "e"}, {"from": "d", "to": "f"}];
  define('swimlane', { focus: true, subcategory: 'process', pattern: 'path-journey', useWhen: ['Explain 2–6 steps handed between three roles'],
    ai: 'Steps sit in a lane (lane1, lane2 or lane3, top to bottom) and a column 0–3; one step per lane and column. links is a JSON array of {"from": step key, "to": step key, "label"?: ≤6 characters}: up to 8, no self-links, each pair once.',
    rows: { variable: 'steps', field: 'steps', label: '步骤', min: 2, max: 6, columns: [L('label', '步骤', 10), C('key', '步骤代号（用于连线）', 32, { required: true, field: 'id' }), C('lane', '所在泳道', 8, { required: true, options: [{ value: 'lane1', label: '泳道 1' }, { value: 'lane2', label: '泳道 2' }, { value: 'lane3', label: '泳道 3' }] }), { ...N('col', '列位置', 0, 3), integer: true }, I(), HL] },
    vars: [...range(3, i => [V(`lane${i + 1}`, `泳道 ${i + 1}`, `lanes.${i}.label`, 8), V(`lane${i + 1}Sub`, `泳道 ${i + 1} 副标题`, `lanes.${i}.sub`, 10), VI(`lane${i + 1}Icon`, `泳道 ${i + 1} 图标`, `lanes.${i}.icon`)]).flat(),
      { ...relation('links', '连线', 0, 8), default: JSON.stringify(SWIM_LINKS) }],
    check: d => {
      const steps = d.steps || [], keys = steps.map(x => x.id), slots = new Set();
      for (const st of steps) {
        const slot = `${st.lane}@${st.col}`;
        if (slots.has(slot)) return `Two steps share ${st.lane}, column ${st.col}; one step per lane and column.`;
        slots.add(slot);
      }
      const L = d.links;
      if (!Array.isArray(L) || L.length > 8) return 'links must be a JSON array of up to 8 {"from","to","label"} objects.';
      const seen = new Set();
      for (const [k, l] of L.entries()) {
        if (!l || typeof l !== 'object' || Array.isArray(l)) return `links[${k}] must be {"from","to","label"}.`;
        for (const end of ['from', 'to']) if (!keys.includes(l[end])) return `links[${k}].${end} "${l[end]}" is not a step key (${keys.join(', ')}).`;
        if (l.from === l.to) return `links[${k}] links a step to itself.`;
        if (seen.has(`${l.from}>${l.to}`)) return `links[${k}] repeats ${l.from} → ${l.to}.`;
        seen.add(`${l.from}>${l.to}`);
      }
      return null;
    } });

  define('cycle', { subcategory: 'process', pattern: 'path-journey', useWhen: ['Explain a loop of 3–5 stages around one center'],
    ai: 'Stages around a closed loop and its center.',
    rows: { variable: 'stages', field: 'stages', label: '阶段', min: 3, max: 5, columns: [L('label', '阶段', 6), C('desc', '说明', 14), I(), HL] },
    vars: [V('center', '中心标题', 'center', 10), V('sub', '中心副标题', 'sub', 14), VI('icon', '中心图标', 'icon', true)] });

  if (SD.SAMPLES.pipeline) SD.SAMPLES.pipeline.links = SD.SAMPLES.pipeline.links.map(l => Array.isArray(l) ? ({ from: l[0], to: l[1], ...(l[2] ? { label: l[2] } : {}) }) : l);
  define('pipeline', { focus: true, subcategory: 'process', duration: 12, pattern: 'path-journey', useWhen: ['Explain a pipeline of up to seven connected stages'],
    ai: 'Nodes joined by links that use the node key; keep keys stable when renaming.',
    rows: { variable: 'nodes', field: 'nodes', label: '节点', min: 2, max: 7, columns: [L('label', '节点', 8), C('sub', '副标题', 10), C('key', '节点代号（用于连线）', 32, { required: true, field: 'id' }), I(), HL] },
    vars: [relation('links', '依赖连线', 1, 10)] });

  define('fishbone', { subcategory: 'process', useWhen: ['Explain the causes behind one problem in 2–6 categories'],
    ai: 'A problem and the categories of causes behind it.',
    rows: { variable: 'categories', field: 'categories', label: '原因类别', min: 2, max: 6, columns: [L('label', '类别', 6), C('sub', '副标题', 12), I(), LIST('items', '具体原因', 2, 8), HL] },
    vars: [V('problem', '问题', 'problem', 10), V('problemSub', '问题副标题', 'problemSub', 12), VI('problemIcon', '问题图标', 'problemIcon', true)] });

  const architectureSample = SD.SAMPLES.architecture;
  if (architectureSample) {
    const ids = {};
    architectureSample.layers.forEach((layer, i) => layer.nodes.forEach((node, j) => { node.id = `layer${i + 1}-node${j + 1}`; ids[node.label] = node.id; }));
    architectureSample.links = architectureSample.links.map(([from, to]) => ({ from: ids[from], to: ids[to] }));
  }
  define('architecture', { subcategory: 'systems', useWhen: ['Explain 2–4 architecture layers and their components'],
    ai: 'Layers of components; links use stable node ids. Renaming never breaks connections.',
    rows: { variable: 'layers', field: 'layers', label: '架构层', min: 2, max: 4, columns: [L('label', '层名', 8), I(), HL, ...range(4, i => [C(`node${i + 1}Id`, `组件 ${i + 1} 标识`, 32, { field: `nodes.${i}.id` }), C(`node${i + 1}`, `组件 ${i + 1}`, 12, { field: `nodes.${i}.label` }), I(`node${i + 1}Icon`, `组件 ${i + 1} 图标`, `nodes.${i}.icon`), B(`node${i + 1}Highlighted`, `组件 ${i + 1} 强调`, `nodes.${i}.hl`)]).flat()] },
    vars: [relation('links', '架构连线', 0, 12)] });

  const ACTORS = [1, 2, 3, 4, 5].map(i => ({ value: `actor${i}`, label: `参与方 ${i}` }));
  define('sequence', { focus: true, subcategory: 'systems', duration: 13, pattern: 'path-journey', useWhen: ['Explain up to eight messages exchanged between five participants'],
    ai: 'Messages between five participants in order; from/to name a participant by position: actor1 … actor5.',
    rows: { variable: 'messages', field: 'messages', label: '消息', min: 2, max: 8, columns: [L('label', '消息', 14), C('from', '发送方', 8, { required: true, options: ACTORS }), C('to', '接收方', 8, { required: true, options: ACTORS }), B('reply', '返回消息', 'reply'), HL] },
    vars: range(5, i => [V(`actor${i + 1}`, `参与方 ${i + 1}`, `actors.${i}.label`, 8), VI(`actor${i + 1}Icon`, `参与方 ${i + 1} 图标`, `actors.${i}.icon`)]).flat() });

  // Business transitions are data: any set within the limits below routes without overlaps (see systems.js).
  const STATE_TRANSITIONS = [{"from": "draft", "to": "review", "label": "提交"}, {"from": "review", "to": "confirm", "label": "通过"}, {"from": "confirm", "to": "pub", "label": "发布"}, {"from": "pub", "to": "arch", "label": "学期结束"}, {"from": "review", "to": "draft", "label": "需修改"}, {"from": "confirm", "to": "draft", "label": "驳回"}, {"from": "review", "to": "review", "label": "自动重试"}];
  define('state', { focus: true, subcategory: 'systems', useWhen: ['Explain 3–6 states and the business transitions between them'],
    ai: 'States are rows with a key. transitions is a JSON array of {"from": state key, "to": state key, "label"?: ≤6 characters, "highlighted"?: true}: 1–10 transitions, each direction of a pair once, at most one self-transition per state. The next state on the line is drawn straight; skips arc above, returns arc below. initial is the key of the starting state.',
    rows: { variable: 'states', field: 'states', label: '状态', min: 3, max: 6, columns: [L('label', '状态', 6), C('key', '状态代号（用于流转）', 8, { required: true, field: 'id' }), I(), HL, B('final', '终止状态', 'final')] },
    vars: [
      { ...V('initial', '初始状态', 'initial', 16), default: 'draft', description: '起始状态的稳定 ID（最多 32 位）。' },
      { ...relation('transitions', '流转', 1, 10), default: JSON.stringify(STATE_TRANSITIONS) },
    ],
    check: d => {
      const keys = (d.states || []).map(x => x.id), T = d.transitions;
      if (!keys.includes(d.initial)) return `initial "${d.initial}" is not a state key (${keys.join(', ')}).`;
      if (!Array.isArray(T) || T.length < 1 || T.length > 10) return 'transitions must be a JSON array of 1–10 {"from","to","label"} objects.';
      const seen = new Set();
      for (const [k, t] of T.entries()) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) return `transitions[${k}] must be {"from","to","label"}.`;
        for (const end of ['from', 'to']) if (!keys.includes(t[end])) return `transitions[${k}].${end} "${t[end]}" is not a state key (${keys.join(', ')}).`;
        if (t.label != null && (typeof t.label !== 'string' || Array.from(t.label).length > 24)) return `transitions[${k}].label must be short text.`;
        if (seen.has(`${t.from}>${t.to}`)) return `transitions[${k}] repeats ${t.from} → ${t.to}; each direction once.`;
        seen.add(`${t.from}>${t.to}`);
      }
      return null;
    } });

  define('disc', { subcategory: 'frameworks', duration: 13, useWhen: ['Contrast what something is not with 2–8 things it is'],
    ai: 'A short "is not" list and the segments of what it is.',
    rows: { variable: 'segments', field: 'groups.1.segments', label: '分区', min: 2, max: 8, columns: [L('label', '分区', 6), I(), HL] },
    vars: [V('notTitle', '“不是”标题', 'groups.0.title', 12), VL('notItems', '“不是”要点', 'groups.0.segments', 3, 8), V('isTitle', '“是”标题', 'groups.1.title', 12)] });

  define('diamond', { resolve: '^center', subcategory: 'frameworks', useWhen: ['Explain four conditions whose intersection is the goal'],
    ai: 'Four outer conditions, four pairwise overlaps, a center and four corner notes.',
    rows: { variable: 'outer', field: 'outer', label: '外圈条件', min: 4, max: 4, columns: [L('label', '条件', 6), I()] },
    vars: [...range(4, i => V(`inner${i + 1}`, `交叠 ${i + 1}`, `inner.${i}`, 4)), V('centerLabel', '中心', 'center.label', 6), VI('centerIcon', '中心图标', 'center.icon', true), ...range(4, i => V(`note${i + 1}`, `角注 ${i + 1}`, `notes.${i}.text`, 24))] });

  define('valley', { focus: true, resolve: '^branch', subcategory: 'frameworks', pattern: 'path-journey', useWhen: ['Explain a dip and recovery across four moments'],
    ai: 'Four moments on a curve (x, y 0–1), a critical zone and two alternative endings from the third moment.',
    rows: { variable: 'points', field: 'points', label: '关键时刻', min: 4, max: 4, columns: [L('label', '时刻', 6), C('quote', '心声', 12), N('x', '横向位置', 0, 1), N('y', '高度', 0, 1), HL] },
    vars: [V('yLabel', '纵轴名称', 'yLabel', 8), V('xLabel', '横轴名称', 'xLabel', 8), V('zoneLabel', '区间名称', 'zone.label', 8), ...range(2, i => [V(`branch${i + 1}`, `分支 ${i + 1}`, `branches.${i}.label`, 6), V(`branch${i + 1}Quote`, `分支 ${i + 1} 心声`, `branches.${i}.quote`, 10)]).flat()] });

  define('capsule', { subcategory: 'frameworks', pattern: 'path-journey', useWhen: ['Explain five stages grouped into three phases'],
    ai: 'Five stages (a stage may list up to three sub-steps) grouped into three phases with two feedback loops.',
    rows: { variable: 'stages', field: 'stages', label: '阶段', min: 5, max: 5, columns: [L('label', '阶段', 6), I(), C('caption', '标注', 6), HL, ...range(3, i => [C(`step${i + 1}`, `子步骤 ${i + 1}`, 6, { field: `items.${i}.label` }), I(`step${i + 1}Icon`, `子步骤 ${i + 1} 图标`, `items.${i}.icon`)]).flat()] },
    vars: [...range(3, i => [V(`group${i + 1}`, `阶段组 ${i + 1}`, `groups.${i}.label`, 6), V(`group${i + 1}Desc`, `阶段组 ${i + 1} 说明`, `groups.${i}.desc`, 28)]).flat(), V('loop1', '回路 1 说明', 'loops.0.2', 6), V('loop2', '回路 2 说明', 'loops.1.2', 6)] });

  define('bridge', { subcategory: 'frameworks', pattern: 'state-transformation', useWhen: ['Map four inputs through three layers to four outputs'],
    ai: 'Two fixed sides (goal and solution) joined by three middle layers.',
    rows: { variable: 'sides', keys: ['left', 'right'], label: '两端', min: 2, max: 2, columns: [L('label', '名称', 8), C('sub', '副标题', 10), I(), ...range(4, i => C(`item${i + 1}`, `条目 ${i + 1}`, 8, { field: `items.${i}.label` }))] },
    vars: range(3, i => [V(`layer${i + 1}`, `中间层 ${i + 1}`, `middle.${i}.title`, 6), V(`layer${i + 1}Desc`, `中间层 ${i + 1} 说明`, `middle.${i}.desc`, 18)]).flat() });

  define('zones', { subcategory: 'frameworks', useWhen: ['Explain four widening zones and what happens in each'],
    ai: 'Four zones from inside out, each with up to four notes.',
    rows: { variable: 'zones', field: 'zones', label: '区域', min: 4, max: 4, columns: [L('label', '区域', 6), C('sub', '副标题', 10), LIST('notes', '说明', 4, 10, undefined, '\n')] } });

  define('radial', { subcategory: 'frameworks', useWhen: ['Explain a center with 2–3 directions, each with two groups'],
    ai: 'A center, its directions, and two groups of items per direction.',
    rows: { variable: 'keys', field: 'keys', label: '方向', min: 2, max: 3, columns: [L('label', '方向', 6), I(), ...range(2, i => [C(`group${i + 1}`, `分组 ${i + 1}`, 6, { field: `children.${i}.label` }), LIST(`group${i + 1}Items`, `分组 ${i + 1} 要点`, 3, 6, `children.${i}.items`)]).flat()] },
    vars: [V('title', '标题', 'title', 12), V('tagline', '副标题', 'tagline', 16), V('centerLabel', '中心', 'center.label', 6), V('centerSub', '中心副标题', 'center.sub', 10)] });

  define('bowtie', { subcategory: 'frameworks', pattern: 'state-transformation', useWhen: ['Explain how many tasks converge into one turning point and fan out into new roles'],
    ai: 'Two fixed sides joined by a central turning point; figures are illustrative.',
    rows: { variable: 'sides', keys: ['left', 'right'], label: '两侧', min: 2, max: 2, columns: [L('title', '标题', 10), C('sub', '副标题', 10), C('figure', '数字', 6), C('figureLabel', '数字说明', 16), ...range(6, i => [C(`item${i + 1}`, `条目 ${i + 1}`, 6, { field: `items.${i}.label` }), C(`item${i + 1}Desc`, `条目 ${i + 1} 说明`, 10, { field: `items.${i}.desc` })]).flat()] },
    vars: [V('centerLabel', '转折点', 'center.label', 8), V('centerSub', '转折点副标题', 'center.sub', 24), VI('centerIcon', '转折点图标', 'center.icon', true)] });

  define('cube', { resolve: '^extra', subcategory: 'frameworks', useWhen: ['Explain four strategies on two axes plus a third constraint'],
    ai: 'Four cells on two axes, a third axis and an extra strategy.',
    rows: { variable: 'cells', field: 'cells', label: '象限', min: 4, max: 4, columns: [L('title', '名称', 4), C('desc', '说明', 18), I(), HL] },
    vars: [...['y', 'x', 'z'].map(a => [V(`${a}Label`, `${a.toUpperCase()} 轴名称`, `${a}.label`, 6), V(`${a}Low`, `${a.toUpperCase()} 轴低端`, `${a}.low`, 4), V(`${a}High`, `${a.toUpperCase()} 轴高端`, `${a}.high`, 4)]).flat(), V('extraTitle', '附加策略', 'extra.title', 4), V('extraDesc', '附加策略说明', 'extra.desc', 22)] });

  define('loops', { subcategory: 'frameworks', useWhen: ['Explain six stages iterated in three overlapping loops'],
    ai: 'Six stages, the hand-offs between them, and three loops spanning stage ranges (0–5).',
    rows: { variable: 'phases', field: 'phases', label: '回路', min: 3, max: 3, columns: [L('label', '回路', 4), { ...N('from', '起始阶段', 0, 5), integer: true }, { ...N('to', '结束阶段', 0, 5), integer: true }, HL] },
    vars: [...range(6, i => V(`stage${i + 1}`, `阶段 ${i + 1}`, `stages.${i}`, 6)), ...range(6, i => V(`edge${i + 1}`, `衔接 ${i + 1}`, `edges.${i}`, 4))] });

  define('nested', { subcategory: 'frameworks', useWhen: ['Explain 2–4 stages that each contain the previous one'],
    ai: 'Nested stages from smallest to largest, each with a note above or below.',
    rows: { variable: 'items', field: 'items', label: '层次', min: 2, max: 4, columns: [L('label', '名称', 4), C('note', '说明', 12), I(), C('side', '说明位置', 4, { options: [{ value: 'up', label: '上方' }, { value: 'down', label: '下方' }] }), HL] } });

  // Default camera move per diagram (others use 平稳); users may pick another. Content focus is on by default.
  const CAMERA = {
    overhead: ['rings', 'orbit', 'hub', 'radial', 'funnel', 'cycle'],
    dimension: ['architecture'],
  };
  for (const [camera, types] of Object.entries(CAMERA)) for (const type of types) if (SD.specs[type]) SD.specs[type].camera = camera;

  // Latin copy is wider in characters; the shared content model also enforces actual writing width.
  const roomy = n => (typeof n === 'number' ? Math.ceil(n * 2) : n);
  for (const spec of Object.values(SD.specs)) {
    if (spec.rows) spec.rows.columns = spec.rows.columns.map(c => ({ ...c, maxLength: roomy(c.maxLength), ...(c.list ? { list: { ...c.list, itemMaxLength: roomy(c.list.itemMaxLength) } } : {}) }));
    spec.vars = (spec.vars || []).map(v => ({ ...v, maxLength: roomy(v.maxLength), ...(v.list ? { list: { ...v.list, itemMaxLength: roomy(v.list.itemMaxLength) } } : {}) }));
  }

  // Card and poster copy, one set for both layouts: eyebrow (poster), title, subtitle, note (card). It frames the
  // diagram and is not part of its animation. Defaults are the diagram's name and description; "" hides a line.
  for (const [type, spec] of Object.entries(SD.specs)) {
    const meta = (SD.META && SD.META[type]) || {};
    const copy = [
      ['copyEyebrow', '眉标（海报）', 'copy.eyebrow', meta.en, 12], ['copyTitle', '标题（卡片、海报）', 'copy.title', meta.zh, 14],
      ['copySubtitle', '副标题（卡片、海报）', 'copy.subtitle', meta.desc, 60], ['copyNote', '底部说明（卡片）', 'copy.note', '', 40],
    ];
    spec.vars = [...(spec.vars || []), ...copy.map(([id, label, field, value, max]) => ({ ...V(id, label, field, Math.max(max, Array.from(value || '').length)), default: value || '' }))];
  }
})();
