/** The lossless content view shared by component forms, JSON, agents and renderers.
 * Variables remain the persisted source. This module has no DOM or I/O dependencies.
 */
export type ComponentVariableValues = Record<string, string | number | boolean>;
export interface ComponentContentField {
  id: string; field?: string; label?: string; labelZh?: string; role?: string;
  type?: string; required?: boolean; min?: number; max?: number; integer?: boolean;
  maxLength?: number; budget?: number; bool?: boolean; level?: boolean; icon?: boolean;
  json?: boolean; description?: string; jsonSchema?: ComponentContentSchema;
  options?: { value: string; label: string }[];
  list?: { maxItems: number; itemMaxLength: number; separators: string };
}
export interface ComponentContentModel {
  type: string; title: string; desc?: string; duration: number; kind: string;
  focus?: boolean; resolve?: boolean; resolveLabel?: string; rules?: string;
  rows: { variable: string; field?: string; keys?: string[]; min: number; max: number;
    label: string; columns: ComponentContentField[] };
  vars: ComponentContentField[]; icons?: string[]; defaults: ComponentVariableValues;
  lookDefaults: ComponentVariableValues; copyDefaults?: ComponentVariableValues;
}
export interface ComponentContentSchema {
  type?: string; title?: string; description?: string; $schema?: string;
  properties?: Record<string, ComponentContentSchema>; items?: ComponentContentSchema; prefixItems?: ComponentContentSchema[];
  required?: string[]; additionalProperties?: boolean | ComponentContentSchema;
  minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; pattern?: string; enum?: (string | number | boolean)[];
  oneOf?: ComponentContentSchema[]; widthBudget?: number;
}
export interface ComponentContentIssue {
  path: string; code: string; message: string; actual?: unknown; expected?: unknown;
}
export interface ComponentContentResult {
  values: ComponentVariableValues; errors: ComponentContentIssue[]; warnings: ComponentContentIssue[];
}

/** Read the contract embedded in the installed composition, so catalog upgrades cannot change old videos. */
export function isComponentContentModel(v: unknown): v is ComponentContentModel {
  if (!object(v) || typeof v.type !== "string" || typeof v.title !== "string" || typeof v.duration !== "number"
    || !Number.isFinite(v.duration) || v.duration <= 0 || typeof v.kind !== "string" || !object(v.rows)
    || !object(v.defaults) || !object(v.lookDefaults) || !Array.isArray(v.vars)) return false;
  const r = v.rows;
  const field = (f: unknown) => object(f) && typeof f.id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(f.id)
    && (f.field === undefined || typeof f.field === "string" && f.field.split(".").every(k => !["__proto__", "prototype", "constructor"].includes(k)));
  return typeof r.variable === "string" && typeof r.label === "string" && typeof r.min === "number" && typeof r.max === "number"
    && Number.isInteger(r.min) && Number.isInteger(r.max) && r.min >= 1 && r.max >= r.min && r.max <= 48
    && Array.isArray(r.columns) && r.columns.length <= 128 && r.columns.every(field) && v.vars.length <= 128 && v.vars.every(field)
    && Object.values(v.defaults).every(x => typeof x === "string" || typeof x === "boolean" || typeof x === "number" && Number.isFinite(x))
    && (typeof r.field === "string" || Array.isArray(r.keys) && r.keys.every(k => typeof k === "string"));
}

const ALIAS: Record<string, string> = { hl: "highlighted", sub: "subtitle", desc: "description" };
const COPY: Record<string, string> = { eyebrow: "copyEyebrow", title: "copyTitle", subtitle: "copySubtitle", note: "copyNote" };
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const LAYOUTS = ["full", "card", "poster"], SKINS = ["keynote", "cinematic", "dot", "editorial"];
const CAMERAS = ["auto", "steady", "overhead", "dimension", "focus"];
const isIndex = (s: string) => /^\d+$/.test(s);
const seg = (s: string) => ALIAS[s] ?? s;
const pathOf = (f: ComponentContentField) => /\.\d+\.\d+$/.test(f.field ?? "")
  ? [f.id] : (f.field ?? f.id).split(".").map(seg);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const width = (s: string) => Array.from(s).reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0x2e80 ? 1 : .55), 0);
