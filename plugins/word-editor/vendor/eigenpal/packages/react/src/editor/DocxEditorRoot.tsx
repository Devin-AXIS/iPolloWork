import {
  UnsupportedElementRegistryContext,
  createUnsupportedElementRegistry,
  type UnsupportedElementRegistry,
} from './unsupported-element-registry';
import type {
  RevisionMarkupOptions,
  ResolvedRevisionMarkup,
  ReviewDisplayMode,
  FieldResultsMode,
  ContentLockPolicy,
  FontShapingOptions,
  LockedControlNavigation,
} from '@docx-editor.dev/core/editor';
import { FormControlTranslateProvider } from './form-control-translate';
import { DialogProvider } from './dialog-host';
import { PopupConfigProvider, type DocxEditorPopups } from './popup-config';
import { warnFieldResultsChanged } from './field-results-warning';
import { warnContentLockPolicyChanged } from './content-lock-policy-warning';
import { warnLockedControlNavigationChanged } from './locked-control-navigation-warning';
import type { DocxEditorChildren } from '../docx-editor-children';
import { ChromeDarkContext, useResolvedDark } from './color-mode-context';
// Provider-first host for the docx editor facade.
//
// `DocxEditorRoot` renders no DOM of its own: it creates the facade WITHOUT a container
// (the instance stashes its document bytes and does no DOM work), publishes it through
// `DocxEditorContext`, and lets `DocxEditor.Content` attach a mount point wherever the
// host's tree puts one. Toolbars built from the hooks therefore work whether they render
// above, below, or nowhere near the painted pages.
//
// STRICTMODE CONTRACT. `destroy()` is terminal on the facade — a destroyed instance
// never remounts — so the mount effect creates a FRESH instance on every run and
// destroys it on cleanup. React StrictMode's double-invoked effect gets two instances;
// the first dies unused, the second is the one the tree sees. Identity of the published
// instance flows through `useState`, so consumers re-render when it lands.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DocumentChange,
  DocumentSource,
  Editor,
  EditorFontError,
  FontConfiguration,
  ZoomMode,
  TableInteractionLabelKey,
} from '@docx-editor.dev/core/contracts/editor';
import {
  createDocxEditor,
  defaultTableLabel,
  resolveZoomMode,
  resolveRevisionMarkup,
  runToolbarCommand,
  sameZoomMode,
} from '@docx-editor.dev/core/editor';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type {
  DocxEditorInstance,
  FontConfigurationFragment,
  FontResolver,
  ImageDecodePort,
} from '@docx-editor.dev/core/editor';
import { useTranslation, type TranslationKey } from '../i18n';
import { DocxEditorContext, ReviewRailContext, type ReviewRailRegistry } from './context';
import type { useDocxEditor } from './context';
import {
  HyperlinkPopupContext,
  HyperlinkPopupViewsContext,
  useHyperlinkPopupInstance,
} from './useHyperlinkPopup';
import { ContentControlContext, useContentControlInstance } from './useContentControl';
import { ImageInsertProvider } from './images/ImageInsert';
import {
  NavigationLayoutContext,
  createNavigationLayoutStore,
} from './navigation/navigation-layout';
import {
  RevisionStyleRegistryContext,
  createRevisionStyleRegistry,
  type RevisionStyleRegistry,
} from './revision-style-registry';

/**
 * Props for `DocxEditor.Root`. `document` and `imageDecodePort` identity changes remount the
 * editor. Changing `fontShaping.maxFontBytes` also remounts. Later `fonts`, `author`, `locale`,
 * `mode`, `translate`, `zoom`, and `zoomMode` changes use instance setters, so edits, selection
 * and undo history survive them. `modules` is sampled at mount only.
 *
 * @public
 */
