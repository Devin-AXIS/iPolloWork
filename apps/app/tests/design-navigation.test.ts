import { describe, expect, test } from "bun:test";

import { buildDesignPreviewDocument, resolveDesignNavigationPath } from "../src/react-app/domains/session/design/design-html-runtime";

describe("Design navigation", () => {
  const root = "design/session-1/index.html";

  test("resolves sibling HTML pages inside the current Design task", () => {
    expect(resolveDesignNavigationPath(root, root, "about.html#team")).toEqual({
      path: "design/session-1/about.html",
      hash: "team",
    });
    expect(resolveDesignNavigationPath(root, root, "/pricing")).toEqual({
      path: "design/session-1/pricing.html",
      hash: "",
    });
    expect(resolveDesignNavigationPath(root, root, "login.html")).toEqual({
      path: "design/session-1/login.html",
      hash: "",
    });
  });

  test("keeps root navigation on the current Design entry page", () => {
    expect(resolveDesignNavigationPath("design/session-1/about.html", root, "/")).toEqual({
      path: root,
      hash: "",
    });
  });

  test("rejects external links, anchors, and paths outside the Design task", () => {
    expect(resolveDesignNavigationPath(root, root, "#features")).toBeNull();
    expect(resolveDesignNavigationPath(root, root, "https://example.com")).toBeNull();
    expect(resolveDesignNavigationPath(root, root, "../../other.html")).toBeNull();
  });

  test("injects navigation handling in preview mode", () => {
    const preview = buildDesignPreviewDocument("<!doctype html><html><body><a href=\"about.html\">About</a></body></html>", false);
    expect(preview).toContain("ipollowork-design-navigation-runtime");
    expect(preview).not.toContain('id="ipollowork-design-runtime"');
  });
});
