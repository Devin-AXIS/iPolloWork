import { ApiError } from "../../../errors.js";
import {
  describeModules,
  type ApiModule,
  type ApiModuleContext,
  type ApiModuleRegistryResult,
  type ApiOperation,
  type JsonSchema,
} from "../../module.js";
import { buildOpenApiDocument, type OpenApiDocument } from "../../openapi.js";

/**
 * The `openapi` module publishes the API's own description.
 *
 * It is the one module that has to read the registry it is registered into, so it takes a
 * late-bound accessor from the services bag rather than a snapshot: at `register()` time the
 * other modules have not necessarily been registered yet, and a snapshot would document a
 * half-built API.
 */

export const OPENAPI_SPEC_PATH = "/api/v1/openapi.json";
export const API_DOCS_PATH = "/api/v1/docs";
export const API_MODULES_PATH = "/api/v1/modules";

export interface OpenApiModuleServices {
  /**
   * Resolves the completed registry. Called per request, never at registration time.
   * Returning `null` (registration still in flight) surfaces as a 500 rather than a
   * document that quietly omits half the API.
   */
  getApiRegistry?: () => ApiModuleRegistryResult | null | undefined;
  /** Version reported in `info.version`. Defaults to `0.0.0`. */
  serverVersion?: string;
}

/** Response schema for `listApiModules`, matching `describeModules` exactly. */
const MODULE_CATALOGUE_SCHEMA: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["id", "title", "description", "version", "stability", "dependsOn", "operations"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      version: { type: "string" },
      stability: { type: "string", enum: ["stable", "preview", "experimental"] },
      dependsOn: { type: "array", items: { type: "string" } },
      operations: {
        type: "array",
        items: {
          type: "object",
          required: ["operationId", "method", "path", "effect", "scope", "summary", "streaming", "deprecated"],
          properties: {
            operationId: { type: "string" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string" },
            effect: { type: "string", enum: ["read", "write", "destructive"] },
            scope: { type: "string", enum: ["viewer", "collaborator", "owner"] },
            summary: { type: "string" },
            streaming: { type: ["string", "null"], enum: ["sse", null] },
            deprecated: { type: "boolean" },
          },
        },
      },
    },
  },
};

export function createOpenApiModule(): ApiModule {
  return {
    id: "openapi",
    title: "API description",
    description:
      "Publishes the OpenAPI 3.1 document, a dependency-free HTML reference, and the enabled module catalogue.",
    version: "1.0.0",
    stability: "stable",
    register(context: ApiModuleContext): ApiOperation[] {
      const services = context.services as OpenApiModuleServices;
      // Built documents are cached per registry identity: the generator is deterministic,
      // so the only reason to rebuild is a registry that was actually replaced.
      let cache: { registry: ApiModuleRegistryResult; document: OpenApiDocument } | null = null;

      const resolveRegistry = (): ApiModuleRegistryResult => {
        const registry = services.getApiRegistry?.();
        if (!registry) {
          throw new ApiError(
            500,
            "openapi_registry_unavailable",
            "The API module registry is not available yet, so no description can be produced.",
          );
        }
        return registry;
      };

      const resolveDocument = (): OpenApiDocument => {
        const registry = resolveRegistry();
        if (cache && cache.registry === registry) return cache.document;
        const document = buildOpenApiDocument({
          operations: registry.operations,
          modules: registry.modules,
          serverVersion: services.serverVersion ?? "0.0.0",
        });
        cache = { registry, document };
        return document;
      };

      return [
        {
          operationId: "getOpenApiDocument",
          method: "GET",
          path: OPENAPI_SPEC_PATH,
          summary: "Get the OpenAPI document",
          description:
            "Returns the OpenAPI 3.1 description of every enabled, non-internal operation. The output is deterministic: identical input produces byte-identical JSON, so the document can be committed and diffed in CI.",
          effect: "read",
          responses: {
            200: {
              description: "The OpenAPI 3.1 document.",
              schema: { type: "object", additionalProperties: true },
            },
          },
          handler: async () => context.jsonResponse(resolveDocument()),
        },
        {
          operationId: "getApiDocs",
          method: "GET",
          path: API_DOCS_PATH,
          summary: "Browse the API reference",
          description:
            "A self-contained HTML reference for the OpenAPI document. The page ships no external assets and works offline; the document is embedded so the page renders without a second authenticated request, and a refresh control re-fetches it from the spec endpoint.",
          effect: "read",
          responses: {
            200: {
              description: "The HTML reference page.",
              contentType: "text/html",
              schema: { type: "string" },
            },
          },
          handler: async () =>
            new Response(
              renderApiDocsHtml({ document: resolveDocument(), specUrl: OPENAPI_SPEC_PATH }),
              {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
              },
            ),
        },
        {
          operationId: "listApiModules",
          method: "GET",
          path: API_MODULES_PATH,
          summary: "List the enabled API modules",
          description:
            "The catalogue of enabled modules and the operations each one contributes, including operations marked internal (which the OpenAPI document omits).",
          effect: "read",
          responses: {
            200: {
              description: "The enabled modules, in registration order.",
              schema: MODULE_CATALOGUE_SCHEMA,
            },
          },
          handler: async () => context.jsonResponse(describeModules(resolveRegistry())),
        },
      ];
    },
  };
}

