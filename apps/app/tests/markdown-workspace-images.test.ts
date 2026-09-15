import { describe, expect, test } from "bun:test";
import { createMarkdownImageLoader, markdownWorkspaceImagePath } from "../src/components/markdown/markdown";

describe("workspace images in chat Markdown", () => {
  test.each([
    ["artifacts/houyi.png", "artifacts/houyi.png"],
    ["./artifacts/houyi.png", "./artifacts/houyi.png"],
    ["artifacts/后羿%20射日.png", "artifacts/后羿 射日.png"],
    ["C:\\project\\artifacts\\houyi.png", "C:\\project\\artifacts\\houyi.png"],
    ["file:///C:/project/artifacts/houyi%20sun.png", "C:/project/artifacts/houyi sun.png"],
    ["/Users/test/project/houyi.png", "/Users/test/project/houyi.png"],
    ["https://example.com/houyi.png", ""],
    ["//example.com/houyi.png", ""],
    ["data:image/png;base64,aGVsbG8=", ""],
    ["javascript:alert(1)", ""],
    ["#", ""],
  ])("resolves %s without sending remote URLs to the workspace API", (href, expected) => {
    expect(markdownWorkspaceImagePath(href)).toBe(expected);
  });

  test("deduplicates repeated/streamed image loads and releases object URLs", async () => {
    const paths: string[] = [];
    const loader = createMarkdownImageLoader(async (path) => {
      paths.push(path);
      return new Blob(["image"], { type: "image/png" });
    });
    const first = loader.load("artifacts/houyi.png");
    expect(loader.load("artifacts/houyi.png")).toBe(first);
    const url = await first;
    expect(url.startsWith("blob:")).toBe(true);
    expect(await loader.load("artifacts/houyi.png")).toBe(url);
    expect(paths).toEqual(["artifacts/houyi.png"]);
    expect((await fetch(url)).headers.get("content-type")).toBe("image/png");
    loader.dispose();
    await expect(fetch(url)).rejects.toThrow();
    await expect(loader.load("artifacts/houyi.png")).rejects.toThrow("disposed");
  });

  test("does not leak an object URL when the session unmounts during a download", async () => {
    const pending = Promise.withResolvers<Blob>();
    const loader = createMarkdownImageLoader(() => pending.promise);
    const result = loader.load("artifacts/houyi.png");
    loader.dispose();
    pending.resolve(new Blob(["image"], { type: "image/png" }));
    await expect(result).rejects.toThrow("disposed");
  });

  test("does not repeatedly fetch a missing or forbidden file on re-render", async () => {
    let calls = 0;
    const loader = createMarkdownImageLoader(async () => {
      calls += 1;
      throw new Error("Image is not available in this workspace");
    });
    await expect(loader.load("../outside.png")).rejects.toThrow("not available");
    await expect(loader.load("../outside.png")).rejects.toThrow("not available");
    expect(calls).toBe(1);
    loader.dispose();
  });
});
