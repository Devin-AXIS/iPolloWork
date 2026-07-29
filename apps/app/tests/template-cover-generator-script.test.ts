import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("template cover generator script", () => {
  test("supports configurable browser discovery", () => {
    const source = readFileSync(
      new URL("../../../scripts/generate-template-covers.mjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain("process.env.IPOLLOWORK_COVER_BROWSER");
    expect(source).toContain("process.env.PUPPETEER_EXECUTABLE_PATH");
    expect(source).toContain("process.env.CHROME_PATH");
    expect(source).toContain("resolveBrowserExecutable()");
    expect(source).toContain("No browser executable found");
    expect(source).not.toContain('puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"');
  });
});
