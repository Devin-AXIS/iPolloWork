// Paint-side twin of embedded-font auto-wiring, done safely (issue #78).
//
// Measurement never touches the browser's font machinery: HarfBuzz shapes the admitted
// bytes directly. But painted pages are ordinary DOM, so a font that exists only inside
// the DOCX renders in a platform substitute unless the SAME bytes are registered as a
// `FontFace`.
//
// The naive version of that — register under the family the DOCUMENT declares — is a
// zero-click UI-redressing hole, and was reverted once already. `FontFaceSet` is
// per-DOCUMENT, not per-subtree: a face added for a family name hides the installed font
// of that name for the WHOLE page. A file fully controls `w:font/@w:name`, so a document
// naming its face `Segoe UI` would repaint the host application's own chrome with
// attacker-chosen glyphs. CSS-quoting the name stops CSS injection, not shadowing —
// quoting is not namespacing.
//
// So faces register under an ENGINE-MINTED alias derived from the admitted face's content
// hash, and the painter emits `font-family: "<alias>", "<declared family>"`. Document text
// gets the embedded glyphs; the declared name keeps whatever it means to the host page.

import type { FontSource, FontSourceSubstitution } from '../contracts/editor.ts';
import {
  boundedStructuralFontValidator,
  FontResolutionError,
  type FontResourceSnapshot,
} from '../layout/font-resource.ts';
import { sfntFaceIsBold } from '../layout/synthetic-bold.ts';
import { materializeCollectionFace } from './font-collection-face.ts';

/** The slice of `FontFace` this module needs; injectable for tests. */
export interface FontFaceLike {
  load(): Promise<unknown>;
}

/** The slice of `FontFaceSet` this module needs; injectable for tests. */
export interface FontFaceSetLike {
  add(face: FontFaceLike): unknown;
  delete(face: FontFaceLike): unknown;
}

export interface EmbeddedFontFaceEnvironment {
  readonly fontSet?: FontFaceSetLike | undefined;
  readonly createFontFace?: (
    family: string,
    bytes: Uint8Array,
    descriptors: { readonly weight: string; readonly style: 'normal' | 'italic' }
  ) => FontFaceLike;
}

/** Faces registered for one document load; disposing removes exactly those faces. */
export interface EmbeddedFontFaceRegistration {
  /** Faces actually admitted into the set (per-face failures are dropped silently). */
  readonly installed: number;
  /**
   * Declared family -> alias, for the painter. Empty when nothing registered, which makes
   * painting fall back to the declared family alone.
   */
  readonly alias: (family: string) => string | undefined;
  /**
   * Register the same faces in another document's `FontFaceSet`, once per document. A set is
   * per document, so a surface that moves to a pop-out window or an iframe paints in
   * fallback glyphs until its new document has them too.
   */
  showIn(document: Document): void;
  dispose(): void;
}

const NO_REGISTRATION: EmbeddedFontFaceRegistration = Object.freeze({
  installed: 0,
  alias: () => undefined,
  showIn() {},
  dispose() {},
});

type FaceDescriptors = { readonly weight: string; readonly style: 'normal' | 'italic' };

/**
 * The weight descriptor of a face.
 *
 * A face in a bold slot whose own outlines are not bold registers at 599, below the CSS bold
 * threshold of 600. Bold text still selects it before the regular face, and the browser then
 * synthesizes the bold. At 700, the face matched bold text exactly, so the browser drew it at
 * its own regular weight. `bytes` holds the face first, as the browser gets it.
 */
function weightDescriptor(weight: number, bytes: Uint8Array): string {
  return weight >= 600 && !sfntFaceIsBold(bytes, 0) ? '599' : String(weight);
}

/**
 * The alias for one document's face set.
 *
 * Derived from content hashes, so it is engine-minted and a document cannot collide with
 * a host family name — the whole point. The `docx-embedded-` prefix keeps it recognisable
 * in devtools, and the alias is per-FAMILY (not per-face) because CSS selects weight and
 * style through the descriptors, not the name.
 */
