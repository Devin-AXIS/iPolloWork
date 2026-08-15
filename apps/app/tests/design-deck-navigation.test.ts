import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("Design deck navigation", () => {
  test("keeps the slide controls available in preview mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toMatch(/\{deck \? \(\s*<div[^>]*data-testid="design-deck-navigation"/);
  });

  test("shows only the slide position in the deck navigation label", async () => {
    const source = await Bun.file(panelUrl).text();

    const navigation = source.match(/data-testid="design-deck-navigation"[\s\S]*?\) : null\}/)?.[0] ?? "";

    expect(navigation).toContain("{deck.index + 1} / {deck.total}");
    expect(navigation).not.toContain("deck.title");
  });

  test("uses a fixed presentation canvas instead of a mobile document preview", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("h-[900px] w-[1600px] origin-top-left");
    expect(source).toContain("presentationCanvasScale(previewViewport.width, previewViewport.height)");
    expect(source).toContain("!isPresentationTemplate ? (");
  });

  test("starts presentation templates in canvas editing mode", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('setEditing(isPresentationTemplate);');
    expect(source).toContain("Edit");
  });

  test("keeps the website toolbar compact and ordered", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).not.toContain('>Current design</p>');
    expect(source).not.toContain("Edit page");
    expect(source).toContain('className="order-3 shrink-0 rounded-lg"');
    expect(source).toContain("panelWidth < 360");
    expect(source).toContain('className="w-14 shrink-0 rounded-lg border-0 bg-transparent');
    expect(source).toContain("const currentVersionLabel = `V${versionTargets.length + 1}`");
    expect(source).toContain("<SelectValue>{viewedVersionLabel}</SelectValue>");
  });

  test("measures the presentation viewport after the canvas mounts", async () => {
    const source = await Bun.file(panelUrl).text();
    const measurementEffect = source.match(/React\.useEffect\(\(\) => \{\s*const viewport = previewViewportRef\.current;[\s\S]*?\}, \[([^\]]*)\]\);/);

    expect(measurementEffect?.[1]).toContain("isPresentationTemplate");
    expect(measurementEffect?.[1]).toContain("sourceHydrated");
  });

  test("applies modifier-wheel zoom from the presentation iframe and exposes reset", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "zoom"');
    expect(source).toContain("presentationCanvasWheelZoom(current, event.data.deltaY)");
    expect(source).toContain('aria-label="Fit canvas to view"');
    expect(source).toContain("setPresentationZoom(1)");
  });

  test("moves publish and export into more actions below 480px", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("panelWidth < 480");
    expect(source).toContain("compact={compactToolbar}");
    expect(source).toContain("showExports={Boolean(deck)}");
    expect(source).toContain("onPublish={features.publish ? () => publishMutation.mutate() : undefined}");
  });

  test("orders editing actions before sharing and export", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source.indexOf('aria-label="Fit canvas to view"')).toBeLessThan(source.indexOf('aria-label="Save design"'));
    expect(source.indexOf('aria-label="Save design"')).toBeLessThan(source.indexOf('aria-label="Publish to object storage"'));
    expect(source.indexOf('aria-label="Publish to object storage"')).toBeLessThan(source.indexOf("<DesignExportMenu"));
  });

  test("offers selected-element deletion only from the floating toolbar", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('aria-label={isMultiSelection ? "Delete selected elements" : "Delete selected element"}');
    expect(source).toContain('type: "delete"');
    expect(source).toContain("disabled={!selectionSummary.selections.some((member) => member.canDelete)}");
    expect(source).toContain("onClick={() => setDeleteConfirmationOpen(true)}");
    expect(source).toContain("deleteSelection();");
    expect(source).not.toContain("onClick={deleteSelection}");
    expect(source).not.toContain("text-destructive hover:bg-destructive/10");
  });

  test("places AI after every floating toolbar action", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain('aria-label="Ask AI about selected element"');
    expect(source.lastIndexOf('aria-label="Ask AI about selected element"')).toBeGreaterThan(source.lastIndexOf('aria-label="Toggle advanced design settings"'));
  });

  test("keeps the floating toolbar spacing compact and consistent", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('items-center gap-4 rounded-lg border border-border bg-popover px-4 py-2');
    expect(source).toContain('<div className="flex items-center gap-3">');
    expect(source).toContain('<div className="flex items-center gap-1">');
    expect(source).not.toContain("gap-[17px]");
  });

  test("keeps protected runtime controls unavailable to AI", async () => {
    const source = await Bun.file(panelUrl).text();
    const labelIndex = source.lastIndexOf('aria-label="Ask AI about selected element"');
    const actionStart = source.lastIndexOf("<button", labelIndex);
    expect(source.slice(actionStart, labelIndex)).toContain("disabled={!selection.canDelete || saveMutation.isPending || viewedVersionPath !== \"current\"}");
  });

  test("pans the overflowed presentation canvas without moving the slide", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "pan"');
    expect(source).toContain("scrollBy({ left: -event.data.deltaX, top: -event.data.deltaY })");
    expect(source).toContain("overflow-auto");
    expect(source).toContain("presentationCanvasStageSize");
  });

  test("restores the current view after undo instead of jumping to the beginning", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("pendingViewRestoreRef");
    expect(source).toContain("frameViewRef");
    expect(source).toContain("deckRef");
    expect(source).toContain('type: "restore-view"');
    expect(source).toContain('event.data.type === "view-restored"');
    expect(source).toContain('type: "select-locator", locator');
    expect(source).toContain("const selectionLocator = selection?.locator ?? null");
    expect(source).toContain("presentationPanRef.current?.scrollTo");
    expect(source).toContain("if (activePageHash && !pending)");
    expect(source).not.toContain('postMessage({ channel: DESIGN_MESSAGE_CHANNEL, type: "scroll-to", hash: activePageHash }, "*");\n                        iframeRef');
  });

  test("accepts normal deck messages and waits for a revision-matched restore acknowledgement", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain("if (pending) {");
    expect(source).toContain("event.data.viewRevision !== pending.id");
    expect(source).not.toContain("pending?.deckIndex !== null");
    expect(source).toContain('type: "deck-navigate", direction: "index", index: deckIndex, viewRevision: pending?.id ?? ""');
  });

  test("ignores draft messages until the replacement iframe has restored the undo view", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('if ((event.data.type === "draft" || event.data.type === "document-draft") && shouldIgnoreDesignDraftMessage(pendingViewRestoreRef.current)) return;');
    expect(source).toContain("expectsDesignRestoreFrame(pending, previewSource, previewRevision, activeFrameRevision)");
    expect(source).toContain("event.data.frameRevision !== activeFrameRevisionRef.current");
  });

  test("keeps undo history when saving the current design", async () => {
    const source = await Bun.file(panelUrl).text();
    const saveMutation = source.match(/const saveMutation = useMutation\(\{[\s\S]*?\n  \}\);/)?.[0] ?? "";

    expect(saveMutation).not.toContain("setHistory([])");
    expect(source).toContain("shouldHydrateDesignSource(pageChanged, fileQuery.data.content, draftRef.current)");
  });

  test("uses an atomic deduplicated stack for consecutive undo actions", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('from "./design-undo-history"');
    expect(source).toContain("historyRef");
    expect(source).toContain("pushDesignUndoHistory(current, snapshot)");
    expect(source).toContain("popDesignUndoHistory(historyRef.current, {");
    expect(source).toContain("tokenCss: designTokenDraftRef.current");
    expect(source).not.toContain('if (event.data.type === "editing") setHistory((current) => [...current, draft]);');
  });

  test("restores the theme token file together with HTML on undo", async () => {
    const source = await Bun.file(panelUrl).text();
    const undo = source.match(/const undo = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

    expect(source).toContain("rememberHistory({ html: currentHtml, tokenCss: currentTokenCss, restoreTokenCss: true })");
    expect(source).toContain("if (themedHtml === currentHtml && next === currentTokenCss)");
    expect(undo).toContain("draftRef.current = previous.html");
    expect(undo).toContain("if (previous.restoreTokenCss)");
    expect(undo).toContain("designTokenDraftRef.current = previous.tokenCss");
    expect(undo).toContain("scheduleDesignTokenSave(previous.tokenCss)");
  });

  test("recreates the preview frame when undoing a live canvas edit", async () => {
    const source = await Bun.file(panelUrl).text();
    const undo = source.match(/const undo = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

    // A drag changes only the live iframe DOM. Its pre-drag HTML may already
    // equal previewSource, so Undo must invalidate the hydrated frame instead
    // of relying on previewSource changing to trigger a reload.
    expect(undo).toContain('setHydratedPreviewSource("");');
    expect(undo).toContain('setPreviewLoaded(false);');
    expect(undo).toContain('setPreviewRevision(restore.previewRevision);');
  });

  test("explains why Undo is disabled before the first change", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('title={history.length === 0 && !aiUndoCheckpoint ? "Make a change first to undo it" : "Undo last design change"}');
  });

  test("dismisses the floating selection toolbar when the editor deselects", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('event.data.type === "deselected"');
    expect(source).toContain("setSelectionState(null);");
    expect(source).toContain("setQuickEdit(null);");
    expect(source).toContain("setAdvancedOpen(false);");
  });

  test("leaves snapshot replies to their dedicated requester instead of treating them as selection updates", async () => {
    const source = await Bun.file(panelUrl).text();
    const snapshotGuard = 'if (event.data.type !== "selected" && event.data.type !== "editing" && event.data.type !== "draft") return;';

    expect(source).toContain(snapshotGuard);
    expect(source.indexOf(snapshotGuard)).toBeLessThan(source.indexOf("setSelectionState((current) =>"));
  });

  test("derives toolbar targets and placement from the complete selection", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain('import { isDesignSelectionMember, summarizeDesignSelection } from "./design-selection-summary"');
    expect(source).toContain("const selectionSummary = selectionState");
    expect(source).toContain("const isMultiSelection = selectionSummary?.isMultiSelection ?? false");
    expect(source).toContain("selectionSummary?.selectionRect");
    expect(source).toContain("ids: selectionSummary.selectionIds");
  });

  test("hides single-element toolbar actions in a multi-selection", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain("{!isMultiSelection && selection.canEditText ?");
    expect(source).toContain("{!isMultiSelection ? <button");
    expect(source).toContain('aria-label={isMultiSelection ? "Delete selected elements" : "Delete selected element"}');
  });

  test("uses the Figma toolbar assets and constrains free dragging to the preview", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain('import floatingToolbarGrip from "./assets/floating-toolbar-grip.svg"');
    expect(source).toContain('import floatingToolbarEditText from "./assets/floating-toolbar-edit-text.svg"');
    expect(source).toContain('aria-label="Move floating toolbar"');
    expect(source).toContain("onPointerMove={moveFloatingToolbar}");
    expect(source).toContain("viewport.clientWidth - toolbar.offsetWidth - padding");
    expect(source).toContain("viewport.clientHeight - toolbar.offsetHeight - padding");
  });
});
