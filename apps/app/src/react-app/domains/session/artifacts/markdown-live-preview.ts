import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type Extension, type Range, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  findMarkdownCodeBlocks,
  findMarkdownImages,
  findMarkdownTables,
  type MarkdownCodeBlock,
  type MarkdownImage,
  type MarkdownTable,
} from "./markdown-rich-content";

/**
 * Obsidian-style "merged" markdown view for CodeMirror 6: the document stays
 * fully editable as plain markdown, but headings, emphasis, lists, quotes and
 * links are rendered inline. Syntax markers (`#`, `*`, `` ` ``, `>`, link
 * brackets) are hidden unless the selection touches the line they belong to,
 * so editing the raw markup is always one click away.
 */

const HIDE = Decoration.replace({});
const HIDDEN_LINE = Decoration.line({ class: "cm-md-hidden-line" });
const HIDDEN_MARK = Decoration.mark({ class: "cm-md-hidden-mark" });

const HEADING_MARK = [
  Decoration.mark({ class: "cm-md-h1" }),
  Decoration.mark({ class: "cm-md-h2" }),
  Decoration.mark({ class: "cm-md-h3" }),
  Decoration.mark({ class: "cm-md-h4" }),
  Decoration.mark({ class: "cm-md-h5" }),
  Decoration.mark({ class: "cm-md-h6" }),
];

const STRONG = Decoration.mark({ class: "cm-md-strong" });
const EMPHASIS = Decoration.mark({ class: "cm-md-emphasis" });
const STRIKE = Decoration.mark({ class: "cm-md-strike" });
const INLINE_CODE = Decoration.mark({ class: "cm-md-code" });
const LINK_TEXT = Decoration.mark({ class: "cm-md-link" });
const QUOTE = Decoration.line({ class: "cm-md-quote" });
const CODE_BLOCK = Decoration.line({ class: "cm-md-codeblock" });
const TABLE_BORDER_COLOR = "rgba(100, 116, 139, 0.85)";

