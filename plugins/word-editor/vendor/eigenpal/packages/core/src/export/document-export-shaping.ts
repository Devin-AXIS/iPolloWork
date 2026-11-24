// Document-aware font resolution shared by every headless exporter.

import { drawingPartFontFamilies } from '../store/package/drawing-part-fonts.ts';
import { textPathFontFamily } from '../store/package/legacy-vml-text-art.ts';
import { collectRenderedFontFamilyCandidates } from '../store/package/rendered-fonts.ts';
import {
  documentFontSubstitutionPlan,
  applyDocumentFontSubstitutions,
  hostChainedDocumentFallbacks,
} from '../layout/document-font-substitution.ts';
import { symbolFontFamily, validFontFamily } from '../store/package/run-defaults.ts';
import {
  DEFAULT_FONT,
  MAX_RESOLVER_FAMILIES,
  composeFontConfiguration,
} from '../layout/font-composition.ts';
import {
  composePreparedFontOrigins,
  type FontOrigin,
  type FontOriginFailure,
} from '../layout/font-resolver.ts';
import { prepareOwnedLayoutFontConfiguration } from '../layout/layout-shaping.ts';
import { EXPORT_HARFBUZZ_SHAPER_POLICY } from '../layout/layout-shaper-policy.ts';
import { fontShapingPolicy, type FontShapingOptions } from '../layout/font-shaping-policy.ts';
import { HARD_MAX_AGGREGATE_FONT_BYTES, type FontRequest } from '../layout/font-resource.ts';
import {
  complexSymbolFieldFonts,
  usedNumberingFontFamilies,
} from '../layout/synthesized-font-families.ts';
import { eastAsianLanguageFontFamilies } from '../layout/east-asian-font-families.ts';
import { EQUATION_FONT_FAMILY } from '../layout/equation-layout.ts';
import {
  createFieldParseState,
  effectiveFieldInstruction,
  isInsideFieldResult,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  onInstrText,
  resetFieldParseState,
} from '../layout/field-instruction.ts';
import {
  complexFieldInstructionMaySynthesizeGlyph,
  simpleFieldInstructionMaySynthesizeGlyph,
} from '../layout/field-form.ts';
import { parseSymbolInstruction } from '../layout/field-symbol.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import { noteIdOf, noteTypeOf, type NoteKind } from '../store/package/note-nodes.ts';
import { hasLegacyFormFieldData } from '../store/package/field-nodes.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
  WML_NAMESPACE_URI,
} from '../store/package/ooxml-shared.ts';
import {
  openHeadlessDocument,
  type HeadlessDocumentView,
} from '../store/headless-document-view.ts';
import {
  ExportResourceError,
  openDocumentForExport,
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from './export-session.ts';
import {
  documentEmbeddedFontOrigin,
  type DocumentEmbeddedFontDiagnostics,
} from './document-embedded-fonts.ts';
import {
  bindSessionAdmittedFont,
  enforceStrictFontPolicy,
  fontResolutionReport,
  hasExportAdmittedFont,
  publishFontResolutionReport,
  type DocumentExportFontResolutionOptions,
  type ExportAdmittedFontApi,
  type ExportFontResolutionReport,
} from './document-export-font-resolution.ts';
import {
  bindSessionExportLaidOutText,
  hasExportLaidOutText,
  type ExportLaidOutTextApi,
} from './export-laid-out-text.ts';
import { createSessionExportShaping, type SessionExportShaping } from './shared-export-shaping.ts';

export type {
  ExportDroppedEmbeddedFont,
  ExportFontFaceResolution,
  ExportFontFamilyResolution,
  ExportFontResolutionReport,
} from './document-export-font-resolution.ts';
export { hasExportAdmittedFont, hasExportLaidOutText };

/** Session-owned shaping over one document-specific font composition. @internal */
export interface DocumentExportShaping extends SessionExportShaping {
  /** Release this active document's font-byte reservation. Idempotent. */
  dispose(): void;
}

/** Cancellation and deadline controls for document-specific font resolution. @internal */
export interface DocumentExportShapingOptions extends DocumentExportFontResolutionOptions {
  /** Explicit per-face shaping execution ceiling. Defaults to 16 MiB. */
  readonly fontShaping?: FontShapingOptions;
  /** Host supports document optional ligatures in measurement and glyph output. */
  readonly documentLigatures?: boolean;
  readonly glyphFallbacks?: readonly FontRequest[];
  /** Origins composed after the document-embedded font origin. */
  readonly lastResortFonts?: readonly FontOrigin[];
  readonly signal?: AbortSignal;
  /** Maximum time for font origins and shaping initialization. Default: 60 seconds. */
  readonly timeoutMs?: number;
  /** Process-byte lease observations for resource-lifecycle tests and diagnostics. @internal */
  readonly onActiveFontBytesChange?: (activeBytes: number) => void;
}

/** Export session retaining the exact font evidence used to construct its measurer. @public */
export interface FontBackedExportSession extends ExportSession {
  /** Immutable font-resolution evidence; remains readable after session disposal. */
  readonly fontResolution: ExportFontResolutionReport;
}

/** Core-produced font-backed session with admitted-face and laid-out-text capabilities. @public */
export interface FontBackedExportCapabilities
  extends FontBackedExportSession, ExportAdmittedFontApi, ExportLaidOutTextApi {}

/** Whether a value publishes both font-backed session capabilities. @public */
export function hasFontBackedExportCapabilities<T extends object>(
  value: T
): value is T & ExportAdmittedFontApi & ExportLaidOutTextApi {
  return hasExportAdmittedFont(value) && hasExportLaidOutText(value);
}

/** Result of opening immutable bytes through Core's document-aware font composition root. @public */
export type OpenFontBackedDocumentForExportResult =
  | { readonly ok: true; readonly session: FontBackedExportCapabilities }
  | Exclude<OpenDocumentForExportResult, { readonly ok: true }>;

/** Font-backed one-shot session options shared by Markdown and future exporters. @public */
export interface OpenFontBackedDocumentForExportOptions extends Omit<
  OpenDocumentForExportOptions,
  'measurer' | 'reuseAcrossRevisions'
> {
  /** Explicit per-face shaping execution ceiling; defaults to 16 MiB. */
  readonly fontShaping?: FontShapingOptions;
  /** Apply document optional ligatures to both layout measurement and exported glyphs. */
  readonly documentLigatures?: boolean;
  /** Immutable font-backed byte sessions reject incremental revision reuse. */
  readonly reuseAcrossRevisions?: false;
  /** Ordered first-wins font origins resolved against this immutable DOCX. */
  readonly fonts: FontOrigin | readonly FontOrigin[];
  /**
   * Origins composed AFTER the document's own embedded fonts, for faces nothing else covers.
   * An origin here sees every face the explicit origins and the embedded fonts can paint in
   * `resolvedFaces`, so a stand-in it offers cannot shadow a face the document carries.
   */
  readonly lastResortFonts?: FontOrigin | readonly FontOrigin[];
  /** Font provisioning deadline; defaults to `resourceTimeoutMs`, then 60 seconds. */
  readonly fontResolutionTimeoutMs?: number;
  /** Ordered admitted faces used when a complete text span lacks glyph coverage. Maximum 16. */
  readonly glyphFallbacks?: readonly FontRequest[];
  /** `strict` refuses incomplete face coverage or any failed origin. Default: `best-effort`. */
  readonly fontPolicy?: 'best-effort' | 'strict';
  /** Fire-and-forget diagnostics; returned promises are observed but do not delay export. */
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
}

let activeDocumentFontBytes = 0;
const FONT_RESOLUTION_TIMEOUT = Symbol('font-resolution-timeout');

function createDocumentFontByteLease(onChange?: (activeBytes: number) => void): {
  readonly reserve: (byteLength: number) => () => void;
  readonly release: () => void;
} {
  let leasedBytes = 0;
  let released = false;
  onChange?.(activeDocumentFontBytes);
  const reserve = (byteLength: number): (() => void) => {
    if (released) throw new Error('Document font-byte lease is already released');
    if (activeDocumentFontBytes + byteLength > HARD_MAX_AGGREGATE_FONT_BYTES) {
      throw new ExportResourceError(
        'layoutFailed',
        `Active document export font bytes are limited to ${HARD_MAX_AGGREGATE_FONT_BYTES}; ` +
          `requested ${byteLength} bytes with ${activeDocumentFontBytes} bytes already active`
      );
    }
    activeDocumentFontBytes += byteLength;
    leasedBytes += byteLength;
    onChange?.(activeDocumentFontBytes);
    let reservationReleased = false;
    return () => {
      if (reservationReleased || released) return;
      reservationReleased = true;
      activeDocumentFontBytes -= byteLength;
      leasedBytes -= byteLength;
      onChange?.(activeDocumentFontBytes);
    };
  };
  return {
    reserve,
    release: () => {
      if (released) return;
      released = true;
      activeDocumentFontBytes -= leasedBytes;
      leasedBytes = 0;
      onChange?.(activeDocumentFontBytes);
    },
  };
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * The same read `layout/symbol-run.ts` makes: the WML namespace, or none — unprefixed
 * attributes on WML elements are common in authored packages. Use it wherever the answer
 * decides what LAYOUT will do, so a foreign-namespaced attribute cannot say otherwise.
 */
function wmlAttributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find(
    (attribute) =>
      attribute.localName === localName &&
      (attribute.namespaceUri === WML_NAMESPACE_URI || attribute.namespaceUri === '')
  )?.value;
}

/**
 * Open immutable DOCX bytes with document-aware, session-owned font shaping.
 *
 * This is the composition root exporters should use. It parses before requesting fonts, applies
 * cancellation/deadlines to provisioning, atomically binds the resulting measurer to that parsed
 * view, and releases the document-specific font lease with the returned session. When best-effort
 * resolution admits no source, the session retains Core's deterministic fixed measurer; strict
 * policy already refuses that incomplete coverage. Mutable views are intentionally excluded: a
 * live editor host must supply its own revision-stable measurer.
 *
 * @public
 */
export async function openFontBackedDocumentForExport(
  source: Uint8Array,
  options: OpenFontBackedDocumentForExportOptions
): Promise<OpenFontBackedDocumentForExportResult> {
  if ((options as { readonly reuseAcrossRevisions?: boolean }).reuseAcrossRevisions === true) {
    throw new TypeError(
      'reuseAcrossRevisions requires a live view or caller-supplied measurer; ' +
        'document-aware byte sessions are immutable'
    );
  }
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  const opened = openHeadlessDocument(source);
  if (!opened.ok) return opened;
  const {
    fonts,
    lastResortFonts,
    fontResolutionTimeoutMs,
    fontPolicy,
    onFontResolution,
    glyphFallbacks,
    documentLigatures,
    fontShaping,
    ...sessionOptions
  } = options;
  const origins = Array.isArray(fonts) ? fonts : [fonts as FontOrigin];
  const lastResort =
    lastResortFonts === undefined
      ? []
      : Array.isArray(lastResortFonts)
        ? lastResortFonts
        : [lastResortFonts as FontOrigin];
  let fontResolution: ExportFontResolutionReport | undefined;
  let shaping: DocumentExportShaping | undefined;
  try {
    shaping = await acquireDocumentExportShaping(opened.view, origins, {
      signal: options.signal,
      timeoutMs: fontResolutionTimeoutMs ?? options.resourceTimeoutMs,
      fontPolicy,
      glyphFallbacks,
      documentLigatures,
      fontShaping,
      lastResortFonts: lastResort,
      onFontResolution: (report) => {
        fontResolution = report;
        return onFontResolution?.(report);
      },
    });
  } catch (error) {
    if (error instanceof ExportResourceError && error.code === 'aborted') {
      return { ok: false, reason: 'aborted' };
    }
    throw error;
  }
  if (!fontResolution) {
    shaping?.dispose();
    throw new ExportResourceError(
      'layoutFailed',
      'Document font resolution completed without publishing its evidence'
    );
  }
  let result: OpenDocumentForExportResult;
  try {
    result = openDocumentForExport(opened.view, {
      ...sessionOptions,
      reuseAcrossRevisions: false,
      ...(shaping
        ? {
            measurer: shaping.createMeasurer(),
            producer: options.producer ?? shaping.producer,
          }
        : options.producer
          ? { producer: options.producer }
          : {}),
    });
  } catch (error) {
    shaping?.dispose();
    throw error;
  }
  if (!result.ok) {
    shaping?.dispose();
    return result;
  }
  const session = result.session;
  let ownedShaping: DocumentExportShaping | undefined = shaping;
  let termination: 'active' | 'aborted' | 'disposed' = 'active';
  const unavailable = (): ExportResourceError =>
    termination === 'aborted'
      ? new ExportResourceError('aborted', 'Export resource settlement was aborted')
      : new ExportResourceError('disposed', 'Export session has been disposed');
  const disposeOwned = (next: 'aborted' | 'disposed'): void => {
    if (termination !== 'active') return;
    termination = next;
    options.signal?.removeEventListener('abort', abortOwned);
    try {
      session.dispose();
    } finally {
      ownedShaping?.dispose();
      ownedShaping = undefined;
    }
  };
  const abortOwned = (): void => disposeOwned('aborted');
  options.signal?.addEventListener('abort', abortOwned, { once: true });
  if (options.signal?.aborted) abortOwned();
  return {
    ok: true,
    session: Object.freeze({
      fontResolution,
      layout: () => (termination === 'active' ? session.layout() : Promise.reject(unavailable())),
      layoutFor: (displayMode: Parameters<ExportSession['layoutFor']>[0]) =>
        termination === 'active' ? session.layoutFor(displayMode) : Promise.reject(unavailable()),
      validatedImageBytes: (drawing: Parameters<ExportSession['validatedImageBytes']>[0]) =>
        termination === 'active' ? session.validatedImageBytes(drawing) : null,
      metafileBytes: (drawing: Parameters<NonNullable<ExportSession['metafileBytes']>>[0]) =>
        termination === 'active' ? (session.metafileBytes?.(drawing) ?? null) : null,
      chartFallbackResource: (
        drawing: Parameters<NonNullable<ExportSession['chartFallbackResource']>>[0]
      ) =>
        termination === 'active'
          ? (session.chartFallbackResource?.(drawing) ?? Promise.resolve(undefined))
          : Promise.resolve(undefined),
      admittedFontFace: bindSessionAdmittedFont({
        status: () => termination,
        unavailable,
        resolve: () => ownedShaping?.resolveFont,
      }),
      shapeLaidOutText: bindSessionExportLaidOutText({
        status: () => termination,
        unavailable,
        shaping: () => ownedShaping,
      }),
      dispose: () => disposeOwned('disposed'),
    }),
  };
}

/**
 * Resolve ordered font origins for one document and acquire its shared HarfBuzz substrate.
 *
 * Origins are first-wins, exactly like browser editor font origins. Resolvers receive only the
 * bounded family catalog declared by the body, styles, headers, footers, and notes. An empty or
 * unresolved origin list returns `undefined`; callers can then retain Core's deterministic fixed
 * measurer. Network-backed origins therefore remain an explicit exporter-host decision.
 *
 * @internal
 */
export async function acquireDocumentExportShaping(
  view: HeadlessDocumentView,
  origins: readonly FontOrigin[],
  options: DocumentExportShapingOptions = {}
): Promise<DocumentExportShaping | undefined> {
  const executionPolicy = fontShapingPolicy(options.fontShaping, EXPORT_HARFBUZZ_SHAPER_POLICY);
  if ((options.glyphFallbacks?.length ?? 0) > 16)
    throw new RangeError('At most 16 glyph fallback faces are supported');
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const controller = new AbortController();
  const abortFromHost = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromHost, { once: true });
  if (options.signal?.aborted) abortFromHost();
  const timer = setTimeout(() => controller.abort(FONT_RESOLUTION_TIMEOUT), timeoutMs);

  try {
    throwIfAborted(controller.signal);
    const work = (async (): Promise<DocumentExportShaping | undefined> => {
      const fontByteLease = createDocumentFontByteLease(options.onActiveFontBytesChange);
      let leaseTransferred = false;
      try {
        // Family names are file-supplied, so the cap truncates rather than refuses the document.
        // documentFontFamilies orders body before furniture before notes, which makes the cut
        // safe: a hostile header cannot crowd the body's faces out. The editor caps the same way.
        const families = documentFontFamilies(view).slice(0, MAX_RESOLVER_FAMILIES);
        const documentFonts = documentFontSubstitutionPlan(view, families);
        const originFailures: FontOriginFailure[] = [];
        const embeddedFontDiagnostics: DocumentEmbeddedFontDiagnostics = { dropped: [] };
        const embeddedOrigin = documentEmbeddedFontOrigin(view, embeddedFontDiagnostics);
        const resolvedOrigins = [
          ...origins,
          ...(embeddedOrigin ? [embeddedOrigin] : []),
          ...(options.lastResortFonts ?? []),
        ];
        const resolved = await composePreparedFontOrigins(
          resolvedOrigins,
          {
            // Explicit fallback requests must reach demand-driven resolvers. Reserve their
            // bounded slots before the body-first document catalog; keep the total cap.
            families: [
              ...new Set([
                ...(options.glyphFallbacks ?? []).map((face) => face.family),
                ...documentFonts.families,
              ]),
            ].slice(0, MAX_RESOLVER_FAMILIES),
            defaultFamily: DEFAULT_FONT.family,
            signal: controller.signal,
          },
          {
            onOriginFailure: (failure) => originFailures.push(failure),
            reserveOwnedBytes: fontByteLease.reserve,
            maxExecutionFontBytes: executionPolicy.maxFontBytes,
            // Export writes every page once, so it waits for faces an editor paints late.
            awaitDeferred: true,
          }
        );
        throwIfAborted(controller.signal);
        const composed = composeFontConfiguration(resolved ?? {});
        const configuration = applyDocumentFontSubstitutions(composed, documentFonts);
        const standIns = hostChainedDocumentFallbacks(composed, configuration, documentFonts);
        if (configuration.sources.length === 0) {
          const report = fontResolutionReport(
            families,
            configuration.defaultFont.family,
            originFailures,
            undefined,
            embeddedFontDiagnostics.dropped
          );
          publishFontResolutionReport(report, options);
          enforceStrictFontPolicy(report, options, options.glyphFallbacks);
          return undefined;
        }
        const shaping = await createSessionExportShaping(
          prepareOwnedLayoutFontConfiguration(configuration),
          undefined,
          options.glyphFallbacks,
          options.documentLigatures,
          { maxFontBytes: executionPolicy.maxFontBytes }
        );
        throwIfAborted(controller.signal);
        const report = fontResolutionReport(
          families,
          configuration.defaultFont.family,
          originFailures,
          shaping.resolveFont,
          embeddedFontDiagnostics.dropped,
          standIns
        );
        publishFontResolutionReport(report, options);
        enforceStrictFontPolicy(report, options, options.glyphFallbacks);
        leaseTransferred = true;
        return Object.freeze({
          ...shaping,
          dispose: fontByteLease.release,
        });
      } finally {
        if (!leaseTransferred) fontByteLease.release();
      }
    })();
    return await Promise.race([work, abortFailure(controller.signal)]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromHost);
  }
}

