// Author native video components from the engine: node tools/author.mjs [type ...]
// Renders each diagram at its designed maximum in a browser (text needs real font metrics), binds row text to
// the component data, and writes src/<name>/<name>.html + registry-item.json. The runtime keeps these nodes in
// step with the variables; the gallery keeps drawing the same engine in SVG mode.
//   CHROME_PATH=/path/to/chrome node tools/author.mjs timeline
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// HyperFrames owns the contract. Standalone packs carry a generated, dependency-free copy.
const adapterPath = new URL('../hyperframes/ai-adapter.mjs', import.meta.url);
const core = fileURLToPath(new URL('../../../vendor/hyperframes/packages/core/', import.meta.url));
const source = readFileSync(join(core, 'src/registry/componentContent.ts'), 'utf8');
writeFileSync(adapterPath, '// Generated from @hyperframes/core/src/registry/componentContent.ts; edit that source.\n' + stripTypeScriptTypes(source).replace(/[ \t]+$/gm, ''));
const { withBudgets, schema, guide, toJSON } = await import(adapterPath);
const AI_RUNTIME = 'window.StageComponentContent=(()=>{' + readFileSync(adapterPath, 'utf8').replace(/\bexport /g, '')
  + ';return {fromJSON,toJSON,schema,guide,validateComponentVariables,parseComponentTextList};})();';

// What concludes each scene, for components that have a conclusion (timing.resolve).
// Relations and value meanings the schema cannot say on its own, in the words an AI should follow.
const RULES = {
  state: 'transitions 是数组 [{"from": 状态 id, "to": 状态 id, "label": 短说明}]，1～10 条；同一方向不重复；每个状态最多一条自循环。initial 是起始状态的 id。相邻的下一个状态画直线，跳过的在上方画弧，回退的在下方画弧，无需指定位置。',
  swimlane: '每个步骤的 lane 是 lane1 / lane2 / lane3（从上到下），col 是 0～3；同一 lane 同一 col 只能有一个步骤。links 是数组 [{"from": 步骤 id, "to": 步骤 id, "label": 短说明}]，最多 8 条，不连自己、不重复。',
  architecture: '每层 1～4 个节点，节点必须有全局唯一的稳定 id。links 为 [{"from":节点 id,"to":节点 id,"label"?:短说明}]，0～12 条，连接同层或后面的层；改名称不影响连线。',
  pipeline: '2～7 个节点，links 为 [{"from":节点 id,"to":节点 id,"label"?:短说明}]，1～10 条；不连自己、不重复，不允许循环依赖。',
  sequence: '每条消息的 from / to 写 actor1～actor5，对应 actors 数组的第 1～5 个参与者；改参与者名称不影响消息。from 与 to 相同表示自处理。',
  matrix: '每行 values 固定 3 个，对应 3 个对比列：2 = 全面支持，1 = 部分支持，0 = 不支持，也可以写短文字（如价格）。',
  quadrant: 'x、y 是 0～1 的位置（0 = 低端，1 = 高端），不是像素。',
  roadmap: 'start / end 是 0～4 的周期位置；没有 end 表示里程碑。',
  scurve: 'at 是 0～1 的曲线位置；curve 是 1 或 2（第 2 条曲线是结论，最后出现）。',
  journey: 'level 是 0～1 的体验高低（定性位置，不是数据）。',
  valley: 'x、y 是 0～1 的位置，x 依次递增。',
};
const CONCLUSION = { venn: '交集', funnel: '3 个产出', matrix: '合计数字', scurve: '第二曲线', diamond: '中心交汇', valley: '两个结局', cube: '附加策略' };

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireProducer = createRequire(new URL('../../../vendor/hyperframes/packages/producer/package.json', import.meta.url));
const { default: puppeteer } = await import(pathToFileURL(requireProducer.resolve('puppeteer')).href);
const engine = name => readFileSync(join(lib, 'engine', `${name}.js`), 'utf8');
const RENDERERS = ['essentials', 'hero', 'systems', 'frameworks'];
const ALL = [AI_RUNTIME, ...['core', ...RENDERERS, 'native', 'specs', 'component'].map(engine)].join('\n');
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&family=Inter+Tight:wght@500;600;700;800&family=Instrument+Serif&family=Doto:wght@700;900&family=DotGothic16&display=swap';

