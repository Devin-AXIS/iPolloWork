import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type DomEditSelection } from "../editor/domEditing";
import { useDomEditActionsContext } from "../../contexts/DomEditContext";
import { resolveBoundedOverlayPosition } from "./boundedOverlay";

type TextFormatAction = "bold" | "italic" | "strike" | "code" | "link";

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
}

interface TextSelectionDrag {
  pointerId: number;
  startX: number;
  startY: number;
  range: Range | null;
}

declare global {
  interface Window {
    __hfPreviewTextSelectionSuppressUntil?: number;
  }
}

function suppressCanvasSelection(ms = 1500): void {
  window.__hfPreviewTextSelectionSuppressUntil = Date.now() + ms;
}

function nodeElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element && element.nodeType === Node.ELEMENT_NODE && "style" in element
    ? (element as HTMLElement)
    : null;
}

function containsOnlyInlineRichText(element: HTMLElement): boolean {
  const blocked = element.querySelector(
    "div,section,article,main,aside,header,footer,ul,ol,li,table,thead,tbody,tr,td,th,figure,video,img,canvas,svg,iframe",
  );
  return blocked == null;
}

function isSelectionInsideElement(selection: Selection, element: HTMLElement): boolean {
  const anchor = nodeElement(selection.anchorNode);
  const focus = nodeElement(selection.focusNode);
  return Boolean(anchor && focus && element.contains(anchor) && element.contains(focus));
}

function isEditableTextNode(node: Node | null): boolean {
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  return Boolean(node.textContent?.trim());
}

function hasEditableTextAtPoint(doc: Document, x: number, y: number): boolean {
  const element = doc.elementFromPoint(x, y);
  if (!element) return false;
  const target = element.closest<HTMLElement>(
    "[data-hf-id], [id], h1, h2, h3, h4, h5, h6, p, span, div",
  );
  return Boolean(target && containsOnlyInlineRichText(target) && target.textContent?.trim());
}

function iframePointFromClient(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const rootWidth = rootRect?.width || win.innerWidth;
  const rootHeight = rootRect?.height || win.innerHeight;
  if (!rootWidth || !rootHeight || !iframeRect.width || !iframeRect.height) return null;
  return {
    x: ((clientX - iframeRect.left) / iframeRect.width) * rootWidth,
    y: ((clientY - iframeRect.top) / iframeRect.height) * rootHeight,
  };
}

interface CaretPoint {
  node: Node;
  offset: number;
}