const pointer = (path: string[]) => "/" + path.map(s => s.replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
const get = (v: unknown, path: string[]): unknown => path.reduce<unknown>((x, k) =>
  Array.isArray(x) ? x[Number(k)] : object(x) ? x[k] : undefined, v);
function set(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < path.length; i++) {
    const k = path[i]; if (k === undefined) return;
    if (i === path.length - 1) { Reflect.set(node, k, value); return; }
    let child: unknown = Reflect.get(node, k);
    if (!object(child) && !Array.isArray(child)) {
      child = isIndex(path[i + 1] ?? "") ? [] : {};
      Reflect.set(node, k, child);
    }
    if (object(child) || Array.isArray(child)) node = child;
  }
}
function merge(base: unknown, patch: unknown): unknown {
  if (!object(patch)) return patch;
  const out: Record<string, unknown> = object(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
  return out;
}

/** JSON arrays are the new storage encoding; delimiter strings remain readable for installed v4 components. */
export function parseComponentTextList(value: string, separators: string): string[] {
  if (value.trimStart().startsWith("[")) {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((s): s is string => typeof s === "string")) {
      throw Error("List must be a JSON array of texts");
    }
    return parsed;
  }
  return Array.from(value, ch => separators.includes(ch) ? "\n" : ch).join("")
    .split("\n").map(s => s.trim()).filter(Boolean);
}
function rowsOf(model: ComponentContentModel, values: ComponentVariableValues): Record<string, unknown>[] {
  const raw: unknown = JSON.parse(String(values[model.rows.variable] ?? ""));
  if (!object(raw) || raw.version !== 1 || raw.kind !== model.kind || !Array.isArray(raw.rows) || !raw.rows.every(object)) {
    throw Error("Data document does not match this component");
  }
  return raw.rows;
}
function columnsOf(model: ComponentContentModel) {
  return model.rows.columns.map(c => ({ c, path: (c.field ?? c.id).includes(".")
    ? (c.field ?? c.id).split(".").map(seg) : [seg((c.field ?? c.id) === "id" ? "id" : c.id)] }));
}
function decode(f: ComponentContentField, raw: unknown): unknown {
  if (f.bool) return raw === "yes" || raw === true;
  if (f.json) return typeof raw === "string" ? JSON.parse(raw) : raw;
  if (f.list) return parseComponentTextList(String(raw), f.list.separators);
  if (f.type === "number") return typeof raw === "number" ? raw : Number(raw);
  if (f.level && /^[012]$/.test(String(raw))) return Number(raw);
  return raw;
}
function compact(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter(x => x !== undefined && !(object(x) && Object.values(x).every(y => typeof y === "boolean"))).map(compact);
  return object(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)])) : v;
}
export function toJSON(model: ComponentContentModel, overrides: ComponentVariableValues): Record<string, unknown> {
  const values = { ...model.defaults, ...overrides }, content: Record<string, unknown> = {};
  const rows = rowsOf(model, values), cols = columnsOf(model);
  const items = rows.map(row => {
    const item: Record<string, unknown> = { id: row.id };
    for (const { c, path } of cols) {
      const raw = row[c.id];
      if (raw !== undefined && raw !== "") set(item, path, decode(c, raw));
    }
    return compact(item);
  });
  if (model.rows.keys) model.rows.keys.forEach((key, i) => set(content, key.split(".").map(seg), items[i]));
  else set(content, (model.rows.field ?? model.rows.variable).split(".").map(seg), items);
  for (const f of model.vars) {
    if (Object.values(COPY).includes(f.id)) continue;
    const raw = values[f.id];
    if (raw !== undefined && (raw !== "" || f.bool)) set(content, pathOf(f), decode(f, raw));
  }
  const result: Record<string, unknown> = { content };
  const copy = Object.fromEntries(Object.entries(COPY).filter(([, id]) => values[id] !== undefined && values[id] !== model.copyDefaults?.[id]).map(([k, id]) => [k, values[id]]));
  if (Object.keys(copy).length) result.copy = copy;
  const cues: unknown = JSON.parse(String(values.motionCueTimes ?? "{}"));
  if (!object(cues)) throw Error("Timing must be an object");
  const timing = Object.fromEntries(Object.entries(cues).map(([k, t]) => {
    const step = /^step-(\d+)$/.exec(k);
    return [step ? String(rows[Number(step[1]) - 1]?.id ?? k) : k, t];
  }));
  if (Object.keys(timing).length) result.timing = timing;
  const look = Object.fromEntries(["layout", "skin", "camera"].filter(k => values[k] !== undefined && values[k] !== model.lookDefaults[k]).map(k => [k, values[k]]));
  if (Object.keys(look).length) result.look = look;
  return result;
}

