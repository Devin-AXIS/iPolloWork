import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { SlidersHorizontal } from "@phosphor-icons/react";
import { type DomEditSelection } from "../editor/domEditing";
import { useDomEditActionsContext } from "../../contexts/DomEditContext";
import { resolveBoundedOverlayPosition } from "./boundedOverlay";

type TextFormatAction = "bold" | "italic" | "strike" | "code" | "link";
type TextFormatState = Record<TextFormatAction, boolean>;

interface PreviewTextSelectionToolbarProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  activeSelection: DomEditSelection | null;
  hidden?: boolean;
}

interface TextSelectionState {
  text: string;
  rect: DOMRect;
  element: HTMLElement;
  originalHtml: string;
  markedHtml: string;
  range: Range;
  activeFormats: TextFormatState;
  showTextControls: boolean;
}

function containsOnlyInlineRichText(element: HTMLElement): boolean {
  const blocked = element.querySelector(
    "div,section,article,main,aside,header,footer,h1,h2,h3,h4,h5,h6,p,ul,ol,li,table,thead,tbody,tr,td,th,figure,video,img,canvas,svg,iframe",
  );
  return blocked == null;
}

function isTextLeafElement(element: HTMLElement): boolean {
  return Boolean(element.textContent?.trim()) && containsOnlyInlineRichText(element);
}

function markEntireElementHtml(element: HTMLElement): string {
  return `<!--hf-selection-start-->${element.innerHTML}<!--hf-selection-end-->`;
}

function selectedElementRect(iframe: HTMLIFrameElement, element: HTMLElement): DOMRect {
  const iframeRect = iframe.getBoundingClientRect();
  const doc = iframe.contentDocument;
  const root = doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement;
  const rootRect = root?.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (!rootRect?.width || !rootRect.height) return iframeRect;
  const scaleX = iframeRect.width / rootRect.width;
  const scaleY = iframeRect.height / rootRect.height;
  return new DOMRect(
    iframeRect.left + (elementRect.left - rootRect.left) * scaleX,
    iframeRect.top + (elementRect.top - rootRect.top) * scaleY,
    elementRect.width * scaleX,
    elementRect.height * scaleY,
  );
}

const emptyTextFormatState = (): TextFormatState => ({
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
});

function textNodesInRange(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (!doc) return [];
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE && range.intersectsNode(root)) return [root as Text];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.trim() && range.intersectsNode(node)) nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function nodeHasFormat(node: Text, action: TextFormatAction): boolean {
  const element = node.parentElement;
  if (!element) return false;
  if (action === "link") return Boolean(element.closest("a[href]"));
  if (action === "code") return Boolean(element.closest("code"));
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  if (action === "italic") return style.fontStyle === "italic" || style.fontStyle === "oblique";
  if (action === "bold") {
    const weight = Number.parseInt(style.fontWeight, 10);
    return style.fontWeight === "bold" || (!Number.isNaN(weight) && weight >= 600);
  }
  return style.textDecorationLine.split(/\s+/).includes("line-through");
}

function detectSelectionFormats(range: Range): TextFormatState {
  const nodes = textNodesInRange(range);
  if (nodes.length === 0) return emptyTextFormatState();
  return {
    bold: nodes.every((node) => nodeHasFormat(node, "bold")),
    italic: nodes.every((node) => nodeHasFormat(node, "italic")),
    strike: nodes.every((node) => nodeHasFormat(node, "strike")),
    code: nodes.every((node) => nodeHasFormat(node, "code")),
    link: nodes.every((node) => nodeHasFormat(node, "link")),
  };
}

function formatWrapper(doc: Document, action: TextFormatAction, remove: boolean): HTMLElement {
  if (remove) {
    const span = doc.createElement("span");
    if (action === "bold") span.style.fontWeight = "normal";
    if (action === "italic") span.style.fontStyle = "normal";
    if (action === "strike") {
      span.style.display = "inline-block";
      span.style.textDecoration = "none";
    }
    return span;
  }
  const tag = action === "bold" ? "strong" : action === "italic" ? "em" : action === "strike" ? "del" : action === "code" ? "code" : "a";
  const wrapper = doc.createElement(tag);
  if (action === "link") wrapper.setAttribute("href", "https://");
  return wrapper;
}

