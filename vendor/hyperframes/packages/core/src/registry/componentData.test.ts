import { describe, expect, it } from "vitest";
import type { RegistryVisualComponentDataContract } from "./componentData";
import {
  createVisualComponentDataRow,
  formatVisualComponentDataForAi,
  parseVisualComponentData,
  serializeVisualComponentData,
} from "./componentData";

const REGION_CONTRACT: RegistryVisualComponentDataContract = {
  version: 1,
  kind: "region-value",
  mode: "override",
  rowId: "region",
  binding: { variable: "values", encoding: "key-value-list" },
  columns: [
    { id: "region", label: "Region", type: "string", role: "id", required: true },
    { id: "value", label: "Value", type: "number", role: "value", required: true },
  ],
  minRows: 1,
  maxRows: 10,
  valueFormat: { unit: "people/mi²", precision: 1 },
};

describe("visual component data contract", () => {
  it("reports inclusive row number bounds without clamping and respects required and optional blanks", () => {
    const required: RegistryVisualComponentDataContract = { ...REGION_CONTRACT, binding: { variable: "values", encoding: "json" },
      columns: REGION_CONTRACT.columns.map(column => column.id === "value" ? { ...column, min: 0, max: 1 } : column),
    };
    const optional: RegistryVisualComponentDataContract = { ...required, columns: required.columns.map(column => column.id === "value" ? { ...column, required: false } : column) };
    const value = (cell: unknown) => JSON.stringify({ version: 1, kind: "region-value", rows: [{ region: "CA", value: cell }] });
    for (const cell of [0, 1, "0", "1", .5, "0.5"]) {
      const parsed = parseVisualComponentData(required, value(cell));
      expect(parsed.issues).toEqual([]);
      expect(parsed.document.rows[0]?.value).toBe(Number(cell));
    }
    for (const cell of [-.01, 1.01]) {
      for (const contract of [required, optional]) {
        const parsed = parseVisualComponentData(contract, value(cell));
        expect(parsed.issues.map(issue => issue.path)).toEqual(["rows.0.value"]);
        expect(parsed.document.rows[0]?.value).toBe(cell);
      }
    }
    for (const cell of [undefined, "", " "]) {
      expect(parseVisualComponentData(required, value(cell)).issues.map(issue => issue.path)).toEqual(["rows.0.value"]);
      expect(parseVisualComponentData(optional, value(cell)).issues).toEqual([]);
    }
  });
  it("accepts real numbers and numeric strings while rejecting coerced values and required blanks", () => {
    const required: RegistryVisualComponentDataContract = { ...REGION_CONTRACT, binding: { variable: "values", encoding: "json" } };
    const optional: RegistryVisualComponentDataContract = { ...required, columns: required.columns.map(column => column.id === "value" ? { ...column, required: false } : column) };
    const value = (cell: unknown) => JSON.stringify({ version: 1, kind: "region-value", rows: [{ region: "CA", value: cell }] });
    for (const cell of [0, "0", .5, " 2.75 ", "-1"]) {
      const parsed = parseVisualComponentData(required, value(cell));
      expect(parsed.issues).toEqual([]);
      expect(parsed.document.rows[0]?.value).toBe(Number(cell));
    }
    for (const cell of [null, false, true, [], [1], {}, { value: 1 }, "NaN"]) {
      for (const contract of [required, optional]) {
        const parsed = parseVisualComponentData(contract, value(cell));
        expect(parsed.issues.map(issue => issue.path)).toEqual(["rows.0.value"]);
        expect(parsed.document.rows[0]?.value).toBeUndefined();
      }
    }
    for (const cell of [undefined, "", "  ", "\n"]) {
      expect(parseVisualComponentData(required, value(cell)).issues.map(issue => issue.path)).toEqual(["rows.0.value"]);
      const parsed = parseVisualComponentData(optional, value(cell));
      expect(parsed.issues).toEqual([]);
      expect(parsed.document.rows[0]?.value).toBeUndefined();
    }
  });
  it("keeps overflowing branch content intact while reporting declared layout limits", () => {
    const contract: RegistryVisualComponentDataContract = {
      version: 1, kind: "category-value", mode: "replace", rowId: "id",
      binding: { variable: "branches", encoding: "json" }, minRows: 2, maxRows: 6,
      columns: [
        { id: "id", label: "ID", type: "string", role: "id", required: true },
        { id: "label", label: "Branch", type: "string", role: "label", required: true, maxLength: 2 },
        { id: "leaves", label: "Leaves", type: "string", role: "value", list: { maxItems: 2, itemMaxLength: 2, separators: "、,，\n" } },
      ],
    };
    const rows = [{ id: "one", label: "📈甲", leaves: "甲、乙" }, { id: "two", label: "方向", leaves: "甲\n乙" }];
    const value = (items: typeof rows) => JSON.stringify({ version: 1, kind: "category-value", rows: items });
    expect(parseVisualComponentData(contract, value(rows)).issues).toEqual([]);
    const overflow = [{ ...rows[0]!, label: "甲乙丙", leaves: "甲、乙、丙" }, { ...rows[1]!, leaves: "完整内容" }];
    const parsed = parseVisualComponentData(contract, value(overflow));
    expect(parsed.document.rows).toEqual(overflow);
    expect(parsed.issues.map(issue => issue.path)).toEqual(["rows.0.label", "rows.0.leaves", "rows.1.leaves"]);
    expect(parseVisualComponentData(contract, JSON.stringify({ version: 1, kind: "category-value", rows: [{ ...rows[0], leaves: {} }, rows[1]] })).issues[0]?.path).toBe("rows.0.leaves");
    expect(parseVisualComponentData(contract, value(rows.slice(0, 1))).issues[0]?.path).toBe("rows");
    expect(parseVisualComponentData(contract, value(Array.from({ length: 7 }, (_, i) => ({ ...rows[0]!, id: String(i) })))).issues[0]?.path).toBe("rows");
    const ai = JSON.parse(formatVisualComponentDataForAi(contract, value(rows)));
    expect([ai.minRows, ai.maxRows]).toEqual([2, 6]);
    expect(ai.columns[2].list.maxItems).toBe(2);
  });
  it("preserves icon choices and embedded images through the native rows contract", () => {
    const contract: RegistryVisualComponentDataContract = {
      version: 1, kind: "category-value", mode: "replace", rowId: "label",
      binding: { variable: "nodes", encoding: "json" }, minRows: 2, maxRows: 12,
      columns: [
        { id: "label", label: "Name", type: "string", role: "label", required: true },
        { id: "icon", label: "Icon", type: "string", role: "value", options: [{ value: "globe", label: "Globe" }, { value: "bot", label: "Bot" }] },
        { id: "image", label: "Image", type: "string", role: "value", format: "image" },
      ],
    };
    expect(createVisualComponentDataRow(contract).icon).toBe("globe");
    const document = { version: 1 as const, kind: "category-value" as const, rows: [
      { label: "One", icon: "bot", image: "data:image/png;base64,aGVsbG8=" },
      { label: "Two", icon: "globe", image: "" },
    ] };
    const parsed = parseVisualComponentData(contract, serializeVisualComponentData(contract, document));
    expect(parsed.issues).toEqual([]);
    expect(parsed.document).toEqual({ ...document, rows: [document.rows[0], { label: "Two", icon: "globe" }] });
    document.rows[0]!.icon = "unknown";
    expect(parseVisualComponentData(contract, JSON.stringify(document)).issues.length).toBeGreaterThan(0);
  });
  it("normalizes compact registry values into typed AI-readable rows", () => {
    const parsed = parseVisualComponentData(REGION_CONTRACT, "CA:253.9,TX:112.8");

    expect(parsed).toEqual({
      document: {
        version: 1,
        kind: "region-value",
        rows: [
          { region: "CA", value: 253.9 },
          { region: "TX", value: 112.8 },
        ],
      },
      issues: [],
    });
    expect(serializeVisualComponentData(REGION_CONTRACT, parsed.document)).toBe(
      "CA:253.9,TX:112.8",
    );
  });

  it("normalizes route data without exposing its compact storage syntax to AI", () => {
    const contract: RegistryVisualComponentDataContract = {
      version: 1,
      kind: "route-value",
      mode: "replace",
      rowId: "routeId",
      binding: { variable: "routes", encoding: "route-value-list" },
      columns: [
        { id: "from", label: "From", type: "string", role: "source", required: true },
        { id: "to", label: "To", type: "string", role: "target", required: true },
        { id: "value", label: "Volume", type: "number", role: "value", required: true },
      ],
    };

    const parsed = parseVisualComponentData(contract, "Shanghai>Singapore:100");
    expect(parsed.document.rows).toEqual([
      { from: "Shanghai", to: "Singapore", value: 100, routeId: "Shanghai>Singapore" },
    ]);
    expect(serializeVisualComponentData(contract, parsed.document)).toBe("Shanghai>Singapore:100");
  });

  it("normalizes label-detail lists without changing the component storage format", () => {
    const contract: RegistryVisualComponentDataContract = {
      version: 1,
      kind: "category-value",
      mode: "replace",
      rowId: "label",
      binding: { variable: "items", encoding: "label-detail-list" },
      columns: [
        { id: "label", label: "Label", type: "string", role: "label", required: true },
        { id: "detail", label: "Detail", type: "string", role: "value", required: true },
      ],
      minRows: 1,
      maxRows: 4,
    };

    const value = "01::Context|02::Signal|03::Decision|04::Action";
    const parsed = parseVisualComponentData(contract, value);
    expect(parsed.document.rows).toEqual([
      { label: "01", detail: "Context" },
      { label: "02", detail: "Signal" },
      { label: "03", detail: "Decision" },
      { label: "04", detail: "Action" },
    ]);
    expect(serializeVisualComponentData(contract, parsed.document)).toBe(value);
  });

  it("validates JSON documents and reports row-level issues", () => {
    const contract: RegistryVisualComponentDataContract = {
      ...REGION_CONTRACT,
      binding: { variable: "values", encoding: "json" },
    };
    const parsed = parseVisualComponentData(
      contract,
      JSON.stringify({
        version: 1,
        kind: "region-value",
        rows: [
          { region: "CA", value: "not-a-number" },
          { region: "CA", value: 2 },
        ],
      }),
    );

    expect(parsed.issues.map((issue) => issue.path)).toEqual(["rows.0.value", "rows.1.region"]);
  });

  it("creates schema-shaped rows and a deterministic AI contract", () => {
    expect(createVisualComponentDataRow(REGION_CONTRACT)).toEqual({ region: "", value: 0 });
    const description = formatVisualComponentDataForAi(REGION_CONTRACT, "CA:253.9");
    expect(description).toContain('"kind": "region-value"');
    expect(description).toContain('"mode": "override"');
    expect(description).toContain('"allowedOperations"');
    expect(description).toContain('"valid": true');
    expect(description).toContain('"value": 253.9');
    expect(description).not.toContain("key-value-list");
  });
});