const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONT_URL}"></head><body><script>${ALL}</script></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// English names from the gallery translations give sample items readable ids ("project-kickoff", not "row-1"),
// which is what an AI sees in the example and copies when it writes timing.
const english = (() => { const w = {}; try { new Function('window', readFileSync(join(lib, 'gallery-i18n.js'), 'utf8'))(w); } catch {} return (w.StageGalleryI18n || {}).text || {}; })();

const types = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => Object.keys(window.StageDiagrams.specs));
const layoutProblems = [];
for (const type of types) {
  const a = await page.evaluate(([type, english]) => {
    const SD = window.StageDiagrams, spec = SD.specs[type], sample = JSON.parse(JSON.stringify(SD.SAMPLES[type]));
    // A plain-string item is its own label ("items.2.label" on "高校").
    const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : typeof v === 'string' && k === 'label' ? v : v[k]), o);
    const put = (o, path, value) => { const keys = path.split('.'); keys.slice(0, -1).reduce((v, k, i) => (v[k] = v[k] || (/^\d+$/.test(keys[i + 1]) ? [] : {})), o)[keys.at(-1)] = value; };
    const r = spec.rows, rows = r.keys ? r.keys.map(key => get(sample, key)) : get(sample, r.field) || [];
    // Author every row slot the layout supports; extra slots repeat the sample and stay hidden until used.
    // Keyed rows (left / right) are fixed slots and are authored as they are.
    // Only renderers with per-row units (r0, r1, …) can hide unused slots; the others are authored as they are
    // and rebuild at runtime when a count changes.
    const units = !!SD.native.render(type, sample, { skin: 'keynote', chrome: 'none' }, 'sd').root.querySelector('[data-u^="r"]');
    const padded = r.keys || !units ? rows : Array.from({ length: r.max }, (_, i) => {
      const row = JSON.parse(JSON.stringify(rows[i % rows.length]));
      for (const c of r.columns.filter(column => column.list)) {
        const input = get(row, c.field || c.id) || [];
        put(row, c.field || c.id, Array.from({ length: c.list.maxItems }, (_, leaf) => input[leaf % input.length] || '要点'));
      }
      return { ...row, ...(i >= rows.length ? { hl: false, now: false } : {}) };
    });
    const authored = JSON.parse(JSON.stringify(sample));
    if (!r.keys && units) put(authored, r.field, padded);
    const out = SD.native.render(type, authored, { skin: 'keynote', chrome: 'none' }, 'sd');
    out.over.className = 'sd-over-native';
    const text = v => (Array.isArray(v) ? null : v == null ? null : String(v));
    // Canvas text ↔ variable: in document order every text node binds to the first unused row cell or field
    // with exactly its text, so canvas edits write the same variable the form edits (equal texts stay distinct).
    const scalars = (spec.vars || []).filter(v => !v.icon && !v.list && v.type !== 'number');
    const pointers = [
      ...padded.flatMap((row, i) => r.columns.filter(c => !c.bool && !c.icon && !c.list && c.type !== 'number')
        .map(c => ({ raw: text(get(row, c.field || c.id)), pointer: `/${r.variable}/rows/${i}/${c.id}` }))),
      ...scalars.map(v => ({ raw: text(get(sample, v.field || v.id)), pointer: `/${v.id}`, id: v.id })),
    ].filter(p => p.raw);
    const used = new Set(), bound = new Set();
    for (const t of out.root.querySelectorAll('.sd-text')) {
      const raw = t.getAttribute('data-raw') ?? t.textContent;
      const p = pointers.find(candidate => !used.has(candidate) && candidate.raw === raw);
      if (!p) continue;
      used.add(p);
      t.setAttribute('data-var-text', p.pointer);
      if (p.id && !bound.has(p.id)) { bound.add(p.id); t.setAttribute('data-ipw-ai-slot', p.id); }
    }
    // A central icon field also marks the real native vector; other fields are edited through the form.
    const centralIcon = out.root.querySelector('[data-u="center"] svg .ico')?.closest('[data-hf-edit-as-unit]');
    const iconVariable = (spec.vars || []).find(v => v.icon && v.central);
    if (iconVariable && centralIcon) { centralIcon.setAttribute('data-ipw-ai-slot', iconVariable.id); bound.add(iconVariable.id); }
    const slotted = (spec.vars || []).map(v => v.id).filter(id => bound.has(id));
    out.root.querySelectorAll('[data-u]').forEach(node => {
      const row = /^r(\d+)/.exec(node.getAttribute('data-u'));
      if (row) { node.setAttribute('data-ipw-motion-event', `step-${Number(row[1]) + 1}`); node.setAttribute('data-ipw-animation-reference', `step-${Number(row[1]) + 1}`); }
    });
    const join = (c, v) => JSON.stringify(v.map(x => (x && typeof x === 'object' ? x.label : x)));
    const cell = (c, item) => { const v = get(item, c.field || c.id); return c.bool ? (v ? 'yes' : 'no') : v == null ? '' : c.type === 'number' ? Number(v) : Array.isArray(v) ? join(c, v) : String(v); };
    // Item ids: the item's own key when the component has one (it is what relations reference), otherwise a slug
    // of its English name; unique, short, ASCII.
    const keyCol = r.columns.find(c => (c.field || c.id) === 'id'), labelCol = r.columns.find(c => c.role === 'label');
    const taken = new Set();
    const idFor = (item, i) => {
      if (keyCol) return cell(keyCol, item);
      const name = labelCol ? cell(labelCol, item) : '', en = english[name] || (/^[\x20-\x7e]+$/.test(name) ? name : '');
      let id = en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 3).join('-').slice(0, 24) || `item-${i + 1}`;
      if (!/^[a-z0-9]/.test(id)) id = `item-${i + 1}`;
      while (taken.has(id)) id = `${id}-${i + 1}`;
      taken.add(id);
      return id;
    };
    const defaults = { version: 1, kind: 'category-value', rows: rows.map((item, i) => ({ id: idFor(item, i), ...Object.fromEntries(r.columns.map(c => [c.id, cell(c, item)])) })) };
    const varDefaults = Object.fromEntries((spec.vars || []).map(v => { const x = get(sample, v.field || v.id); return [v.id, v.default !== undefined ? v.default : v.type === 'boolean' ? !!x : v.json ? JSON.stringify(x) : v.type === 'number' ? Number(x ?? 0) : Array.isArray(x) ? join(v, x) : x == null ? '' : String(x)]; }));
    return { slotted, varDefaults, contract: SD.component.contract(spec), main: out.root.outerHTML, over: out.over.outerHTML, defs: out.defs, camera: out.camera, css: SD.native.css('.sd-root'), meta: SD.META[type], icons: Object.keys(SD.icons), defaults, spec: JSON.parse(JSON.stringify(spec, (k, v) => (typeof v === 'function' ? undefined : v))) };
  }, [type, english]);
  const manifest = writeComponent(type, a);
  const checked = await page.evaluate(({ model }) => {
    const SD = window.StageDiagrams, spec = SD.specs[model.type], contract = window.StageComponentContent;
    const roundTrip = contract.fromJSON(model, contract.toJSON(model, model.defaults));
    if (roundTrip.errors.length) return [{ case: 'round-trip', issues: roundTrip.errors }];
    if (JSON.stringify(contract.toJSON(model, roundTrip.values)) !== JSON.stringify(contract.toJSON(model, model.defaults))) return [{ case: 'round-trip', issues: ['Content was lost'] }];
    const cases = [{ name: 'default', values: model.defaults }];
    const initial = JSON.parse(model.defaults[model.rows.variable]);
    if (model.rows.keys) {
      const columns = model.rows.columns.filter(col => col.required || col.role === 'label');
      const rows = initial.rows.map(row => Object.fromEntries([['id', row.id], ...columns.map(col => [col.id, row[col.id]])]));
      cases.push({ name: 'cleared-fixed-details', values: { ...model.defaults, [model.rows.variable]: JSON.stringify({ ...initial, rows }) } });
    }
    if (!model.rows.keys) for (const count of new Set([model.rows.min, model.rows.max])) {
      const rows = Array.from({ length: count }, (_, i) => {
        const row = { ...initial.rows[i % initial.rows.length], id: `item-${i + 1}` };
        for (const col of model.rows.columns) {
          if (col.field === 'id') row[col.id] = row.id;
          if (col.bool) row[col.id] = 'no';
          if (col.role === 'label') row[col.id] = `条目${i + 1}`;
        }
        if (model.type === 'quadrant') { row.x = .15 + .7 * i / Math.max(1, count - 1); row.y = i % 2 ? .7 : .3; }
        if (model.type === 'scurve') { row.at = .1 + .8 * i / Math.max(1, count - 1); row.curve = 1; }
        if (model.type === 'swimlane') { row.lane = `lane${i % 3 + 1}`; row.col = Math.floor(i / 3); }
        return row;
      });
      const values = { ...model.defaults, [model.rows.variable]: JSON.stringify({ ...initial, rows }) };
      if (['state', 'pipeline', 'swimlane'].includes(model.type)) {
        values[model.type === 'state' ? 'transitions' : 'links'] = JSON.stringify(rows.slice(1).map((row, i) => ({ from: rows[i].id, to: row.id, label: '下一步' })));
        if (model.type === 'state') values.initial = rows[0].id;
      }
      if (model.type === 'architecture') values.links = '[]';
      cases.push({ name: `rows-${count}`, values });
    }
    if (model.type === 'state') {
      const rows = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, key: `s${i}`, label: `状态${i}`, icon: 'spark' }));
      const pairs = [[0,2],[0,3],[0,4],[0,5],[1,3],[1,4],[1,5],[2,4],[2,5],[3,5]];
      cases.push({ name: 'dense-10-transitions', values: { ...model.defaults, states: JSON.stringify({ ...initial, rows }), initial: 's0', transitions: JSON.stringify(pairs.map(([from,to],i)=>({from:`s${from}`,to:`s${to}`,label:`L${i}`}))) } });
    }
    const stage = document.createElement('div'); stage.className = 'sd-root';
    stage.setAttribute('skin', 'keynote'); stage.style.cssText = 'position:relative;width:1200px;height:675px';
    const style = document.createElement('style'); style.textContent = SD.native.css('.sd-root');
    document.head.appendChild(style); document.body.appendChild(stage);
    const problems = [];
    try {
      for (const item of cases) {
        const validation = contract.validateComponentVariables(model, item.values);
        if (validation.errors.length) { problems.push({ case: item.name, issues: validation.errors }); continue; }
        const prepared = SD.component.toData(spec, item.values, (_, value) => JSON.parse(value).rows);
        if (item.name === 'cleared-fixed-details') for (const key of model.rows.keys) {
          const side = prepared.data[key];
          if (side.items?.length || side.metric || side.sub || side.figure) problems.push({ case: item.name, issues: ['Cleared editable details returned from the example'] });
        }
        for (const layout of ['full', 'card']) {
          const issues = SD.native.preflight(SD.native.render(model.type, prepared.data, { skin: 'keynote', chrome: 'none', layout }, 'sd'), stage);
          if (issues.length) problems.push({ case: `${item.name}-${layout}`, issues });
        }
      }
      return problems;
    } finally { stage.remove(); style.remove(); }
  }, { model: manifest.visualComponent.ai.model });
  if (checked.length) layoutProblems.push({ type, cases: checked });
}
await browser.close();
if (layoutProblems.length) { console.error(JSON.stringify(layoutProblems, null, 2)); process.exitCode = 1; }

