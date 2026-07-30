// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { readStudioUiPreferences, writeStudioUiPreferences } from "./studioUiPreferences";

beforeEach(() => {
  localStorage.clear();
});

describe("Studio UI catalog preferences", () => {
  it("persists a catalog column count from one through four", () => {
    writeStudioUiPreferences({ catalogColumnCount: 1 }, localStorage);
    expect(readStudioUiPreferences(localStorage).catalogColumnCount).toBe(1);

    writeStudioUiPreferences({ catalogColumnCount: 4 }, localStorage);
    expect(readStudioUiPreferences(localStorage).catalogColumnCount).toBe(4);
  });

  it("ignores an out-of-range catalog column count", () => {
    localStorage.setItem("hf-studio-ui-preferences", JSON.stringify({ catalogColumnCount: 5 }));

    expect(readStudioUiPreferences(localStorage).catalogColumnCount).toBeUndefined();
  });
});