/** The module instance registered by the server. */
export const openApiModule: ApiModule = createOpenApiModule();

export interface ApiDocsHtmlInput {
  /** The OpenAPI document to embed. */
  document: unknown;
  /** Where the refresh control re-fetches the document from. */
  specUrl: string;
  /** Page title. Defaults to `iPolloWork API`. */
  title?: string;
}

/**
 * Renders the offline API reference.
 *
 * No CDN, no bundler, no dependency: the server has to work on a disconnected machine, and a
 * docs page that blanks out without network access is worse than no docs page. Everything the
 * page needs is in the string this function returns.
 *
 * Two escaping rules make untrusted text safe here. The embedded document is JSON with `<`,
 * `>` and `&` escaped as `\uXXXX`, which is valid JSON and cannot terminate the script block
 * — a summary containing `</script>` stays inert. Everything the page then renders goes in
 * through `textContent`, never `innerHTML`, so a hostile string cannot become markup.
 */
export function renderApiDocsHtml(input: ApiDocsHtmlInput): string {
  const title = input.title ?? "iPolloWork API";
  const embedded = embedJson(input.document);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCS_CSS}</style>
</head>
<body>
<header class="top">
  <div class="titles"><h1 id="doc-title">${escapeHtml(title)}</h1><p id="doc-version" class="muted"></p></div>
  <div class="controls">
    <input id="filter" type="search" placeholder="Filter operations" autocomplete="off" spellcheck="false">
    <button id="expand" type="button">Expand all</button>
    <button id="collapse" type="button">Collapse all</button>
    <button id="refresh" type="button">Refresh</button>
  </div>
</header>
<p id="status" class="status" hidden></p>
<p id="doc-description" class="description muted"></p>
<main id="app"></main>
<script type="application/json" id="openapi-document">${embedded}</script>
<script id="spec-url" type="application/json">${embedJson(input.specUrl)}</script>
<script>${DOCS_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * JSON for embedding in a `<script type="application/json">` block.
 *
 * `<`, `>` and `&` can only occur inside JSON string literals, where `\uXXXX` is an exact
 * equivalent — so this is a lossless transform that removes every byte sequence able to
 * close the element. U+2028/U+2029 are escaped because they are literal line terminators to
 * a JavaScript parser.
 */
function embedJson(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DOCS_CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #14171a; --muted: #5b6570; --line: #dfe3e8; --panel: #f6f7f9;
  --get: #0b6bcb; --post: #1a7f37; --put: #9a6700; --patch: #9a6700; --delete: #b42318;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #11141a; --fg: #e6e9ef; --muted: #9aa4b2; --line: #2a303a; --panel: #171b22;
    --get: #63a4ff; --post: #4ac26b; --put: #d4a72c; --patch: #d4a72c; --delete: #ff6b6b; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 24px 64px; background: var(--bg); color: var(--fg);
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 15px; margin: 32px 0 4px; }
.top { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px 0 12px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 2; }
.titles p { margin: 2px 0 0; font-size: 12px; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; }
.controls input, .controls button { font: inherit; font-size: 13px; padding: 5px 10px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--fg); }
.controls button { cursor: pointer; }
.muted { color: var(--muted); }
.description { white-space: pre-wrap; margin: 16px 0 0; max-width: 76ch; font-size: 13px; }
.status { margin: 12px 0 0; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); font-size: 13px; }
.tag-desc { margin: 0 0 8px; font-size: 13px; }
details.op { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; background: var(--panel); }
details.op > summary { cursor: pointer; padding: 10px 12px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
details.op > summary::-webkit-details-marker { display: none; }
.method { font-weight: 700; font-size: 11px; letter-spacing: .06em; min-width: 52px; }
.method.get { color: var(--get); } .method.post { color: var(--post); }
.method.put { color: var(--put); } .method.patch { color: var(--patch); } .method.delete { color: var(--delete); }
.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.op-summary { color: var(--muted); font-size: 13px; }
.op-body { padding: 0 12px 14px; border-top: 1px solid var(--line); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
.chip { font-size: 11px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); }
.chip.warn { border-color: var(--delete); color: var(--delete); }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 6px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12px; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px;
  overflow: auto; font-size: 12px; margin: 4px 0 0; max-height: 340px; }
