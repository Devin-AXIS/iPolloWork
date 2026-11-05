import { describe, expect, it } from "vitest";
import { MANIFEST_FILENAME, TEMPLATES_DIR } from "./remote.js";

// These constants construct the GitHub URL that installed CLIs use to fetch
// remote examples. Accidentally reverting either value silently breaks init
// for every user. Pin them explicitly.
describe("remote template path constants", () => {
  it("TEMPLATES_DIR points to registry/examples", () => {
    expect(TEMPLATES_DIR).toBe("registry/examples");
  });

  it("MANIFEST_FILENAME is retained for backwards-compat with any external consumers", () => {
    expect(MANIFEST_FILENAME).toBe("templates.json");
  });
});
