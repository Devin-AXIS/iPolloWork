/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Check,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Upload,
  Strikethrough,
  Table2,
  Type,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { pickLocalImageFile, readLocalImageAsDataUrl } from "@/app/lib/desktop";
import {
  findSlashCommand,
  replaceLinePrefix,
  replaceSlashCommand,
  wrapMarkdownSelection,
  wrapMarkdownSelectionByLine,
  type MarkdownEdit,
  type SlashCommandMatch,
} from "./markdown-editor-commands";
import { formatMarkdownImage } from "./markdown-rich-content";

type MarkdownEditorOverlaysProps = {
  view: EditorView;
  revision: number;
};

type BlockCommand = {
  id: string;
  label: string;
  aliases: string[];
  shortcut?: string;
  icon: typeof Type;
  markdown: string;
  kind?: "insert";
  select?: string;
};

type PendingLocalImageTarget =
  | { kind: "insert" }
  | { kind: "slash"; slash: SlashCommandMatch }
  | { kind: "replace"; from: number; to: number; alt: string };
type RectEdges = Pick<DOMRect, "bottom" | "left" | "right" | "top">;

const BLOCK_COMMANDS: BlockCommand[] = [
  { id: "text", label: "Text", aliases: ["plain", "paragraph"], icon: Type, markdown: "" },
  { id: "heading-1", label: "Heading 1", aliases: ["h1", "title"], shortcut: "#", icon: Heading1, markdown: "# " },
  { id: "heading-2", label: "Heading 2", aliases: ["h2", "subtitle"], shortcut: "##", icon: Heading2, markdown: "## " },
  { id: "heading-3", label: "Heading 3", aliases: ["h3"], shortcut: "###", icon: Heading3, markdown: "### " },
  { id: "image", label: "Image", aliases: ["photo", "picture"], icon: Image, markdown: "", kind: "insert" },
  { id: "table", label: "Table", aliases: ["grid", "columns"], icon: Table2, markdown: "| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |", kind: "insert" },
  { id: "code", label: "Code block", aliases: ["pre", "fence"], shortcut: "```", icon: Code2, markdown: "```\nCode\n```", kind: "insert" },
  { id: "bulleted-list", label: "Bulleted list", aliases: ["bullet", "ul"], shortcut: "-", icon: List, markdown: "- " },
  { id: "numbered-list", label: "Numbered list", aliases: ["number", "ol"], shortcut: "1.", icon: ListOrdered, markdown: "1. " },
  { id: "to-do", label: "To-do list", aliases: ["todo", "task", "check"], shortcut: "[]", icon: ListTodo, markdown: "- [ ] " },
  { id: "quote", label: "Quote", aliases: ["blockquote"], shortcut: ">", icon: Quote, markdown: "> " },
  { id: "divider", label: "Divider", aliases: ["line", "rule"], shortcut: "---", icon: Minus, markdown: "---", kind: "insert" },
];
const LOCAL_IMAGE_ACCEPT = "image/*";
const SLASH_MENU_WIDTH = 288;
const SLASH_MENU_EDGE_PADDING = 8;
const SLASH_MENU_GAP = 6;
const SLASH_MENU_MAX_HEIGHT = 448;
const SLASH_MENU_HEADER_HEIGHT = 28;
const SLASH_MENU_ROW_HEIGHT = 49;
const SLASH_MENU_EMPTY_HEIGHT = 104;

function applyEdit(view: EditorView, edit: MarkdownEdit) {
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: edit.selection, scrollIntoView: true });
  view.focus();
}

function formatSelection(view: EditorView, before: string, after: string, placeholder: string) {
  const range = view.state.selection.main;
  applyEdit(view, wrapMarkdownSelectionByLine(view.state.doc.toString(), range.from, range.to, before, after, placeholder));
}