function rendererFile(type) {
  return RENDERERS.find(f => engine(f).includes(`SD.register('${type}'`));
}

// The AI editing surface (hyperframes/ai-adapter.mjs): one natural-shape object { content, copy, timing, look },
// its JSON Schema, a short guide and a real example, all derived from the same component model.
function aiSurface(type, spec, a, data, duration, variables) {
  const defaults = Object.fromEntries(variables.map(v => [v.id, v.default]));
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const model = withBudgets({
    type, title: a.meta.zh, desc: a.meta.desc, duration, kind: data.kind, focus: !!spec.focus, resolve: !!CONCLUSION[type], resolveLabel: CONCLUSION[type], rules: RULES[type],
    rows: { ...pick(spec.rows, ['variable', 'field', 'keys', 'min', 'max', 'label']), columns: spec.rows.columns.map(c => pick(c, ['id', 'labelZh', 'field', 'role', 'type', 'required', 'min', 'max', 'integer', 'maxLength', 'list', 'bool', 'level', 'icon', 'options'])) },
    vars: (spec.vars || []).map(v => pick(v, ['id', 'label', 'field', 'type', 'required', 'min', 'max', 'integer', 'maxLength', 'list', 'icon', 'bool', 'json', 'jsonSchema', 'options', 'description'])),
    icons: a.icons, defaults, lookDefaults: { layout: 'full', skin: 'keynote', camera: 'auto' },
    copyDefaults: pick(defaults, ['copyEyebrow', 'copyTitle', 'copySubtitle', 'copyNote']),
  });
  coverDemoLanguages(model);
  return { guide: guide(model), example: toJSON(model, defaults), schema: schema(model), model };
}

