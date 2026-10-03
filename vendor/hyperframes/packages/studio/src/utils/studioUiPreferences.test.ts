// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { readStudioUiPreferences, writeStudioUiPreferences } from "./studioUiPreferences";

const entries = new Map<string, string>();
const storage: Storage = {
  get length() {
    return entries.size;
  },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  key: (index) => Array.from(entries.keys())[index] ?? null,
  removeItem: (key) => entries.delete(key),
  setItem: (key, value) => entries.set(key, value),
};

beforeEach(() => {
  storage.clear();
});

describe("Studio UI catalog preferences", () => {
  it("persists a catalog column count from one through four", () => {
    writeStudioUiPreferences({ catalogColumnCount: 1 }, storage);
    expect(readStudioUiPreferences(storage).catalogColumnCount).toBe(1);

    writeStudioUiPreferences({ catalogColumnCount: 4 }, storage);
    expect(readStudioUiPreferences(storage).catalogColumnCount).toBe(4);
  });

  it("ignores an out-of-range catalog column count", () => {
    storage.setItem("hf-studio-ui-preferences", JSON.stringify({ catalogColumnCount: 5 }));

    expect(readStudioUiPreferences(storage).catalogColumnCount).toBeUndefined();
  });

  it("persists the timeline layer width", () => {
    writeStudioUiPreferences({ timelineLayerWidth: 320 }, storage);

    expect(readStudioUiPreferences(storage).timelineLayerWidth).toBe(320);
  });
});
