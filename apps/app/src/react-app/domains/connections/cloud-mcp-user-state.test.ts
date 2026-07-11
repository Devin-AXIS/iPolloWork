declare const afterEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

import {
  __setCloudMcpUserStateStorageForTest,
  clearCloudMcpUnhealthyRemintAttempt,
  readCloudMcpUnhealthyRemintAttempt,
  writeCloudMcpUnhealthyRemintAttempt,
} from "./cloud-mcp-user-state";

const UNHEALTHY_REMINT_ATTEMPT_KEY = "ipollowork.den.mcp.unhealthyRemintAttempt";

function createStorageStub() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
      removeItem(key: string) {
        values.delete(key);
      },
    },
  };
}

afterEach(() => {
  __setCloudMcpUserStateStorageForTest(null);
});

describe("cloud MCP unhealthy re-mint attempt marker", () => {
  test("round-trips and clears the persisted marker", () => {
    const { storage } = createStorageStub();
    __setCloudMcpUserStateStorageForTest(storage);

    expect(readCloudMcpUnhealthyRemintAttempt()).toBe(null);

    writeCloudMcpUnhealthyRemintAttempt({ orgId: "org_1" });
    expect(readCloudMcpUnhealthyRemintAttempt()).toEqual({ orgId: "org_1" });

    clearCloudMcpUnhealthyRemintAttempt();
    expect(readCloudMcpUnhealthyRemintAttempt()).toBe(null);
  });

  test("returns null for corrupt JSON", () => {
    const { storage, values } = createStorageStub();
    __setCloudMcpUserStateStorageForTest(storage);
    values.set(UNHEALTHY_REMINT_ATTEMPT_KEY, "{");

    expect(readCloudMcpUnhealthyRemintAttempt()).toBe(null);
  });

  test("returns the stored org so callers can compare org mismatches", () => {
    const { storage } = createStorageStub();
    __setCloudMcpUserStateStorageForTest(storage);

    writeCloudMcpUnhealthyRemintAttempt({ orgId: "org_a" });

    expect(readCloudMcpUnhealthyRemintAttempt()).toEqual({ orgId: "org_a" });
  });
});