const objectSchema = (): ComponentContentSchema => ({ type: "object", additionalProperties: false, properties: {} });
function fieldSchema(model: ComponentContentModel, f: ComponentContentField): ComponentContentSchema {
  const description = f.labelZh ?? f.label ?? f.id;
  const text: ComponentContentSchema = { type: "string", description,
    ...(f.budget ? { widthBudget: f.budget } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}) };
  if (f.bool) return { type: "boolean", description };
  if (f.json) return { ...f.jsonSchema, description: f.description ?? description };
  if (f.type === "number") return { type: f.integer ? "integer" : "number", description,
    ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}) };
  if (f.list) return { type: "array", maxItems: f.list.maxItems, items: { ...text, minLength: 1, maxLength: f.list.itemMaxLength } };
  if (f.level) return { oneOf: [{ enum: [0, 1, 2] }, text], description };
  if (f.icon) return { ...text, enum: model.icons };
  if (f.options) return { ...text, enum: f.options.map(o => o.value) };
  return text;
}
function place(root: ComponentContentSchema, path: string[], leaf: ComponentContentSchema, required = false): void {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    const k = path[i]; if (k === undefined || isIndex(k)) continue;
    node.properties ??= {};
    if (i === path.length - 1) {
      const previous = node.properties[k];
      node.properties[k] = previous && previous.type === "string" && leaf.type === "string"
        ? { ...leaf, widthBudget: Math.max(previous.widthBudget ?? 0, leaf.widthBudget ?? 0) || undefined,
          maxLength: Math.max(previous.maxLength ?? 0, leaf.maxLength ?? 0) || undefined } : leaf;
      if (required) node.required = [...new Set([...(node.required ?? []), k])];
      return;
    }
    const next = path[i + 1];
    if (next !== undefined && isIndex(next)) {
      const arr = node.properties[k] ??= { type: "array", minItems: 0, maxItems: 0, items: objectSchema() };
      arr.maxItems = Math.max(arr.maxItems ?? 0, Number(next) + 1);
      if (i + 2 === path.length) { arr.items = leaf; arr.minItems = arr.maxItems; return; }
      node = arr.items ??= objectSchema();
    } else node = node.properties[k] ??= objectSchema();
  }
}
export function schema(model: ComponentContentModel): ComponentContentSchema {
  const item = objectSchema();
  place(item, ["id"], { type: "string", pattern: ID.source }, true);
  for (const { c, path } of columnsOf(model)) place(item, path, fieldSchema(model, c), c.required);
  // An existing child must name itself; absent optional children need no placeholder slots.
  const children = (node: ComponentContentSchema): void => {
    for (const child of Object.values(node.properties ?? {})) {
      if (child.type === "array" && child.items?.properties) {
        const label = ["label", "title"].find(k => child.items?.properties?.[k]);
        if (label) child.items.required = [...new Set([...(child.items.required ?? []), label])];
        if (model.type === "architecture" && child.items.properties?.id) {
          child.items.properties.id = { type: "string", pattern: ID.source };
          child.items.required = [...new Set([...(child.items.required ?? []), "id"])];
        }
        child.minItems = model.type === "architecture" || model.type === "orbit" || model.rows.keys ? 1 : 0;
        children(child.items);
      } else children(child);
    }
  };
  children(item);
  if (model.type === "radial" && item.properties?.children) item.properties.children.minItems = 2;
  const content = objectSchema();
  if (model.rows.keys) model.rows.keys.forEach(k => place(content, k.split(".").map(seg), item));
  else place(content, (model.rows.field ?? model.rows.variable).split(".").map(seg), { type: "array", minItems: model.rows.min, maxItems: model.rows.max, items: item });
  for (const f of model.vars) if (!Object.values(COPY).includes(f.id)) place(content, pathOf(f), fieldSchema(model, f), f.required);
  if (model.type === "disc" && content.properties?.groups) {
    const notItems = model.vars.find(f => f.id === "notItems");
    content.properties.groups = { type: "array", minItems: 2, maxItems: 2, prefixItems: [
      { ...objectSchema(), properties: { title: { type: "string" }, segments: notItems ? fieldSchema(model, notItems) : { type: "array", items: { type: "string" }, maxItems: 3 } } },
      { ...objectSchema(), properties: { title: { type: "string" }, segments: { type: "array", minItems: model.rows.min, maxItems: model.rows.max, items: item } } },
    ] };
  }
  // Fixed scalar slots (actors, lanes, outputs, columns...) cannot be silently extended or shortened.
  const fixed = (node: ComponentContentSchema): void => {
    for (const child of Object.values(node.properties ?? {})) {
      if (child.type === "array" && child.items?.properties && (child.maxItems ?? 0) > 0) {
        child.minItems = child.maxItems;
        fixed(child.items);
      } else if (child.properties) fixed(child);
    }
  };
  // Apply only to scalar-owned trees; the main row list retains its min/max and optional children.
  const scalarRoots = new Set(model.vars.filter(f => !f.json && !f.list && !Object.values(COPY).includes(f.id)).map(f => pathOf(f)[0]));
  const rowRoot = model.rows.keys ? null : (model.rows.field ?? model.rows.variable).split(".")[0];
  for (const k of scalarRoots) if (k && k !== rowRoot && !model.rows.keys?.includes(k)) {
    const node = content.properties?.[k];
    if (node?.type === "array" && node.items?.properties) { node.minItems = node.maxItems; fixed(node.items); }
    else if (node) fixed(node);
  }
  const copy = objectSchema();
  for (const [k, limit] of Object.entries({ eyebrow: 12, title: 14, subtitle: 60, note: 40 })) place(copy, [k], { type: "string", widthBudget: limit });
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: `${model.title} (${model.type})`, ...objectSchema(),
    properties: { content, copy,
      timing: { type: "object", additionalProperties: { type: "number", minimum: 0 } },
      look: { ...objectSchema(), properties: { layout: { enum: LAYOUTS }, skin: { enum: SKINS }, camera: { enum: model.focus ? CAMERAS : CAMERAS.filter(c => c !== "focus") } } } } };
}
function validate(s: ComponentContentSchema, v: unknown, path: string[], errors: ComponentContentIssue[]): void {
  const err = (code: string, message: string, expected?: unknown) => errors.push({ path: pointer(path), code, message, actual: v, expected });
  if (s.oneOf) {
    if (!s.oneOf.some(choice => { const e: ComponentContentIssue[] = []; validate(choice, v, path, e); return !e.length; })) err("invalid_value", "Use a supported value");
    return;
  }
  if (s.enum && !s.enum.includes(typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : "")) err("invalid_value", `Use one of: ${s.enum.join(", ")}`, s.enum);
  if (s.type === "object") {
    if (!object(v)) { err("not_object", "Use an object"); return; }
    for (const k of s.required ?? []) if (v[k] === undefined || v[k] === "") errors.push({ path: pointer([...path, k]), code: "required", message: `${k} is required` });
    for (const [k, x] of Object.entries(v)) {
      const child = s.properties && Object.hasOwn(s.properties, k) ? s.properties[k] : undefined;
      if (child) validate(child, x, [...path, k], errors);
      else if (s.additionalProperties === false) errors.push({ path: pointer([...path, k]), code: "unknown_field", message: `Unknown field ${k}; use ${Object.keys(s.properties ?? {}).join(", ")}` });
      else if (object(s.additionalProperties)) validate(s.additionalProperties, x, [...path, k], errors);
    }
  } else if (s.type === "array") {
    if (!Array.isArray(v)) { err("not_array", "Use an array"); return; }
    if (v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? Infinity)) err("item_count", `This layout holds ${s.minItems ?? 0}–${s.maxItems ?? "∞"} items; shorten or split into another scene`, { min: s.minItems, max: s.maxItems });
    v.forEach((x, i) => { const child = s.prefixItems?.[i] ?? s.items; if (child) validate(child, x, [...path, String(i)], errors); });
  } else if (s.type === "string") {
    if (typeof v !== "string") { err("not_text", "Use text"); return; }
    if (s.minLength && !v.trim()) err("required", "Text must not be empty");
    if ((s.maxLength !== undefined && Array.from(v).length > s.maxLength) || (s.widthBudget !== undefined && width(v) > s.widthBudget)) err("too_long", `Shorten text to fit this layout (width ≤ ${s.widthBudget ?? s.maxLength}; English letters use about half a unit)`, { max: s.widthBudget ?? s.maxLength });
    if (s.pattern && !new RegExp(s.pattern).test(v)) err("invalid_id", "Use a short ASCII id (letters, numbers, - or _)");
  } else if (s.type === "number" || s.type === "integer") {
    if (typeof v !== "number" || !Number.isFinite(v)) { err("not_number", "Use a finite number"); return; }
    if (s.type === "integer" && !Number.isInteger(v)) err("not_integer", "Use an integer");
    if (v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) err("out_of_range", `Use a value between ${s.minimum ?? "−∞"} and ${s.maximum ?? "∞"}`);
  } else if (s.type === "boolean" && typeof v !== "boolean") err("not_boolean", "Use true or false");
}
function contentRows(model: ComponentContentModel, content: unknown): Record<string, unknown>[] {
  const raw = model.rows.keys ? model.rows.keys.map(k => get(content, k.split(".").map(seg))) : get(content, (model.rows.field ?? model.rows.variable).split(".").map(seg));
  return Array.isArray(raw) ? raw.filter(object) : [];
}
function semantic(model: ComponentContentModel, content: unknown, errors: ComponentContentIssue[]): void {
  const rows = contentRows(model, content), root = model.rows.keys ? [] : (model.rows.field ?? model.rows.variable).split(".").map(seg);
  const issue = (path: string[], code: string, message: string) => errors.push({ path: pointer(["content", ...path]), code, message });
  const ids = rows.map(r => r.id), seen = new Set<unknown>();
  rows.forEach((r, i) => { if (seen.has(r.id)) issue([...root, String(i), "id"], "duplicate_id", "Item ids must be unique"); seen.add(r.id); });
  const links = (key: string, allowed: unknown[], max: number, min = 0, self = false, ordered = false, dag = false) => {
    const raw = get(content, [key]); if (!Array.isArray(raw)) return;
    if (raw.length < min || raw.length > max) issue([key], "item_count", `${key} holds ${min}–${max} relations`);
    const pairs = new Set<string>(), adjacency = new Map<unknown, unknown[]>();
    raw.forEach((l, i) => {
      if (!object(l)) return;
      for (const end of ["from", "to"]) if (!allowed.includes(l[end])) issue([key, String(i), end], "unknown_reference", `No item with id ${String(l[end])}; use ${allowed.join(", ")}`);
      if (!self && l.from === l.to) issue([key, String(i)], "self_relation", "A relation must connect two different items");
      const pair = `${String(l.from)}>${String(l.to)}`;
      if (pairs.has(pair)) issue([key, String(i)], "duplicate_relation", "Each direction of a pair may appear once");
      pairs.add(pair);
      if (ordered && allowed.indexOf(l.from) >= allowed.indexOf(l.to)) issue([key, String(i)], "backward_relation", "Connect an earlier layer to a later layer");
      adjacency.set(l.from, [...(adjacency.get(l.from) ?? []), l.to]);
    });
    if (dag) {
      const visiting = new Set<unknown>(), visited = new Set<unknown>();
      const cyclic = (id: unknown): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        if ((adjacency.get(id) ?? []).some(cyclic)) return true;
        visiting.delete(id); visited.add(id); return false;
      };
      if (allowed.some(cyclic)) issue([key], "cycle", "Pipeline dependencies must not contain a cycle");
    }
  };
  if (model.type === "state") {
    if (!ids.includes(get(content, ["initial"]))) issue(["initial"], "unknown_reference", "Initial must name an existing state id");
    links("transitions", ids, 10, 1, true);
  }
  if (model.type === "swimlane") {
    const occupied = new Set<string>();
    rows.forEach((r, i) => { const slot = `${String(r.lane)}@${String(r.col)}`;
      if (occupied.has(slot)) issue([...root, String(i), "col"], "occupied_slot", "One step per lane and column"); occupied.add(slot); });
    links("links", ids, 8);
  }
  if (model.type === "pipeline") links("links", ids, 10, 1, false, false, true);
  if (model.type === "architecture") {
    const nodes = rows.flatMap(r => Array.isArray(r.nodes) ? r.nodes.filter(object) : []), nodeIds = nodes.map(n => n.id);
    if (new Set(nodeIds).size !== nodeIds.length) issue([...root], "duplicate_id", "Architecture node ids must be globally unique");
    links("links", nodeIds, 12);
    const layerOf = (id: unknown) => rows.findIndex(r => Array.isArray(r.nodes) && r.nodes.some(n => object(n) && n.id === id));
    const raw = get(content, ["links"]);
    if (Array.isArray(raw)) raw.forEach((l, i) => { if (object(l) && layerOf(l.from) > layerOf(l.to)) issue(["links", String(i)], "backward_relation", "Architecture links must run within a layer or to a later layer"); });
  }
  if (model.type === "roadmap") rows.forEach((r, i) => { if (typeof r.end === "number" && typeof r.start === "number" && r.end <= r.start) issue([...root, String(i), "end"], "invalid_interval", "End must be after start; omit end for a milestone"); });
  if (model.type === "loops") rows.forEach((r, i) => { if (Number(r.from) >= Number(r.to)) issue([...root, String(i), "to"], "invalid_interval", "End stage must follow the start stage (0–5)"); });
  if (model.type === "timeline" && rows.filter(r => r.current === true).length > 1) issue(root, "multiple_current", "Mark at most one milestone as current");
  if (model.type === "valley") rows.forEach((r, i) => { if (i && Number(r.x) <= Number(rows[i - 1]?.x)) issue([...root, String(i), "x"], "out_of_order", "x must strictly increase in reading order"); });
  if (model.type === "scurve") {
    rows.forEach((r, i) => { if (r.curve === 2 && get(content, ["second"]) === false) issue([...root, String(i), "curve"], "hidden_curve", "Enable second before assigning a phase to curve 2"); });
  }
}
function timing(model: ComponentContentModel, input: unknown, rows: Record<string, unknown>[], values: ComponentVariableValues, errors: ComponentContentIssue[]): void {
  if (!object(input)) return;
  const ids = rows.map(r => r.id), factor = ({ restrained: 1.15, balanced: 1, energetic: .85 }[String(values.motionStyle)] ?? 1);
  const beat = 1.4 * factor, times = rows.map((_, i) => .6 + 1.4 * i), anchors: number[] = [];
  const error = (id: string, message: string) => errors.push({ path: pointer(["timing", id]), code: "timing", message });
  for (const [k, t] of Object.entries(input)) {
    if (k === "resolve") { if (!model.resolve) error(k, "This component has no conclusion"); continue; }
    const i = ids.indexOf(k);
    if (i < 0) { error(k, `No item with id ${k}`); continue; }
    if (typeof t === "number") { times[i] = t; anchors.push(i); }
  }
  anchors.sort((a, b) => a - b);
  if (anchors.length) for (let i = 0; i < times.length; i++) {
    if (anchors.includes(i)) continue;
    const prev = anchors.filter(k => k < i).at(-1), next = anchors.find(k => k > i);
    if (prev === undefined && next !== undefined) times[i] = Math.min(times[i] ?? 0, (times[next] ?? 0) - (next - i) * beat);
    else if (prev !== undefined && next === undefined) times[i] = (times[prev] ?? 0) + (i - prev) * beat;
    else if (prev !== undefined && next !== undefined) times[i] = (times[prev] ?? 0) + ((times[next] ?? 0) - (times[prev] ?? 0)) * (i - prev) / (next - prev);
  }
  times.forEach((t, i) => { if (t < 0 || t + beat > model.duration - 1 + .001 || (i && t < (times[i - 1] ?? 0) + beat - .001)) error(String(ids[i]), `Keep rows in order, ${beat.toFixed(2)}s per row, and 1s of full view before ${model.duration}s`); });
  const resolve = input.resolve;
  if (typeof resolve === "number" && (resolve < (times.at(-1) ?? 0) + .7 || resolve > model.duration - 1.6)) error("resolve", "Conclusion must follow the final row and leave 1s for reading");
}
export function fromJSON(model: ComponentContentModel, input: unknown, current: ComponentVariableValues = model.defaults): ComponentContentResult {
  const errors: ComponentContentIssue[] = [], warnings: ComponentContentIssue[] = [], values = { ...model.defaults, ...current };
  if (!object(input)) return { values: current, errors: [{ path: "", code: "not_object", message: "Submit { content?, copy?, timing?, look? }" }], warnings };
  const pending: { value: unknown; path: string[] }[] = [{ value: input, path: [] }];
  let visited = 0;
  while (pending.length) {
    const entry = pending.pop(); if (!entry) break;
    if (++visited > 2048 || entry.path.length > 12) return { values: current, errors: [{ path: pointer(entry.path), code: "too_complex", message: "Shorten this object or split into scenes" }], warnings };
    if (object(entry.value) || Array.isArray(entry.value)) for (const [k, value] of Object.entries(entry.value)) {
      if (["__proto__", "constructor", "prototype"].includes(k)) errors.push({ path: pointer([...entry.path, k]), code: "unknown_field", message: `Unknown field ${k}` });
      pending.push({ value, path: [...entry.path, k] });
    }
  }
  if (errors.length) return { values: current, errors, warnings };
  let base: Record<string, unknown>;
  try { base = toJSON(model, values); } catch (e) { return { values: current, errors: [{ path: "", code: "invalid_current", message: e instanceof Error ? e.message : "Invalid current data" }], warnings }; }
  const merged = merge(base, input);
  if (object(merged) && Object.hasOwn(input, "timing")) merged.timing = input.timing;
  validate(schema(model), merged, [], errors);
  if (!object(merged)) return { values: current, errors, warnings };
  semantic(model, merged.content, errors);
  const rows = contentRows(model, merged.content);
  timing(model, merged.timing ?? {}, rows, values, errors);
  if (errors.length) return { values: current, errors, warnings };
  const cols = columnsOf(model), stored = rows.map((item, i) => {
    const row: Record<string, unknown> = { id: item.id ?? `item-${i + 1}` };
    for (const { c, path } of cols) {
      const v = get(item, path);
      if (v === undefined) continue;
      row[c.id] = c.bool ? (v ? "yes" : "no") : c.list ? JSON.stringify(v) : c.level && typeof v === "number" ? String(v) : v;
    }
    return row;
  });
  values[model.rows.variable] = JSON.stringify({ version: 1, kind: model.kind, rows: stored });
  for (const f of model.vars) {
    if (Object.values(COPY).includes(f.id)) continue;
    const v = get(merged.content, pathOf(f));
    if (v === undefined) { if (!f.required) values[f.id] = ""; continue; }
    if (f.json || f.list) values[f.id] = JSON.stringify(v);
    else if (f.bool) values[f.id] = v === true;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") values[f.id] = v;
  }
  if (object(merged.copy)) for (const [k, id] of Object.entries(COPY)) if (typeof merged.copy[k] === "string") values[id] = merged.copy[k];
  if (object(merged.look)) for (const [k, v] of Object.entries(merged.look)) if (typeof v === "string") values[k] = v;
  values.motionCueTimes = JSON.stringify(merged.timing ?? {});
  return { values, errors, warnings };
}
/** Validate flat form/canvas writes through the same content rules; never change values on rejection. */
export function validateComponentVariables(model: ComponentContentModel, values: ComponentVariableValues): ComponentContentResult {
  try {
    const errors: ComponentContentIssue[] = [], columns = new Set(["id", ...model.rows.columns.map(c => c.id)]);
    rowsOf(model, { ...model.defaults, ...values }).forEach((row, i) => {
      for (const key of Object.keys(row)) if (!columns.has(key)) errors.push({ path: pointer([model.rows.variable, "rows", String(i), key]), code: "unknown_field", message: `Unknown row field ${key}` });
    });
    if (errors.length) return { values: model.defaults, errors, warnings: [] };
    const result = fromJSON(model, toJSON(model, values), values); return { ...result, values: result.errors.length ? model.defaults : values };
  }
  catch (e) { return { values: model.defaults, errors: [{ path: "", code: "invalid_data", message: e instanceof Error ? e.message : "Invalid data" }], warnings: [] }; }
}
export function guide(model: ComponentContentModel): string {
  const r = model.rows;
  return [`${model.title} (${model.type})：${model.desc ?? ""}`,
    `主列表 ${r.keys ? r.keys.join(" / ") : r.field}：${r.min}～${r.max} 个；数组顺序就是讲解顺序。`,
    "读取当前 JSON 和 revision；只提交要改的字段，未提交字段保持原样，数组整体替换。每项保留稳定英文 id。",
    `timing 使用条目 id → 秒；每拍至少 1.4s，场景 ${model.duration}s，末尾保留 1s。${model.resolve ? "resolve 是结论时间。" : "此图没有 resolve。"}`,
    model.rules, "遵守 schema 的数量、层级、引用和文字宽度；错误会返回准确路径，不裁切内容。不要传颜色、像素或动画脚本。"].filter(Boolean).join("\n");
}
export function withBudgets(model: ComponentContentModel): ComponentContentModel {
  const rows = rowsOf(model, model.defaults);
  const add = (f: ComponentContentField, raw: unknown[]): ComponentContentField => {
    if (f.type === "number" || f.bool || f.icon || f.options || f.json || (f.field ?? f.id).split(".").at(-1) === "id" || model.type === "state" && f.id === "initial") return f;
    const strings = raw.filter((x): x is string => typeof x === "string" && x !== "");
    const samples = f.list ? strings.flatMap(x => parseComponentTextList(x, f.list?.separators ?? "\n")) : strings;
    const units = Math.max(0, ...samples.map(width));
    // All empty optional slots still get a finite writing budget from the authored field limit.
    return { ...f, budget: Math.max(4, Math.ceil(units ? units * 1.2 : (f.maxLength ?? f.list?.itemMaxLength ?? 12) / 2)) };
  };
  return { ...model, rows: { ...model.rows, columns: model.rows.columns.map(f => add(f, rows.map(r => r[f.id]))) },
    vars: model.vars.map(f => Object.values(COPY).includes(f.id) ? f : add(f, [model.defaults[f.id]])) };
}
