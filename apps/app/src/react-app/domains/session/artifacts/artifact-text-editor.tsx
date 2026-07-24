/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { cn } from "@/lib/utils";
import { markdownLivePreview } from "./markdown-live-preview";
import { MarkdownEditorOverlays } from "./markdown-editor-overlays";

type ArtifactTextEditorProps = {
  className?: string;
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
};

export function ArtifactTextEditor(props: ArtifactTextEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          props.language === "markdown" ? [] : lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          props.language === "markdown" ? [markdown(), markdownLivePreview()] : [],
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
              setRevision((current) => current + 1);
            }
          }),
          props.language === "markdown"
            ? EditorView.theme({
                "&": { height: "100%", background: "transparent" },
                ".cm-scroller": { fontFamily: "inherit" },
                ".cm-content": { minHeight: "100%", padding: "16px", maxWidth: "768px", margin: "0 auto", fontSize: "14px", lineHeight: "1.7" },
                ".cm-activeLine": { backgroundColor: "transparent" },
              })
            : EditorView.theme({
                "&": { height: "100%", background: "transparent" },
                ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
                ".cm-content": { minHeight: "100%", padding: "12px 0", fontSize: "12px", lineHeight: "20px" },
                ".cm-gutters": { background: "transparent", borderRight: "1px solid hsl(var(--border))" },
                ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px", color: "hsl(var(--muted-foreground))" },
                ".cm-activeLine": { backgroundColor: "hsl(var(--muted) / 0.35)" },
                ".cm-activeLineGutter": { backgroundColor: "hsl(var(--muted) / 0.35)" },
              }),
        ],
      }),
    });

    viewRef.current = view;
    setEditorView(view);

    // Dev-only handle so e2e flows can drive the editor selection.
    if (import.meta.env.DEV) {
      (window as unknown as { __artifactEditorView?: EditorView }).__artifactEditorView = view;
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      setEditorView(null);
      if (import.meta.env.DEV) {
        delete (window as unknown as { __artifactEditorView?: EditorView }).__artifactEditorView;
      }
    };
  }, [props.language]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const current = view.state.doc.toString();

    if (current === props.value) {
      return;
    }

    view.dispatch({ changes: { from: 0, to: current.length, insert: props.value } });
  }, [props.value]);

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", props.className)}>
      <div ref={rootRef} className="min-h-0 flex-1 overflow-hidden" />
      {props.language === "markdown" && editorView ? <MarkdownEditorOverlays view={editorView} revision={revision} /> : null}
    </div>
  );
}
