/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
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
  Strikethrough,
  Table2,
  Type,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
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

const BLOCK_COMMANDS: BlockCommand[] = [
  { id: "text", label: "Text", aliases: ["plain", "paragraph"], icon: Type, markdown: "" },
  { id: "heading-1", label: "Heading 1", aliases: ["h1", "title"], shortcut: "#", icon: Heading1, markdown: "# " },
  { id: "heading-2", label: "Heading 2", aliases: ["h2", "subtitle"], shortcut: "##", icon: Heading2, markdown: "## " },
  { id: "heading-3", label: "Heading 3", aliases: ["h3"], shortcut: "###", icon: Heading3, markdown: "### " },
  { id: "image", label: "Image", aliases: ["photo", "picture"], icon: Image, markdown: "![Image description](https://)", kind: "insert", select: "https://" },
  { id: "table", label: "Table", aliases: ["grid", "columns"], icon: Table2, markdown: "| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |", kind: "insert" },
  { id: "code", label: "Code block", aliases: ["pre", "fence"], shortcut: "```", icon: Code2, markdown: "```\nCode\n```", kind: "insert" },
  { id: "bulleted-list", label: "Bulleted list", aliases: ["bullet", "ul"], shortcut: "-", icon: List, markdown: "- " },
  { id: "numbered-list", label: "Numbered list", aliases: ["number", "ol"], shortcut: "1.", icon: ListOrdered, markdown: "1. " },
  { id: "to-do", label: "To-do list", aliases: ["todo", "task", "check"], shortcut: "[]", icon: ListTodo, markdown: "- [ ] " },
  { id: "quote", label: "Quote", aliases: ["blockquote"], shortcut: ">", icon: Quote, markdown: "> " },
  { id: "divider", label: "Divider", aliases: ["line", "rule"], shortcut: "---", icon: Minus, markdown: "---", kind: "insert" },
];

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

export function MarkdownEditorOverlays({ view, revision }: MarkdownEditorOverlaysProps) {
  const [activeCommand, setActiveCommand] = useState(0);
  const [slashDismissedAt, setSlashDismissedAt] = useState<number | null>(null);
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
        applyBlock(view, commands[activeCommand], visibleSlash);
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
      {visibleSlash && slashCoords ? (
        <div
          role="listbox"
          aria-label="Insert block"
          className="absolute z-40 max-h-[min(28rem,calc(100vh-8rem))] w-72 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
          style={{ left: Math.min(Math.max(8, slashCoords.left - editorRect.left), Math.max(8, editorRect.width - 296)), top: slashCoords.bottom - editorRect.top + 6 }}
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
                onClick={() => applyBlock(view, command, visibleSlash)}
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
            const insert = formatMarkdownImage(imageEditor.alt, imageEditor.url);
            applyEdit(view, { from: imageEditor.from, to: imageEditor.to, insert, selection: { anchor: imageEditor.from + insert.length } });
            setImageEditor(null);
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