function aliasForFamily(hashes: readonly string[]): string {
  let digest = 0;
  for (const hash of hashes) {
    for (let index = 0; index < hash.length; index += 1) {
      digest = (digest * 31 + hash.charCodeAt(index)) >>> 0;
    }
  }
  return `docx-embedded-${digest.toString(36)}`;
}

/** Match the family normalization used by measurement's fontRequestKey. */
const familyKey = (family: string): string => family.trim().toLowerCase();

/**
 * The font machinery of `doc`, or of the script's own document when none is given.
 *
 * Both halves come from the SAME window: a `FontFace` made by one window's constructor is
 * refused by another window's `FontFaceSet`.
 */
export function fontFaceEnvironmentOf(doc?: Document | null): EmbeddedFontFaceEnvironment {
  const target =
    doc ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : undefined);
  const fontSet = (target as { fonts?: FontFaceSetLike } | undefined)?.fonts;
  const FontFaceCtor = (target?.defaultView as (Window & typeof globalThis) | null | undefined)
    ?.FontFace;
  if (!fontSet || typeof FontFaceCtor !== 'function') return {};
  return {
    fontSet,
    createFontFace: (family, bytes, descriptors) =>
      // A copy, not the admitted view: FontFace snapshots its source, but slicing keeps
      // the engine's buffers from ever being aliased by browser internals.
      new FontFaceCtor(family, bytes.slice().buffer, descriptors) as unknown as FontFaceLike,
  };
}

/**
 * Register admitted faces under engine-minted aliases and return the lookup the painter
 * uses. Resolves after every face has either loaded into the set or failed; per-face
 * failure only lowers `installed`.
 *
 * Callers MUST pass faces that survived validation — these bytes reach the browser's own
 * font loader.
 *
 * `substitutions` extends the lookup to the names runs actually write: a document says
 * `Calibri` while the registered face is `Carlito`, so without the map the text measures
 * shaped and then paints in a platform substitute. Aliasing the `from` name is what makes
 * app-supplied stand-ins paintable WITHOUT registering a face called "Calibri" globally —
 * the shadowing hole this module exists to avoid applies to Word's family names just as
 * much as to a document's own.
 */