function elementAppliesFormat(element: Element, action: TextFormatAction): boolean {
  const tag = element.tagName.toLowerCase();
  const style = (element as HTMLElement).style;
  if (action === "bold") return tag === "b" || tag === "strong" || Boolean(style.fontWeight);
  if (action === "italic") return tag === "i" || tag === "em" || Boolean(style.fontStyle);
  if (action === "strike") return tag === "s" || tag === "strike" || tag === "del" || style.textDecoration.includes("line-through");
  if (action === "code") return tag === "code";
  return tag === "a";
}

function isSemanticFormatElement(element: Element, action: TextFormatAction): boolean {
  const tag = element.tagName.toLowerCase();
  if (action === "bold") return tag === "b" || tag === "strong";
  if (action === "italic") return tag === "i" || tag === "em";
  if (action === "strike") return tag === "s" || tag === "strike" || tag === "del";
  if (action === "code") return tag === "code";
  return tag === "a";
}

function findSharedFormatAncestor(start: Comment, end: Comment, action: TextFormatAction): Element | null {
  let current = start.parentElement;
  while (current) {
    if (current.contains(end) && isSemanticFormatElement(current, action)) return current;
    current = current.parentElement;
  }
  return null;
}

function fragmentHasContent(fragment: DocumentFragment): boolean {
  return Boolean(fragment.textContent || fragment.querySelector("img,svg,video,br"));
}

function stripFormatFromFragment(fragment: DocumentFragment, action: TextFormatAction): void {
  const elements = Array.from(fragment.querySelectorAll("*"));
  for (const element of elements.reverse()) {
    if (!elementAppliesFormat(element, action)) continue;
    const htmlElement = element as HTMLElement;
    if (action === "bold") htmlElement.style.removeProperty("font-weight");
    if (action === "italic") htmlElement.style.removeProperty("font-style");
    if (action === "strike") htmlElement.style.removeProperty("text-decoration");
    const tag = element.tagName.toLowerCase();
    const semanticMatch =
      (action === "bold" && (tag === "b" || tag === "strong")) ||
      (action === "italic" && (tag === "i" || tag === "em")) ||
      (action === "strike" && (tag === "s" || tag === "strike" || tag === "del")) ||
      (action === "code" && tag === "code") ||
      (action === "link" && tag === "a");
    if (semanticMatch) element.replaceWith(...Array.from(element.childNodes));
  }
}

function toggleMarkedSelectionFormat(html: string, action: TextFormatAction, active: boolean): string {
  const start = "<!--hf-selection-start-->";
  const end = "<!--hf-selection-end-->";
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
  let startMarker: Comment | null = null;
  let endMarker: Comment | null = null;
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue === "hf-selection-start") startMarker = node as Comment;
    if (node.nodeValue === "hf-selection-end") endMarker = node as Comment;
    node = walker.nextNode();
  }
  if (!startMarker || !endMarker) return html;

  const doc = template.ownerDocument;
  const selectedRange = doc.createRange();
  selectedRange.setStartAfter(startMarker);
  selectedRange.setEndBefore(endMarker);
  const selected = selectedRange.cloneContents();

  if (active) {
    const ancestor = findSharedFormatAncestor(startMarker, endMarker, action);
    if (ancestor?.parentNode) {
      const beforeRange = doc.createRange();
      beforeRange.selectNodeContents(ancestor);
      beforeRange.setEndBefore(startMarker);
      const before = beforeRange.cloneContents();
      const afterRange = doc.createRange();
      afterRange.selectNodeContents(ancestor);
      afterRange.setStartAfter(endMarker);
      const after = afterRange.cloneContents();
      const parent = ancestor.parentNode;
      if (fragmentHasContent(before)) {
        const beforeWrapper = ancestor.cloneNode(false) as Element;
        beforeWrapper.append(before);
        parent.insertBefore(beforeWrapper, ancestor);
      }
      parent.insertBefore(startMarker, ancestor);
      parent.insertBefore(selected, ancestor);
      parent.insertBefore(endMarker, ancestor);
      if (fragmentHasContent(after)) {
        const afterWrapper = ancestor.cloneNode(false) as Element;
        afterWrapper.append(after);
        parent.insertBefore(afterWrapper, ancestor);
      }
      ancestor.remove();
      return template.innerHTML;
    }
    stripFormatFromFragment(selected, action);
  }

  selectedRange.deleteContents();
  if (active && (action === "code" || action === "link")) {
    selectedRange.insertNode(selected);
    return template.innerHTML;
  }
  const wrapper = formatWrapper(doc, action, active);
  wrapper.append(selected);
  selectedRange.insertNode(wrapper);
  return template.innerHTML;
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceMarkedSelectionWithText(html: string, value: string): string {
  const start = "<!--hf-selection-start-->";
  const end = "<!--hf-selection-end-->";
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) return html;
  const before = html.slice(0, startIndex);
  const after = html.slice(endIndex + end.length);
  return `${before}${escapeHtmlText(value)}${after}`;
}

