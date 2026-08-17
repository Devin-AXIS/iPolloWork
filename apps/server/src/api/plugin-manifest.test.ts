import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validatePluginPackageManifest } from "@ipollowork/types/plugins";
import { describe, expect, test } from "bun:test";

import { API_MODULES } from "./index.js";

/**
 * The plugin-package manifest that declares this API component as an installable piece.
 *
 * `server-route` is a declared contribution type with no runtime consumer yet, so the
 * manifest documents intent rather than driving behaviour. That makes it exactly the kind
 * of file that rots silently, which is why it is validated against the real schema here and
 * cross-checked against the module catalogue rather than against a copied list.
 */
const MANIFEST_PATH = fileURLToPath(
  new URL("../../../../examples/plugin-packages/public-api/ipollowork.plugin.json", import.meta.url),
);

function readManifest(): unknown {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as unknown;
}

describe("public-api plugin manifest", () => {
  test("passes the shipped plugin package schema", () => {
    const result = validatePluginPackageManifest(readManifest());
    if (!result.success) {
      throw new Error(result.issues.map((issue) => `${issue.path || "manifest"}: ${issue.message}`).join("; "));
    }
    expect(result.success).toBe(true);
  });

  test("declares one server-route contribution per API module", () => {
    const result = validatePluginPackageManifest(readManifest());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const contributions = result.manifest.contributions ?? [];
    expect(contributions.every((contribution) => contribution.type === "server-route")).toBe(true);
    expect(contributions.every((contribution) => contribution.location === "server")).toBe(true);
    expect(contributions.map((contribution) => contribution.ref)).toEqual(
      API_MODULES.map((module) => module.id),
    );
  });

  test("identifies itself as a builtin server component", () => {
    const result = validatePluginPackageManifest(readManifest());
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.manifest.id).toBe("public-api");
    expect(result.manifest.source.origin).toBe("builtin");
    expect(result.manifest.package?.updateId).toBe("ipollowork/public-api");
    // The component contributes routes, not files: a resource here would claim a payload
    // the package does not carry.
    expect(result.manifest.resources).toEqual([]);
  });
});