function applyBlock(view: EditorView, command: BlockCommand, slash: SlashCommandMatch | null) {
  if (slash) {
    const edit = replaceSlashCommand(slash, command.markdown);
    if (command.select) {
      const start = command.markdown.indexOf(command.select);
      edit.selection = { anchor: slash.from + start, head: slash.from + start + command.select.length };
    }
    applyEdit(view, edit);
    return;
  }

  if (command.kind === "insert") {
    const range = view.state.selection.main;
    applyEdit(view, { from: range.from, to: range.to, insert: command.markdown, selection: { anchor: range.from + command.markdown.length } });
    return;
  }

  const range = view.state.selection.main;
  applyEdit(view, replaceLinePrefix(view.state.doc.toString(), range.head, command.markdown));
}

function commandMatches(command: BlockCommand, query: string) {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return command.label.toLowerCase().includes(normalized) || command.aliases.some((alias) => alias.includes(normalized));
}

function getSelectionBoundaryCoords(view: EditorView, position: number, direction: "start" | "end") {
  const coords = view.coordsAtPos(position);
  if (coords) return coords;

  const fallbackPosition = direction === "start"
    ? Math.min(view.state.doc.length, position + 1)
    : Math.max(0, position - 1);

  return view.coordsAtPos(fallbackPosition);
}

function getSlashMenuPosition(editorRect: RectEdges & Pick<DOMRect, "height" | "width">, slashCoords: RectEdges, commandCount: number) {
  const estimatedHeight = Math.min(
    SLASH_MENU_MAX_HEIGHT,
    commandCount > 0
      ? SLASH_MENU_HEADER_HEIGHT + (commandCount * SLASH_MENU_ROW_HEIGHT)
      : SLASH_MENU_HEADER_HEIGHT + SLASH_MENU_EMPTY_HEIGHT,
  );
  const belowSpace = editorRect.bottom - slashCoords.bottom - SLASH_MENU_GAP - SLASH_MENU_EDGE_PADDING;
  const aboveSpace = slashCoords.top - editorRect.top - SLASH_MENU_GAP - SLASH_MENU_EDGE_PADDING;
  const shouldFlipAbove = belowSpace < estimatedHeight && aboveSpace > belowSpace;
  const availableHeight = Math.max(
    72,
    shouldFlipAbove ? aboveSpace : belowSpace,
  );
  const maxHeight = Math.min(SLASH_MENU_MAX_HEIGHT, availableHeight);
  const left = Math.min(
    Math.max(SLASH_MENU_EDGE_PADDING, slashCoords.left - editorRect.left),
    Math.max(SLASH_MENU_EDGE_PADDING, editorRect.width - SLASH_MENU_WIDTH - SLASH_MENU_EDGE_PADDING),
  );
  const top = shouldFlipAbove
    ? Math.max(SLASH_MENU_EDGE_PADDING, slashCoords.top - editorRect.top - Math.min(estimatedHeight, maxHeight) - SLASH_MENU_GAP)
    : Math.min(
        slashCoords.bottom - editorRect.top + SLASH_MENU_GAP,
        Math.max(SLASH_MENU_EDGE_PADDING, editorRect.height - maxHeight - SLASH_MENU_EDGE_PADDING),
      );

  return { left, top, maxHeight };
}

function inferImageMimeType(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "svg") return "image/svg+xml";
  if (extension === "ico") return "image/x-icon";
  if (extension === "jpg") return "image/jpeg";
  if (extension === "avif" || extension === "bmp" || extension === "gif" || extension === "jpeg" || extension === "png" || extension === "webp") {
    return `image/${extension}`;
  }
  return null;
}

function isLocalImagePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^data:/i.test(trimmed) || /^(https?|wss?|ftp|mailto|tel):/i.test(trimmed)) return false;
  if (!/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(trimmed.split(/[?#]/, 1)[0] ?? "")) return false;
  return /^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("/") || /^file:/i.test(trimmed);
}

function normalizeLocalImagePath(value: string) {
  const trimmed = value.trim();
  if (!/^file:/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(new URL(trimmed).pathname).replace(/^\/([a-z]:)/i, "$1");
  } catch {
    return trimmed.replace(/^file:\/+/i, "");
  }
}

async function fileToImageDataUrl(file: File) {
  const mimeType = inferImageMimeType(file);
  if (!mimeType) throw new Error("Please select an image file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${window.btoa(binary)}`;
}

function imageBlockEdit(document: string, from: number, to: number, markdown: string): MarkdownEdit {
  const before = document.slice(0, from);
  const deleteTo = document.slice(to, to + 1) === "\n" ? to + 1 : to;
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = "\n";
  const insert = `${prefix}${markdown}${suffix}`;

  return {
    from,
    to: deleteTo,
    insert,
    selection: { anchor: from + insert.length },
  };
}

export function MarkdownEditorOverlays({ view, revision }: MarkdownEditorOverlaysProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingLocalImageRef = useRef<PendingLocalImageTarget>({ kind: "insert" });
  const [activeCommand, setActiveCommand] = useState(0);
  const [slashDismissedAt, setSlashDismissedAt] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageEditor, setImageEditor] = useState<{
    from: number;
    to: number;
    alt: string;
    url: string;
    left: number;
    top: number;
  } | null>(null);
  const document = view.state.doc.toString();
  const selection = view.state.selection.main;
  const slash = selection.empty ? findSlashCommand(document, selection.head) : null;
  const visibleSlash = slash && slash.to !== slashDismissedAt ? slash : null;
  const commands = useMemo(
    () => BLOCK_COMMANDS.filter((command) => commandMatches(command, visibleSlash?.query ?? "")),
    [visibleSlash?.query],
  );

  const insertImageMarkdown = (target: PendingLocalImageTarget, alt: string, url: string) => {
    const markdown = formatMarkdownImage(alt, url);
    const document = view.state.doc.toString();
    if (target.kind === "slash") {
      applyEdit(view, imageBlockEdit(document, target.slash.from, target.slash.to, markdown));
    } else if (target.kind === "replace") {
      applyEdit(view, imageBlockEdit(document, target.from, target.to, markdown));
      setImageEditor(null);
    } else {
      const range = view.state.selection.main;
      applyEdit(view, imageBlockEdit(document, range.from, range.to, markdown));
    }
    pendingLocalImageRef.current = { kind: "insert" };
  };

  const chooseLocalImage = async (target: PendingLocalImageTarget) => {
    pendingLocalImageRef.current = target;
    setImageError(null);
    const pickedPath = await pickLocalImageFile("选择图片");
    if (pickedPath) {
      const dataUrl = await readLocalImageAsDataUrl(pickedPath);
      if (!dataUrl) {
        setImageError("Could not read that local image. Choose another file.");
        return;
      }
      const fileName = pickedPath.split(/[\\/]/).pop() ?? "Image";
      const alt = target.kind === "replace" && target.alt ? target.alt : fileName.replace(/\.[^.]+$/, "") || "Image";
      insertImageMarkdown(target, alt, dataUrl);
      return;
    }
    if (typeof window !== "undefined" && window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) return;
    imageInputRef.current?.click();
  };

  const insertLocalImage = async (file: File) => {
    try {
      const target = pendingLocalImageRef.current;
      const alt = target.kind === "replace" && target.alt ? target.alt : file.name.replace(/\.[^.]+$/, "") || "Image";
      insertImageMarkdown(target, alt, await fileToImageDataUrl(file));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Could not read this image. Please try another file.");
    }
  };

  const normalizeImageEditorUrl = async () => {
    if (!imageEditor) return "";
    const url = imageEditor.url.trim();
    if (!isLocalImagePath(url)) return url;
    const dataUrl = await readLocalImageAsDataUrl(normalizeLocalImagePath(url));
    if (!dataUrl) throw new Error("Could not read that local image. Choose the image file again.");
    return dataUrl;
  };

  const runCommand = (command: BlockCommand, slashMatch: SlashCommandMatch | null) => {
    if (command.id === "image") {
      void chooseLocalImage(slashMatch ? { kind: "slash", slash: slashMatch } : { kind: "insert" });
      return;
    }
    applyBlock(view, command, slashMatch);
  };

  useEffect(() => {
    setActiveCommand(0);
  }, [visibleSlash?.query]);

  useEffect(() => {
    if (!visibleSlash) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveCommand((current) => Math.min(commands.length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveCommand((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter" && commands[activeCommand]) {
        event.preventDefault();
        runCommand(commands[activeCommand], visibleSlash);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissedAt(visibleSlash.to);
      }
    };

    view.contentDOM.addEventListener("keydown", handleKeyDown);
    return () => view.contentDOM.removeEventListener("keydown", handleKeyDown);
  }, [activeCommand, commands, view, visibleSlash]);

  useEffect(() => {
    if (slashDismissedAt !== null && selection.head !== slashDismissedAt) setSlashDismissedAt(null);
  }, [revision, selection.head, slashDismissedAt]);

  useEffect(() => {
    const openImageEditor = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest("[data-markdown-image-action]") : null;
      const figure = element?.closest<HTMLElement>("[data-markdown-image]");
      if (!element || !figure) return;
      event.preventDefault();
      event.stopPropagation();

      const editorRect = view.dom.getBoundingClientRect();
      const imageRect = figure.getBoundingClientRect();
      setImageEditor({
        from: Number(figure.dataset.markdownImageFrom),
        to: Number(figure.dataset.markdownImageTo),
        alt: figure.dataset.markdownImageAlt ?? "",
        url: figure.dataset.markdownImageUrl ?? "",
        left: Math.max(8, Math.min(editorRect.width - 328, imageRect.right - editorRect.left - 320)),
        top: Math.max(8, Math.min(editorRect.height - 260, imageRect.top - editorRect.top + 8)),
      });
    };

    view.dom.addEventListener("click", openImageEditor, true);
    return () => view.dom.removeEventListener("click", openImageEditor, true);
  }, [view]);

  const editorRect = view.dom.getBoundingClientRect();
  const slashCoords = visibleSlash ? view.coordsAtPos(visibleSlash.to) : null;
  const slashMenuPosition = visibleSlash && slashCoords ? getSlashMenuPosition(editorRect, slashCoords, commands.length) : null;
  const selectionStart = !selection.empty ? getSelectionBoundaryCoords(view, selection.from, "start") : null;
  const selectionEnd = !selection.empty ? getSelectionBoundaryCoords(view, selection.to, "end") : null;
  const selectionToolbarLeft = selectionStart && selectionEnd
    ? Math.max(152, Math.min(editorRect.width - 152, ((selectionStart.left + selectionEnd.right) / 2) - editorRect.left))
    : 0;
  const selectionToolbarTop = selectionStart
    ? Math.max(8, selectionStart.top - editorRect.top - 48)
    : 0;

  return (
    <>
      <input
        ref={imageInputRef}
        type="file"
        accept={LOCAL_IMAGE_ACCEPT}
        className="hidden"
        aria-label="Choose a local image"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void insertLocalImage(file);
          event.currentTarget.value = "";
        }}
      />
      {visibleSlash && slashMenuPosition ? (
        <div
          role="listbox"
          aria-label="Insert block"
          className="absolute z-40 max-h-[min(28rem,calc(100vh-8rem))] w-72 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
          style={slashMenuPosition}
          data-markdown-slash-menu
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">Basic blocks</div>
          {commands.length ? commands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === activeCommand}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                  index === activeCommand ? "bg-muted text-foreground" : "hover:bg-muted/70",
                )}
                onMouseEnter={() => setActiveCommand(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runCommand(command, visibleSlash)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background"><Icon className="size-4 text-muted-foreground" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{command.label}</span>{command.shortcut ? <span className="block text-[11px] text-muted-foreground">{command.shortcut}</span> : null}</span>
                {index === activeCommand ? <Check className="size-3.5 text-muted-foreground" /> : null}
              </button>
            );
          }) : <div className="px-3 py-8 text-center text-xs text-muted-foreground">No matching blocks</div>}
        </div>
      ) : null}

      {!selection.empty && selectionStart && selectionEnd ? (
        <div
          role="toolbar"
          aria-label="Format selected text"
          className="absolute z-40 flex h-10 items-center rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          style={{ left: selectionToolbarLeft, top: selectionToolbarTop, transform: "translateX(-50%)" }}
          data-markdown-selection-toolbar
        >
          <button type="button" className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-muted" title="Turn into text" onMouseDown={(event) => event.preventDefault()} onClick={() => applyBlock(view, BLOCK_COMMANDS[0], null)}>Text</button>
          <span className="mx-1 h-5 w-px bg-border" />
          {[
            { label: "Bold", icon: Bold, action: () => formatSelection(view, "**", "**", "Bold text") },
            { label: "Italic", icon: Italic, action: () => formatSelection(view, "*", "*", "Italic text") },
            { label: "Strikethrough", icon: Strikethrough, action: () => formatSelection(view, "~~", "~~", "Strikethrough text") },
            { label: "Inline code", icon: Code2, action: () => formatSelection(view, "`", "`", "code") },
            { label: "Link", icon: Link2, action: () => formatSelection(view, "[", "](https://)", "Link text") },
          ].map((item) => {
            const Icon = item.icon;
            return <button key={item.label} type="button" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={item.label} title={item.label} onMouseDown={(event) => event.preventDefault()} onClick={item.action}><Icon className="size-3.5" /></button>;
          })}
        </div>
      ) : null}

      {imageEditor ? (
        <form
          className="absolute z-50 w-80 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl"
          style={{ left: imageEditor.left, top: imageEditor.top }}
          data-markdown-image-editor
          onKeyDown={(event) => {
            if (event.key === "Escape") setImageEditor(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void normalizeImageEditorUrl()
              .then((url) => {
                const insert = formatMarkdownImage(imageEditor.alt, url);
                applyEdit(view, { from: imageEditor.from, to: imageEditor.to, insert, selection: { anchor: imageEditor.from + insert.length } });
                setImageEditor(null);
                setImageError(null);
              })
              .catch((error) => setImageError(error instanceof Error ? error.message : "Could not read this image."));
          }}
        >
          <div className="mb-3">
            <div className="text-sm font-semibold">Image</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Replace the image or update its description.</div>
          </div>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Image URL
            <Input
              autoFocus
              value={imageEditor.url}
              onChange={(event) => setImageEditor((current) => current ? { ...current, url: event.target.value } : current)}
              className="mt-1 px-2.5"
              placeholder="https://example.com/image.png"
            />
          </label>
          <button
            type="button"
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-muted"
            onClick={() => {
              void chooseLocalImage({ kind: "replace", from: imageEditor.from, to: imageEditor.to, alt: imageEditor.alt });
            }}
          >
            <Upload className="size-3.5" />
            Choose local image
          </button>
          {imageError ? <div className="mt-2 text-xs text-destructive">{imageError}</div> : null}
          <label className="mt-2 block text-[11px] font-medium text-muted-foreground">
            Description
            <Input
              value={imageEditor.alt}
              onChange={(event) => setImageEditor((current) => current ? { ...current, alt: event.target.value } : current)}
              className="mt-1 px-2.5"
              placeholder="Describe this image"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="h-8 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted" onClick={() => setImageEditor(null)}>Cancel</button>
            <button type="submit" className="h-8 rounded-lg bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50" disabled={!imageEditor.url.trim()}>Update image</button>
          </div>
        </form>
      ) : null}
    </>
  );
}
