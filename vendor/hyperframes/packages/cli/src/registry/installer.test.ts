import { describe, expect, it } from "vitest";
import { assertSafeTarget } from "./installer.js";

const DEST = "/tmp/hf-install-test";

describe("assertSafeTarget", () => {
  it("allows simple relative paths", () => {
    expect(() => assertSafeTarget(DEST, "index.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "compositions/intro.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "assets/nested/deep/file.svg")).not.toThrow();
  });

  it("rejects `..` path segments", () => {
    expect(() => assertSafeTarget(DEST, "../escape.html")).toThrow(/\.\./);
    expect(() => assertSafeTarget(DEST, "compositions/../../escape.html")).toThrow(/\.\./);
    expect(() => assertSafeTarget(DEST, "a/b/../../../escape.html")).toThrow();
  });

  it("rejects Unix absolute paths", () => {
    expect(() => assertSafeTarget(DEST, "/etc/passwd")).toThrow(/absolute/);
    expect(() => assertSafeTarget(DEST, "/home/user/file.txt")).toThrow();
  });

  it("rejects Windows drive-letter paths", () => {
    expect(() => assertSafeTarget(DEST, "C:/Windows/System32")).toThrow(/Windows/);
    expect(() => assertSafeTarget(DEST, "D:\\notes.txt")).toThrow();
  });

  it("allows `.` segments (no-op) and dotfile-like names", () => {
    expect(() => assertSafeTarget(DEST, ".hidden")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "./file.html")).not.toThrow();
    expect(() => assertSafeTarget(DEST, "a..b/file.html")).not.toThrow();
  });
});