function removeSelectionMarkers(html: string): string {
  return html
    .replace("<!--hf-selection-start-->", "")
    .replace("<!--hf-selection-end-->", "");
}

function toolbarStyle(
  rect: DOMRect,
  container: HTMLElement,
  toolbarSize: { width: number; height: number },
): CSSProperties {
  const hostRect = container.getBoundingClientRect();
  const position = resolveBoundedOverlayPosition(rect, hostRect, toolbarSize, {
    edgePadding: 12,
    gap: 8,
  });
  return {
    left: position.left,
    top: position.top,
    maxWidth: position.maxWidth,
    maxHeight: position.maxHeight,
  };
}

export function PreviewTextSelectionToolbar({
  iframeRef,
  containerRef,
  activeSelection,
  hidden,
}: PreviewTextSelectionToolbarProps) {
  const { applyDomSelection, buildDomSelectionFromTarget, handleDomInnerHtmlCommit } =
    useDomEditActionsContext();
  const [state, setState] = useState<TextSelectionState | null>(null);
  const [replacementText, setReplacementText] = useState("");
  const stateRef = useRef<TextSelectionState | null>(null);
  const committingRef = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 420, height: 40 });
  stateRef.current = state;

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => {
      const rect = toolbar.getBoundingClientRect();
      const width = Math.max(toolbar.scrollWidth, rect.width);
      const height = Math.max(toolbar.scrollHeight, rect.height);
      setToolbarSize((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [state?.text]);

  const buildToolbarState = useCallback((): TextSelectionState | null => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const element = activeSelection?.element;
    if (hidden || !iframe || !doc || !element || !element.isConnected) return null;
    const showTextControls = isTextLeafElement(element);
    const range = doc.createRange();
    range.selectNodeContents(element);
    return {
      text: element.textContent?.trim() ?? "",
      rect: selectedElementRect(iframe, element),
      element,
      originalHtml: element.innerHTML,
      markedHtml: showTextControls ? markEntireElementHtml(element) : element.innerHTML,
      range,
      activeFormats: showTextControls ? detectSelectionFormats(range) : emptyTextFormatState(),
      showTextControls,
    };
  }, [activeSelection, hidden, iframeRef]);

  useEffect(() => {
    const next = buildToolbarState();
    setState(next);
    setReplacementText(next?.text ?? "");
  }, [buildToolbarState]);

  useEffect(() => {
    if (!activeSelection?.element || hidden) return;
    let frameId = 0;
    let lastRect = "";
    const updatePosition = () => {
      const next = buildToolbarState();
      if (!next) return setState(null);
      const rectKey = `${next.rect.left}:${next.rect.top}:${next.rect.width}:${next.rect.height}`;
      if (rectKey !== lastRect) {
        lastRect = rectKey;
        setState((current) => (current ? { ...current, rect: next.rect } : next));
      }
    };
    const refreshPosition = () => {
      updatePosition();
      frameId = requestAnimationFrame(refreshPosition);
    };
    window.addEventListener("resize", updatePosition);
    const iframeWindow = iframeRef.current?.contentWindow;
    iframeWindow?.addEventListener("scroll", updatePosition, { passive: true });
    const observer = new ResizeObserver(updatePosition);
    observer.observe(activeSelection.element);
    frameId = requestAnimationFrame(refreshPosition);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
      iframeWindow?.removeEventListener("scroll", updatePosition);
      observer.disconnect();
    };
  }, [activeSelection, buildToolbarState, hidden, iframeRef]);

  const commitSelectedHtml = useCallback(
    async (nextHtml: string, current: TextSelectionState, options?: { keepToolbar?: boolean }) => {
      const targetSelection =
        activeSelection?.element === current.element
          ? activeSelection
          : await buildDomSelectionFromTarget(current.element);
      if (!targetSelection) return;
      const previousHtml = current.element.innerHTML;
      current.element.innerHTML = nextHtml;
      try {
        await handleDomInnerHtmlCommit(targetSelection, nextHtml);
        if (!options?.keepToolbar) setState(null);
      } catch {
        current.element.innerHTML = previousHtml;
      }
    },
    [activeSelection, buildDomSelectionFromTarget, handleDomInnerHtmlCommit],
  );

  const applyFormat = useCallback(
    async (action: TextFormatAction) => {
      const current = stateRef.current;
      if (!current?.showTextControls) return;
      const nextHtml = removeSelectionMarkers(
        toggleMarkedSelectionFormat(
          current.markedHtml,
          action,
          current.activeFormats[action],
        ),
      );
      await commitSelectedHtml(nextHtml, current, { keepToolbar: true });
      const next = buildToolbarState();
      if (next) setState(next);
    },
    [buildToolbarState, commitSelectedHtml],
  );

  const updateReplacementPreview = useCallback(
    (value: string) => {
      const current = stateRef.current;
      if (!current) return;
      const nextHtml = replaceMarkedSelectionWithText(current.markedHtml, value);
      current.element.innerHTML = nextHtml;
      stateRef.current = {
        ...current,
        text: value,
      };
    },
    [],
  );

  const replaceSelection = useCallback(async () => {
    if (committingRef.current) return;
    const current = stateRef.current;
    if (!current) return;
    committingRef.current = true;
    const nextHtml = replaceMarkedSelectionWithText(current.markedHtml, replacementText);
    try {
      await commitSelectedHtml(nextHtml, current, { keepToolbar: true });
      const next = buildToolbarState();
      if (next) setState(next);
    } finally {
      committingRef.current = false;
    }
  }, [buildToolbarState, commitSelectedHtml, replacementText]);

  const openDesignProperties = useCallback(() => {
    if (!activeSelection) return;
    if (document.body.hasAttribute("data-studio-preview-fullscreen")) {
      document
        .querySelector("[data-studio-fullscreen-target]")
        ?.dispatchEvent(new CustomEvent("studio-toggle-fullscreen", { bubbles: true }));
    }
    applyDomSelection(activeSelection, { revealPanel: true });
  }, [activeSelection, applyDomSelection]);

  if (!state || hidden || !containerRef.current) return null;

  return (
    <div
      ref={toolbarRef}
      className="hf-preview-text-toolbar absolute z-[80] flex items-center gap-1 overflow-auto rounded-md border px-1.5 py-1 shadow-lg"
      style={toolbarStyle(state.rect, containerRef.current, toolbarSize)}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input,button")) return;
        event.preventDefault();
      }}
      role="toolbar"
      aria-label="Element editing"
    >
      {state.showTextControls && (
        <>
          <span className="px-2 text-[11px] font-medium">Text</span>
          <input
            className="hf-preview-text-toolbar__input"
            value={replacementText}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const next = event.target.value;
              setReplacementText(next);
              updateReplacementPreview(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void replaceSelection();
              if (event.key === "Escape") {
                state.element.innerHTML = state.originalHtml;
                stateRef.current = null;
                setState(null);
              }
            }}
            onBlur={() => {
              if (stateRef.current) void replaceSelection();
            }}
            aria-label="Edit element text"
          />
          <button type="button" className="hf-preview-text-toolbar__button" aria-pressed={state.activeFormats.bold} onClick={() => applyFormat("bold")}>B</button>
          <button type="button" className="hf-preview-text-toolbar__button italic" aria-pressed={state.activeFormats.italic} onClick={() => applyFormat("italic")}>I</button>
          <button type="button" className="hf-preview-text-toolbar__button line-through" aria-pressed={state.activeFormats.strike} onClick={() => applyFormat("strike")}>S</button>
          <button type="button" className="hf-preview-text-toolbar__button font-mono" aria-pressed={state.activeFormats.code} onClick={() => applyFormat("code")}>&lt;/&gt;</button>
          <button type="button" className="hf-preview-text-toolbar__button" aria-pressed={state.activeFormats.link} onClick={() => applyFormat("link")}>Link</button>
        </>
      )}
      <button
        type="button"
        className="hf-preview-text-toolbar__button"
        aria-label="Open Design properties"
        title="Design"
        onClick={openDesignProperties}
      >
        <SlidersHorizontal size={16} weight="bold" />
      </button>
    </div>
  );
}
