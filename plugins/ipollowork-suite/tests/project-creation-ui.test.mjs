/** Contextual project creation preserves the organization's ownership. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
const require = createRequire(import.meta.url);
test("organization creation has no personal ownership option; the global dialog retains it", async () => {
  const bundle = await build({
    entryPoints: ["src/client/project-creation.tsx"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    loader: { ".css": "empty", ".module.css": "empty" },
    external: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@deepseek-ai/dsh-client-ui-primitives",
    ],
  });
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) =>
      name === "@deepseek-ai/dsh-client-ui-primitives"
        ? {
            Modal: ({ children }) =>
              React.createElement("div", { role: "dialog" }, children),
          }
        : require(name),
  });
  const labels = new Proxy(
    { title: "组织空间", personal: "个人" },
    { get: (value, key) => Reflect.get(value, key) ?? key },
  );
  const state = {
    signedIn: true,
    loading: false,
    error: "",
    catalog: { enterprises: [{ id: "org", name: "Selected organization" }] },
  };
  const props = {
    open: true,
    useEnterpriseLabels: (select) => select(labels),
    useEnterpriseState: (select) => select(state),
    refreshEnterprises: async () => {},
  };
  const render = (extra) =>
    new JSDOM(
      renderToStaticMarkup(
        React.createElement(module.exports.ProjectCreationDialog, {
          ...props,
          ...extra,
        }),
      ),
    ).window.document;
  const organization = render({ organizationId: "org" });
  assert(organization.body.textContent.includes("Selected organization"));
  assert.equal(
    [...organization.querySelectorAll("option")].some(
      (option) => option.textContent === "个人",
    ),
    false,
  );
  assert.equal(
    [...render({}).querySelectorAll("option")].some(
      (option) => option.textContent === "个人",
    ),
    true,
  );
});
