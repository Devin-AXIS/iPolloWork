import { describe, expect, test } from "vitest";
import { getTimelineEditCapabilities } from "./timelineEditCapabilities";

const BASE = {
  tag: "div",
  duration: 6,
  domId: "rw-thread",
};

describe("timeline edit capabilities", () => {
  test("allows a patchable implicit layer and marks its first edit as materialization", () => {
    expect(
      getTimelineEditCapabilities({
        ...BASE,
        timingSource: "implicit",
      }),
    ).toEqual({
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
      status: "materializes-timing",
    });
  });

  test("keeps source locks authoritative", () => {
    expect(
      getTimelineEditCapabilities({
        ...BASE,
        timingSource: "implicit",
        timelineLocked: true,
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "locked",
    });
  });

  test("does not expose an edit that cannot be saved", () => {
    expect(
      getTimelineEditCapabilities({
        tag: "div",
        duration: 6,
        timingSource: "implicit",
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "missing-target",
    });
  });

  test("requires nested children to be edited inside their parent composition", () => {
    expect(
      getTimelineEditCapabilities({
        ...BASE,
        timingSource: "implicit",
        expandedParentStart: 2,
      }),
    ).toEqual({
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "nested-context",
    });
  });
});

 test("a same-file scene can request a validated whole move but cannot trim or stretch", () => {
  expect(getTimelineEditCapabilities({tag:"section",domId:"scene",duration:4,inlineScopeKind:"scene"})).toMatchObject({canMove:true,canTrimStart:false,canTrimEnd:false});
  expect(getTimelineEditCapabilities({tag:"section",domId:"scene",duration:4,inlineScopeKind:"scene",expandedParentStart:2})).toMatchObject({canMove:false});
 });
