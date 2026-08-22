import path from "node:path";
import { realpath, stat } from "node:fs/promises";

const MAX_SNAPSHOT_NODES = 250;
const MAX_SNAPSHOT_TEXT = 30_000;
const MAX_ACTIONS = 8;
const MAX_FILL_TEXT = 50_000;
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_INFERRED_CONTROLS = 32;
const MAX_WAIT_MS = 2_000;
const DEFAULT_WAIT_FOR_MS = 5_000;
const MAX_WAIT_FOR_MS = 10_000;
const MAX_TOTAL_WAIT_MS = 10_000;
const WAIT_POLL_MS = 100;
const MAX_EXPECTED_NAME = 200;
const MAX_DEBUGGER_COMMAND_MS = 5_000;

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

function pluginDataPathAllowed(filePath, userDataRoot, workspaceId, extensionId) {
  if (!extensionId || !pathWithin(userDataRoot, filePath)) return false;
  const parts = path.relative(userDataRoot, filePath).split(path.sep);
  const expectedWorkspace = safeStorageSegment(workspaceId);
  const expectedPlugin = safeStorageSegment(extensionId);
  return parts.some((part, index) => (
    part === "plugin-data"
    && parts[index + 1] === expectedWorkspace
    && parts[index + 2] === expectedPlugin
    && index + 3 < parts.length
  ));
}