function normalizeImagePreviewUrl(url: string) {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  if (/^[a-z]:[\\/]/i.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, "/").replace(/^([a-z]):/i, (_, drive: string) => `${drive.toUpperCase()}:`)}`;
  }
  if (trimmed.startsWith("\\\\")) {
    return `file:${trimmed.replace(/\\/g, "/")}`;
  }
  return trimmed;
}

function dataImageToObjectUrl(url: string) {
  const match = url.match(/^data:(image\/(?:avif|bmp|gif|jpeg|jpg|png|svg\+xml|webp|x-icon));base64,([\s\S]+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: match[1] }));
  } catch {
    return null;
  }
}

type RichPreviewRange = {
  from: number;
  to: number;
};

function styleTableCell(cell: HTMLTableCellElement) {
  cell.style.border = `1px solid ${TABLE_BORDER_COLOR}`;
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "\u2022";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const BULLET = Decoration.replace({ widget: new BulletWidget() });

class ImageWidget extends WidgetType {
  constructor(readonly image: MarkdownImage) {
    super();
  }

  eq(other: ImageWidget) {
    return other.image.alt === this.image.alt && other.image.url === this.image.url && other.image.from === this.image.from;
  }

  toDOM() {
    const figure = document.createElement("figure");
    figure.className = "cm-md-image";
    figure.dataset.markdownImage = "";
    figure.dataset.markdownImageFrom = String(this.image.from);
    figure.dataset.markdownImageTo = String(this.image.to);
    figure.dataset.markdownImageAlt = this.image.alt;
    figure.dataset.markdownImageUrl = this.image.url;
    suppressPreviewSelection(figure);

    const image = document.createElement("img");
    const objectUrl = dataImageToObjectUrl(this.image.url);
    if (objectUrl) {
      image.addEventListener("load", () => window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000), { once: true });
      image.addEventListener("error", () => URL.revokeObjectURL(objectUrl), { once: true });
    }
    image.src = objectUrl ?? normalizeImagePreviewUrl(this.image.url);
    image.alt = this.image.alt;
    image.loading = "lazy";
    image.addEventListener("error", () => figure.classList.add("cm-md-image-error"));
    figure.appendChild(image);

    const fallback = document.createElement("span");
    fallback.className = "cm-md-image-fallback";
    fallback.textContent = this.image.alt || "Image could not be loaded";
    figure.appendChild(fallback);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-image-edit";
    edit.dataset.markdownImageAction = "edit";
    edit.setAttribute("aria-label", "Replace or edit image");
    edit.textContent = "Replace";
    figure.appendChild(edit);

    return figure;
  }

  ignoreEvent() {
    return true;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly table: MarkdownTable) {
    super();
  }

  eq(other: TableWidget) {
    return other.table.from === this.table.from
      && other.table.to === this.table.to
      && JSON.stringify(other.table.headers) === JSON.stringify(this.table.headers)
      && JSON.stringify(other.table.rows) === JSON.stringify(this.table.rows);
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrap";
    wrapper.dataset.markdownTable = "";
    suppressPreviewSelection(wrapper);

    const table = document.createElement("table");
    table.className = "cm-md-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const value of this.table.headers) {
      const cell = document.createElement("th");
      cell.textContent = value;
      styleTableCell(cell);
      headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    for (const row of this.table.rows) {
      const tableRow = document.createElement("tr");
      for (const value of row) {
        const cell = document.createElement("td");
        cell.textContent = value;
        styleTableCell(cell);
        tableRow.appendChild(cell);
      }
      body.appendChild(tableRow);
    }
    table.appendChild(body);
    table.style.borderCollapse = "collapse";
    wrapper.appendChild(table);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-table-edit";
    edit.textContent = "Edit table";
    edit.setAttribute("aria-label", "Edit Markdown table");
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", () => {
      const firstLine = view.state.doc.lineAt(this.table.from);
      view.dispatch({ selection: { anchor: firstLine.from, head: firstLine.to }, scrollIntoView: true });
      view.focus();
    });
    wrapper.appendChild(edit);

    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

class CodeBlockWidget extends WidgetType {
  constructor(readonly block: MarkdownCodeBlock) {
    super();
  }

  eq(other: CodeBlockWidget) {
    return other.block.from === this.block.from
      && other.block.to === this.block.to
      && other.block.language === this.block.language
      && other.block.code === this.block.code;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-code-wrap";
    wrapper.dataset.markdownCodeBlock = "";
    suppressPreviewSelection(wrapper);

    const header = document.createElement("div");
    header.className = "cm-md-code-header";
    header.textContent = this.block.language || "Code";
    wrapper.appendChild(header);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.block.code;
    pre.appendChild(code);
    wrapper.appendChild(pre);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-code-edit";
    edit.textContent = "Edit code";
    edit.setAttribute("aria-label", "Edit Markdown code block");
    edit.addEventListener("mousedown", (event) => event.preventDefault());
    edit.addEventListener("click", () => {
      const firstLine = view.state.doc.lineAt(this.block.from);
      view.dispatch({ selection: { anchor: firstLine.from, head: firstLine.to }, scrollIntoView: true });
      view.focus();
    });
    wrapper.appendChild(edit);
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

function suppressPreviewSelection(element: HTMLElement) {
  element.addEventListener("pointerdown", (event) => {
    if (event.detail > 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  element.addEventListener("mousedown", (event) => {
    if (event.detail > 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  element.addEventListener("selectstart", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function selectionTouchesRange(view: EditorView, from: number, to: number) {
  for (const range of view.state.selection.ranges) {
    if (range.from === range.to && range.from >= from && range.from <= to) {
      return true;
    }
    if (range.from < to && range.to > from) {
      return true;
    }
  }
  return false;
}

function getRichPreviewRanges(document: string): RichPreviewRange[] {
  return [
    ...findMarkdownTables(document),
    ...findMarkdownCodeBlocks(document),
    ...findMarkdownImages(document),
  ];
}

function getRichPreviewRangeAtBoundaryPosition(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position);
  const document = view.state.doc.toString();
  const ranges = getRichPreviewRanges(document);

  for (const range of ranges) {
    const firstLine = view.state.doc.lineAt(range.from);
    if (position >= firstLine.from && position <= firstLine.to) {
      return range;
    }
  }

  if (line.text.trim()) return null;

  const previousLine = line.number > 1 ? view.state.doc.line(line.number - 1) : null;
  const nextLine = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null;

  return ranges.find((range) => previousLine?.to === range.to || nextLine?.from === range.from) ?? null;
}

function isInsideRichPreviewWidget(event: MouseEvent | PointerEvent) {
  return event.target instanceof Element
    && event.target.closest(".cm-md-image, .cm-md-table-wrap, .cm-md-code-wrap") !== null;
}

function suppressPointerBesidePreview(event: MouseEvent | PointerEvent, view: EditorView) {
  if (isInsideRichPreviewWidget(event)) return false;

  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return false;

  const range = getRichPreviewRangeAtBoundaryPosition(view, position);
  if (!range || selectionTouchesRange(view, range.from, range.to)) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const document = view.state.doc.toString();
  const codeBlocks = findMarkdownCodeBlocks(document);
  const isInsideCodeBlock = (from: number, to: number) => codeBlocks.some((block) => from >= block.from && to <= block.to);
  // Force the markdown tree to be parsed across the whole document so headings
  // and inline marks are decorated immediately, even before incremental parsing
  // would otherwise reach them.
  const tree =
    ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = Number(name.slice(-1)) - 1;
          widgets.push(HEADING_MARK[level].range(node.from, node.to));
          return;
        }

        if (name === "HeaderMark") {
          const after = view.state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          widgets.push(HIDDEN_MARK.range(node.from, after));
          return;
        }

        if (name === "StrongEmphasis") {
          widgets.push(STRONG.range(node.from, node.to));
          return;
        }
        if (name === "Emphasis") {
          widgets.push(EMPHASIS.range(node.from, node.to));
          return;
        }
        if (name === "Strikethrough") {
          widgets.push(STRIKE.range(node.from, node.to));
          return;
        }
        if (name === "InlineCode") {
          widgets.push(INLINE_CODE.range(node.from, node.to));
          return;
        }

        if (name === "EmphasisMark" || name === "CodeMark" || name === "StrikethroughMark") {
          widgets.push(HIDDEN_MARK.range(node.from, node.to));
          return;
        }

        if (name === "QuoteMark") {
          const after = view.state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          widgets.push(HIDDEN_MARK.range(node.from, after));
          return;
        }

        if (name === "ListMark") {
          const lineText = view.state.doc.lineAt(node.from).text;
          const isBullet = /^\s*[-*+]\s/.test(lineText);
          if (isBullet) {
            widgets.push(BULLET.range(node.from, node.to));
          }
          return;
        }

        if (name === "LinkMark") {
          widgets.push(HIDDEN_MARK.range(node.from, node.to));
          return;
        }
        if (name === "URL") {
          widgets.push(HIDDEN_MARK.range(node.from, node.to));
          return;
        }
      },
    });
  }

  for (const image of findMarkdownImages(document)) {
    if (!isInsideCodeBlock(image.from, image.to) && !selectionTouchesRange(view, image.from, image.to)) {
      widgets.push(Decoration.replace({ widget: new ImageWidget(image) }).range(image.from, image.to));
    }
  }

  for (const table of findMarkdownTables(document)) {
    if (!isInsideCodeBlock(table.from, table.to) && !selectionTouchesRange(view, table.from, table.to)) {
      const firstLine = view.state.doc.lineAt(table.from);
      widgets.push(Decoration.replace({ widget: new TableWidget(table) }).range(firstLine.from, firstLine.to));
      for (let lineNumber = firstLine.number + 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
        const line = view.state.doc.line(lineNumber);
        if (line.from > table.to) break;
        widgets.push(HIDDEN_LINE.range(line.from));
        if (line.from !== line.to) widgets.push(HIDE.range(line.from, line.to));
      }
    }
  }

  for (const block of codeBlocks) {
    if (selectionTouchesRange(view, block.from, block.to)) continue;
    const firstLine = view.state.doc.lineAt(block.from);
    widgets.push(Decoration.replace({ widget: new CodeBlockWidget(block) }).range(firstLine.from, firstLine.to));
    for (let lineNumber = firstLine.number + 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
      const line = view.state.doc.line(lineNumber);
      if (line.from > block.to) break;
      widgets.push(HIDDEN_LINE.range(line.from));
      if (line.from !== line.to) widgets.push(HIDE.range(line.from, line.to));
    }
  }

  // Line decorations must be applied in document order; collect them separately.
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "Blockquote") {
          let pos = node.from;
          while (pos <= node.to) {
            const line = view.state.doc.lineAt(pos);
            widgets.push(QUOTE.range(line.from));
            if (line.to + 1 > node.to) break;
            pos = line.to + 1;
          }
        }
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          let pos = node.from;
          while (pos <= node.to) {
            const line = view.state.doc.lineAt(pos);
            widgets.push(CODE_BLOCK.range(line.from));
            if (line.to + 1 > node.to) break;
            pos = line.to + 1;
          }
        }
      },
    });
  }

  widgets.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  const builder = new RangeSetBuilder<Decoration>();
  for (const w of widgets) {
    builder.add(w.from, w.to, w.value);
  }
  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild when the document, viewport or selection changes. Also rebuild
      // when the language parser advances (the syntax tree may not be ready in
      // the constructor for large documents), detected via any transaction that
      // touched the language state.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const protectRichPreviewBoundaries = EditorView.domEventHandlers({
  pointerdown: suppressPointerBesidePreview,
  mousedown: suppressPointerBesidePreview,
  dblclick(event, view) {
    if (isInsideRichPreviewWidget(event)) return false;

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return false;

    const range = getRichPreviewRangeAtBoundaryPosition(view, position);
    if (!range || selectionTouchesRange(view, range.from, range.to)) return false;

    event.preventDefault();
    event.stopPropagation();
    return true;
  },
});

const livePreviewTheme = EditorView.baseTheme({
  ".cm-md-h1": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-md-h2": { fontSize: "1.4em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-md-h3": { fontSize: "1.2em", fontWeight: "600", lineHeight: "1.3" },
  ".cm-md-h4": { fontSize: "1.1em", fontWeight: "600" },
  ".cm-md-h5": { fontSize: "1.05em", fontWeight: "600" },
  ".cm-md-h6": { fontSize: "1em", fontWeight: "600" },
  ".cm-md-hidden-line": { display: "none", height: "0", margin: "0", padding: "0" },
  ".cm-md-hidden-line *": { display: "none" },
  ".cm-md-hidden-mark": { display: "none" },
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-emphasis": { fontStyle: "italic" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    backgroundColor: "hsl(var(--muted) / 0.6)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".cm-md-link": { color: "hsl(var(--primary))", textDecoration: "underline" },
  ".cm-md-quote": {
    borderLeft: "3px solid hsl(var(--border))",
    paddingLeft: "0.75em",
    color: "hsl(var(--muted-foreground))",
    fontStyle: "italic",
  },
  ".cm-md-codeblock": {
    backgroundColor: "hsl(var(--muted) / 0.55)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    paddingLeft: "0.85rem",
    paddingRight: "0.85rem",
    boxShadow: "inset 3px 0 hsl(var(--border))",
  },
  ".cm-md-bullet": { paddingRight: "0.4em", color: "hsl(var(--muted-foreground))" },
  ".cm-md-image": {
    position: "relative",
    display: "block",
    maxWidth: "100%",
    margin: "0.75rem 0",
    overflow: "hidden",
    border: "1px solid hsl(var(--border))",
    borderRadius: "0.85rem",
    backgroundColor: "hsl(var(--muted) / 0.25)",
    userSelect: "none",
  },
  ".cm-md-image img": { display: "block", maxWidth: "100%", maxHeight: "28rem", margin: "0 auto", objectFit: "contain" },
  ".cm-md-image-fallback": { display: "none", padding: "3rem 1rem", textAlign: "center", color: "hsl(var(--muted-foreground))" },
  ".cm-md-image-error img": { display: "none" },
  ".cm-md-image-error .cm-md-image-fallback": { display: "block" },
  ".cm-md-image-edit": {
    position: "absolute",
    top: "0.6rem",
    right: "0.6rem",
    padding: "0.35rem 0.6rem",
    border: "1px solid hsl(var(--border))",
    borderRadius: "0.55rem",
    backgroundColor: "hsl(var(--background) / 0.92)",
    color: "hsl(var(--foreground))",
    fontSize: "0.72rem",
    fontWeight: "600",
    opacity: "0",
    transition: "opacity 120ms ease",
  },
  ".cm-md-image:hover .cm-md-image-edit, .cm-md-image-edit:focus-visible": { opacity: "1" },
  ".cm-md-table-wrap": {
    position: "relative",
    display: "block",
    margin: "0.75rem 0",
    overflowX: "auto",
    border: "1px solid rgba(100, 116, 139, 0.72)",
    borderRadius: "0.5rem",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    userSelect: "none",
  },
  ".cm-md-table": { width: "100%", borderCollapse: "separate", borderSpacing: "0", fontSize: "0.9em" },
  ".cm-md-table th, .cm-md-table td": { minWidth: "7rem", padding: "0.6rem 0.75rem", borderRight: "1px solid rgba(100, 116, 139, 0.72)", borderBottom: "1px solid rgba(100, 116, 139, 0.72)", textAlign: "left", verticalAlign: "top" },
  ".cm-md-table th": { backgroundColor: "rgba(148, 163, 184, 0.2)", fontWeight: "650" },
  ".cm-md-table tr > :last-child": { borderRight: "0" },
  ".cm-md-table tbody tr:last-child > *": { borderBottom: "0" },
  ".cm-md-table-edit": {
    position: "absolute",
    top: "0.4rem",
    right: "0.4rem",
    padding: "0.28rem 0.5rem",
    border: "1px solid hsl(var(--border))",
    borderRadius: "0.5rem",
    backgroundColor: "hsl(var(--background) / 0.94)",
    color: "hsl(var(--muted-foreground))",
    fontSize: "0.68rem",
    opacity: "0",
  },
  ".cm-md-table-wrap:hover .cm-md-table-edit, .cm-md-table-edit:focus-visible": { opacity: "1" },
  ".cm-md-code-wrap": {
    position: "relative",
    display: "block",
    margin: "0.75rem 0",
    overflow: "hidden",
    border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
    borderRadius: "0.75rem",
    backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
    userSelect: "none",
  },
  ".cm-md-code-header": { padding: "0.45rem 0.8rem", borderBottom: "1px solid color-mix(in srgb, currentColor 12%, transparent)", color: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em" },
  ".cm-md-code-wrap pre": { margin: "0", overflowX: "auto", padding: "0.85rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "0.84em", lineHeight: "1.65" },
  ".cm-md-code-edit": {
    position: "absolute",
    top: "0.32rem",
    right: "0.4rem",
    padding: "0.22rem 0.48rem",
    border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
    borderRadius: "0.45rem",
    backgroundColor: "hsl(var(--background) / 0.94)",
    color: "hsl(var(--muted-foreground))",
    fontSize: "0.66rem",
    opacity: "0",
  },
  ".cm-md-code-wrap:hover .cm-md-code-edit, .cm-md-code-edit:focus-visible": { opacity: "1" },
});

export function markdownLivePreview(): Extension {
  return [livePreviewPlugin, protectRichPreviewBoundaries, livePreviewTheme];
}