// Budgets come from the Chinese sample; the gallery also shows each diagram in English, and those translations
// render correctly. Each budget therefore covers the widest demo text in either language.
function coverDemoLanguages(model) {
  const width = s => Array.from(String(s)).reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 1 : 0.55), 0);
  const parts = v => String(v).split(/\n|、/).map(x => x.trim()).filter(Boolean);
  const en = v => [english[v] ?? '', ...parts(v).map(x => english[x] ?? '')].filter(Boolean);
  const cover = (f, raw) => {
    if (!f.budget) return;
    const widest = Math.max(0, ...raw.filter(x => typeof x === 'string' && x).flatMap(x => (f.list ? parts(x).flatMap(en) : en(x))).map(width));
    if (widest > f.budget) f.budget = Math.ceil(widest);
  };
  let rows = [];
  try { rows = JSON.parse(model.defaults[model.rows.variable]).rows || []; } catch {}
  for (const c of model.rows.columns) cover(c, rows.map(r => r[c.id]));
  for (const v of model.vars) cover(v, [model.defaults[v.id]]);
}

function writeComponent(type, a) {
  const spec = a.spec, name = spec.name, dir = join(lib, 'src', name), duration = spec.duration || 10;
  const data = a.contract;
  const option = (value, label) => ({ value, label });
  const variables = [
    { id: spec.rows.variable, label: spec.rows.label, type: 'string', default: JSON.stringify(a.defaults), update: 'live', maxLength: 12000 },
    ...(spec.vars || []).map(({ field, icon, central, required, list, json, jsonSchema, bool, ...variable }) => ({ ...variable, default: a.varDefaults[variable.id], update: 'live', ...(icon ? { type: 'enum', options: a.icons.map(value => ({ value, label: value })) } : {}), ...(list && !variable.description ? { description: 'JSON 文本数组，标点保留；也可使用已有的分隔文本。' } : {}) })),
    { id: 'skin', label: '视觉风格', type: 'enum', default: 'keynote', update: 'live', options: [option('keynote', '发布会'), option('cinematic', '电影感'), option('editorial', '杂志'), option('dot', '点阵')] },
    { id: 'camera', label: '镜头', type: 'enum', default: 'auto', update: 'live', description: spec.focus ? '平稳、俯视、立体是一段完整连贯的运动；聚焦跟随讲解逐站推进。开场和结尾始终是完整画面。' : '每个镜头都是一段完整连贯的运动：开场、推进、回到正面全景停留、收尾；开场和结尾始终是完整画面。', options: [option('auto', '自动'), option('steady', '平稳'), option('overhead', '俯视'), option('dimension', '立体'), ...(spec.focus ? [option('focus', '聚焦')] : [])] },
    { id: 'layout', label: '布局', type: 'enum', default: 'full', update: 'live', options: [option('full', '完整'), option('card', '卡片'), option('poster', '海报')] },
    { id: 'chrome', label: '显示角标', type: 'boolean', default: false, update: 'live' },
    { id: 'fx', label: '光效与粒子', type: 'boolean', default: true, update: 'live' },
    { id: 'motionCueTimes', label: '节拍时间', type: 'string', default: '{}', update: 'live', maxLength: 2000, description: '每行出现的秒数，键用行的 id（重排不错位），也可用 step-N；"resolve" 是结论出现的秒数。如 {"kickoff":1.2,"beta":3.5,"resolve":9.5}。每行至少间隔 1.4 秒，结尾保留 1 秒全景。' },
  ];
  const defaults = Object.fromEntries(variables.map(v => [v.id, v.default]));
  // One custom element per build and renderer file: components drawn by different renderer files can share a page.
  const tag = `stage-diagram-${createHash('sha256').update(ALL).digest('hex').slice(0, 8)}-${rendererFile(type)}`;
  const ai = aiSurface(type, spec, a, data, duration, variables);
  const runtime = [AI_RUNTIME, `window.STAGE_DIAGRAMS_TAG=${JSON.stringify(tag)};`, engine('core'), engine(rendererFile(type)), engine('native'), engine('specs'), engine('component'),
    `(()=>{const root=document.getElementById('root');const runtimeId=root.closest('[data-composition-id]').getAttribute('data-composition-id');
const SD=window.StageDiagrams;
// This build stays private to the component: older copies on the page test window.StageDiagrams.
if(SD&&SD.tag===${JSON.stringify(tag)}){delete window.StageDiagrams;}
SD.component.mount({root,spec:SD.specs[${JSON.stringify(type)}],model:JSON.parse(root.getAttribute('data-component-content-model')),gsap:window.gsap,duration:${duration},id:runtimeId,defaults:${JSON.stringify(defaults)}});})();`].join('\n');
  // Project tokens wrap the authored values: no project setting keeps the original look.
  // Fonts: the default look follows the project; a chosen skin (dot, editorial, cinematic) keeps its own type.
  const css = a.css
    .replace(/([^{}]+)\{([^{}]*)\}/g, (rule, sel, body) => /\[skin=(dot|editorial|cinematic)\]/.test(sel) ? rule
      : `${sel}{${body.replace(/--sd-sans:([^;}]+)/g, '--sd-sans:var(--ipw-font-body,$1)').replace(/--sd-display:([^;}]+)/g, '--sd-display:var(--ipw-font-display,$1)')}}`)
    .replace(/--sd-surface:([^;}]+)/g, '--sd-surface:var(--component-surface,$1)')
    .replace(/--sd-line-2:([^;}]+)/g, '--sd-line-2:var(--component-border,$1)')
    .replace(/--sd-muted:([^;}]+)/g, '--sd-muted:var(--component-muted,$1)')
    + `
.sd-root{--stage-accent:var(--component-accent,var(--ipw-color-primary));--stage-bg-light:var(--ipw-color-bg);--stage-fg-light:var(--component-text,var(--ipw-color-text));--stage-bg-dark:var(--ipw-color-bg);--stage-fg-dark:var(--component-text,var(--ipw-color-text))}`;
  const attr = s => s.replaceAll('&', '&amp;').replaceAll("'", '&#39;');
  const html = `<!doctype html>
<html lang="zh" data-composition-variables='${attr(JSON.stringify(variables.map(({ update, ...v }) => v)))}'>
<head><meta charset="utf-8"><title>${a.meta.zh}</title><link rel="stylesheet" href="${FONT_URL}"></head>
<body><template>
<style>${css}</style>
<div id="root" data-composition-id="${name}" data-component-content-model='${attr(JSON.stringify(ai.model))}' data-width="1920" data-height="1080" data-start="0" data-duration="${duration}" data-hf-live-variables="">
<div class="sd-root" skin="keynote" chrome="none" data-live="" data-ipw-preserve-font="" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden">
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${a.defs}</svg>
<div class="sd-plane" style="position:absolute;left:0;top:0;width:1200px;height:675px;transform:scale(1.6);transform-origin:0 0">
<div class="sd-cam" data-ipw-ai-slot="${spec.rows.variable}" style="position:absolute;left:0;top:0;width:1200px;height:675px">${a.main}</div>
${a.over}
</div></div></div>
<script data-ipw-motion-recipe="1">${runtime.replaceAll('</script', '<\\/script')}</script>
</template></body></html>
`;
  const manifest = {
    name, type: 'hyperframes:block', title: a.meta.zh, description: a.meta.desc, version: '4.0.0', author: 'Stage Diagrams', license: 'MIT',
    tags: ['stage-diagrams', type, spec.group || spec.subcategory], dimensions: { width: 1920, height: 1080 }, duration,
    engine: { name: 'gsap', version: '3.14.2', seekable: true },
    visualComponent: {
      version: 1, category: 'business', subcategory: spec.subcategory, surfaces: ['video'], themeMode: 'inherit',
      ai: { slots: [spec.rows.variable, ...a.slotted], instructions: `${spec.ai} Edit content through the shared form or JSON contract. Colours and fonts follow the project theme.`, ...ai },
      data,
    },
    variables,
    motionRecipe: { ...spec.motionRecipe, usage: { ...spec.motionRecipe.usage, example: { ...spec.motionRecipe.usage.example, values: { [spec.rows.variable]: JSON.stringify(a.defaults), ...a.varDefaults, ...spec.motionRecipe.usage.example.values } } } },
    files: [{ path: `${name}.html`, target: `compositions/${name}/${name}.html`, type: 'hyperframes:composition' }],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), html);
  writeFileSync(join(dir, 'registry-item.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${name}: ${(html.length / 1024).toFixed(0)} KB, rows ${spec.rows.min}-${spec.rows.max}`);
  return manifest;
}
