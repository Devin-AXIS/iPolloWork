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
