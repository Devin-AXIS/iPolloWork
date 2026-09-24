import path from "node:path";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const MAX_SNAPSHOT_NODES = 250;
const MAX_SNAPSHOT_TEXT = 30_000;
const MAX_ACTIONS = 8;
const MAX_FILL_TEXT = 50_000;
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_INFERRED_CONTROLS = 32;
const MAX_WAIT_MS = 10_000;
const DEFAULT_WAIT_FOR_MS = 5_000;
const MAX_WAIT_FOR_MS = 10_000;
const MAX_TOTAL_WAIT_MS = 10_000;
const WAIT_POLL_MS = 100;
const MAX_EXPECTED_NAME = 200;
const MAX_DEBUGGER_COMMAND_MS = 5_000;
const FILE_CHOOSER_EVENT_MS = 250;
const MAX_WINDOWS_BROWSER_PATH = 240;
const UPLOAD_CONTROL_NAME = /(?:上传|选择.{0,8}(?:文件|视频|素材)|upload|choose.{0,8}(?:file|video)|select.{0,8}(?:file|video)|browse)/i;
const MAX_READ_TEXT = 24_000;
const MAX_READ_ITEMS = 120;
const MAX_SCREENSHOT_ANNOTATIONS = 40;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_OBSERVATION_SETTLE_MS = 2_000;
const SNAPSHOT_MODES = new Set(["content", "interactive", "mixed"]);
const READ_MODES = new Set(["article", "forms", "links", "page", "tables"]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
const CONTENT_ROLES = new Set(["heading", "listitem", "paragraph", "StaticText"]);
const WRITABLE_ROLES = new Set(["combobox", "searchbox", "textbox"]);
const CHECKABLE_ROLES = new Set(["checkbox", "menuitemcheckbox", "menuitemradio", "radio", "switch"]);
const RADIO_ROLES = new Set(["menuitemradio", "radio"]);
const ACTIVATABLE_ROLES = new Set(["button", "link", "menuitem", "option", "tab", "treeitem"]);
const NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Escape",
  "Home",
  "PageDown",
  "PageUp",
  "Tab",
]);
const ACTIVATION_KEYS = new Set(["Enter", "Space"]);
const SCROLL_DISTANCE = { small: 320, page: 800 };

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function boundedText(value, max = 500) {
  const text = normalizeText(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function axValue(value) {
  return value && typeof value === "object" && "value" in value ? value.value : undefined;
}

function axProperty(node, name) {
  return (node?.properties ?? []).find((property) => property?.name === name)?.value?.value;
}

function accessibleName(node) {
  const name = normalizeText(axValue(node.name));
  const role = String(axValue(node.role) ?? "unknown");
  return name || (WRITABLE_ROLES.has(role) ? `Unnamed ${role}` : "");
}

function quote(value) {
  return JSON.stringify(boundedText(value));
}

function domAttributes(node) {
  const attributes = Array.isArray(node?.attributes) ? node.attributes : [];
  return Object.fromEntries(Array.from({ length: Math.floor(attributes.length / 2) }, (_value, index) => (
    [String(attributes[index * 2]).toLowerCase(), String(attributes[index * 2 + 1])]
  )));
}

async function debuggerCommand(debuggerApi, method, params = {}) {
  let timeout;
  try {
    return await Promise.race([
      debuggerApi.sendCommand(method, params),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Built-in browser command timed out: ${method}`));
        }, MAX_DEBUGGER_COMMAND_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function accessibilityFrames(frameTree, depth = 0) {
  if (!frameTree?.frame?.id) return [];
  return [
    { depth, frameId: frameTree.frame.id },
    ...(frameTree.childFrames ?? []).flatMap((child) => accessibilityFrames(child, depth + 1)),
  ];
}

async function readAccessibilityTrees(debuggerApi) {
  const pageTree = await debuggerCommand(debuggerApi, "Page.getFrameTree").catch(() => null);
  const frames = accessibilityFrames(pageTree?.frameTree);
  if (frames.length === 0) {
    const response = await debuggerCommand(debuggerApi, "Accessibility.getFullAXTree");
    return [{ depth: 0, nodes: Array.isArray(response?.nodes) ? response.nodes : [] }];
  }
  const trees = [];
  for (const frame of frames) {
    const response = await debuggerCommand(debuggerApi, "Accessibility.getFullAXTree", {
      frameId: frame.frameId,
    }).catch(() => null);
    if (Array.isArray(response?.nodes)) trees.push({ depth: frame.depth, nodes: response.nodes });
  }
  if (trees.length > 0) return trees;
  const response = await debuggerCommand(debuggerApi, "Accessibility.getFullAXTree");
  return [{ depth: 0, nodes: Array.isArray(response?.nodes) ? response.nodes : [] }];
}

function pathWithin(root, filePath) {
  const relativePath = path.relative(root, filePath);
  return Boolean(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function safeStorageSegment(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_") || "default";
}

function observationKey(mode, scopeBackendNodeId) {
  return `${mode}:${scopeBackendNodeId || "page"}`;
}

function lineDelta(previous, current) {
  if (previous === current) return { change: "unchanged", tree: "(Page unchanged)", delta: null };
  if (!previous) return { change: "full", tree: current, delta: null };
  const before = previous.split("\n");
  const after = current.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const added = after.slice(prefix, after.length - suffix);
  const delta = { fromLine: prefix + 1, removed: before.length - prefix - suffix, added };
  const compact = `@@ line ${delta.fromLine} -${delta.removed} +${added.length}\n${added.join("\n")}`.trimEnd();
  return compact.length < current.length
    ? { change: "delta", tree: compact, delta }
    : { change: "full", tree: current, delta: null };
}

function pluginDataPathAllowed(filePath, userDataRoot, workspaceId, extensionId) {
  if (!extensionId || !pathWithin(userDataRoot, filePath)) return false;
  const parts = path.relative(userDataRoot, filePath).split(path.sep);
  const expectedWorkspace = safeStorageSegment(workspaceId);
  const expectedPlugin = safeStorageSegment(extensionId);
  return parts.some((part, index) => (
    part === "plugin-data"
    && (
      (parts[index + 1] === expectedWorkspace && parts[index + 2] === expectedPlugin && index + 3 < parts.length)
      || (parts[index + 1] === expectedPlugin && index + 2 < parts.length)
    )
  ));
}

async function removeStagedUpload(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !/^ipw-upload-[A-Za-z0-9_-]+$/.test(path.basename(resolved))) {
    throw new Error("Browser upload staging path is invalid.");
  }
  await rm(resolved, { recursive: true, force: true });
}

function snapshotLine(node, ref, depth) {
  const role = String(axValue(node.role) ?? "unknown");
  const name = boundedText(accessibleName(node));
  const protectedValue = axProperty(node, "protected") === true;
  const value = protectedValue ? "" : boundedText(axValue(node.value), 300);
  const details = [];
  if (name) details.push(quote(name));
  if (value && value !== name) details.push(`value=${quote(value)}`);
  // Links already exposed by Chromium's accessibility tree must retain their
  // destination, so read-only discovery does not have to activate every card.
  const href = role === "link" ? axProperty(node, "url") : null;
  if (typeof href === "string" && href.length <= 2048) {
    try {
      const url = new URL(href);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) details.push(`url=${quote(href)}`);
    } catch { /* Invalid page-provided URLs are not usable navigation targets. */ }
  }
  for (const property of ["checked", "disabled", "expanded", "focused", "required", "selected"]) {
    const propertyValue = axProperty(node, property);
    if (propertyValue !== undefined && propertyValue !== false) details.push(`${property}=${String(propertyValue)}`);
  }
  const level = axProperty(node, "level");
  if (level !== undefined) details.push(`level=${String(level)}`);
  const prefix = `${"  ".repeat(Math.min(depth, 8))}${ref ? `[${ref}] ` : ""}${role}`;
  return `${prefix}${details.length ? ` ${details.join(" ")}` : ""}`;
}

function automationMetadataFunction() {
  return `function inspectAutomationTarget(scrollIntoView) {
    if (scrollIntoView) this.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
    const tag = this.tagName?.toUpperCase?.() || "";
    const type = this.getAttribute?.("type")?.toLowerCase?.() || "";
    const role = this.getAttribute?.("role")?.toLowerCase?.() || "";
    const rect = this.getBoundingClientRect();
    const style = getComputedStyle(this);
    const root = this.getRootNode?.();
    const viewportWidth = this.ownerDocument?.defaultView?.innerWidth || 0;
    const viewportHeight = this.ownerDocument?.defaultView?.innerHeight || 0;
    const visibleLeft = Math.max(0, rect.left);
    const visibleRight = Math.min(viewportWidth, rect.right);
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(viewportHeight, rect.bottom);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const points = [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75]];
    const localPoint = points.map(([xRatio, yRatio]) => {
      const x = visibleLeft + visibleWidth * xRatio;
      const y = visibleTop + visibleHeight * yRatio;
      const documentHit = this.ownerDocument?.elementFromPoint?.(x, y);
      const rootHit = root?.elementFromPoint?.(x, y) ?? documentHit;
      const rootHost = root?.host ?? null;
      const hitsElement = rootHit === this || this.contains?.(rootHit);
      const reachesDocument = documentHit === this || this.contains?.(documentHit) || documentHit === rootHost;
      return { x, y, unobstructed: Boolean(hitsElement && reachesDocument) };
    }).find((candidate) => candidate.unobstructed);
    let offsetX = 0;
    let offsetY = 0;
    try {
      let currentWindow = this.ownerDocument?.defaultView;
      while (currentWindow && currentWindow !== currentWindow.top) {
        const frame = currentWindow.frameElement;
        if (!frame) break;
        if (scrollIntoView) frame.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
        const frameRect = frame.getBoundingClientRect();
        offsetX += frameRect.left;
        offsetY += frameRect.top;
        currentWindow = frame.ownerDocument?.defaultView;
      }
    } catch { /* keep local coordinates if a frame boundary refuses access */ }
    const checkable = ["checkbox", "radio"].includes(type)
      || ["checkbox", "menuitemcheckbox", "menuitemradio", "radio", "switch"].includes(role);
    const buttonLike = tag === "BUTTON" || role === "button" || tag === "A" || checkable
      || (tag === "INPUT" && ["button", "submit"].includes(type))
      || style.cursor === "pointer" || typeof this.onclick === "function";
    const writable = tag === "TEXTAREA" || (tag === "INPUT" && !["button", "submit", "checkbox", "radio", "file"].includes(type))
      || this.isContentEditable === true;
    const label = this.getAttribute?.("aria-label") || this.getAttribute?.("data-placeholder") || this.getAttribute?.("placeholder") || "";
    let context = "";
    const ownText = (this.innerText || this.textContent || "").replace(/\\s+/g, " ").trim();
    for (let parent = this.parentElement, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
      const text = (parent.innerText || "").replace(/\\s+/g, " ").trim();
      if (text.length > 180) break;
      if (text && text !== ownText) {
        context = text;
        break;
      }
    }
    return {
      buttonLike,
      context,
      label,
      checkable,
      disabled: Boolean(this.disabled || this.readOnly || this.getAttribute?.("aria-disabled") === "true"),
      fileInput: tag === "INPUT" && type === "file",
      nativeSelect: tag === "SELECT",
      imageSrc: tag === "IMG" ? String(this.currentSrc || this.src || "").slice(0, 2048) : null,
      rendered: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        && style.pointerEvents !== "none",
      visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < viewportWidth && rect.top < viewportHeight
        && style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none",
      unobstructed: Boolean(localPoint),
      text: (this.getAttribute?.("aria-label") || this.getAttribute?.("data-placeholder") || this.getAttribute?.("placeholder") || this.innerText || this.textContent || "").replace(/\\s+/g, " ").trim(),
      writable,
      bounds: {
        left: visibleLeft + offsetX,
        top: visibleTop + offsetY,
        width: visibleWidth,
        height: visibleHeight,
      },
      x: (localPoint?.x ?? 0) + offsetX,
      y: (localPoint?.y ?? 0) + offsetY,
    };
  }`;
}

function selectExactOptionFunction() {
  return `function selectExactOption(requestedOption) {
    if (this.tagName?.toUpperCase?.() !== "SELECT") return { ok: false, reason: "not_select" };
    const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
    const requested = normalize(requestedOption);
    const options = Array.from(this.options ?? []);
    const labelMatches = options.filter((option) => normalize(option.label || option.textContent) === requested);
    const valueMatches = options.filter((option) => String(option.value) === requestedOption);
    const matches = labelMatches.length > 0 ? labelMatches : valueMatches;
    if (matches.length === 0) return { ok: false, reason: "not_found" };
    if (matches.length > 1) return { ok: false, reason: "ambiguous" };
    const option = matches[0];
    const changed = this.value !== option.value;
    if (changed) {
      this.value = option.value;
      option.selected = true;
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, changed, label: normalize(option.label || option.textContent), value: String(option.value) };
  }`;
}

function pageReadFunction() {
  return `function readPage(request) {
    const mode = request.mode || "page";
    const maxItems = request.maxItems || ${MAX_READ_ITEMS};
    const maxChars = request.maxChars || ${MAX_READ_TEXT};
    const clean = (value, limit = 1200) => String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const safeUrl = (value) => {
      try {
        const url = new URL(value, document.baseURI);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
      } catch { return ""; }
    };
    const items = [];
    let characters = 0;
    let truncated = false;
    const add = (kind, text, extra = {}) => {
      if (items.length >= maxItems || characters >= maxChars) { truncated = true; return; }
      const value = clean(text);
      if (!value) return;
      const remaining = maxChars - characters;
      const bounded = value.slice(0, remaining);
      if (bounded.length < value.length) truncated = true;
      items.push({ kind, text: bounded, ...extra });
      characters += bounded.length;
    };
    const root = mode === "article"
      ? document.querySelector("article, main, [role=main]") || document.body
      : document.body;
    if (["article", "page"].includes(mode)) {
      const seen = new Set();
      for (const element of Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre")).slice(0, mode === "article" ? maxItems : 30)) {
        if (items.length >= maxItems || characters >= maxChars) { truncated = true; break; }
        if (!visible(element)) continue;
        const text = clean(element.innerText || element.textContent);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const tag = element.tagName.toLowerCase();
        add(tag.startsWith("h") ? "heading" : tag === "li" ? "listitem" : tag, text, tag.startsWith("h") ? { level: Number(tag.slice(1)) } : {});
      }
    }
    if (["links", "page"].includes(mode)) {
      for (const link of Array.from(root.querySelectorAll("a[href]")).slice(0, 20)) {
        if (items.length >= maxItems || characters >= maxChars) { truncated = true; break; }
        if (!visible(link)) continue;
        const url = safeUrl(link.getAttribute("href"));
        if (url) add("link", link.innerText || link.getAttribute("aria-label") || url, { url });
      }
    }
    if (["tables", "page"].includes(mode)) {
      for (const table of Array.from(root.querySelectorAll("table")).slice(0, 10)) {
        if (items.length >= maxItems || characters >= maxChars) { truncated = true; break; }
        if (!visible(table)) continue;
        const rows = Array.from(table.rows).slice(0, 30).map((row) => (
          Array.from(row.cells).slice(0, 20).map((cell) => clean(cell.innerText || cell.textContent, 300))
        )).filter((row) => row.some(Boolean));
        if (rows.length) add("table", rows.map((row) => row.join(" | ")).join("\\n"), { rows });
      }
    }
    if (["forms", "page"].includes(mode)) {
      for (const field of Array.from(root.querySelectorAll("input,textarea,select,button")).slice(0, 30)) {
        if (items.length >= maxItems || characters >= maxChars) { truncated = true; break; }
        if (!visible(field)) continue;
        const type = clean(field.getAttribute("type") || field.tagName.toLowerCase(), 40);
        if (type === "hidden" || type === "password") continue;
        const label = field.labels?.[0]?.innerText || field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.getAttribute("name") || field.innerText;
        add("field", label || "Unnamed field", { fieldType: type, required: Boolean(field.required) });
      }
    }
    return { title: clean(document.title, 300), items, truncated };
  }`;
}

function annotationOverlayExpression(annotations) {
  return `(() => {
    const overlayId = "__ipollowork_browser_annotations__";
    document.getElementById(overlayId)?.remove();
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden";
    const stablePixels = document.createElement("style");
    stablePixels.textContent = "*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important;transition:none!important}";
    overlay.appendChild(stablePixels);
    for (const item of ${JSON.stringify(annotations)}) {
      const box = document.createElement("div");
      box.style.cssText = ["position:absolute","box-sizing:border-box","border:2px solid #ff4d4f","border-radius:5px","background:rgba(255,77,79,.08)","left:"+item.left+"px","top:"+item.top+"px","width:"+Math.max(1,item.width)+"px","height:"+Math.max(1,item.height)+"px"].join(";");
      const label = document.createElement("span");
      label.textContent = item.ref;
      label.style.cssText = "position:absolute;left:-2px;top:-20px;padding:2px 5px;border-radius:4px;background:#ff4d4f;color:white;font:700 11px/16px ui-monospace,monospace;white-space:nowrap";
      box.appendChild(label);
      overlay.appendChild(box);
    }
    document.documentElement.appendChild(overlay);
    return true;
  })()`;
}

export function createBrowserRuntime({
  getTab,
  selectTab,
  focusWindow,
  listLocalWorkspaces,
  getUserDataPath,
  platform = process.platform,
}) {
  const tabStates = new Map();
  const queues = new Map();
  const stagedUploads = new Map();

  function stateFor(tabId) {
    let state = tabStates.get(tabId);
    if (!state) {
      state = {
        documentRevision: 1,
        snapshotSerial: 0,
        latestSnapshotId: null,
        url: null,
        nextRef: 1,
        backendRefs: new Map(),
        refs: new Map(),
        observations: new Map(),
        screenshots: new Map(),
        captureFiles: new Set(),
      };
      tabStates.set(tabId, state);
    }
    return state;
  }

  function invalidate(tabId) {
    const state = stateFor(tabId);
    state.documentRevision += 1;
    state.latestSnapshotId = null;
    state.url = null;
    state.nextRef = 1;
    state.backendRefs.clear();
    state.refs.clear();
    state.observations.clear();
    state.screenshots.clear();
  }

  async function forget(tabId) {
    const state = tabStates.get(tabId);
    const pending = queues.get(tabId);
    tabStates.delete(tabId);
    queues.delete(tabId);
    await pending?.catch(() => undefined);
    const uploadDirectories = stagedUploads.get(tabId) ?? [];
    stagedUploads.delete(tabId);
    await Promise.all([
      ...[...uploadDirectories].map((directory) => removeStagedUpload(directory).catch((error) => console.warn("Could not remove staged browser upload", error))),
      ...[...state?.captureFiles ?? []].map((filePath) =>
        rm(filePath, { force: true }).catch((error) => console.warn("Could not remove browser capture", error))),
    ]);
  }

  function resolveTab(rawTabId) {
    const tabId = typeof rawTabId === "string" ? rawTabId.trim() : "";
    const tab = getTab?.(tabId);
    if (!tab || tab.view?.webContents?.isDestroyed?.()) {
      throw new Error("Unknown or closed built-in browser tab.");
    }
    return tab;
  }

  function enqueue(tabId, job) {
    const previous = queues.get(tabId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(job);
    queues.set(tabId, current);
    return current.finally(() => {
      if (queues.get(tabId) === current) queues.delete(tabId);
    });
  }

  async function withDebugger(tab, job) {
    return enqueue(tab.tabId, async () => {
      const debuggerApi = tab.view.webContents.debugger;
      const attachedHere = !debuggerApi.isAttached();
      if (attachedHere) debuggerApi.attach("1.3");
      try {
        await debuggerCommand(debuggerApi, "DOM.enable");
        await debuggerCommand(debuggerApi, "Accessibility.enable");
        return await job(debuggerApi);
      } finally {
        if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
      }
    });
  }

  function referenceFor(state, node, { inferred = false } = {}) {
    const backendNodeId = Number(node?.backendDOMNodeId);
    if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) return null;
    let number = state.backendRefs.get(backendNodeId);
    if (!number) {
      number = state.nextRef;
      state.nextRef += 1;
      state.backendRefs.set(backendNodeId, number);
    }
    const ref = `@e${number}`;
    state.refs.set(ref, {
      backendNodeId,
      inferred,
      name: boundedText(accessibleName(node), MAX_EXPECTED_NAME),
      role: String(axValue(node.role) ?? "unknown"),
    });
    return ref;
  }

  async function captureSnapshot(tab, debuggerApi, payload = {}) {
    const startedAt = Date.now();
    const imageSelector = payload.imageSelector;
    if (imageSelector !== undefined && (typeof imageSelector !== "string" || !imageSelector.trim() || imageSelector.length > 200)) {
      throw new Error("Browser image selector is invalid.");
    }
    const mode = payload.mode === undefined ? "mixed" : String(payload.mode);
    if (!SNAPSHOT_MODES.has(mode)) throw new Error("Browser snapshot mode must be content, interactive, or mixed.");
    const state = stateFor(tab.tabId);
    const scopeRef = typeof payload.scopeRef === "string" ? payload.scopeRef.trim() : "";
    const scopeEntry = scopeRef ? requireRef(state, { ref: scopeRef }).entry : null;
    const scopeBackendNodeId = scopeEntry?.backendNodeId ?? null;
    const trees = await readAccessibilityTrees(debuggerApi);
    if (scopeBackendNodeId && !trees.some((tree) => tree.nodes.some((node) => Number(node?.backendDOMNodeId) === scopeBackendNodeId))) {
      const partial = await debuggerCommand(debuggerApi, "Accessibility.getPartialAXTree", {
        backendNodeId: scopeBackendNodeId,
        fetchRelatives: true,
      }).catch(() => null);
      if (Array.isArray(partial?.nodes)) trees.push({ depth: 0, nodes: partial.nodes });
    }
      state.snapshotSerial += 1;
      state.refs.clear();
      const snapshotId = `${tab.tabId}:${state.documentRevision}:${state.snapshotSerial}`;
      state.latestSnapshotId = snapshotId;
      state.url = tab.view.webContents.getURL();

      const lines = [];
      const controlLines = [];
      let emitted = 0;
      let inferredControls = 0;
      let truncated = false;

      let foundScope = !scopeBackendNodeId;
      for (const tree of trees) {
        const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
        const parentById = new Map(tree.nodes.flatMap((node) => (
          (node.childIds ?? []).map((childId) => [childId, node.nodeId])
        )));
        const childIds = new Set(tree.nodes.flatMap((node) => node.childIds ?? []));
        const scopedRoot = scopeBackendNodeId
          ? tree.nodes.find((node) => Number(node?.backendDOMNodeId) === scopeBackendNodeId)
          : null;
        if (scopeBackendNodeId && !scopedRoot) continue;
        if (scopedRoot) foundScope = true;
        const roots = scopedRoot ? [scopedRoot] : tree.nodes.filter((node) => !childIds.has(node.nodeId));
        const visited = new Set();
        const clickCandidates = [];
        const visit = (node, depth = tree.depth, insideNamedControl = false) => {
          if (!node || visited.has(node.nodeId)) return;
          visited.add(node.nodeId);
          const role = String(axValue(node.role) ?? "unknown");
          const name = normalizeText(axValue(node.name));
          const interactive = mode !== "content" && !node.ignored && INTERACTIVE_ROLES.has(role);
          const content = mode !== "interactive" && !node.ignored && CONTENT_ROLES.has(role) && name && !insideNamedControl;
          if (mode !== "content" && !node.ignored && name && !insideNamedControl && role === "StaticText" && clickCandidates.length < MAX_SNAPSHOT_NODES * 4) clickCandidates.push({ node, depth });
          // Reserve room for controls after long recommendation/comment lists.
          if ((interactive || content) && emitted < MAX_SNAPSHOT_NODES - (interactive ? 0 : 50)) {
            const ref = interactive ? referenceFor(state, node) : null;
            lines.push(snapshotLine(node, ref, depth));
            emitted += 1;
          } else if (interactive || content) {
            truncated = true;
          }
          for (const childId of node.childIds ?? []) {
            visit(byId.get(childId), depth + 1, insideNamedControl || interactive || Boolean(content));
          }
        };
        for (const root of roots) visit(root);
        if (!scopedRoot) for (const node of tree.nodes) visit(node);

        const inspected = new Map();
        for (const candidate of clickCandidates) {
          if (inferredControls >= MAX_INFERRED_CONTROLS) break;
          let ancestorId = parentById.get(candidate.node.nodeId);
          for (let depth = 0; ancestorId && depth < 4; depth += 1) {
            const ancestor = byId.get(ancestorId);
            ancestorId = ancestor ? parentById.get(ancestor.nodeId) : undefined;
            const backendNodeId = Number(ancestor?.backendDOMNodeId);
            if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
            if ([...state.refs.values()].some((entry) => entry.backendNodeId === backendNodeId)) break;
            if (!inspected.has(backendNodeId)) {
              const objectId = await resolvedNode(debuggerApi, { backendNodeId }).catch(() => null);
              inspected.set(backendNodeId, objectId ? await inspectElement(debuggerApi, objectId).catch(() => null) : null);
            }
            const metadata = inspected.get(backendNodeId);
            if (!metadata?.buttonLike || !(metadata.rendered ?? metadata.visible) || metadata.disabled || !metadata.text || metadata.text.length > MAX_EXPECTED_NAME) continue;
            const pseudoNode = {
              backendDOMNodeId: backendNodeId,
              name: { value: metadata.text },
              properties: [],
              role: { value: "button" },
            };
            const ref = referenceFor(state, pseudoNode, { inferred: true });
            controlLines.push(snapshotLine(pseudoNode, ref, candidate.depth)
              + (metadata.context && metadata.context !== metadata.text ? ` context=${quote(metadata.context)}` : ""));
            inferredControls += 1;
            break;
          }
        }
      }
      if (!foundScope) throw new Error("Browser scope reference is stale. Take a new full snapshot.");

      // Some rich editors retain a zero-height previous input when opening an
      // inline reply. Do not offer that stale editor as the active writable ref.
      for (const [ref, entry] of state.refs) {
        if (!WRITABLE_ROLES.has(entry.role)) continue;
        const objectId = await resolvedNode(debuggerApi, entry).catch(() => null);
        const metadata = objectId ? await inspectElement(debuggerApi, objectId).catch(() => null) : null;
        const index = lines.findIndex(line => line.includes(`[${ref}]`));
        if (metadata && !(metadata.rendered ?? metadata.visible)) {
          if (index >= 0) lines.splice(index, 1);
          state.refs.delete(ref);
        } else if (index >= 0 && metadata?.context) lines[index] += ` context=${quote(metadata.context)}`;
      }

      // Supplement file inputs and role-less rich editors omitted by the AX
      // tree, using DOM-backed refs without exposing arbitrary page evaluation.
      const flattened = mode === "content" || scopeBackendNodeId ? { nodes: [] } : await debuggerCommand(debuggerApi, "DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true,
      }).catch(() => ({ nodes: [] }));
      let supplementalControls = 0;
      for (const node of flattened?.nodes ?? []) {
        if (supplementalControls >= MAX_INFERRED_CONTROLS) {
          truncated = true;
          break;
        }
        const attributes = domAttributes(node);
        const fileInput = String(node?.nodeName ?? "").toUpperCase() === "INPUT" && attributes.type?.toLowerCase() === "file";
        const editor = ["", "true", "plaintext-only"].includes(attributes.contenteditable);
        if (!fileInput && !editor) continue;
        const backendNodeId = Number(node?.backendNodeId);
        if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
        if ([...state.refs.values()].some((entry) => entry.backendNodeId === backendNodeId)) continue;
        const objectId = editor ? await resolvedNode(debuggerApi, { backendNodeId }).catch(() => null) : null;
        const metadata = objectId ? await inspectElement(debuggerApi, objectId).catch(() => null) : null;
        if (editor && (!metadata?.writable || !(metadata.rendered ?? metadata.visible) || metadata.disabled)) continue;
        const name = editor ? metadata.label || "Unnamed textbox" : attributes["aria-label"] || attributes.title || attributes.name || "Upload file";
        const pseudoNode = {
          backendDOMNodeId: backendNodeId,
          name: { value: boundedText(name, MAX_EXPECTED_NAME) },
          properties: [],
          role: { value: editor ? "textbox" : "fileinput" },
        };
        const ref = referenceFor(state, pseudoNode, { inferred: editor });
        controlLines.push(snapshotLine(pseudoNode, ref, 1));
        supplementalControls += 1;
      }

      let imageUrl = null;
      if (imageSelector) {
        const { root } = await debuggerCommand(debuggerApi, "DOM.getDocument", { depth: 0 });
        const { nodeIds } = await debuggerCommand(debuggerApi, "DOM.querySelectorAll", { nodeId: root.nodeId, selector: imageSelector });
        // A configured profile selector must identify exactly one visible image.
        if (nodeIds.length === 1) {
          const { node } = await debuggerCommand(debuggerApi, "DOM.describeNode", { nodeId: nodeIds[0] });
          const objectId = await resolvedNode(debuggerApi, { backendNodeId: node.backendNodeId });
          const metadata = await inspectElement(debuggerApi, objectId);
          if (metadata.visible && metadata.unobstructed && /^https?:\/\//.test(metadata.imageSrc || "")) imageUrl = metadata.imageSrc;
        }
        if (tab.view.webContents.getURL() !== state.url) throw new Error("Browser page changed during snapshot.");
      }
      const controls = controlLines.join("\n");
      let tree = lines.join("\n");
      if (tree.length + controls.length > MAX_SNAPSHOT_TEXT) {
        tree = `${tree.slice(0, MAX_SNAPSHOT_TEXT - controls.length - 25)}\n… snapshot truncated`;
        truncated = true;
      }
      if (controls) tree += `\n${controls}`;
      const fullTree = tree || "(No accessible page content)";
      const key = observationKey(mode, scopeBackendNodeId);
      const previousTree = state.observations.get(key)?.tree ?? "";
      const rendered = payload.delta === true ? lineDelta(previousTree, fullTree) : {
        change: previousTree === fullTree ? "unchanged" : "full",
        tree: fullTree,
        delta: null,
      };
      state.observations.set(key, { snapshotId, tree: fullTree });
      const elapsedMs = Date.now() - startedAt;
      return {
        ok: true,
        provider: "builtin",
        tabId: tab.tabId,
        snapshotId,
        url: state.url,
        title: tab.view.webContents.getTitle(),
        mode,
        ...(scopeRef ? { scopeRef } : {}),
        tree: rendered.tree,
        change: rendered.change,
        ...(rendered.delta ? { delta: rendered.delta } : {}),
        ...(imageSelector ? { imageUrl } : {}),
        elementCount: state.refs.size,
        truncated,
        metrics: {
          elapsedMs,
          characters: rendered.tree.length,
          fullCharacters: fullTree.length,
          savedCharacters: Math.max(0, fullTree.length - rendered.tree.length),
        },
      };
  }

  async function snapshot(payload = {}) {
    const tab = resolveTab(payload.tabId);
    return withDebugger(tab, (debuggerApi) => captureSnapshot(tab, debuggerApi, payload));
  }

  async function currentAccessibleEntry(debuggerApi, entry) {
    const response = await debuggerCommand(debuggerApi, "Accessibility.getPartialAXTree", {
      backendNodeId: entry.backendNodeId,
      fetchRelatives: false,
    });
    const nodes = Array.isArray(response?.nodes) ? response.nodes : [];
    const current = nodes.find((node) => Number(node?.backendDOMNodeId) === entry.backendNodeId) ?? nodes[0];
    if (!current || current.ignored) throw new Error("Browser reference is stale. Take a new snapshot.");
    return {
      checked: axProperty(current, "checked"),
      name: boundedText(accessibleName(current), MAX_EXPECTED_NAME),
      role: String(axValue(current.role) ?? "unknown"),
    };
  }

  async function resolvedNode(debuggerApi, entry) {
    const result = await debuggerCommand(debuggerApi, "DOM.resolveNode", { backendNodeId: entry.backendNodeId });
    const objectId = result?.object?.objectId;
    if (!objectId) throw new Error("Browser reference is stale. Take a new snapshot.");
    return objectId;
  }

  async function inspectElement(debuggerApi, objectId, { scrollIntoView = false } = {}) {
    const inspected = await debuggerCommand(debuggerApi, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: automationMetadataFunction(),
      arguments: [{ value: scrollIntoView }],
      returnByValue: true,
      awaitPromise: true,
    });
    return inspected?.result?.value ?? null;
  }

  async function read(payload = {}) {
    const tab = resolveTab(payload.tabId);
    const mode = payload.mode === undefined ? "page" : String(payload.mode);
    if (!READ_MODES.has(mode)) throw new Error("Browser read mode must be article, forms, links, page, or tables.");
    const maxChars = payload.maxChars === undefined ? MAX_READ_TEXT : Number(payload.maxChars);
    if (!Number.isInteger(maxChars) || maxChars < 1_000 || maxChars > MAX_READ_TEXT) {
      throw new Error(`Browser read maxChars must be between 1000 and ${MAX_READ_TEXT}.`);
    }
    return withDebugger(tab, async (debuggerApi) => {
      const startedAt = Date.now();
      const url = tab.view.webContents.getURL();
      const response = await debuggerCommand(debuggerApi, "Runtime.evaluate", {
        expression: `(${pageReadFunction()})(${JSON.stringify({ mode, maxChars, maxItems: MAX_READ_ITEMS })})`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (tab.view.webContents.getURL() !== url) throw new Error("Browser page changed during read. Retry the read on the latest page.");
      const value = response?.result?.value;
      const items = Array.isArray(value?.items) ? value.items : [];
      const lines = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const text = boundedText(item.text, 4_000);
        if (!text) continue;
        if (item.kind === "heading") lines.push(`${"#".repeat(Math.max(1, Math.min(6, Number(item.level) || 2)))} ${text}`);
        else if (item.kind === "link" && typeof item.url === "string") lines.push(`- [${text}](${item.url})`);
        else if (item.kind === "field") lines.push(`- ${text} (${boundedText(item.fieldType, 40)}${item.required ? ", required" : ""})`);
        else lines.push(text);
      }
      const content = lines.join("\n").slice(0, maxChars) || "(No readable page content)";
      return {
        ok: true,
        provider: "builtin",
        tabId: tab.tabId,
        url,
        title: boundedText(value?.title || tab.view.webContents.getTitle(), 300),
        mode,
        content,
        itemCount: items.length,
        truncated: Boolean(value?.truncated) || lines.join("\n").length > maxChars,
        metrics: { elapsedMs: Date.now() - startedAt, characters: content.length },
      };
    });
  }

  async function screenshot(payload = {}) {
    const tab = resolveTab(payload.tabId);
    const target = payload.target === undefined ? "viewport" : String(payload.target);
    if (!["ref", "region", "viewport"].includes(target)) {
      throw new Error("Browser screenshot target must be viewport, region, or ref.");
    }
    const visualMode = payload.mode === undefined ? "plain" : String(payload.mode);
    if (!["annotated", "auto", "plain"].includes(visualMode)) {
      throw new Error("Browser screenshot mode must be plain, annotated, or auto.");
    }
    return withDebugger(tab, async (debuggerApi) => {
      const startedAt = Date.now();
      const state = stateFor(tab.tabId);
      const snapshotId = typeof payload.snapshotId === "string" ? payload.snapshotId.trim() : "";
      const needsSnapshot = target === "ref" || visualMode === "annotated" || (visualMode === "auto" && state.refs.size > 0);
      if (needsSnapshot && (!snapshotId || snapshotId !== state.latestSnapshotId || state.url !== tab.view.webContents.getURL())) {
        throw new Error("Browser screenshot requires the latest snapshotId for ref or annotated capture.");
      }
      const layout = await debuggerCommand(debuggerApi, "Page.getLayoutMetrics").catch(() => null);
      const viewport = layout?.cssVisualViewport ?? layout?.visualViewport ?? {
        clientWidth: tab.view.getBounds?.().width ?? 800,
        clientHeight: tab.view.getBounds?.().height ?? 600,
        pageX: 0,
        pageY: 0,
      };
      const viewportWidth = Math.max(1, Number(viewport.clientWidth) || 800);
      const viewportHeight = Math.max(1, Number(viewport.clientHeight) || 600);
      let clip = null;
      let ref = "";
      if (target === "region") {
        const region = payload.region && typeof payload.region === "object" ? payload.region : {};
        const x = Number(region.x);
        const y = Number(region.y);
        const width = Number(region.width);
        const height = Number(region.height);
        if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
          || width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION) {
          throw new Error("Browser screenshot region requires bounded positive x, y, width, and height.");
        }
        clip = {
          x: (Number(viewport.pageX) || 0) + Math.min(x, viewportWidth - 1),
          y: (Number(viewport.pageY) || 0) + Math.min(y, viewportHeight - 1),
          width: Math.min(width, viewportWidth - Math.min(x, viewportWidth - 1)),
          height: Math.min(height, viewportHeight - Math.min(y, viewportHeight - 1)),
          scale: 1,
        };
      } else if (target === "ref") {
        const required = requireRef(state, payload);
        ref = required.ref;
        const objectId = await resolvedNode(debuggerApi, required.entry);
        const metadata = await inspectElement(debuggerApi, objectId, { scrollIntoView: true });
        if (!metadata?.visible || !metadata.bounds?.width || !metadata.bounds?.height) {
          throw new Error("Browser screenshot reference is not visible.");
        }
        const currentLayout = await debuggerCommand(debuggerApi, "Page.getLayoutMetrics").catch(() => null);
        const refViewport = currentLayout?.cssVisualViewport ?? currentLayout?.visualViewport ?? viewport;
        clip = {
          x: (Number(refViewport.pageX) || 0) + Math.max(0, Number(metadata.bounds.left) || 0),
          y: (Number(refViewport.pageY) || 0) + Math.max(0, Number(metadata.bounds.top) || 0),
          width: Math.min(MAX_SCREENSHOT_DIMENSION, Number(metadata.bounds.width)),
          height: Math.min(MAX_SCREENSHOT_DIMENSION, Number(metadata.bounds.height)),
          scale: 1,
        };
      }

      const annotate = visualMode === "annotated" || (visualMode === "auto" && state.refs.size > 0);
      let annotations = [];
      if (annotate) {
        for (const [entryRef, entry] of state.refs) {
          if (annotations.length >= MAX_SCREENSHOT_ANNOTATIONS) break;
          const objectId = await resolvedNode(debuggerApi, entry).catch(() => null);
          const metadata = objectId ? await inspectElement(debuggerApi, objectId).catch(() => null) : null;
          if (!metadata?.visible || !metadata.bounds?.width || !metadata.bounds?.height) continue;
          annotations.push({ ref: entryRef, ...metadata.bounds });
        }
      }
      await debuggerCommand(debuggerApi, "Runtime.evaluate", {
        expression: annotationOverlayExpression(annotations),
        returnByValue: true,
      });
      let captured;
      try {
        captured = await debuggerCommand(debuggerApi, "Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          ...(clip ? { clip } : {}),
        });
      } finally {
        await debuggerCommand(debuggerApi, "Runtime.evaluate", {
          expression: 'document.getElementById("__ipollowork_browser_annotations__")?.remove(); true',
          returnByValue: true,
        }).catch(() => {});
      }
      const bytes = Buffer.from(String(captured?.data ?? ""), "base64");
      if (bytes.length === 0) throw new Error("Built-in browser returned an empty screenshot.");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const screenshotKey = JSON.stringify({ target, ref, region: payload.region ?? null, annotate });
      const previous = state.screenshots.get(screenshotKey);
      const changed = previous?.hash !== hash;
      if (payload.ifChanged === true && !changed) {
        return {
          ok: true,
          provider: "builtin",
          tabId: tab.tabId,
          url: tab.view.webContents.getURL(),
          target,
          mode: annotate ? "annotated" : "plain",
          changed: false,
          imagePath: previous.filePath,
          mimeType: "image/png",
          metrics: { elapsedMs: Date.now() - startedAt, bytes: 0, annotations: annotations.length },
        };
      }
      const directory = path.join(getUserDataPath(), "browser-captures");
      await mkdir(directory, { recursive: true });
      const keyHash = createHash("sha256").update(screenshotKey).digest("hex").slice(0, 12);
      const filePath = path.join(directory, `${safeStorageSegment(tab.tabId)}-${keyHash}.png`);
      await writeFile(filePath, bytes);
      state.captureFiles.add(filePath);
      state.screenshots.set(screenshotKey, { filePath, hash });
      return {
        ok: true,
        provider: "builtin",
        tabId: tab.tabId,
        url: tab.view.webContents.getURL(),
        target,
        mode: annotate ? "annotated" : "plain",
        changed,
        imagePath: filePath,
        mimeType: "image/png",
        hash,
        metrics: { elapsedMs: Date.now() - startedAt, bytes: bytes.length, annotations: annotations.length },
      };
    });
  }

  function requireExpectedName(action, current, actionName) {
    const rawExpectedName = typeof action.expectedName === "string" ? action.expectedName.trim() : "";
    if (!rawExpectedName || rawExpectedName.length > MAX_EXPECTED_NAME) {
      throw new Error(`Browser ${actionName} requires the short exact accessible name from the latest snapshot.`);
    }
    const expectedName = boundedText(rawExpectedName, MAX_EXPECTED_NAME);
    if (normalizeText(current.name) !== normalizeText(expectedName)) {
      throw new Error("Browser target name changed. Take a new snapshot before acting.");
    }
  }

  function focusBrowserTarget(tab) {
    focusWindow?.();
    selectTab?.(tab.tabId);
    tab.view.webContents.focus();
  }

  function sendPointerClick(tab, metadata) {
    focusBrowserTarget(tab);
    const point = { x: Math.round(metadata.x), y: Math.round(metadata.y) };
    tab.view.webContents.sendInputEvent({ type: "mouseMove", ...point });
    tab.view.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    tab.view.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  }

  async function interceptFileChooser(debuggerApi, trigger) {
    let chooser = null;
    const onMessage = (_event, method, params) => {
      if (method === "Page.fileChooserOpened") chooser = params;
    };
    await debuggerCommand(debuggerApi, "Page.enable");
    debuggerApi.on("message", onMessage);
    try {
      await debuggerCommand(debuggerApi, "Page.setInterceptFileChooserDialog", { enabled: true });
      await trigger();
      if (!chooser) await new Promise((resolve) => setTimeout(resolve, FILE_CHOOSER_EVENT_MS));
      return chooser;
    } finally {
      await debuggerCommand(debuggerApi, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
      debuggerApi.removeListener("message", onMessage);
    }
  }

  function fileChooserResult(state, chooser) {
    const backendNodeId = Number(chooser?.backendNodeId);
    if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) {
      state.latestSnapshotId = null;
      return { type: "fileChooser", message: "File picker was intercepted. Take a new snapshot and use the browser upload action; do not ask the user to choose a file." };
    }
    const ref = referenceFor(state, {
      backendDOMNodeId: backendNodeId,
      role: { value: "fileinput" },
      name: { value: "Upload file" },
    });
    return { type: "fileChooser", uploadRef: ref, message: "File picker was intercepted. Use the browser upload action with this ref and the generated file path; do not ask the user to choose a file." };
  }

  async function waitUntil(check, timeoutMs, description) {
    const startedAt = Date.now();
    while (true) {
      if (await check()) return Date.now() - startedAt;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) throw new Error(`Browser waitFor timed out waiting for ${description}.`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_POLL_MS, timeoutMs - elapsedMs)));
    }
  }

  async function performStructuredWait({ action, debuggerApi, state, tab }) {
    const timeoutMs = action.timeoutMs === undefined ? DEFAULT_WAIT_FOR_MS : Number(action.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < WAIT_POLL_MS || timeoutMs > MAX_WAIT_FOR_MS) {
      throw new Error(`Browser waitFor timeout must be between ${WAIT_POLL_MS} and ${MAX_WAIT_FOR_MS} ms.`);
    }
    const condition = typeof action.condition === "string" ? action.condition : "";
    let elapsedMs;
    if (condition === "url") {
      const value = typeof action.value === "string" ? action.value.trim() : "";
      const match = action.match === "contains" ? "contains" : "equals";
      if (!value || value.length > 2_048) throw new Error("Browser waitFor URL requires a bounded non-empty value.");
      elapsedMs = await waitUntil(() => {
        const currentUrl = tab.view.webContents.getURL();
        return match === "contains" ? currentUrl.includes(value) : currentUrl === value;
      }, timeoutMs, `URL to ${match} ${value}`);
    } else if (condition === "text") {
      const value = typeof action.value === "string" ? normalizeText(action.value) : "";
      if (!value || value.length > 500) throw new Error("Browser waitFor text requires a bounded non-empty value.");
      const expected = value.toLocaleLowerCase();
      elapsedMs = await waitUntil(async () => {
        const trees = await readAccessibilityTrees(debuggerApi).catch(() => []);
        return trees.some((tree) => tree.nodes.some((node) => {
          if (node?.ignored) return false;
          const name = normalizeText(axValue(node.name));
          const protectedValue = axProperty(node, "protected") === true;
          const currentValue = protectedValue ? "" : normalizeText(axValue(node.value));
          return `${name} ${currentValue}`.toLocaleLowerCase().includes(expected);
        }));
      }, timeoutMs, `accessible text ${value}`);
    } else if (condition === "ref") {
      const { ref, entry } = requireRef(state, action);
      const requestedState = action.state === "visible" ? "visible" : "attached";
      elapsedMs = await waitUntil(async () => {
        try {
          await currentAccessibleEntry(debuggerApi, entry);
          if (requestedState === "attached") return true;
          const objectId = await resolvedNode(debuggerApi, entry);
          const metadata = await inspectElement(debuggerApi, objectId);
          return Boolean(metadata?.visible && !metadata.disabled);
        } catch {
          return false;
        }
      }, timeoutMs, `${ref} to be ${requestedState}`);
    } else if (condition === "load") {
      const requestedState = action.state === "interactive" ? "interactive" : "complete";
      elapsedMs = await waitUntil(async () => {
        const response = await debuggerCommand(debuggerApi, "Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        }).catch(() => null);
        const readyState = response?.result?.value;
        return requestedState === "interactive"
          ? readyState === "interactive" || readyState === "complete"
          : readyState === "complete";
      }, timeoutMs, `document readiness ${requestedState}`);
    } else {
      throw new Error("Unsupported browser waitFor condition.");
    }
    state.latestSnapshotId = null;
    return { type: "waitFor", condition, elapsedMs };
  }

  async function resolveUploadFiles(rawPaths, rawWorkspaceRoot, rawExtensionId) {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0 || rawPaths.length > MAX_UPLOAD_FILES) {
      throw new Error(`Browser upload requires 1-${MAX_UPLOAD_FILES} files.`);
    }
    const requestedWorkspaceRoot = typeof rawWorkspaceRoot === "string" ? rawWorkspaceRoot.trim() : "";
    if (!requestedWorkspaceRoot) throw new Error("Browser upload requires an active local workspace.");
    const registeredWorkspaces = typeof listLocalWorkspaces === "function" ? await listLocalWorkspaces() : [];
    const workspace = registeredWorkspaces.find((entry) => (
      typeof entry?.path === "string" && path.resolve(entry.path) === path.resolve(requestedWorkspaceRoot)
    ));
    if (!workspace?.id) throw new Error("Browser upload workspace is not registered locally.");
    const workspaceRoot = await realpath(path.resolve(workspace.path));
    const storageRoots = [...new Set([
      getUserDataPath(),
      workspace.runtimeStorageRoot,
    ].filter((value) => typeof value === "string" && value.trim()).map((value) => path.resolve(value.trim())))];
    const trustedStorageRoots = (await Promise.all(storageRoots.map((root) => realpath(root).catch(() => null))))
      .filter(Boolean);
    const extensionId = typeof rawExtensionId === "string" && /^[A-Za-z0-9._-]+$/.test(rawExtensionId.trim())
      ? rawExtensionId.trim()
      : "";
    const selected = await Promise.all(rawPaths.map(async (rawPath) => {
      if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("Browser upload file paths must be non-empty strings.");
      const requestedPath = rawPath.trim();
      const filePath = await realpath(path.isAbsolute(requestedPath)
        ? path.resolve(requestedPath)
        : path.resolve(workspaceRoot, requestedPath));
      if (!pathWithin(workspaceRoot, filePath)
        && !trustedStorageRoots.some((root) => pluginDataPathAllowed(filePath, root, workspace.id, extensionId))) {
        throw new Error("Browser upload files must belong to the active workspace or the named plugin's private data.");
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Browser upload targets must be files.");
      if (fileStat.size > MAX_UPLOAD_FILE_BYTES) throw new Error("Browser upload file exceeds the 1 GB limit.");
      return { filePath, size: fileStat.size };
    }));
    if (platform !== "win32" || selected.every(({ filePath }) => filePath.length < MAX_WINDOWS_BROWSER_PATH)) {
      return { files: selected.map(({ filePath }) => filePath), sizes: selected.map(({ size }) => size), stagedDirectory: null };
    }
    const stagedDirectory = await mkdtemp(path.join(tmpdir(), "ipw-upload-"));
    try {
      const usedNames = new Set();
      const files = [];
      for (const [index, selectedFile] of selected.entries()) {
        if (selectedFile.filePath.length < MAX_WINDOWS_BROWSER_PATH) {
          files.push(selectedFile.filePath);
          continue;
        }
        let name = path.basename(selectedFile.filePath);
        if (usedNames.has(name) || path.join(stagedDirectory, name).length >= MAX_WINDOWS_BROWSER_PATH) {
          name = `video-${index}${path.extname(name)}`;
        }
        usedNames.add(name);
        const stagedPath = path.join(stagedDirectory, name);
        if (stagedPath.length >= MAX_WINDOWS_BROWSER_PATH) throw new Error("Browser upload staging path is too long.");
        await copyFile(selectedFile.filePath, stagedPath);
        files.push(stagedPath);
      }
      return { files, sizes: selected.map(({ size }) => size), stagedDirectory };
    } catch (error) {
      await removeStagedUpload(stagedDirectory);
      throw error;
    }
  }

  function requireRef(state, action) {
    const rawRef = typeof action?.ref === "string" ? action.ref.trim() : "";
    const shorthandMatch = /^@?e(\d+)$/i.exec(rawRef);
    const ref = shorthandMatch ? `@e${shorthandMatch[1]}` : rawRef;
    const entry = state.refs.get(ref);
    if (!entry) throw new Error("Browser reference is stale or unknown. Take a new snapshot.");
    return { ref, entry };
  }

  async function performAction({ action, debuggerApi, state, tab, workspaceRoot }) {
    if (action.type === "wait") {
      const durationMs = Number(action.durationMs);
      if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_WAIT_MS) {
        throw new Error(`Browser wait must be between 0 and ${MAX_WAIT_MS} ms.`);
      }
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return { type: "wait", durationMs };
    }
    if (action.type === "waitFor") {
      return performStructuredWait({ action, debuggerApi, state, tab });
    }
    if (action.type === "press") {
      const key = typeof action.key === "string" ? action.key.trim() : "";
      if (NAVIGATION_KEYS.has(key)) {
        focusBrowserTarget(tab);
        await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", { type: "keyDown", key });
        await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", { type: "keyUp", key });
        return { type: "press", key };
      }
      if (!ACTIVATION_KEYS.has(key)) throw new Error("Unsupported browser key. Use fill for text input.");
      if (typeof action.ref !== "string" || !action.ref.trim() || typeof action.expectedName !== "string" || !action.expectedName.trim()) {
        throw new Error("Browser Enter and Space require a stable ref and exact accessible name.");
      }
      const { ref, entry } = requireRef(state, action);
      const objectId = await resolvedNode(debuggerApi, entry);
      const metadata = await inspectElement(debuggerApi, objectId, { scrollIntoView: true });
      const current = entry.inferred
        ? { name: boundedText(entry.role === "textbox" ? metadata?.label || "Unnamed textbox" : metadata?.text, MAX_EXPECTED_NAME), role: entry.role }
        : await currentAccessibleEntry(debuggerApi, entry);
      const editorEnter = key === "Enter" && metadata?.writable && WRITABLE_ROLES.has(current.role);
      requireExpectedName(action, current, "activation key");
      if (!metadata?.visible || metadata.disabled || (!metadata.buttonLike && !ACTIVATABLE_ROLES.has(current.role) && !editorEnter)) {
        throw new Error("Browser activation-key target is not a visible enabled control.");
      }
      focusBrowserTarget(tab);
      await debuggerCommand(debuggerApi, "DOM.focus", { backendNodeId: entry.backendNodeId });
      const eventKey = key === "Space" ? " " : key;
      const code = key === "Space" ? "Space" : "Enter";
      const windowsVirtualKeyCode = key === "Space" ? 32 : 13;
      const chooser = await interceptFileChooser(debuggerApi, async () => {
        await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: eventKey,
          code,
          windowsVirtualKeyCode,
          text: key === "Enter" ? "\r" : " ",
          unmodifiedText: key === "Enter" ? "\r" : " ",
        });
        await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: eventKey,
          code,
          windowsVirtualKeyCode,
        });
      });
      if (chooser) return fileChooserResult(state, chooser);
      state.latestSnapshotId = null;
      return { type: "press", key, ref, name: current.name };
    }
    if (action.type === "scroll") {
      const direction = typeof action.direction === "string" ? action.direction : "";
      const amount = typeof action.amount === "string" ? action.amount : "";
      const distance = SCROLL_DISTANCE[amount];
      if (!distance || !["down", "left", "right", "up"].includes(direction)) {
        throw new Error("Browser scroll requires a supported direction and amount.");
      }
      focusBrowserTarget(tab);
      const bounds = tab.view.getBounds?.() ?? { width: 800, height: 600 };
      const point = {
        x: Math.max(1, Math.round(Number(bounds.width || 800) / 2)),
        y: Math.max(1, Math.round(Number(bounds.height || 600) / 2)),
      };
      const signedDistance = direction === "up" || direction === "left" ? -distance : distance;
      tab.view.webContents.sendInputEvent({ type: "mouseMove", ...point });
      tab.view.webContents.sendInputEvent({
        type: "mouseWheel",
        ...point,
        deltaX: direction === "left" || direction === "right" ? signedDistance : 0,
        deltaY: direction === "up" || direction === "down" ? signedDistance : 0,
      });
      state.latestSnapshotId = null;
      return { type: "scroll", direction, amount };
    }

    const { ref, entry } = requireRef(state, action);
    const objectId = await resolvedNode(debuggerApi, entry);
    const metadata = await inspectElement(debuggerApi, objectId, { scrollIntoView: true });

    if (action.type === "upload") {
      if (!metadata?.fileInput) {
        const current = await currentAccessibleEntry(debuggerApi, entry);
        requireExpectedName(action, current, "upload");
        if (!UPLOAD_CONTROL_NAME.test(current.name) || !metadata?.buttonLike || !metadata.visible || metadata.disabled || !metadata.unobstructed) {
          throw new Error("Browser upload requires a file input or a visible upload control with its exact accessible name.");
        }
      } else if (metadata.disabled) {
        throw new Error("Browser upload target is disabled.");
      }
      const upload = await resolveUploadFiles(action.filePaths, workspaceRoot, action.extensionId);
      let backendNodeId = entry.backendNodeId;
      try {
        if (!metadata?.fileInput) {
          const chooser = await interceptFileChooser(debuggerApi, () => sendPointerClick(tab, metadata));
          backendNodeId = Number(chooser?.backendNodeId);
          if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) {
            throw new Error("Upload control did not expose a file input. Take a new snapshot and upload through its file-input ref.");
          }
        }
        await debuggerCommand(debuggerApi, "DOM.setFileInputFiles", {
          files: upload.files,
          backendNodeId,
        });
        const fileInputObjectId = await resolvedNode(debuggerApi, { backendNodeId });
        const observed = await debuggerCommand(debuggerApi, "Runtime.callFunctionOn", {
          objectId: fileInputObjectId,
          functionDeclaration: "function () { return Array.from(this.files || [], file => file.size); }",
          returnByValue: true,
        });
        const sizes = observed?.result?.value;
        if (Array.isArray(sizes) && sizes.length > 0 && (sizes.length !== upload.sizes.length || sizes.some((size, index) => size !== upload.sizes[index]))) {
          throw new Error("Browser received an incomplete upload file. The original video was not submitted.");
        }
        if (upload.stagedDirectory) {
          const directories = stagedUploads.get(tab.tabId) ?? new Set();
          directories.add(upload.stagedDirectory);
          stagedUploads.set(tab.tabId, directories);
        }
      } catch (error) {
        if (upload.stagedDirectory) await removeStagedUpload(upload.stagedDirectory);
        throw error;
      }
      state.latestSnapshotId = null;
      return { type: "upload", ref, count: upload.files.length };
    }

    const current = entry.inferred
      ? { name: boundedText(entry.role === "textbox" ? metadata?.label || "Unnamed textbox" : metadata?.text, MAX_EXPECTED_NAME), role: entry.role }
      : await currentAccessibleEntry(debuggerApi, entry);
    if (!metadata?.visible || metadata.disabled) {
      throw new Error("Browser target is not visible and enabled. Take a new snapshot after correcting the page state.");
    }

    if (action.type === "click") {
      requireExpectedName(action, current, "click");
      if (!metadata.buttonLike || !metadata.unobstructed) {
        throw new Error("Browser click target is not an unobstructed interactive control.");
      }
      const chooser = await interceptFileChooser(debuggerApi, () => sendPointerClick(tab, metadata));
      if (chooser) return fileChooserResult(state, chooser);
      state.latestSnapshotId = null;
      return { type: "click", ref, name: current.name };
    }

    if (action.type === "fill") {
      if (!WRITABLE_ROLES.has(current.role) || !metadata.writable) {
        throw new Error("Browser fill target is not a writable field.");
      }
      const value = typeof action.value === "string" ? action.value : "";
      if (value.length > MAX_FILL_TEXT) throw new Error("Browser fill text is too long.");
      focusBrowserTarget(tab);
      await debuggerCommand(debuggerApi, "DOM.focus", { backendNodeId: entry.backendNodeId });
      tab.view.webContents.selectAll();
      await debuggerCommand(debuggerApi, "Input.insertText", { text: value });
      return { type: "fill", ref, characters: Array.from(value).length };
    }

    if (action.type === "hover") {
      requireExpectedName(action, current, "hover");
      if (!metadata.unobstructed) throw new Error("Browser hover target is obstructed.");
      focusBrowserTarget(tab);
      tab.view.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(metadata.x),
        y: Math.round(metadata.y),
      });
      state.latestSnapshotId = null;
      return { type: "hover", ref, name: current.name };
    }

    if (action.type === "select") {
      requireExpectedName(action, current, "select");
      if (!metadata.nativeSelect || !metadata.unobstructed || !["combobox", "listbox"].includes(current.role)) {
        throw new Error("Browser select target is not a native select control.");
      }
      const option = typeof action.option === "string" ? action.option.trim() : "";
      if (!option || option.length > 500) throw new Error("Browser select requires one bounded exact option label or value.");
      const response = await debuggerCommand(debuggerApi, "Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: selectExactOptionFunction(),
        arguments: [{ value: option }],
        returnByValue: true,
        awaitPromise: true,
      });
      const selected = response?.result?.value;
      if (!selected?.ok) {
        const reason = selected?.reason === "ambiguous" ? "is ambiguous" : "was not found";
        throw new Error(`Browser select option ${reason}. Take a new snapshot and use an exact option label or value.`);
      }
      if (selected.changed) state.latestSnapshotId = null;
      return {
        type: "select",
        ref,
        name: current.name,
        option: selected.label,
        value: selected.value,
        changed: Boolean(selected.changed),
      };
    }

    if (action.type === "check") {
      requireExpectedName(action, current, "check");
      if (!CHECKABLE_ROLES.has(current.role) || !metadata.checkable) {
        throw new Error("Browser check target is not a checkbox, radio, or switch.");
      }
      const checked = action.checked;
      if (typeof checked !== "boolean") throw new Error("Browser check requires a boolean checked state.");
      if (RADIO_ROLES.has(current.role) && checked === false) {
        throw new Error("Browser radio controls can only be checked; choose another option to change the selection.");
      }
      if (current.checked === checked) {
        return { type: "check", ref, name: current.name, checked, changed: false };
      }
      if (!metadata.unobstructed) throw new Error("Browser check target is obstructed.");
      sendPointerClick(tab, metadata);
      state.latestSnapshotId = null;
      return { type: "check", ref, name: current.name, checked, changed: true };
    }

    throw new Error(`Unsupported browser action: ${String(action.type ?? "missing")}`);
  }

  async function act(payload = {}) {
    const startedAt = Date.now();
    const tab = resolveTab(payload.tabId);
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (actions.length === 0 || actions.length > MAX_ACTIONS) {
      throw new Error(`Browser act requires 1-${MAX_ACTIONS} actions.`);
    }
    const totalWait = actions.reduce((sum, action) => {
      if (action?.type === "wait") return sum + Number(action.durationMs || 0);
      if (action?.type === "waitFor") {
        return sum + (action.timeoutMs === undefined ? DEFAULT_WAIT_FOR_MS : Number(action.timeoutMs));
      }
      return sum;
    }, 0);
    if (!Number.isFinite(totalWait) || totalWait > MAX_TOTAL_WAIT_MS) {
      throw new Error(`Browser action batch may wait at most ${MAX_TOTAL_WAIT_MS} ms in total.`);
    }
    const observe = payload.observe && typeof payload.observe === "object" && !Array.isArray(payload.observe)
      ? payload.observe
      : null;
    if (observe) {
      const settleMs = observe.settleMs === undefined ? 100 : Number(observe.settleMs);
      if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > MAX_OBSERVATION_SETTLE_MS) {
        throw new Error(`Browser observation settleMs must be between 0 and ${MAX_OBSERVATION_SETTLE_MS}.`);
      }
    }
    return withDebugger(tab, async (debuggerApi) => {
      const state = stateFor(tab.tabId);
      const snapshotId = typeof payload.snapshotId === "string" ? payload.snapshotId.trim() : "";
      if (!snapshotId || snapshotId !== state.latestSnapshotId || state.url !== tab.view.webContents.getURL()) {
        throw new Error("Browser snapshot is stale. Take a new snapshot before acting.");
      }
      // Windows may deny foreground focus to a scheduled background task. Keep
      // Chromium input active for this bounded batch, then release it again.
      await debuggerCommand(debuggerApi, "Emulation.setFocusEmulationEnabled", { enabled: true });
      try {
        const results = [];
        for (const action of actions) {
          if (!action || typeof action !== "object") throw new Error("Browser actions must be objects.");
          const result = await performAction({
            action,
            debuggerApi,
            state,
            tab,
            workspaceRoot: payload.workspaceRoot,
          });
          results.push(result);
          if (state.latestSnapshotId !== snapshotId || result.type === "fileChooser") break;
        }
        let observation = null;
        if (observe) {
          const settleMs = observe.settleMs === undefined ? 100 : Number(observe.settleMs);
          if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
          if (observe.waitForLoad) {
            await performStructuredWait({
              action: {
                type: "waitFor",
                condition: "load",
                state: observe.waitForLoad,
                ...(observe.timeoutMs === undefined ? {} : { timeoutMs: observe.timeoutMs }),
              },
              debuggerApi,
              state,
              tab,
            });
          }
          observation = await captureSnapshot(tab, debuggerApi, observe);
        }
        return {
          ok: true,
          provider: "builtin",
          tabId: tab.tabId,
          url: tab.view.webContents.getURL(),
          results,
          snapshotRequired: observation ? false : state.latestSnapshotId !== snapshotId,
          ...(observation ? { observation } : {}),
          metrics: { elapsedMs: Date.now() - startedAt },
        };
      } finally {
        await debuggerCommand(debuggerApi, "Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
      }
    });
  }

  return { act, forget, invalidate, read, screenshot, snapshot };
}