function normalizedTimeout(value: number | undefined): number {
  if (value === undefined) return 60_000;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }
  return Math.max(1, value);
}

function abortFailure(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (): void => {
      reject(exportAbortError(signal));
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

function exportAbortError(signal: AbortSignal): ExportResourceError {
  const timedOut = signal.reason === FONT_RESOLUTION_TIMEOUT;
  return new ExportResourceError(
    timedOut ? 'timedOut' : 'aborted',
    timedOut ? 'Font resolution timed out' : 'Font resolution was aborted',
    timedOut ? undefined : { cause: signal.reason }
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw exportAbortError(signal);
}

function documentFontFamilies(view: HeadlessDocumentView): readonly string[] {
  const bodyRoots: OoxmlElement[] = [view.part().root];
  const furnitureRoots: OoxmlElement[] = [];
  const noteRoots: OoxmlElement[] = [];
  const seen = new Set<string>([view.part().name]);
  const append = (
    into: OoxmlElement[],
    part: { readonly name: string; readonly root: OoxmlElement } | null
  ): void => {
    if (!part || seen.has(part.name)) return;
    seen.add(part.name);
    into.push(part.root);
  };

  for (const section of view.headerFooterPartsBySection()) {
    for (const part of section.headers.values()) append(furnitureRoots, part);
    for (const part of section.footers.values()) append(furnitureRoots, part);
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    noteRoots.push(...referencedNoteRoots(view, kind));
  }
  const headlessTheme = view.documentThemeFonts();
  const theme = {
    ...headlessTheme,
    major: headlessTheme.major,
    minor: headlessTheme.minor,
    majorEastAsia: headlessTheme.majorEastAsia ?? null,
    minorEastAsia: headlessTheme.minorEastAsia ?? null,
  };
  const byFold = new Map<string, string>();
  const appendStoryTier = (
    roots: readonly OoxmlElement[],
    context: 'body' | 'furniture' | 'note' | 'detached'
  ): void => {
    const rendered = collectRenderedFontFamilyCandidates(
      roots,
      view.stylesRoot(),
      theme,
      synthesizedFieldGlyphIds(roots, context)
    );
    const markerFamilies = usedNumberingFontFamilies(
      roots,
      view.numberingRoot(),
      view.stylesRoot(),
      theme
    );
    for (const family of [
      ...rendered.direct,
      ...layoutSynthesizedFontFamilies(roots),
      ...markerFamilies,
      ...eastAsianLanguageFontFamilies(roots, view.stylesRoot(), theme),
      ...rendered.inherited,
    ]) {
      const fold = family.toLowerCase();
      if (!byFold.has(fold)) byFold.set(fold, family);
    }
  };
  // Preserve the visible document body before any bounded secondary story catalog. Within each
  // tier, direct/synthetic/marker faces precede inherited candidates. This keeps a hostile header
  // or orphan note from crowding the body's active Normal face out of the resolver cap.
  appendStoryTier(bodyRoots, 'body');
  // Chart and saved diagram parts name their labels' faces outside every story.
  for (const family of drawingPartFontFamilies(view.currentPackage(), theme)) {
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  }
  appendStoryTier(furnitureRoots, 'furniture');
  appendStoryTier(noteRoots, 'note');
  return [...byFold.values()];
}

function referencedNoteRoots(view: HeadlessDocumentView, kind: NoteKind): readonly OoxmlElement[] {
  const part = resolveNotesPart(view.currentPackage(), kind);
  if (!part) return [];
  const referenced = new Set(
    collectNoteReferences(view.part())
      .filter((hit) => hit.noteKind === kind)
      .map((hit) => hit.noteId)
  );
  const roots: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    const type = noteTypeOf(child);
    const id = noteIdOf(child);
    if (
      type === 'separator' ||
      type === 'continuationSeparator' ||
      (id !== null && referenced.has(id))
    ) {
      roots.push(child as OoxmlElement);
    }
  }
  return roots;
}

const OMML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/**
 * Nodes whose visible text is created by field projection instead of stored in a glyph run.
 *
 * This deliberately follows the bounded field parser and records only a well-formed PAGE-family
 * or SYMBOL field with no cached result. Generic `fldChar` runs are metadata, not glyphs: treating
 * all three marker runs as visible leaks inert font declarations to resolvers and can crowd real
 * document faces out of the bounded catalog.
 */
function synthesizedFieldGlyphIds(
  roots: readonly OoxmlElement[],
  storyContext: 'body' | 'furniture' | 'note' | 'detached'
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const root of roots) {
    const paragraphs: Array<{
      paragraph: OoxmlElement;
      context: 'body' | 'furniture' | 'note' | 'detached';
    }> = [];
    const rootStack: Array<{
      node: OoxmlElement;
      context: 'body' | 'furniture' | 'note' | 'detached';
    }> = [{ node: root, context: storyContext }];
    while (rootStack.length > 0) {
      const { node, context } = rootStack.pop()!;
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
        paragraphs.push({ paragraph: node, context });
      }
      const childContext =
        node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'txbxContent'
          ? context === 'body' || context === 'note'
            ? 'detached'
            : context
          : context;
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind !== 'textValue') {
          rootStack.push({ node: child as OoxmlElement, context: childContext });
        }
      }
    }
    for (const paragraph of paragraphs) {
      collectParagraphSynthesizedFieldGlyphIds(paragraph.paragraph, ids, paragraph.context);
    }
  }
  return ids;
}

