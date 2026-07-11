import { describe, expect, test } from "bun:test";

import { hyperframesStudioUrl } from "../src/react-app/domains/session/video/video-panel";

describe("HyperFrames Video Studio", () => {
  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1");
  });
});
