import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { listWorkspaceCatalogEntries } from "./routes/files.js";

describe("file session catalog listing", () => {
  test("scans only the requested prefix instead of walking the whole workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipollowork-catalog-prefix-"));
    try {
      await mkdir(join(root, "design", "session-1"), { recursive: true });
      await mkdir(join(root, "unrelated", "deep"), { recursive: true });
      await writeFile(join(root, "design", "session-1", "index.html"), "<html></html>");
      await writeFile(join(root, "unrelated", "deep", "ignored.md"), "ignored");

      const visitedDirectories: string[] = [];
      const items = await listWorkspaceCatalogEntries(root, {
        prefix: "design/session-1",
        includeDirs: false,
        onVisitDirectory: (relativePath) => visitedDirectories.push(relativePath),
      });

      expect(visitedDirectories).toEqual(["design/session-1"]);
      expect(items.map((item) => item.path)).toEqual(["design/session-1/index.html"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips heavy generated directories during workspace-wide catalog scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipollowork-catalog-ignore-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "node_modules", "huge"), { recursive: true });
      await mkdir(join(root, "vendor", "huge"), { recursive: true });
      await mkdir(join(root, ".git", "objects"), { recursive: true });
      await writeFile(join(root, "src", "index.ts"), "export {};");
      await writeFile(join(root, "node_modules", "huge", "ignored.js"), "ignored");
      await writeFile(join(root, "vendor", "huge", "ignored.js"), "ignored");
      await writeFile(join(root, ".git", "objects", "ignored"), "ignored");

      const visitedDirectories: string[] = [];
      const items = await listWorkspaceCatalogEntries(root, {
        includeDirs: false,
        onVisitDirectory: (relativePath) => visitedDirectories.push(relativePath),
      });

      expect(visitedDirectories).toContain("");
      expect(visitedDirectories).toContain("src");
      expect(visitedDirectories).not.toContain("node_modules");
      expect(visitedDirectories).not.toContain("vendor");
      expect(visitedDirectories).not.toContain(".git");
      expect(items.map((item) => item.path)).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
