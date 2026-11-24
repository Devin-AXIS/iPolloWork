// Page backgrounds acquire an implicit default-style paragraph after each header.
// These are layout reserves, never authored nodes or editable paragraph records.
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { HeaderFooterStoryLayout } from './hf-layout.ts';
import { attributeValue, childNamed } from './style-definition-reader.ts';

type Kind = 'header' | 'footer';

export function hasPageBackground(part: OoxmlPart): boolean {
  return part.root.children.some(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'background'
  );
}

function element(
  id: string,
  localName: string,
  children: readonly OoxmlElement[] = []
): OoxmlElement {
  return {
    id,
    kind: localName === 'p' ? 'paragraph' : localName === 'pPr' ? 'paragraphProperties' : 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as OoxmlElement;
}

function furnitureStyle(root: OoxmlElement | null, kind: Kind): string {
  for (const node of root?.children ?? []) {
    if (node.kind === 'textValue' || node.localName !== 'style') continue;
    if (attributeValue(node, 'type') !== 'paragraph') continue;
    const name = childNamed(node, 'name');
    if (name && attributeValue(name, 'val')?.toLowerCase() === kind)
      return attributeValue(node, 'styleId') ?? kind;
  }
  return kind === 'header' ? 'Header' : 'Footer';
}

/** Per furniture source: weak authored identities and at most six missing-story shells. */
export function createBackgroundFurnitureProjection(stylesRoot: () => OoxmlElement | null) {
  const projected = new WeakMap<OoxmlPart, OoxmlPart>();
  const metadata = new WeakMap<
    OoxmlPart,
    { original?: OoxmlPart; reserveIds: ReadonlySet<string> }
  >();
  const stripped = new WeakMap<HeaderFooterStoryLayout, HeaderFooterStoryLayout>();
  const missing = new Map<string, OoxmlPart>();
  let priorStyles: OoxmlElement | null | undefined;

  // Deliberately NOT named after the store's scope-keyed part accessor, which opens and
  // permanently retains a story store and is pinned by
  // `core/src/__tests__/part-for-call-sites.test.ts`. This only projects a
  // background-reserving copy of an already-resolved header or footer part, so it takes a
  // name of its own rather than blunting that guard with a collision.
  const variantPart = (original: OoxmlPart | undefined, kind: Kind, variant: string): OoxmlPart => {
    if (original && kind === 'footer') return original;
    const cached = original && projected.get(original);
    if (cached) return cached;
    const styles = stylesRoot();
    if (priorStyles !== styles) {
      missing.clear();
      priorStyles = styles;
    }
    const key = `${kind}-${variant}`;
    if (!original && missing.has(key)) return missing.get(key)!;
    const name = original?.name ?? `/__layout/background-${key}.xml`;
    const id = `${original?.id ?? name}:background-reserve`;
    const reserveIds = new Set<string>();
    const children: OoxmlElement[] = [];
    if (!original) {
      const style: OoxmlElement = {
        ...element(`${id}:style`, 'pStyle'),
        kind: 'generic',
        attributes: [
          {
            kind: 'wmlVal' as const,
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'val',
            prefix: 'w',
            value: furnitureStyle(styles, kind),
          },
        ],
      };
      const blank = element(`${id}:initial`, 'p', [element(`${id}:pPr`, 'pPr', [style])]);
      children.push(blank);
      reserveIds.add(blank.id);
    }
    if (kind === 'header') {
      const blank = element(`${id}:terminal`, 'p');
      reserveIds.add(blank.id);
      // A separate container prevents a trailing deleted paragraph mark in authored
      // content from merging into the reserve and adopting its default formatting.
      children.push(
        element(`${id}:container`, 'sdt', [element(`${id}:content`, 'sdtContent', [blank])])
      );
    }
    const root = original?.root ?? element(`${id}:root`, kind === 'header' ? 'hdr' : 'ftr');
    const derived: OoxmlPart = {
      id: original?.id ?? name,
      name,
      contentType:
        original?.contentType ??
        `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`,
      root: { ...root, children: [...root.children, ...children] } as OoxmlElement,
    };
    metadata.set(derived, { original, reserveIds });
    if (original) projected.set(original, derived);
    else missing.set(key, derived);
    return derived;
  };

  const authoredStory = (story: HeaderFooterStoryLayout): HeaderFooterStoryLayout => {
    const meta = story.part && metadata.get(story.part);
    if (!meta) return story;
    const cached = stripped.get(story);
    if (cached) return cached;
    const result: HeaderFooterStoryLayout = {
      ...story,
      part: meta.original,
      fragments: story.fragments.filter(
        (block) => block.kind !== 'paragraph' || !meta.reserveIds.has(block.paragraphId)
      ),
      withPageContext: (context) => authoredStory(story.withPageContext(context)),
    };
    stripped.set(story, result);
    return result;
  };
  return {
    variantPart,
    authoredStory,
    isImplicitPart: (part: OoxmlPart) => metadata.has(part) && !metadata.get(part)!.original,
  };
}