function collectParagraphSynthesizedFieldGlyphIds(
  paragraph: OoxmlElement,
  ids: Set<string>,
  context: 'body' | 'furniture' | 'note' | 'detached'
): void {
  const state = createFieldParseState();
  let beginRunId: string | null = null;
  let separateRunId: string | null = null;
  let instruction = '';
  let instructionOverflow = false;
  let hadSeparate = false;
  let hasLegacyFormData = false;
  let resultVisibility = 0;
  const stack: Array<{
    node: OoxmlElement;
    runId: string | null;
    visibility: number;
    containerDepth: number;
  }> = [];
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const child = paragraph.children[index]!;
    if (child.kind !== 'textValue') {
      stack.push({
        node: child as OoxmlElement,
        runId: null,
        visibility: ALL_REVISION_VIEWS,
        containerDepth: 0,
      });
    }
  }

  while (stack.length > 0) {
    const { node, runId: inheritedRunId, visibility, containerDepth } = stack.pop()!;
    if (containerDepth >= MAX_INLINE_CONTAINER_DEPTH) continue;
    // A textbox is a distinct story with its own paragraph field state. It is discovered by
    // the root walk and processed separately; never let its markers nest into the host paragraph.
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    const runId =
      node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'r' ? node.id : inheritedRunId;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
      const raw = attributeValue(node, 'instr') ?? '';
      if (
        simpleFieldInstructionMaySynthesizeGlyph(raw, {
          allowPageFields: context === 'body' || context === 'furniture',
          allowRefFields: context === 'body' || context === 'note',
          allowPageRef: context === 'body',
          allowAutonum: context === 'body' || context === 'note',
        }) &&
        fieldSubtreeResultVisibility(node) !== ALL_REVISION_VIEWS
      ) {
        ids.add(node.id);
      }
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const kind = attributeValue(node, 'fldCharType');
      if (kind === 'begin') {
        onFldCharBegin(state);
        if (state.nesting === 1) {
          beginRunId = runId;
          separateRunId = null;
          instruction = '';
          instructionOverflow = false;
          hadSeparate = false;
          hasLegacyFormData = hasLegacyFormFieldData(node);
          resultVisibility = 0;
        }
      } else if (kind === 'separate') {
        const outermost = state.nesting === 1;
        onFldCharSeparate(state);
        if (outermost) {
          const effective = effectiveFieldInstruction(state);
          instruction = effective.instruction;
          instructionOverflow = effective.overflow || state.nestingOverflow;
          separateRunId = runId;
          hadSeparate = true;
        }
      } else if (kind === 'end') {
        if (state.nesting === 1) {
          if (state.phase === 'instruction') {
            const effective = effectiveFieldInstruction(state);
            instruction = effective.instruction;
            instructionOverflow = effective.overflow || state.nestingOverflow;
          }
          const synthesizes =
            !instructionOverflow &&
            complexFieldInstructionMaySynthesizeGlyph(instruction, {
              hasSeparate: hadSeparate,
              hasLegacyFormData,
              allowPageFields: context === 'body' || context === 'furniture',
              allowRefFields: context === 'body' || context === 'note',
              allowPageRef: context === 'body',
              allowAutonum: context === 'body' || context === 'note',
            });
          if (synthesizes && resultVisibility !== ALL_REVISION_VIEWS) {
            const projectedRunId = separateRunId ?? beginRunId;
            if (projectedRunId) ids.add(projectedRunId);
          }
        }
        onFldCharEnd(state);
      }
      // Field-marker payload (`ffData`, macros) is never instruction or visible result text.
      continue;
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'instrText' || node.localName === 'delInstrText')
    ) {
      onInstrText(state, boundedTextContent(node), node.localName === 'delInstrText');
      continue;
    }
    if (
      state.nesting > 0 &&
      isInsideFieldResult(state) &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      fieldResultElementPaints(node)
    ) {
      resultVisibility |= visibility;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') {
        stack.push({
          node: child as OoxmlElement,
          runId,
          visibility: visibility & revisionWrapperVisibility(node),
          containerDepth: nextInlineContainerDepth(node, containerDepth),
        });
      }
    }
  }
  resetFieldParseState(state);
}

