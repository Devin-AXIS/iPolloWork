declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => { toBe: (expected: unknown) => void };

import { shouldRefreshTemplateCatalogOnOpen } from "./template-market-refresh";

describe("template market refresh", () => {
  test("refreshes when the market opens from a closed state", () => {
    expect(shouldRefreshTemplateCatalogOnOpen(true, false)).toBe(true);
  });

  test("does not refresh while already open or closed", () => {
    expect(shouldRefreshTemplateCatalogOnOpen(true, true)).toBe(false);
    expect(shouldRefreshTemplateCatalogOnOpen(false, false)).toBe(false);
  });
});