export interface DocxEditorRootProps {
  /** Customize automatically mounted popups. Set an entry to false for manual ownership. */
  popups?: DocxEditorPopups;
  /** A document to load: DOCX bytes, `'blank'` for an empty one, or an existing handle.
   * Identity change remounts; `'blank'` is a constant, so holding it across renders does
   * not. Omitting this mounts NO document, which is not the same as an empty one. */
  document?: DocumentSource;
  /**
   * Font bytes for Word-accurate (HarfBuzz-shaped) wrap and pagination. Omitted, layout
   * uses a fixed-width estimate; fonts embedded in the document are wired automatically
   * either way. Pass `await loadDefaultFonts()` from `@docx-editor.dev/fonts` for
   * Word's default faces — a bare fragment is accepted — or compose several origins
   * with `composeFontConfiguration`. An identity change replaces the fonts in place
   * (`setFonts`), keeping the document, selection and undo history; keep the reference stable
   * across renders. Failures degrade to the fixed measurer and report through `onFontError`.
   */
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
  /** Explicit shaping byte ceiling; a changed maxFontBytes value remounts. */
  fontShaping?: FontShapingOptions;
  /** Author for later comments, replies, and tracked changes. Changes apply without a remount. */
  author?: string;
  /**
   * BCP-47 locale for regional date input and engine-generated labels. Defaults to en-US.
   * Changes apply to subsequent edits without a remount; stored date formats are preserved.
   * For UI translations, wrap Root and its chrome in LocaleProvider with an i18n catalog.
   */
  locale?: string;
  /** Live drawing and form-control labels; defaults to the active catalogue. */
  translate?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Capability modules to register (`@docx-editor.dev/pro`'s review module, custom nodes,
   * collaboration). Sampled at mount only because registration is construction-time.
   */
  modules?: readonly EditorModule[];
  /**
   * The host mode, matching the toolbar's three-state pill. Changes apply without a remount.
   *
   * `'edit'` opens in editing even when the document's `w:trackRevisions` asks for
   * tracked changes; `'suggesting'` opens in suggesting (needs a review module and an
   * `author`); `'view'` is read-only and the toolbar cannot leave it. Omitted, the
   * DOCUMENT decides: a package carrying `w:trackRevisions` opens in suggesting.
   */
  mode?: 'edit' | 'view' | 'suggesting';
  /**
   * A fixed scale. Supplying one also means the mode is fixed, unless `zoomMode` says
   * otherwise: an app that pinned 100% keeps 100% on every window size.
   */
  zoom?: number;
  /**
   * Where the scale comes from. Defaults to `'auto'`: fit the page width, between 50% and
   * 100%, so a window with room for the sheet renders at 100% and a narrower one shrinks
   * rather than growing a horizontal scrollbar — down to the floor, past which it scrolls.
   *
   * A fit tracks the room beside the page, so opening the comments rail or docking the
   * navigation pane shrinks the document by what it took. Pass `{ type: 'fixed' }` to opt out.
   */
  zoomMode?: ZoomMode | 'auto';
  /**
   * Controlled viewer markup settings. Omitted fields use defaults.
   * Save callback values into this prop to accept API and dialog changes.
   * Omit this prop for uncontrolled settings. Use one configuration source.
   */
  revisionMarkup?: RevisionMarkupOptions;
  /** Receives proposed settings from API or dialog changes, excluding prop reconciliation. */
  onRevisionMarkupChange?: (settings: ResolvedRevisionMarkup) => void;
  /** Initial revision display mode. */
  reviewDisplayMode?: ReviewDisplayMode;
  /**
   * How the reader edits saved field results. `'atomic'` (the default) keeps every field one
   * unit. `'editable'` allows typing, deletion, and selection inside the saved result of a
   * DATE, MERGEFIELD, HYPERLINK, or similar field. Read once, when the editor is created: a later change is ignored, with a development warning. Refused
   * with a collaboration module.
   */
  fieldResults?: FieldResultsMode;
  /**
   * Opt-in relaxation of content-control locks. With `allowFormattingInLockedContent: true`,
   * readers can format `contentLocked` and `sdtContentLocked` controls while their text stays
   * protected. Read once, when the editor is created: a later change in value is ignored,
   * with a development warning.
   */
  contentLockPolicy?: ContentLockPolicy;
  /**
   * How the caret moves through an inline content control whose content is locked.
   * `'characters'` (the default) walks through its characters, as Word does. `'atomic'` makes
   * the control one caret unit. Read once, when the editor is created: a later change is
   * ignored, with a development warning.
   */
  lockedControlNavigation?: LockedControlNavigation;

