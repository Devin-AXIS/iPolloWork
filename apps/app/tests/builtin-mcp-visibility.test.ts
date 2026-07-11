import { describe, expect, test } from "bun:test";

import { MCP_QUICK_CONNECT } from "../src/app/constants";

describe("built-in iPolloWalk MCP visibility", () => {
  test("hides internal iPolloWalk MCPs and omits the retired admin connector", () => {
    expect(MCP_QUICK_CONNECT.find((entry) => entry.serverName === "ipollowalk-cloud")?.defaultHidden).toBe(true);
    expect(MCP_QUICK_CONNECT.find((entry) => entry.serverName === "ipollowalk-admin")).toBeUndefined();
    expect(MCP_QUICK_CONNECT.find((entry) => entry.serverName === "ipollowalk-ui")?.defaultHidden).toBe(true);
  });

  test("keeps directory apps visible by default", () => {
    expect(MCP_QUICK_CONNECT.find((entry) => entry.serverName === "notion")?.defaultHidden).toBeUndefined();
    expect(MCP_QUICK_CONNECT.find((entry) => entry.serverName === "linear")?.defaultHidden).toBeUndefined();
  });
});
