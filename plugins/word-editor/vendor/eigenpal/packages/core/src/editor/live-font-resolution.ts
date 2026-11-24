import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import type { FontFaceRequest } from '../contracts/editor-fonts.ts';
import type { UsedFontFace } from './font-face-usage.ts';
import { supportedFontFamilies } from '../layout/supported-font-families.ts';
import { drawingPartFontFamilies } from '../store/package/drawing-part-fonts.ts';
import { fontResolverFamilies } from './font-availability.ts';
import { MAX_RESOLVER_FAMILIES } from './font-composition.ts';
import { resolverGlyphFontFamilies } from './resolver-glyph-font-families.ts';

/**
 * The families to ask a font resolver for: the caret's family when it is not the default,
 * then every family the document uses.
 */
export function liveFontFamilies(
  session: TreeDocxSessionView,
  caretFamily: string | undefined,
  defaultFamily: string | undefined
): readonly string[] {
  const [selected] = supportedFontFamilies([[caretFamily]]);
  return fontResolverFamilies(
    [
      ...new Set([
        ...(selected && selected !== defaultFamily ? [selected] : []),
        ...session.documentFonts(),
        // Chart and diagram labels name faces outside every story.
        ...drawingPartFontFamilies(session.currentPackage(), session.documentThemeFonts()),
      ]),
    ],
    resolverGlyphFontFamilies(session),
    MAX_RESOLVER_FAMILIES
  );
}

/**
 * The faces that laid-out text uses, as a resolver request names them: a run that names no
 * font uses `defaultFamily`. The caret's face goes first, so the face a user picks loads
 * before they type. Undefined before any text is laid out, so the resolver loads every face
 * of the families it serves, as it did before it was told the faces.
 */
export function requestFaces(
  used: readonly UsedFontFace[] | undefined,
  defaultFamily: string,
  caret?: {
    readonly fontFamily?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
  } | null
): readonly FontFaceRequest[] | undefined {
  if (!used || used.length === 0) return undefined;
  const faces: FontFaceRequest[] = [];
  const seen = new Set<string>();
  const caretFace: UsedFontFace | null | undefined = caret && {
    family: caret.fontFamily ?? null,
    weight: caret.bold ? 700 : 400,
    style: caret.italic ? 'italic' : 'normal',
  };
  for (const face of caretFace ? [caretFace, ...used] : used) {
    const family = face.family?.trim() ? face.family : defaultFamily;
    const request = { family, weight: face.weight, style: face.style };
    const key = faceKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(request);
  }
  return faces;
}

/** The case-folded identity of a face, as `FontResolutionRequest.resolvedFaces` keys it. */
const faceKey = (face: FontFaceRequest): string =>
  `${face.family.trim().toLowerCase()}\u0000${face.weight}\u0000${face.style}`;

/** What one resolution asks for: the families, and the faces of them that text uses. */
export interface LiveFontRequest {
  readonly families: readonly string[];
  /** Absent when no text is laid out yet: the resolver then loads every face. */
  readonly faces?: readonly FontFaceRequest[];
  /**
   * Every family the document uses, also those asked for before. A follow-up asks about a few
   * families, but the document's substitutions still cover all of them.
   */
  readonly documentFamilies?: readonly string[];
}

