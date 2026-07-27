import { describe, expect, test } from "bun:test";

import { resolveDenDesktopAuthScheme } from "../src/app/lib/den-auth-scheme";

describe("desktop auth protocol scheme", () => {
  test("keeps packaged builds on the production protocol", () => {
    expect(resolveDenDesktopAuthScheme(false)).toBe("ipollowork");
  });

  test("isolates development callbacks from the packaged app", () => {
    expect(resolveDenDesktopAuthScheme(true)).toBe("ipollowork-dev");
  });
});