function fieldResultElementPaints(node: OoxmlElement): boolean {
  if (node.localName === 't' || node.localName === 'delText') {
    return boundedTextContent(node).length > 0;
  }
  return node.localName === 'sym' || node.localName === 'tab' || node.localName === 'br';
}

const ALL_MARKUP_VIEW = 1;
const PROPOSED_VIEW = 2;
const ORIGINAL_VIEW = 4;
const ALL_REVISION_VIEWS = ALL_MARKUP_VIEW | PROPOSED_VIEW | ORIGINAL_VIEW;

function fieldSubtreeResultVisibility(field: OoxmlElement): number {
  const stack: Array<{ node: OoxmlElement; visibility: number }> = [];
  for (const child of field.children) {
    if (child.kind !== 'textValue') {
      stack.push({ node: child as OoxmlElement, visibility: ALL_REVISION_VIEWS });
    }
  }
  let resultVisibility = 0;
  while (stack.length > 0) {
    const { node, visibility } = stack.pop()!;
    // Nested textbox paragraphs reset field state and are visited independently by the caller.
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && fieldResultElementPaints(node)) {
      resultVisibility |= visibility;
      if (resultVisibility === ALL_REVISION_VIEWS) return resultVisibility;
    }
    for (const child of node.children) {
      if (child.kind !== 'textValue') {
        stack.push({
          node: child as OoxmlElement,
          visibility: visibility & revisionWrapperVisibility(node),
        });
      }
    }
  }
  return resultVisibility;
}

