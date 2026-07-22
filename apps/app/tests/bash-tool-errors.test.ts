import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Bash tool errors", () => {
  test("renders the concrete error and distinguishes an interrupted command", () => {
    const source = readFileSync(
      new URL("../src/components/tools/bash.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('part.state === "output-error"');
    expect(source).toContain("part.errorText");
    expect(source).toContain("Command failed or was interrupted");
    expect(source).toContain("defaultOpen={isError}");
  });
});