function snapshotLine(node, ref, depth) {
  const role = String(axValue(node.role) ?? "unknown");
  const name = boundedText(axValue(node.name));
  const protectedValue = axProperty(node, "protected") === true;
  const value = protectedValue ? "" : boundedText(axValue(node.value), 300);
  const details = [];
  if (name) details.push(quote(name));
  if (value && value !== name) details.push(`value=${quote(value)}`);
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
      || style.cursor === "pointer";
    const writable = tag === "TEXTAREA" || (tag === "INPUT" && !["button", "submit", "checkbox", "radio", "file"].includes(type))
      || this.isContentEditable === true;
    return {
      buttonLike,
      checkable,
      disabled: Boolean(this.disabled || this.readOnly || this.getAttribute?.("aria-disabled") === "true"),
      fileInput: tag === "INPUT" && type === "file",
      nativeSelect: tag === "SELECT",
      visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < viewportWidth && rect.top < viewportHeight
        && style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none",
      unobstructed: Boolean(localPoint),
      text: (this.innerText || this.textContent || "").replace(/\s+/g, " ").trim(),
      writable,
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
  }

  function forget(tabId) {
    tabStates.delete(tabId);
    queues.delete(tabId);
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
      name: boundedText(axValue(node.name), MAX_EXPECTED_NAME),
      role: String(axValue(node.role) ?? "unknown"),
    });
    return ref;
  }

  async function snapshot(payload = {}) {
    const tab = resolveTab(payload.tabId);
    return withDebugger(tab, async (debuggerApi) => {
      const trees = await readAccessibilityTrees(debuggerApi);
      const state = stateFor(tab.tabId);
      state.snapshotSerial += 1;
      state.refs.clear();
      const snapshotId = `${tab.tabId}:${state.documentRevision}:${state.snapshotSerial}`;
      state.latestSnapshotId = snapshotId;
      state.url = tab.view.webContents.getURL();

      const lines = [];
      let emitted = 0;
      let inferredControls = 0;
      let truncated = false;

      for (const tree of trees) {
        const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
        const parentById = new Map(tree.nodes.flatMap((node) => (
          (node.childIds ?? []).map((childId) => [childId, node.nodeId])
        )));
        const childIds = new Set(tree.nodes.flatMap((node) => node.childIds ?? []));
        const roots = tree.nodes.filter((node) => !childIds.has(node.nodeId));
        const visited = new Set();
        const clickCandidates = [];
        const visit = (node, depth = tree.depth, insideNamedControl = false) => {
          if (!node || visited.has(node.nodeId)) return;
          visited.add(node.nodeId);
          const role = String(axValue(node.role) ?? "unknown");
          const name = normalizeText(axValue(node.name));
          const interactive = !node.ignored && INTERACTIVE_ROLES.has(role);
          const content = !node.ignored && CONTENT_ROLES.has(role) && name && !insideNamedControl;
          if (content && role === "StaticText") clickCandidates.push({ node, depth });
          if ((interactive || content) && emitted < MAX_SNAPSHOT_NODES) {
            const ref = interactive ? referenceFor(state, node) : null;
            lines.push(snapshotLine(node, ref, depth));
            emitted += 1;
          } else if ((interactive || content) && emitted >= MAX_SNAPSHOT_NODES) {
            truncated = true;
          }
          for (const childId of node.childIds ?? []) {
            visit(byId.get(childId), depth + 1, insideNamedControl || interactive || Boolean(content));
          }
        };
        for (const root of roots) visit(root);
        for (const node of tree.nodes) visit(node);

        for (const candidate of clickCandidates) {
          if (emitted >= MAX_SNAPSHOT_NODES || inferredControls >= MAX_INFERRED_CONTROLS) break;
          let ancestorId = parentById.get(candidate.node.nodeId);
          for (let depth = 0; ancestorId && depth < 4; depth += 1) {
            const ancestor = byId.get(ancestorId);
            ancestorId = ancestor ? parentById.get(ancestor.nodeId) : undefined;
            const backendNodeId = Number(ancestor?.backendDOMNodeId);
            if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
            if ([...state.refs.values()].some((entry) => entry.backendNodeId === backendNodeId)) break;
            const objectId = await resolvedNode(debuggerApi, { backendNodeId }).catch(() => null);
            const metadata = objectId ? await inspectElement(debuggerApi, objectId).catch(() => null) : null;
            if (!metadata?.buttonLike || !metadata.visible || metadata.disabled) continue;
            const pseudoNode = {
              backendDOMNodeId: backendNodeId,
              name: { value: axValue(candidate.node.name) },
              properties: [],
              role: { value: "button" },
            };
            const ref = referenceFor(state, pseudoNode, { inferred: true });
            lines.push(snapshotLine(pseudoNode, ref, candidate.depth));
            emitted += 1;
            inferredControls += 1;
            break;
          }
        }
      }

      // Accessibility trees intentionally omit some hidden file inputs used by
      // modern upload buttons. Chromium's flattened DOM gives those controls a
      // safe ref without exposing selectors or arbitrary page evaluation.
      const flattened = await debuggerCommand(debuggerApi, "DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true,
      }).catch(() => ({ nodes: [] }));
      for (const node of flattened?.nodes ?? []) {
        if (emitted >= MAX_SNAPSHOT_NODES) {
          truncated = true;
          break;
        }
        const attributes = domAttributes(node);
        if (String(node?.nodeName ?? "").toUpperCase() !== "INPUT" || attributes.type?.toLowerCase() !== "file") continue;
        const backendNodeId = Number(node?.backendNodeId);
        if (!Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
        if ([...state.refs.values()].some((entry) => entry.backendNodeId === backendNodeId)) continue;
        const name = attributes["aria-label"] || attributes.title || attributes.name || "Upload file";
        const pseudoNode = {
          backendDOMNodeId: backendNodeId,
          name: { value: name },
          properties: [],
          role: { value: "fileinput" },
        };
        const ref = referenceFor(state, pseudoNode);
        lines.push(snapshotLine(pseudoNode, ref, 1));
        emitted += 1;
      }

      let tree = lines.join("\n");
      if (tree.length > MAX_SNAPSHOT_TEXT) {
        tree = `${tree.slice(0, MAX_SNAPSHOT_TEXT - 25)}\n… snapshot truncated`;
        truncated = true;
      }
      return {
        ok: true,
        provider: "builtin",
        tabId: tab.tabId,
        snapshotId,
        url: state.url,
        title: tab.view.webContents.getTitle(),
        tree: tree || "(No accessible page content)",
        elementCount: state.refs.size,
        truncated,
      };
    });
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
      name: boundedText(axValue(current.name), MAX_EXPECTED_NAME),
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
    const userDataRoot = await realpath(path.resolve(getUserDataPath()));
    const extensionId = typeof rawExtensionId === "string" && /^[A-Za-z0-9._-]+$/.test(rawExtensionId.trim())
      ? rawExtensionId.trim()
      : "";
    return Promise.all(rawPaths.map(async (rawPath) => {
      if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("Browser upload file paths must be non-empty strings.");
      const filePath = await realpath(path.resolve(rawPath.trim()));
      if (!pathWithin(workspaceRoot, filePath)
        && !pluginDataPathAllowed(filePath, userDataRoot, workspace.id, extensionId)) {
        throw new Error("Browser upload files must belong to the active workspace or the named plugin's private data.");
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Browser upload targets must be files.");
      if (fileStat.size > MAX_UPLOAD_FILE_BYTES) throw new Error("Browser upload file exceeds the 1 GB limit.");
      return filePath;
    }));
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
        ? { name: boundedText(metadata?.text, MAX_EXPECTED_NAME), role: "button" }
        : await currentAccessibleEntry(debuggerApi, entry);
      requireExpectedName(action, current, "activation key");
      if (!metadata?.visible || metadata.disabled || (!metadata.buttonLike && !ACTIVATABLE_ROLES.has(current.role))) {
        throw new Error("Browser activation-key target is not a visible enabled control.");
      }
      focusBrowserTarget(tab);
      await debuggerCommand(debuggerApi, "DOM.focus", { backendNodeId: entry.backendNodeId });
      const eventKey = key === "Space" ? " " : key;
      const code = key === "Space" ? "Space" : "Enter";
      const windowsVirtualKeyCode = key === "Space" ? 32 : 13;
      await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: eventKey,
        code,
        windowsVirtualKeyCode,
      });
      await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: eventKey,
        code,
        windowsVirtualKeyCode,
      });
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
      if (metadata?.disabled || !metadata?.fileInput) throw new Error("Browser upload target is not an enabled file input.");
      const files = await resolveUploadFiles(action.filePaths, workspaceRoot, action.extensionId);
      await debuggerCommand(debuggerApi, "DOM.setFileInputFiles", {
        files,
        backendNodeId: entry.backendNodeId,
      });
      state.latestSnapshotId = null;
      return { type: "upload", ref, count: files.length };
    }

    const current = entry.inferred
      ? { name: boundedText(metadata?.text, MAX_EXPECTED_NAME), role: "button" }
      : await currentAccessibleEntry(debuggerApi, entry);
    if (!metadata?.visible || metadata.disabled) {
      throw new Error("Browser target is not visible and enabled. Take a new snapshot after correcting the page state.");
    }

    if (action.type === "click") {
      requireExpectedName(action, current, "click");
      if (!metadata.buttonLike || !metadata.unobstructed) {
        throw new Error("Browser click target is not an unobstructed interactive control.");
      }
      sendPointerClick(tab, metadata);
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
      const modifiers = platform === "darwin" ? 4 : 2;
      await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "a",
        code: "KeyA",
        modifiers,
        windowsVirtualKeyCode: 65,
      });
      await debuggerCommand(debuggerApi, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers,
        windowsVirtualKeyCode: 65,
      });
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
    return withDebugger(tab, async (debuggerApi) => {
      const state = stateFor(tab.tabId);
      const snapshotId = typeof payload.snapshotId === "string" ? payload.snapshotId.trim() : "";
      if (!snapshotId || snapshotId !== state.latestSnapshotId || state.url !== tab.view.webContents.getURL()) {
        throw new Error("Browser snapshot is stale. Take a new snapshot before acting.");
      }
      const results = [];
      for (const action of actions) {
        if (!action || typeof action !== "object") throw new Error("Browser actions must be objects.");
        results.push(await performAction({
          action,
          debuggerApi,
          state,
          tab,
          workspaceRoot: payload.workspaceRoot,
        }));
        if (state.latestSnapshotId !== snapshotId) break;
      }
      const snapshotRequired = state.latestSnapshotId !== snapshotId;
      return {
        ok: true,
        provider: "builtin",
        tabId: tab.tabId,
        url: tab.view.webContents.getURL(),
        results,
        snapshotRequired,
      };
    });
  }

  return { act, forget, invalidate, snapshot };
}