function resolveCaretPoint(doc: Document, x: number, y: number): CaretPoint | null {
  const richDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = richDoc.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = richDoc.caretRangeFromPoint?.(x, y);
  if (range) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function createRangeFromPoints(
  doc: Document,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Range | null {
  const startCaret = resolveCaretPoint(doc, start.x, start.y);
  const endCaret = resolveCaretPoint(doc, end.x, end.y);
  if (!startCaret || !endCaret) return null;
  if (!isEditableTextNode(startCaret.node) && !isEditableTextNode(endCaret.node)) return null;

  const range = doc.createRange();
  try {
    range.setStart(startCaret.node, startCaret.offset);
    range.setEnd(endCaret.node, endCaret.offset);
  } catch {
    return null;
  }
  if (!range.collapsed) return range;

  // Dragging right-to-left creates an inverted range in some WebKit builds.
  try {
    const reversed = doc.createRange();
    reversed.setStart(endCaret.node, endCaret.offset);
    reversed.setEnd(startCaret.node, startCaret.offset);
    return reversed.collapsed ? range : reversed;
  } catch {
    return range;
  }
}

function findEditableTextElement(
  selection: Selection,
  activeSelection: DomEditSelection | null,
): HTMLElement | null {
  if (activeSelection?.element && isSelectionInsideElement(selection, activeSelection.element)) {
    return activeSelection.element;
  }
  const common =
    selection.rangeCount > 0 ? nodeElement(selection.getRangeAt(0).commonAncestorContainer) : null;
  const candidate = common?.closest<HTMLElement>(
    "[data-hf-id], [id], h1, h2, h3, h4, h5, h6, p, span, div",
  );
  if (!candidate) return null;
  if (!containsOnlyInlineRichText(candidate)) return null;
  return candidate;
}

function cloneRichTextFromElement(element: HTMLElement, selection: Selection): string | null {
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !isSelectionInsideElement(selection, element)) return null;

  const markerStart = element.ownerDocument.createComment("hf-selection-start");
  const markerEnd = element.ownerDocument.createComment("hf-selection-end");
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(markerEnd);
  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(markerStart);
  const html = element.innerHTML;
  markerStart.remove();
  markerEnd.remove();
  return html;
}

function replaceMarkedSelection(html: string, action: TextFormatAction): string {
  const start = "<!--hf-selection-start-->";
  const end = "<!--hf-selection-end-->";
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) return html;
  const before = html.slice(0, startIndex);
  const selected = html.slice(startIndex + start.length, endIndex);
  const after = html.slice(endIndex + end.length);
  const wrapped =
    action === "bold"
      ? `<strong>${selected}</strong>`
      : action === "italic"
        ? `<em>${selected}</em>`
        : action === "strike"
          ? `<del>${selected}</del>`
          : action === "code"
            ? `<code>${selected}</code>`
            : `<a href="https://">${selected}</a>`;
  return `${before}${wrapped}${after}`;
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
  const { buildDomSelectionFromTarget, handleDomInnerHtmlCommit } = useDomEditActionsContext();
  const [state, setState] = useState<TextSelectionState | null>(null);
  const [replacementText, setReplacementText] = useState("");
  const stateRef = useRef<TextSelectionState | null>(null);
  const dragRef = useRef<TextSelectionDrag | null>(null);
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

  const updateSelection = useCallback(() => {
    if (hidden) {
      setState(null);
      return;
    }
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const sel = doc?.getSelection();
    if (!iframe || !doc || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setState(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setState(null);
      return;
    }
    const element = findEditableTextElement(sel, activeSelection);
    if (!element) {
      setState(null);
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    const markedHtml = cloneRichTextFromElement(element, sel);
    if (!markedHtml) {
      setState(null);
      return;
    }
    const rangeRect = range.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const rect = new DOMRect(
      iframeRect.left + rangeRect.left,
      iframeRect.top + rangeRect.top,
      rangeRect.width,
      rangeRect.height,
    );
    setState({ text, rect, element, originalHtml: element.innerHTML, markedHtml, range });
    setReplacementText(text);
  }, [activeSelection, hidden, iframeRef]);

  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;

    doc.addEventListener("selectionchange", updateSelection);
    doc.addEventListener("mouseup", updateSelection);
    doc.addEventListener("keyup", updateSelection);
    iframe.addEventListener("load", updateSelection);
    return () => {
      doc.removeEventListener("selectionchange", updateSelection);
      doc.removeEventListener("mouseup", updateSelection);
      doc.removeEventListener("keyup", updateSelection);
      iframe.removeEventListener("load", updateSelection);
    };
  }, [iframeRef.current, updateSelection]);

  const updateRangeFromDrag = useCallback(
    (event: PointerEvent | ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const selection = doc?.getSelection();
      if (!drag || !iframe || !doc || !selection) return false;
      const start = iframePointFromClient(iframe, drag.startX, drag.startY);
      const end = iframePointFromClient(iframe, event.clientX, event.clientY);
      if (!start || !end) return false;
      const range = createRangeFromPoints(doc, start, end);
      if (!range) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      drag.range = range;
      suppressCanvasSelection();
      updateSelection();
      return true;
    },
    [iframeRef, updateSelection],
  );

  const beginDragSelection = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".hf-preview-text-toolbar")) return;
      if (hidden || event.button !== 0 || event.shiftKey || event.altKey || event.metaKey) return;
      if (event.detail >= 2) return;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const point = iframe ? iframePointFromClient(iframe, event.clientX, event.clientY) : null;
      if (!iframe || !doc || !point || !hasEditableTextAtPoint(doc, point.x, point.y)) return;

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        range: null,
      };
      suppressCanvasSelection();
      event.preventDefault();
      event.stopPropagation();
    },
    [hidden, iframeRef],
  );

  useEffect(() => {
    const finishDrag = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.range) suppressCanvasSelection();
      updateSelection();
    };
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 3 && !drag.range) return;
      if (updateRangeFromDrag(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("pointermove", handleMove, { capture: true });
    window.addEventListener("pointerup", finishDrag, { capture: true });
    window.addEventListener("pointercancel", finishDrag, { capture: true });
    return () => {
      window.removeEventListener("pointermove", handleMove, { capture: true });
      window.removeEventListener("pointerup", finishDrag, { capture: true });
      window.removeEventListener("pointercancel", finishDrag, { capture: true });
    };
  }, [updateRangeFromDrag, updateSelection]);

  const commitSelectedHtml = useCallback(
    async (nextHtml: string, current: TextSelectionState, options?: { keepToolbar?: boolean }) => {
      const targetSelection =
        activeSelection?.element === current.element
          ? activeSelection
          : await buildDomSelectionFromTarget(current.element);
      if (!targetSelection) return;
      const previousHtml = current.element.innerHTML;
      current.element.innerHTML = nextHtml;
      if (!options?.keepToolbar) {
        iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
        setState(null);
      }

      try {
        await handleDomInnerHtmlCommit(targetSelection, nextHtml);
      } catch {
        current.element.innerHTML = previousHtml;
      }
    },
    [activeSelection, buildDomSelectionFromTarget, handleDomInnerHtmlCommit, iframeRef],
  );

  const applyFormat = useCallback(
    async (action: TextFormatAction) => {
      const current = stateRef.current;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const selection = doc?.getSelection();
      if (!current || !selection) return;
      const marked = cloneRichTextFromElement(current.element, selection) ?? current.markedHtml;
      const nextHtml = replaceMarkedSelection(marked, action);
      await commitSelectedHtml(nextHtml, current);
    },
    [commitSelectedHtml, iframeRef],
  );

  const updateReplacementPreview = useCallback(
    (value: string) => {
      const current = stateRef.current;
      if (!current) return;
      const nextHtml = replaceMarkedSelectionWithText(current.markedHtml, value);
      current.element.innerHTML = nextHtml;
      suppressCanvasSelection();
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
      await commitSelectedHtml(nextHtml, current);
    } finally {
      committingRef.current = false;
    }
  }, [commitSelectedHtml, replacementText]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("pointerdown", beginDragSelection as unknown as EventListener, {
      capture: true,
    });
    return () => {
      container.removeEventListener(
        "pointerdown",
        beginDragSelection as unknown as EventListener,
        { capture: true },
      );
    };
  }, [beginDragSelection, containerRef]);

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
      aria-label="Text formatting"
    >
      <span className="px-2 text-[11px] font-medium">Text</span>
      <input
        className="hf-preview-text-toolbar__input"
        value={replacementText}
        onPointerDown={(event) => {
          suppressCanvasSelection();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          suppressCanvasSelection();
          event.stopPropagation();
        }}
        onClick={(event) => {
          suppressCanvasSelection();
          event.stopPropagation();
        }}
        onChange={(event) => {
          const next = event.target.value;
          setReplacementText(next);
          updateReplacementPreview(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void replaceSelection();
          if (event.key === "Escape") {
            state.element.innerHTML = state.originalHtml;
            iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
            setState(null);
          }
        }}
        onBlur={() => {
          if (stateRef.current) void replaceSelection();
        }}
        aria-label="Replace selected text"
      />
      <button type="button" className="hf-preview-text-toolbar__button" onClick={() => applyFormat("bold")}>
        B
      </button>
      <button type="button" className="hf-preview-text-toolbar__button italic" onClick={() => applyFormat("italic")}>
        I
      </button>
      <button type="button" className="hf-preview-text-toolbar__button line-through" onClick={() => applyFormat("strike")}>
        S
      </button>
      <button type="button" className="hf-preview-text-toolbar__button font-mono" onClick={() => applyFormat("code")}>
        &lt;/&gt;
      </button>
      <button type="button" className="hf-preview-text-toolbar__button" onClick={() => applyFormat("link")}>
        Link
      </button>
    </div>
  );
}
