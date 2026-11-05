import { describe, expect, it } from "vitest";
import { fromJSON, toJSON, schema, validateComponentVariables, withBudgets, type ComponentContentModel } from "./componentContent";

const relationSchema = { type: "array", minItems: 0, maxItems: 10, items: { type: "object", additionalProperties: false,
  required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string", widthBudget: 6 }, highlighted: { type: "boolean" } } } };
function model(type = "mindmap"): ComponentContentModel {
  return { type, title: "Diagram", duration: 10, kind: "category-value", lookDefaults: { layout: "full", skin: "keynote", camera: "auto" },
    rows: { variable: "rows", field: "branches", label: "Branches", min: 2, max: 3, columns: [
      { id: "label", required: true, maxLength: 20 }, { id: "leaves", field: "items", list: { maxItems: 3, itemMaxLength: 20, separators: "、,，\n" } },
      { id: "child", field: "children.0.label", maxLength: 20 }, { id: "childIcon", field: "children.0.icon", icon: true },
    ] }, vars: [], icons: ["spark"], defaults: { rows: JSON.stringify({ version: 1, kind: "category-value", rows: [
      { id: "a", label: "Alpha", leaves: '["A,B","C"]', child: "Child" }, { id: "b", label: "Beta" },
    ] }), motionCueTimes: "{}", layout: "full", skin: "keynote", camera: "auto" } };
}
describe("shared component content contract", () => {
  it("keeps stable state references independent of text width budgets", () => {
    const m = model("state"), id = "a".repeat(32);
    m.rows.columns = [{ id: "label", required: true, maxLength: 20 }];
    m.defaults.rows = JSON.stringify({ version: 1, kind: m.kind, rows: [{ id, label: "Alpha" }, { id: "b", label: "Beta" }] });
    m.vars = [{ id: "initial", maxLength: 32 }, { id: "transitions", json: true, jsonSchema: relationSchema }];
    m.defaults.initial = id; m.defaults.transitions = JSON.stringify([{ from: id, to: "b" }]);
    const bounded = withBudgets(m);
    expect(bounded.vars[0]?.budget).toBeUndefined();
    expect(fromJSON(bounded, toJSON(bounded, m.defaults)).errors).toEqual([]);
  });
  it("preserves punctuation, real booleans and nested content through repeated JSON/form round trips", () => {
    const m = model(), input = toJSON(m, m.defaults);
    for (let i = 0; i < 5; i++) {
      const result = fromJSON(m, input);
      expect(result.errors).toEqual([]);
      expect(toJSON(m, result.values)).toEqual(input);
    }
    expect(JSON.stringify(input)).toContain('"A,B"');
  });
  it("rejects unknown nested fields and extra/empty child slots without returning modified values", () => {
    const m = model();
    for (const children of [[{ label: "Child", custom: true }], [{ label: "A" }, { label: "B" }], [{}]]) {
      const result = fromJSON(m, { content: { branches: [{ id: "a", label: "Alpha", children }, { id: "b", label: "Beta" }] } });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(issue => issue.path.startsWith("/content/branches/0/children"))).toBe(true);
      expect(result.values).toBe(m.defaults);
    }
  });
  it("merges a single keyed side and preserves the other side", () => {
    const m = model(); m.rows.keys = ["left", "right"]; m.rows.field = undefined;
    const before = toJSON(m, m.defaults);
    const result = fromJSON(m, { content: { left: { label: "Changed" } } });
    expect(result.errors).toEqual([]);
    const after = toJSON(m, result.values);
    expect(after.content).toEqual({ left: { id: "a", label: "Changed", leaves: ["A,B", "C"], children: [{ label: "Child" }] }, right: { id: "b", label: "Beta" } });
    expect(before.content).not.toEqual(after.content);
  });
  it("enforces scalar slot counts instead of silently dropping a sixth actor", () => {
    const m = model("sequence"); m.vars = Array.from({ length: 5 }, (_, i) => ({ id: `actor${i + 1}`, field: `actors.${i}.label`, type: "string" }));
    Object.assign(m.defaults, Object.fromEntries(m.vars.map(v => [v.id, "Actor"])));
    const result = fromJSON(m, { content: { actors: Array.from({ length: 6 }, () => ({ label: "Actor" })) } });
    expect(result.errors).toContainEqual(expect.objectContaining({ path: "/content/actors", code: "item_count" }));
    expect(schema(m).properties?.content?.properties?.actors?.maxItems).toBe(5);
  });
  it("rejects fractional columns, invalid intervals and duplicate slots", () => {
    const m = model("swimlane"); m.rows.field = "steps";
    m.rows.columns = [{ id: "label", required: true }, { id: "lane" }, { id: "col", type: "number", min: 0, max: 3, integer: true }];
    m.defaults.rows = JSON.stringify({ version: 1, kind: m.kind, rows: [{ id: "a", label: "A", lane: "lane1", col: 0 }, { id: "b", label: "B", lane: "lane2", col: 1 }] });
    expect(fromJSON(m, { content: { steps: [{ id: "a", label: "A", lane: "lane1", col: .5 }, { id: "b", label: "B", lane: "lane1", col: .5 }] } }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_integer" }), expect.objectContaining({ code: "occupied_slot" })]));
  });
  it("validates relations, labels and pipeline cycles before applying", () => {
    const m = model("pipeline"); m.vars = [{ id: "links", json: true, jsonSchema: relationSchema }];
    m.defaults.links = '[{"from":"a","to":"b"}]';
    for (const [links, code] of [
      [[{ from: "missing", to: "b" }], "unknown_reference"],
      [[{ from: "a", to: "b" }, { from: "b", to: "a" }], "cycle"],
      [[{ from: "a", to: "b", label: "Long long long" }], "too_long"],
      [[{ from: "a", to: "b", highlighted: "yes" }], "not_boolean"],
    ] as const) expect(fromJSON(m, { content: { links } }).errors.some(issue => issue.code === code)).toBe(true);
  });
  it("checks sparse cue interpolation, order and final hold with stable ids", () => {
    const m = model();
    for (const timing of [{ a: 3, b: 1 }, { b: .5 }, { b: 9 }]) expect(fromJSON(m, { timing }).errors.some(issue => issue.code === "timing")).toBe(true);
    const ok = fromJSON(m, { timing: { a: 1, b: 3 } }); expect(ok.errors).toEqual([]);
    expect(toJSON(m, fromJSON(m, { timing: {} }, ok.values).values).timing).toBeUndefined();
  });
  it("uses the same strict rules for flat form writes and rejects unknown row fields", () => {
    const m = model(); const rows = JSON.parse(String(m.defaults.rows)); rows.rows[0].custom = "lost";
    expect(validateComponentVariables(m, { ...m.defaults, rows: JSON.stringify(rows) }).errors).toContainEqual(expect.objectContaining({ code: "unknown_field" }));
    expect(fromJSON(m, JSON.parse('{"content":{"__proto__":{"polluted":true}}}')).errors).toContainEqual(expect.objectContaining({ code: "unknown_field" }));
    expect(Reflect.get({}, "polluted")).toBeUndefined();
  });
});
