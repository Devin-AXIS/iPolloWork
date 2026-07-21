import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { protectOutputStreamFromBrokenPipe } from "./stdio-safety.mjs";

test("protectOutputStreamFromBrokenPipe absorbs EPIPE from a closed parent terminal", () => {
  const output = new EventEmitter();
  protectOutputStreamFromBrokenPipe(output);

  assert.doesNotThrow(() => {
    output.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
  });
});