.op-desc { white-space: pre-wrap; margin: 10px 0 0; font-size: 13px; }
.deprecated .path { text-decoration: line-through; }
.empty { color: var(--muted); font-size: 13px; margin: 24px 0; }
`;

/**
 * The page script. Plain ES2015, no build step, no globals leaked.
 * Every value derived from the document is inserted with `textContent`.
 */
const DOCS_SCRIPT = `
(function () {
  "use strict";
  var METHODS = ["get", "put", "post", "delete", "patch"];
  var specUrl = readJson("spec-url") || "/api/v1/openapi.json";
  var app = document.getElementById("app");
  var statusEl = document.getElementById("status");

  function readJson(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent || "null"); } catch (err) { return null; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setStatus(message) {
    if (!message) { statusEl.hidden = true; statusEl.textContent = ""; return; }
    statusEl.hidden = false;
    statusEl.textContent = message;
  }

  function pretty(value) {
    try { return JSON.stringify(value, null, 2); } catch (err) { return String(value); }
  }

  function schemaBlock(schema) {
    if (schema === undefined) return null;
    if (schema && schema.$ref) return el("p", "muted", "Schema: " + schema.$ref);
    if (schema && Object.keys(schema).length === 0) return el("p", "muted", "Any JSON value.");
    return el("pre", null, pretty(schema));
  }

  function collect(doc) {
    var rows = [];
    var paths = (doc && doc.paths) || {};
    Object.keys(paths).forEach(function (path) {
      var item = paths[path] || {};
      Object.keys(item).forEach(function (method) {
        if (METHODS.indexOf(method) === -1) return;
        rows.push({ path: path, method: method, op: item[method] || {} });
      });
    });
    return rows;
  }

  function tagIndex(doc) {
    var index = {};
    ((doc && doc.tags) || []).forEach(function (tag) {
      if (tag && tag.name) index[tag.name] = tag;
    });
    return index;
  }

  function renderParams(op) {
    var params = op.parameters || [];
    if (!params.length) return null;
    var wrap = document.createDocumentFragment();
    wrap.appendChild(el("h3", null, "Parameters"));
    var table = el("table");
    var head = el("tr");
    ["Name", "In", "Required", "Type", "Description"].forEach(function (label) {
      head.appendChild(el("th", null, label));
    });
    table.appendChild(head);
    params.forEach(function (param) {
      var row = el("tr");
      var name = el("td");
      name.appendChild(el("code", null, param.name));
      row.appendChild(name);
      row.appendChild(el("td", null, param.in));
      row.appendChild(el("td", null, param.required ? "yes" : "no"));
      var schema = param.schema || {};
      var type = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type || (schema.$ref ? schema.$ref : "any"));
      row.appendChild(el("td", null, type));
      row.appendChild(el("td", null, param.description || ""));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderBody(op) {
    if (!op.requestBody) return null;
    var wrap = document.createDocumentFragment();
    wrap.appendChild(el("h3", null, "Request body" + (op.requestBody.required ? " (required)" : "")));
    var content = op.requestBody.content || {};
    Object.keys(content).forEach(function (type) {
      wrap.appendChild(el("p", "muted", type));
      var block = schemaBlock((content[type] || {}).schema);
      if (block) wrap.appendChild(block);
    });
    return wrap;
  }

  function renderResponses(op) {
    var responses = op.responses || {};
    var codes = Object.keys(responses).sort();
    if (!codes.length) return null;
    var wrap = document.createDocumentFragment();
    wrap.appendChild(el("h3", null, "Responses"));
    codes.forEach(function (code) {
      var response = responses[code] || {};
      var line = el("p");
      var strong = el("strong", null, code);
      line.appendChild(strong);
      line.appendChild(document.createTextNode(" "));
      if (response.$ref) {
        line.appendChild(el("span", "muted", response.$ref));
        wrap.appendChild(line);
        return;
      }
      line.appendChild(el("span", "muted", response.description || ""));
      wrap.appendChild(line);
      var content = response.content || {};
      Object.keys(content).forEach(function (type) {
        wrap.appendChild(el("p", "muted", type));
        var block = schemaBlock((content[type] || {}).schema);
        if (block) wrap.appendChild(block);
      });
    });
    return wrap;
  }

  function renderOperation(row) {
    var op = row.op;
    var details = el("details", "op" + (op.deprecated ? " deprecated" : ""));
    details.dataset.search = [row.method, row.path, op.operationId || "", op.summary || ""].join(" ").toLowerCase();

    var summary = el("summary");
    summary.appendChild(el("span", "method " + row.method, row.method.toUpperCase()));
    summary.appendChild(el("span", "path", row.path));
    summary.appendChild(el("span", "op-summary", op.summary || ""));
    details.appendChild(summary);

    var body = el("div", "op-body");
    var chips = el("div", "chips");
    function chip(text, warn) { if (text) chips.appendChild(el("span", warn ? "chip warn" : "chip", text)); }
    chip(op.operationId);
    chip(op["x-ipollowork-module"] ? "module: " + op["x-ipollowork-module"] : null);
    chip(op["x-ipollowork-effect"] ? "effect: " + op["x-ipollowork-effect"] : null);
    chip(op["x-ipollowork-scope"] ? "scope: " + op["x-ipollowork-scope"] : null);
    chip(op["x-ipollowork-auth"] ? "auth: " + op["x-ipollowork-auth"] : null);
    chip(op["x-ipollowork-streaming"] ? "streaming: " + op["x-ipollowork-streaming"] : null);
    if (op.deprecated) chip("deprecated", true);
    body.appendChild(chips);

    if (op.description) body.appendChild(el("p", "op-desc", op.description));
    [renderParams(op), renderBody(op), renderResponses(op)].forEach(function (section) {
      if (section) body.appendChild(section);
    });
    details.appendChild(body);
    return details;
  }

  function render(doc) {
    var info = (doc && doc.info) || {};
    document.getElementById("doc-title").textContent = info.title || "API";
    document.getElementById("doc-version").textContent = info.version ? "version " + info.version : "";
    document.getElementById("doc-description").textContent = info.description || "";

    app.replaceChildren();
    var rows = collect(doc);
    if (!rows.length) {
      app.appendChild(el("p", "empty", "This document contains no operations."));
      return;
    }

    var tags = tagIndex(doc);
    var groups = {};
    var order = [];
    rows.forEach(function (row) {
      var tag = (row.op.tags && row.op.tags[0]) || "other";
      if (!groups[tag]) { groups[tag] = []; order.push(tag); }
      groups[tag].push(row);
    });
    order.sort();

    order.forEach(function (tag) {
      var section = el("section");
      section.appendChild(el("h2", null, tag));
      var meta = tags[tag];
      if (meta && meta.description) section.appendChild(el("p", "tag-desc muted", meta.description));
      groups[tag]
        .slice()
        .sort(function (a, b) { return a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path); })
        .forEach(function (row) { section.appendChild(renderOperation(row)); });
      app.appendChild(section);
    });
  }

  document.getElementById("filter").addEventListener("input", function (event) {
    var needle = String(event.target.value || "").trim().toLowerCase();
    var nodes = app.querySelectorAll("details.op");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.hidden = needle !== "" && (node.dataset.search || "").indexOf(needle) === -1;
    }
  });

  document.getElementById("expand").addEventListener("click", function () { toggleAll(true); });
  document.getElementById("collapse").addEventListener("click", function () { toggleAll(false); });
  function toggleAll(open) {
    var nodes = app.querySelectorAll("details.op");
    for (var i = 0; i < nodes.length; i++) { nodes[i].open = open; }
  }

  document.getElementById("refresh").addEventListener("click", function () {
    setStatus("Fetching " + specUrl + " ...");
    fetch(specUrl, { headers: { accept: "application/json" }, credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (doc) { render(doc); setStatus(""); })
      .catch(function (err) {
        setStatus("Could not refresh from " + specUrl + " (" + err.message + "). Showing the embedded document.");
      });
  });

  render(readJson("openapi-document"));
})();
`;