/** Serialize font updates within a document. A new document can supersede a pending fetch. */
export function createLiveFontResolution<Late>(
  read: () => {
    generation: number;
    families: () => readonly string[];
    /** The faces that laid-out text uses, or undefined before any text is laid out. */
    faces?: () => readonly FontFaceRequest[] | undefined;
    /** The family of a run that names no font: the request names it apart (`defaultFamily`). */
    defaultFamily?: string;
    dynamic: boolean;
  } | null,
  resolve: (request: LiveFontRequest, late?: Late) => Promise<void>
): {
  /** Queue a resolution; `initial` runs it now and returns its work, if it started any. */
  schedule(initial?: boolean): Promise<void> | undefined;
  /**
   * Queue faces that arrived after the first paint, for the font generation that asked for
   * them. They install after any resolution in flight, so the two never race.
   */
  deliver(generation: number, late: Late): void;
  /** Whether this document's resolution asked the resolver for `family` already. */
  asked(family: string): boolean;
} {
  let current:
    | {
        generation: number;
        requested: Set<string>;
        requestedFaces: Set<string>;
        /** Families asked for with no faces: the resolver loaded every face of them. */
        everyFace: Set<string>;
        running: boolean;
        late: Late[];
      }
    | undefined;
  let queued = false;
  const pump = (): Promise<void> | undefined => {
    queued = false;
    const state = read();
    if (!state) return;
    const initial = current?.generation !== state.generation;
    if (initial) {
      current = {
        generation: state.generation,
        requested: new Set(),
        requestedFaces: new Set(),
        everyFace: new Set(),
        running: false,
        late: [],
      };
    }
    const active = current!;
    if (active.running) return;
    const faces = state.faces?.();
    const late = active.late.shift();
    if (late !== undefined) {
      active.running = true;
      const work = resolve({ families: state.families(), ...(faces ? { faces } : {}) }, late);
      void work.finally(() => {
        active.running = false;
        if (current === active) schedule();
      });
      return work;
    }
    if (!initial && !state.dynamic) return;
    // A fixed configuration asks nothing of a resolver, but the document's substitution plan
    // still needs its families: without them no family the configuration lacks falls back.
    const documentFamilies = state.families();
    const families = documentFamilies.filter(
      (family) => !active.requested.has(family.toLowerCase())
    );
    // A face that text uses for the first time (an edit made a word bold) asks again for its
    // family, even when the family was asked for before.
    const newFaces = (faces ?? []).filter(
      (face) =>
        !active.requestedFaces.has(faceKey(face)) &&
        !active.everyFace.has(face.family.toLowerCase())
    );
    if (!initial && families.length === 0 && newFaces.length === 0) return;
    for (const family of families) active.requested.add(family.toLowerCase());
    // A request with no faces loads every face of its families and of the default family, so
    // a face of one of them that layout records later needs nothing more.
    if (!faces) {
      for (const family of families) active.everyFace.add(family.toLowerCase());
      if (state.defaultFamily) active.everyFace.add(state.defaultFamily.toLowerCase());
    }
    for (const face of newFaces) active.requestedFaces.add(faceKey(face));
    const asked = [...families];
    const folded = new Set(families.map((family) => family.toLowerCase()));
    const defaultFold = state.defaultFamily?.toLowerCase();
    for (const face of newFaces) {
      const fold = face.family.toLowerCase();
      if (folded.has(fold) || fold === defaultFold) continue;
      if (asked.length >= MAX_RESOLVER_FAMILIES) break;
      folded.add(fold);
      asked.push(face.family);
    }
    // The default family's faces go along when one of them is new: the request names that
    // family apart, in `defaultFamily`.
    if (newFaces.some((face) => face.family.toLowerCase() === defaultFold))
      folded.add(defaultFold!);
    active.running = true;
    // Failed families stay attempted until the next document load. A failing provider
    // must not retry on every keystroke. resolve owns error reporting and degradation.
    const work = resolve({
      families: asked,
      documentFamilies,
      ...(faces ? { faces: faces.filter((face) => folded.has(face.family.toLowerCase())) } : {}),
    });
    void work.finally(() => {
      active.running = false;
      if (current === active) schedule();
    });
    return work;
  };
  const schedule = (initial = false): Promise<void> | undefined => {
    if (initial) return pump();
    if (queued) return;
    queued = true;
    queueMicrotask(pump);
  };
  const deliver = (generation: number, late: Late): void => {
    if (current?.generation !== generation) return;
    current.late.push(late);
    schedule();
  };
  const asked = (family: string): boolean => {
    const key = family.trim().toLowerCase();
    return !!current && (current.requested.has(key) || current.everyFace.has(key));
  };
  return { schedule, deliver, asked };
}