  /** Fired once per instance, after it is published to the tree (and after any
   *  `DocxEditor.Content` in the same commit has attached its mount point). A large
   *  document mounts behind one painted frame; `onReady` fires AFTER that mount lands,
   *  so scrolling or selecting from it works on any document size. */
  onReady?: (editor: Editor) => void;
  /** Fired when the document changes (revision + identity deltas, not bytes). */
  onChange?: (change: DocumentChange) => void;
  /** Fired with the typed font failure when the shaped-font pipeline rejects. */
  onFontError?: (error: EditorFontError) => void;
  /**
   * Localized labels for table insertion furniture. When omitted, core falls back to
   * bundled English through {@link defaultTableLabel}.
   */
  tableInteractionLabel?: (key: TableInteractionLabelKey) => string;
  /** Optional decode port for embedded image insertion and paint in tests or custom hosts. */
  imageDecodePort?: ImageDecodePort;
  /**
   * Colour theme of the composed chrome, as on `<DocxEditor>`. `'dark'` puts `.dark` beside
   * `.docx-editor` on every part that scopes itself (toolbar, menu bar, viewport, dialogs),
   * and `'system'` follows the OS setting as it changes. Defaults to `'light'`. The page
   * content in the viewport is shown inverted in dark mode, as in `<DocxEditor>`. Changes
   * apply without a remount.
   */
  colorMode?: 'light' | 'dark' | 'system';
  children?: DocxEditorChildren;
}

/**
 * Whether two `zoomMode` props say the same thing, `'auto'` shorthand included.
 *
 * By VALUE, because the prop is an object and a host writing it inline hands over a new one
 * on every render. Resolving both first makes `'auto'` and its long form compare equal, which
 * is what a host switching between the two spellings would expect.
 */
function sameZoomProp(a: ZoomMode | 'auto', b: ZoomMode | 'auto'): boolean {
  if (a === b) return true;
  const left = resolveZoomMode(a);
  const right = resolveZoomMode(b);
  return left !== null && right !== null && sameZoomMode(left, right);
}

/** @public Vue-only lifecycle listeners; exported for cross-adapter API parity. */
export interface DocxEditorRootListeners {
  onReady?: (editor: Editor) => void;
  onChange?: (change: DocumentChange) => void;
  onFontError?: (error: EditorFontError) => void;
  onRevisionMarkupChange?: (settings: ResolvedRevisionMarkup) => void;
}

/** @public Vue-only setup result; exported for cross-adapter API parity. */
export interface ProvideDocxEditorResult {
  readonly DocxEditorRoot: typeof DocxEditorRoot;
  readonly rootProps: Omit<DocxEditorRootProps, keyof DocxEditorRootListeners>;
  readonly rootListeners: DocxEditorRootListeners;
  readonly editorRef: ReturnType<typeof useDocxEditor>;
}

/**
 * Prepares Root props and listeners while exposing the instance created by that Root.
 * Call this function during render, like a React hook.
 *
 * @public
 */
function useProvidedDocxEditor(options: DocxEditorRootProps): ProvideDocxEditorResult {
  const latest = useRef(options);
  latest.current = options;
  const [editorRef, setEditorRef] = useState<DocxEditorInstance | null>(null);
  const {
    onReady: _onReady,
    onChange: _onChange,
    onFontError: _onFontError,
    onRevisionMarkupChange: _onRevisionMarkupChange,
    ...rootProps
  } = options;
  const rootListeners = useMemo<DocxEditorRootListeners>(
    () => ({
      onReady: (editor) => {
        setEditorRef(editor as DocxEditorInstance);
        latest.current.onReady?.(editor);
      },
      onChange: (change) => latest.current.onChange?.(change),
      onFontError: (error) => latest.current.onFontError?.(error),
      onRevisionMarkupChange: (settings) => latest.current.onRevisionMarkupChange?.(settings),
    }),
    []
  );
  return {
    DocxEditorRoot,
    rootProps,
    rootListeners,
    editorRef,
  };
}

export { useProvidedDocxEditor as provideDocxEditor };

/**
 * Creates and owns a `DocxEditorInstance` and provides it to the subtree. Renders no
 * DOM — compose it with `DocxEditor.Viewport` + `DocxEditor.Content` for the painted
 * pages, and any hook-built chrome anywhere inside.
 *
 * @public
 */