export async function registerEmbeddedFontFaces(
  sources: readonly FontSource[],
  environment: EmbeddedFontFaceEnvironment = fontFaceEnvironmentOf(),
  substitutions: readonly FontSourceSubstitution[] = []
): Promise<EmbeddedFontFaceRegistration> {
  const { fontSet, createFontFace } = environment;
  if (!fontSet || !createFontFace || sources.length === 0) return NO_REGISTRATION;

  // One alias per declared family, covering all of that family's faces.
  const byFamily = new Map<string, FontSource[]>();
  for (const source of sources) {
    const family = familyKey(source.request.family);
    const list = byFamily.get(family);
    if (list) list.push(source);
    else byFamily.set(family, [source]);
  }

  const aliases = new Map<string, string>();
  const added: { readonly set: FontFaceSetLike; readonly face: FontFaceLike }[] = [];
  /**
   * What each accepted face was made from, so `showIn` can make it again elsewhere. The SOURCE,
   * not its bytes: a source can hand out a fresh copy on each read, and keeping one copy per
   * face for a window that may never open held every document font once more.
   */
  const accepted: { alias: string; source: FontSource; descriptors: FaceDescriptors }[] = [];
  const browserBytesOf = (face: FontSource): Uint8Array => {
    const bytes = face.bytes;
    const isCollection =
      bytes.length >= 4 &&
      bytes[0] === 0x74 &&
      bytes[1] === 0x74 &&
      bytes[2] === 0x63 &&
      bytes[3] === 0x66;
    if (isCollection && face.faceIndex === 0 && !boundedStructuralFontValidator(bytes, 0).valid)
      throw new Error('Invalid collection face');
    if (!isCollection && face.faceIndex !== 0)
      throw new Error('Font face index requires a collection');
    // FontFace selects the first face from an unchanged collection. Keep its signature and
    // all tables; only other faces require materialization.
    return isCollection && face.faceIndex !== 0
      ? materializeCollectionFace(bytes, face.faceIndex)
      : bytes;
  };
  await Promise.all(
    [...byFamily].map(async ([family, faces]) => {
      const alias = aliasForFamily(faces.map((face) => `${face.hash}:face:${face.faceIndex}`));
      let anyLoaded = false;
      await Promise.all(
        faces.map(async (face) => {
          try {
            const browserBytes = browserBytesOf(face);
            const descriptors: FaceDescriptors = {
              weight: weightDescriptor(face.request.weight, browserBytes),
              style: face.request.style,
            };
            const fontFace = createFontFace(alias, browserBytes, descriptors);
            await fontFace.load();
            fontSet.add(fontFace);
            added.push({ set: fontSet, face: fontFace });
            accepted.push({ alias, source: face, descriptors });
            anyLoaded = true;
          } catch {
            // Paint fidelity is best-effort; the face still measures shaped.
          }
        })
      );
      // Only advertise an alias the browser actually accepted: pointing the painter at a
      // family with no registered face would push text to the generic fallback instead of
      // the declared family behind it.
      if (anyLoaded) aliases.set(family, alias);
    })
  );
  if (added.length === 0) return NO_REGISTRATION;

  // A substituted-from name only borrows an alias that its target actually earned, and
  // never displaces a face registered under that name directly — a real Calibri beats a
  // stand-in for Calibri, the same precedence composition already applies to bytes.
  for (const substitution of substitutions) {
    const from = familyKey(substitution.from.family);
    if (aliases.has(from)) continue;
    const alias = aliases.get(familyKey(substitution.to.family));
    if (alias !== undefined) aliases.set(from, alias);
  }

  let disposed = false;
  const shownIn = new WeakSet<object>([fontSet]);
  return {
    installed: added.length,
    alias: (family) => (disposed ? undefined : aliases.get(familyKey(family))),
    showIn(doc) {
      if (disposed) return;
      const target = fontFaceEnvironmentOf(doc);
      if (!target.fontSet || !target.createFontFace || shownIn.has(target.fontSet)) return;
      shownIn.add(target.fontSet);
      for (const { alias, source, descriptors } of accepted) {
        try {
          const face = target.createFontFace(alias, browserBytesOf(source), descriptors);
          // Added before it loads: a set renders a face as soon as its bytes parse, and text
          // already painted under the alias re-renders then.
          target.fontSet.add(face);
          added.push({ set: target.fontSet, face });
          void face.load().catch(() => {});
        } catch {
          // Paint fidelity is best-effort; the face still measures shaped.
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { set, face } of added) {
        try {
          set.delete(face);
        } catch {
          /* removing from a torn-down set is not an error */
        }
      }
    },
  };
}

/**
 * The sources a shaping snapshot admitted, as the validated, owned copies it holds — never the
 * raw file view. A refused source, or one the snapshot answered with another face, is left out.
 */
export function admittedFontSources(
  sources: readonly FontSource[],
  snapshot: FontResourceSnapshot
): FontSource[] {
  const admitted: FontSource[] = [];
  for (const source of sources) {
    const resolved = snapshot.resolve(source.request);
    if (resolved instanceof FontResolutionError || resolved.id !== source.id) continue;
    const { id, hash, faceIndex } = resolved;
    admitted.push({
      request: source.request,
      id,
      // Read when a face is registered: the owned copy is handed out fresh then, and nothing
      // keeps a second copy of every font for the document's lifetime.
      get bytes() {
        return resolved.bytes;
      },
      hash,
      faceIndex,
    });
  }
  return admitted;
}