function revisionWrapperVisibility(node: OoxmlElement): number {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return ALL_REVISION_VIEWS;
  if (node.localName === 'ins' || node.localName === 'moveTo') {
    return ALL_MARKUP_VIEW | PROPOSED_VIEW;
  }
  if (node.localName === 'del' || node.localName === 'moveFrom') {
    return ALL_MARKUP_VIEW | ORIGINAL_VIEW;
  }
  return ALL_REVISION_VIEWS;
}

/**
 * Faces selected by layout semantics rather than a glyph-bearing run's `w:rFonts`.
 *
 * `w:sym/@w:font` belongs here rather than in the store's rendered-family derivation: a
 * symbol run paints one synthesized glyph, exactly like the `{ SYMBOL 183 \\f "Wingdings" }`
 * field two lines below it, and an unmapped private-use code point paints as a tofu box in
 * any face but the authored one — so an exporter that can load it should ask for it. The
 * editor's substitution notice deliberately does not; see `store/package/rendered-fonts.ts`.
 */
function layoutSynthesizedFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (candidate: string | null): void => {
    const family = validFontFamily(candidate ?? undefined);
    if (family === null) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  for (const root of roots) {
    const stack: OoxmlElement[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.namespaceUri === OMML_NAMESPACE_URI) add(EQUATION_FONT_FAMILY);
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sym') {
        // The WML namespace or none, the way `layout/symbol-run.ts` reads it. A
        // foreign-namespaced `font` is a face layout never applies, and the request is
        // capped — so admitting one could evict a face the document really renders in.
        // `symbolFontFamily` is the same rule the editor's own symbol-face collection
        // applies, so both ask for exactly the faces a sink could paint with.
        add(symbolFontFamily(wmlAttributeValue(node, 'font')));
      }
      // Text art (a text watermark) paints its string as outlines of the face it names.
      if (node.localName === 'textpath') add(textPathFontFamily(node));
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
        const instruction = attributeValue(node, 'instr');
        add(parseSymbolInstruction(instruction ?? '')?.font ?? null);
      }
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
        for (const family of complexSymbolFieldFonts(node)) add(family);
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
      }
    }
  }
  return [...byFold.values()];
}

function boundedTextContent(root: OoxmlElement): string {
  let text = '';
  const stack = [...root.children].reverse();
  while (stack.length > 0 && text.length <= 256) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') text += node.value;
    else {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return text;
}