export function DocxEditorRoot(props: DocxEditorRootProps) {
  const {
    document: doc,
    fonts,
    fontShaping,
    author,
    locale,
    translate,
    mode,
    zoom,
    zoomMode,
    tableInteractionLabel,
    imageDecodePort,
    colorMode,
    children,
  } = props;
  const chromeDark = useResolvedDark(colorMode);
  const { t: catalogT } = useTranslation();
  const defaultTranslate = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      catalogT(key as TranslationKey, params),
    [catalogT]
  );
  const defaultTranslateRef = useRef(defaultTranslate);
  defaultTranslateRef.current = defaultTranslate;

  // Latest props, read inside effects without retriggering them.
  const applyingMarkup = useRef(false);
  const [markupRevision, setMarkupRevision] = useState(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const fontShapingMaxFontBytes = fontShaping?.maxFontBytes;

  const [editor, setEditor] = useState<DocxEditorInstance | null>(null);
  /** The `fieldResults` the current instance was created with. */
  const createdFieldResults = useRef(props.fieldResults);
  /** The `contentLockPolicy` the current instance was created with. */
  const createdContentLockPolicy = useRef(props.contentLockPolicy);
  /** The `lockedControlNavigation` the current instance was created with. */
  const createdLockedControlNavigation = useRef(props.lockedControlNavigation);
  /** The `fonts` the current instance holds: created with, or last handed to `setFonts`. */
  const createdFonts = useRef(props.fonts);

  // The channel `<DocxEditor.ColorByChangeType>` / `<DocxEditor.AuthorStyle>` declare through.
  // A store: declarations register from anywhere in the subtree, and identity must hold
  // across renders. Created before the instance effect below, which seeds construction
  // config from it.
  //
  // A REF, not `useMemo`: the instance-creation effect depends on this identity, and React
  // is permitted to discard a memo — which would tear the editor down and take the reader's
  // edits, caret and undo history with it. A ref is a guarantee.
  const registryRef = useRef<RevisionStyleRegistry | null>(null);
  registryRef.current ??= createRevisionStyleRegistry();
  const revisionStyleRegistry = registryRef.current;
  const unsupportedRegistryRef = useRef<UnsupportedElementRegistry | null>(null);
  unsupportedRegistryRef.current ??= createUnsupportedElementRegistry();
  const unsupportedRegistry = unsupportedRegistryRef.current;

  // One instance per document identity, and per effect run: `destroy()` is
  // terminal, so a StrictMode re-run must build anew rather than resurrect.
  useEffect(() => {
    const p = propsRef.current;
    const translate = p.translate ?? defaultTranslateRef.current;
    // Declarations mounted in this same commit registered BEFORE this effect (child
    // effects run bottom-up), so they reach the engine as construction config and the
    // FIRST paint is already styled — no kind-coloured frame.
    const declaredStyles = revisionStyleRegistry.current();
    createdFieldResults.current = p.fieldResults;
    createdContentLockPolicy.current = p.contentLockPolicy;
    createdLockedControlNavigation.current = p.lockedControlNavigation;
    const instance = createDocxEditor({
      unsupportedElementRules: unsupportedRegistry.current(),
      ...(p.document !== undefined ? { document: p.document } : {}),
      ...(p.fonts ? { fonts: p.fonts } : {}),
      ...(p.fontShaping ? { fontShaping: p.fontShaping } : {}),
      ...(p.author !== undefined ? { author: p.author } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      translate,
      ...(p.revisionMarkup !== undefined ? { revisionMarkup: p.revisionMarkup } : {}),
      ...(p.reviewDisplayMode !== undefined ? { reviewDisplayMode: p.reviewDisplayMode } : {}),
      ...(p.fieldResults !== undefined ? { fieldResults: p.fieldResults } : {}),
      ...(p.contentLockPolicy !== undefined ? { contentLockPolicy: p.contentLockPolicy } : {}),
      ...(p.lockedControlNavigation !== undefined
        ? { lockedControlNavigation: p.lockedControlNavigation }
        : {}),
      ...(p.mode !== undefined ? { mode: p.mode } : {}),
      ...(declaredStyles !== undefined ? { revisionStyles: declaredStyles } : {}),
      ...(p.modules !== undefined ? { modules: p.modules } : {}),
      ...(p.zoom !== undefined ? { zoom: p.zoom } : {}),
      ...(p.zoomMode !== undefined ? { zoomMode: p.zoomMode } : {}),
      ...(p.tableInteractionLabel ? { tableInteractionLabel: p.tableInteractionLabel } : {}),
      ...(p.imageDecodePort ? { imageDecodePort: p.imageDecodePort } : {}),
      onFontError: (error) => propsRef.current.onFontError?.(error),
    });
    createdFonts.current = p.fonts;
    const offMarkup = instance.on('revisionMarkupChange', (settings) => {
      if (applyingMarkup.current) return;
      propsRef.current.onRevisionMarkupChange?.(settings);
      setMarkupRevision((value) => value + 1);
    });
    const offChange = instance.on('change', (change) => propsRef.current.onChange?.(change));
    setEditor(instance);
    return () => {
      offMarkup();
      offChange();
      instance.destroy();
      // Functional update: a StrictMode re-run's second instance must not be clobbered.
      setEditor((current) => (current === instance ? null : current));
    };
  }, [doc, fontShapingMaxFontBytes, imageDecodePort, revisionStyleRegistry, unsupportedRegistry]);

  // A new `fonts` value replaces the instance's fonts in place. The instance a remount just
  // created already has them, so only a change after creation reaches `setFonts`.
  useEffect(() => {
    if (!editor || createdFonts.current === fonts) return;
    createdFonts.current = fonts;
    // Rejects only after destroy; font failures report through `onFontError`.
    editor.setFonts(fonts).catch(() => {});
  }, [editor, fonts]);

  // Fired AFTER the instance is published: this effect runs in the commit that rendered
  // the new editor, after child layout effects — so a `DocxEditor.Content` in the tree
  // has already attached. A SMALL document is mounted by then and `onReady` observes it
  // directly. A LARGE one is still behind the engine's open yield (`isOpening`), so the
  // callback waits for the mount's own `change` — the first and only event that can fire
  // inside that window — and then observes a real document too: `onReady` scrolling to a
  // page or selecting a range works on any document size.
  useEffect(() => {
    if (!editor) return undefined;
    if (!editor.snapshot().isOpening) {
      propsRef.current.onReady?.(editor);
      return undefined;
    }
    const off = editor.on('change', () => {
      off();
      propsRef.current.onReady?.(editor);
    });
    // Unsubscribe is idempotent, so the self-removal above and this cleanup can both run.
    return off;
  }, [editor]);

  // Zoom is a facade parameter, not a remount: tearing the editor down for a zoom
  // change would discard the user's edits and undo history.
  //
  // MODE AFTER LEVEL, and both in one effect. `setZoom` leaves any fit mode by design, so
  // running these in two effects let the order decide the outcome: a host passing both
  // `zoom={1.5}` and `zoomMode="auto"` would get whichever ran last.
  //
  // RE-ASSERTED WHEN THE PROP ITSELF MOVES, which is what these refs are for — and ALSO
  // after a zoom-prop update while the host still declares a fit/`auto` mode. `setZoom`
  // exits fit; skipping `setZoomMode` because the mode prop is unchanged would leave the
  // editor fixed despite the declared mode. Unrelated re-renders still do not re-apply:
  // mode is an object, and the documented spelling — `zoomMode={{ type: 'fit', fit:
  // 'pageWidth' }}` — is a fresh literal on every parent render, so an identity dependency
  // would push a toolbar-picked 150% back to the fit on the host's next keystroke.
  const applied = useRef<{
    editor: DocxEditorInstance | null;
    zoom: number | undefined;
    mode: ZoomMode | 'auto' | undefined;
  }>({ editor: null, zoom: undefined, mode: undefined });
  useEffect(() => {
    if (!editor) return;
    // A new instance has none of this yet, whatever the previous one was told.
    const fresh = applied.current.editor !== editor;
    if (fresh) applied.current = { editor, zoom: undefined, mode: undefined };

    let zoomChanged = false;
    if (zoom !== undefined && zoom !== applied.current.zoom) {
      applied.current.zoom = zoom;
      editor.setZoom(zoom);
      zoomChanged = true;
    }
    const previousMode = applied.current.mode;
    const modeMoved =
      zoomMode !== undefined &&
      (previousMode === undefined || !sameZoomProp(previousMode, zoomMode));
    // Preserve a declared fit after `setZoom` tore it down. Fixed declarations stay fixed.
    const resolved = zoomMode === undefined ? null : resolveZoomMode(zoomMode);
    const reassertDeclaredFit =
      zoomChanged && zoomMode !== undefined && resolved !== null && resolved.type === 'fit';
    if (modeMoved || reassertDeclaredFit) {
      applied.current.mode = zoomMode!;
      editor.setZoomMode(zoomMode!);
    }
  }, [editor, zoom, zoomMode]);

  useEffect(() => {
    if (!editor || props.revisionMarkup === undefined) return;
    const settings = resolveRevisionMarkup(props.revisionMarkup);
    if (JSON.stringify(settings) === JSON.stringify(editor.snapshot().revisionMarkup)) return;
    applyingMarkup.current = true;
    try {
      editor.setRevisionMarkup(settings);
    } finally {
      applyingMarkup.current = false;
    }
  }, [editor, props.revisionMarkup, markupRevision]);

  // Author is runtime state. Prop changes preserve the editor instance and existing revisions.
  useEffect(() => {
    if (!editor) return;
    editor.setAuthor(author);
  }, [editor, author]);

  const appliedMode = useRef<{
    editor: DocxEditorInstance | null;
    value: 'edit' | 'view' | 'suggesting' | undefined;
  }>({ editor: null, value: undefined });
  useEffect(() => {
    if (!editor) return;
    if (appliedMode.current.editor !== editor) {
      appliedMode.current = { editor, value: mode };
      return;
    }
    if (appliedMode.current.value === mode) return;
    appliedMode.current.value = mode;
    editor.setMode(mode);
  }, [editor, mode]);

  useEffect(() => {
    if (!editor) return;
    editor.setTranslate(translate ?? defaultTranslate);
  }, [editor, translate, defaultTranslate]);

  useEffect(() => {
    if (!editor) return;
    editor.setLocale(locale);
  }, [editor, locale]);

  // Read once at creation; a later change is ignored and reported in development.
  useEffect(() => {
    if (editor) warnFieldResultsChanged(createdFieldResults.current, props.fieldResults);
  }, [editor, props.fieldResults]);

  // Compared by value, so an inline policy object re-created on each render does not warn.
  useEffect(() => {
    if (editor)
      warnContentLockPolicyChanged(createdContentLockPolicy.current, props.contentLockPolicy);
  }, [editor, props.contentLockPolicy]);

  // Read once at creation, like `fieldResults`.
  useEffect(() => {
    if (editor) {
      warnLockedControlNavigationChanged(
        createdLockedControlNavigation.current,
        props.lockedControlNavigation
      );
    }
  }, [editor, props.lockedControlNavigation]);

  // Table furniture labels follow the live locale resolver without remounting the editor.
  useEffect(() => {
    if (!editor) return;
    editor.setTableInteractionLabel(tableInteractionLabel ?? defaultTableLabel);
  }, [editor, tableInteractionLabel]);

  // A rail registers itself here so the viewport only reserves a gutter when one is
  // actually composed in. See `ReviewRailContext`.
  const [rails, setRails] = useState(0);
  const [gutters, setGutters] = useState(0);
  const commentDraftHandlers = useRef<Array<() => void>>([]);
  const [commentDraftCount, setCommentDraftCount] = useState(0);
  const servesCommentDrafts = commentDraftCount > 0;
  const railEditor = useRef(editor);
  railEditor.current = editor;
  // The engine decides whether Add comment is enabled, so the handlers registered here reach
  // it as one registration, while any exists. The latest handler receives each request.
  useEffect(() => {
    if (!editor || !servesCommentDrafts) return undefined;
    return editor.setCommentDraftChrome({
      onRequest: () => commentDraftHandlers.current.at(-1)?.(),
    });
  }, [editor, servesCommentDrafts]);
  const railRegistry = useMemo<ReviewRailRegistry>(
    () => ({
      mounted: rails,
      register: () => {
        setRails((count) => count + 1);
        return () => setRails((count) => Math.max(0, count - 1));
      },
      gutters,
      reserveGutter: () => {
        setGutters((count) => count + 1);
        return () => setGutters((count) => Math.max(0, count - 1));
      },
      registerCommentDraft: (handler) => {
        commentDraftHandlers.current.push(handler);
        setCommentDraftCount((count) => count + 1);
        return () => {
          const index = commentDraftHandlers.current.indexOf(handler);
          if (index === -1) return;
          commentDraftHandlers.current.splice(index, 1);
          setCommentDraftCount((count) => Math.max(0, count - 1));
        };
      },
      requestCommentDraft: () => {
        const current = railEditor.current;
        return current !== null && runToolbarCommand(current, 'review.addComment').ok;
      },
    }),
    [rails, gutters]
  );

  // The channel between an open navigation pane and the chrome it displaces. A store
  // rather than state: the shift is recomputed on every viewport resize, and state here
  // would re-render the whole editor subtree at resize frequency. Created once per Root —
  // its identity must not change, or the two consumers resubscribe on every render.
  const navigationLayout = useMemo(createNavigationLayoutStore, []);

  // Connected AFTER the instance is published, for live updates from later declarations.
  useEffect(() => {
    revisionStyleRegistry.connect(editor);
    return () => revisionStyleRegistry.connect(null);
  }, [revisionStyleRegistry, editor]);

  useEffect(() => {
    unsupportedRegistry.connect(editor);
    return () => unsupportedRegistry.connect(null);
  }, [unsupportedRegistry, editor]);

  return (
    // The resolved colour mode, for the parts that put `.docx-editor` on themselves.
    <ChromeDarkContext.Provider value={chromeDark}>
      <UnsupportedElementRegistryContext.Provider value={unsupportedRegistry}>
        <FormControlTranslateProvider value={translate ?? defaultTranslate}>
          <ReviewRailContext.Provider value={railRegistry}>
            <DocxEditorContext.Provider value={editor}>
              <NavigationLayoutContext.Provider value={navigationLayout}>
                <RevisionStyleRegistryContext.Provider value={revisionStyleRegistry}>
                  {/* ONE link-popover state per editor, published here so a TOOLBAR button and the
                popover panel — which are siblings, not ancestor and descendant — see the same
                open/closed state and only one of them registers with the engine's gestures. */}
                  <HyperlinkPopupProvider>
                    <ContentControlProvider>
                      {/* Outside the picture insert, which shows its refusal through the registry. */}
                      <PopupConfigProvider value={props.popups}>
                        <ImageInsertProvider>
                          <DialogProvider popups={props.popups}>{children}</DialogProvider>
                        </ImageInsertProvider>
                      </PopupConfigProvider>
                    </ContentControlProvider>
                  </HyperlinkPopupProvider>
                </RevisionStyleRegistryContext.Provider>
              </NavigationLayoutContext.Provider>
            </DocxEditorContext.Provider>
          </ReviewRailContext.Provider>
        </FormControlTranslateProvider>
      </UnsupportedElementRegistryContext.Provider>
    </ChromeDarkContext.Provider>
  );
}

/**
 * Publishes the popover state. A child of the editor context rather than part of `Root`
 * itself, because it consumes that context and a component cannot read its own provider.
 */
function HyperlinkPopupProvider({ children }: { children?: DocxEditorChildren }) {
  // Registered with the engine only while a view shows the state; see
  // `HyperlinkPopupViewsContext`.
  const [views, setViews] = useState(0);
  const attach = useCallback(() => {
    setViews((count) => count + 1);
    return () => setViews((count) => count - 1);
  }, []);
  const popup = useHyperlinkPopupInstance(views > 0);
  return (
    <HyperlinkPopupViewsContext.Provider value={attach}>
      <HyperlinkPopupContext.Provider value={popup}>{children}</HyperlinkPopupContext.Provider>
    </HyperlinkPopupViewsContext.Provider>
  );
}

/** One content-control chrome state per editor — inspector open + mode toggles. */
function ContentControlProvider({ children }: { children?: DocxEditorChildren }) {
  const chrome = useContentControlInstance();
  return <ContentControlContext.Provider value={chrome}>{children}</ContentControlContext.Provider>;
}
