import { describe, expect, test } from "vitest";
import { resolveMotionTimelineTargetKeys } from "./gsapTimelineSegmentCache";

describe("resolveMotionTimelineTargetKeys", () => {
  test("maps selector-only semantic motion to the timeline row key", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".status", hfId: "hf-status" },
        "index.html",
        [
          {
            id: "index.html:.status:0",
            key: "index.html:.status:0",
            hfId: "hf-status",
            selector: ".status",
            sourceFile: "index.html",
          },
        ],
      ),
    ).toEqual(["index.html:.status:0"]);
  });

  test("does not attach a same-named selector from another source file", () => {
    expect(
      resolveMotionTimelineTargetKeys(
        { selector: ".title" },
        "index.html",
        [
          {
            id: "nested.html:.title:0",
            key: "nested.html:.title:0",
            selector: ".title",
            sourceFile: "nested.html",
          },
        ],
      ),
    ).toEqual([]);
  });
});
