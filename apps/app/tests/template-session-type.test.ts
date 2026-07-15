import { describe, expect, test } from "bun:test";

import { sessionTypeForTemplate } from "../src/react-app/domains/session/sidebar/session-type";

describe("template session type", () => {
  test("uses the server-declared video surface for video conversations", () => {
    expect(sessionTypeForTemplate({ surface: "video" })).toBe("video");
  });

  test("uses the design conversation surface for every non-video template category", () => {
    expect(sessionTypeForTemplate({ surface: "design" })).toBe("design");
  });
});
