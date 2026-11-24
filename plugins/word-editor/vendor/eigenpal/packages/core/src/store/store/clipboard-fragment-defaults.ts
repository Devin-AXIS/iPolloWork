// Shared fragment-merge helpers: structural signatures, styles-part indexing, and the
// default-formatting materialization (rich-clipboard-fidelity; split from
// clipboard-fragment-merge.ts to hold the max-lines cap).
//
// Materialization is what keeps a paste looking like its source when docDefaults differ:
// where a run or paragraph would re-resolve a value against the TARGET's defaults — no
// explicit value, no travelling style-chain value — the fragment's source-resolved default
// is stamped as direct formatting (review findings 2 and 5).

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { W14_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { attributeValueOf } from './tree-op-nodes.ts';
import { propertyElement } from './tree-op-properties.ts';
import type { OoxmlProperty } from './tree-op-types.ts';
import {
  APPLICATION_PARAGRAPH_PROPERTIES,
  APPLICATION_RUN_PROPERTIES,
  omittedFor,
  type OmittedDocDefaults,
} from '../package/application-doc-defaults.ts';

export function isElementNode(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

export function walkAll(nodes: readonly OoxmlNode[], visit: (node: OoxmlNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind !== 'textValue') walkAll(node.children, visit);
  }
}

/**
 * Order-stable structural signature for dedupe, blind to node ids and revision-save noise
 * (`w:rsid*`, `w14:paraId`/`textId`).
 */
export function nodeSignature(node: OoxmlNode): string {
  if (node.kind === 'textValue') return `T(${node.value})`;
  // `w:rsid*` CHILD elements are revision-save noise too (Word writes `<w:rsid w:val>`
  // under every style); folding them into the fingerprint made identical styles from
  // separately edited documents never match, so every paste imported a "(pasted)" copy.
  if (node.namespaceUri === WML_NAMESPACE_URI && node.localName.startsWith('rsid')) {
    return '';
  }
  const attrs = node.attributes
    .filter(
      (attribute) =>
        !attribute.localName.startsWith('rsid') &&
        !(
          attribute.namespaceUri === W14_NAMESPACE_URI &&
          (attribute.localName === 'paraId' || attribute.localName === 'textId')
        )
    )
    .map((attribute) => `${attribute.namespaceUri}|${attribute.localName}=${attribute.value}`)
    .sort()
    .join(',');
  const children = node.children.map(nodeSignature).join('');
  return `E(${node.namespaceUri}:${node.localName}[${attrs}]{${children}})`;
}

/** Signature of a style definition, ignoring its own id (compared across documents). */
export function styleSignature(style: OoxmlElement): string {
  const attrs = style.attributes
    .filter((attribute) => attribute.localName !== 'styleId')
    .map((attribute) => `${attribute.localName}=${attribute.value}`)
    .sort()
    .join(',');
  return `S[${attrs}]${style.children.map(nodeSignature).join('')}`;
}

export interface StylesInfo {
  readonly part: OoxmlPart | null;
  readonly styles: readonly OoxmlElement[];
  readonly docDefaults: OoxmlElement | null;
  readonly byId: ReadonlyMap<string, OoxmlElement>;
  readonly names: ReadonlySet<string>;
}

export function stylesInfoOf(part: OoxmlPart | null): StylesInfo {
  const styles: OoxmlElement[] = [];
  const byId = new Map<string, OoxmlElement>();
  const names = new Set<string>();
  let docDefaults: OoxmlElement | null = null;
  if (part && isElementNode(part.root)) {
    for (const child of part.root.children) {
      if (!isElementNode(child)) continue;
      if (isWml(child, 'docDefaults')) {
        docDefaults = child;
        continue;
      }
      if (!isWml(child, 'style')) continue;
      styles.push(child);
      const id = attributeValueOf(child, 'styleId');
      if (id) byId.set(id, child);
      const nameNode = child.children.find((inner) => isWml(inner, 'name'));
      const name = nameNode ? attributeValueOf(nameNode, 'val') : undefined;
      if (name) names.add(name);
    }
  }
  return { part, styles, docDefaults, byId, names };
}

// ---------------------------------------------------------------------------
// Default-formatting materialization (review findings 2 and 5)
// ---------------------------------------------------------------------------

function defaultsContainer(
  docDefaults: OoxmlElement | null,
  which: 'rPrDefault' | 'pPrDefault',
  inner: 'rPr' | 'pPr'
): ReadonlyMap<string, OoxmlNode> {
  const out = new Map<string, OoxmlNode>();
  if (!docDefaults) return out;
  const holder = docDefaults.children.find((child) => isWml(child, which));
  if (!holder || !isElementNode(holder)) return out;
  const props = holder.children.find((child) => isWml(child, inner));
  if (!props || !isElementNode(props)) return out;
  for (const prop of props.children) {
    if (prop.kind === 'textValue') continue;
    out.set(prop.localName, prop);
  }
  return out;
}

/** The styles part root a side carries, or `null` when it has none. */
function stylesRootOf(styles: StylesInfo): OoxmlElement | null {
  const root = styles.part?.root;
  return root && isElementNode(root) ? root : null;
}

/**
 * The halves a side leaves to the application, judged on the `w:docDefaults` this module reads,
 * so omission and authored values come from one element.
 */
function sideOmits(styles: StylesInfo): OmittedDocDefaults {
  return omittedFor(stylesRootOf(styles), styles.docDefaults);
}

/** The application's properties for an omitted default half, keyed by name. */
function applicationDefaults(properties: readonly OoxmlProperty[]): Map<string, OoxmlNode> {
  return new Map(
    properties.map((property) => [
      property.localName,
      propertyElement(property, `fragment#application-${property.localName}`),
    ])
  );
}

/** The `w:spacing` attributes a style chain states; the cascade merges them one by one. */
function chainSpacingAttributes(styles: StylesInfo, startId: string | undefined): Set<string> {
  const stated = new Set<string>();
  let id = startId;
  for (let hop = 0; hop < 16 && id; hop += 1) {
    const style = styles.byId.get(id);
    if (!style) break;
    const props = propertyContainerOf(style, 'pPr');
    const spacing = props?.children.find((child) => isWml(child, 'spacing'));
    if (spacing && isElementNode(spacing))
      for (const attribute of spacing.attributes) stated.add(attribute.localName);
    const basedOn = style.children.find((child) => isWml(child, 'basedOn'));
    id = basedOn ? attributeValueOf(basedOn, 'val') : undefined;
  }
  return stated;
}

/** Follow `w:basedOn` chains checking whether any style in the chain defines `localName`. */
function chainDefines(
  styles: StylesInfo,
  startId: string | undefined,
  container: 'rPr' | 'pPr',
  localName: string
): boolean {
  let id = startId;
  for (let hop = 0; hop < 16 && id; hop += 1) {
    const style = styles.byId.get(id);
    if (!style) return false;
    const props = style.children.find((child) => isWml(child, container));
    if (props && isElementNode(props)) {
      if (
        props.children.some((prop) => prop.kind !== 'textValue' && prop.localName === localName)
      ) {
        return true;
      }
    }
    const basedOn = style.children.find((child) => isWml(child, 'basedOn'));
    id = basedOn ? attributeValueOf(basedOn, 'val') : undefined;
  }
  return false;
}

function defaultStyleIdOf(styles: StylesInfo, type: 'paragraph' | 'character'): string | undefined {
  for (const style of styles.styles) {
    if (attributeValueOf(style, 'type') !== type) continue;
    const flag = attributeValueOf(style, 'default');
    if (flag === '1' || flag === 'true') return attributeValueOf(style, 'styleId');
  }
  return undefined;
}

function propertyContainerOf(node: OoxmlElement, localName: 'rPr' | 'pPr'): OoxmlElement | null {
  const found = node.children.find((child) => isWml(child, localName));
  return found && isElementNode(found) ? found : null;
}

/** CT_PPrBase child sequence (ECMA-376 17.3.1.26), for schema-position inserts. */
const PPR_CHILD_ORDER: ReadonlyMap<string, number> = new Map(
  [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    'jc',
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    'rPr',
    'sectPr',
    'pPrChange',
  ].map((name, index) => [name, index] as const)
);

/** CT_RPr child sequence (ECMA-376 17.3.2.28), for schema-position inserts. */
const RPR_CHILD_ORDER: ReadonlyMap<string, number> = new Map(
  [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
    'u',
    'effect',
    'bdr',
    'shd',
    'fitText',
    'vertAlign',
    'rtl',
    'cs',
    'em',
    'lang',
    'eastAsianLayout',
    'specVanish',
    'oMath',
    'rPrChange',
  ].map((name, index) => [name, index] as const)
);

/**
 * Stamp the fragment's source-resolved default formatting onto pasted content wherever the
 * value would otherwise re-resolve against the TARGET's defaults: the run/paragraph carries
 * no explicit value and its (travelling) style chain defines none, and the two documents'
 * defaults for that property differ.
 */
export function materializeDefaults(
  blocks: readonly OoxmlNode[],
  fragmentStyles: StylesInfo,
  targetStyles: StylesInfo
): readonly OoxmlNode[] {
  // A fragment without a styles part (external HTML) has no defaults of its own, so only a
  // carried styles part, or the target, resolves the application's defaults for an omission.
  const fragmentOmits = stylesRootOf(fragmentStyles) ? sideOmits(fragmentStyles) : null;
  const targetOmits = sideOmits(targetStyles);
  const fragmentRun = fragmentOmits?.run
    ? applicationDefaults(APPLICATION_RUN_PROPERTIES)
    : defaultsContainer(fragmentStyles.docDefaults, 'rPrDefault', 'rPr');
  const targetRun = targetOmits.run
    ? applicationDefaults(APPLICATION_RUN_PROPERTIES)
    : defaultsContainer(targetStyles.docDefaults, 'rPrDefault', 'rPr');
  const fragmentPara = fragmentOmits?.paragraph
    ? applicationDefaults(APPLICATION_PARAGRAPH_PROPERTIES)
    : defaultsContainer(fragmentStyles.docDefaults, 'pPrDefault', 'pPr');
  const targetPara = targetOmits.paragraph
    ? applicationDefaults(APPLICATION_PARAGRAPH_PROPERTIES)
    : defaultsContainer(targetStyles.docDefaults, 'pPrDefault', 'pPr');

  // Fold each side's default paragraph style over its docDefaults, the way the cascade
  // does, so "the default look" is one property set PER DOCUMENT. Folding only the
  // fragment side made a target whose `Normal` overrides docDefaults look identical to
  // the fragment's defaults, so nothing was stamped and the target restyled the paste.
  const foldDefaultParagraphStyle = (
    styles: StylesInfo,
    run: Map<string, OoxmlNode>,
    para: Map<string, OoxmlNode>
  ): string | undefined => {
    const id = defaultStyleIdOf(styles, 'paragraph');
    const style = id ? styles.byId.get(id) : undefined;
    if (!style) return id;
    for (const [containerName, folded] of [
      ['rPr', run],
      ['pPr', para],
    ] as const) {
      const props = propertyContainerOf(style, containerName);
      if (!props) continue;
      for (const prop of props.children) {
        if (prop.kind === 'textValue') continue;
        folded.set(prop.localName, prop);
      }
    }
    return id;
  };
  foldDefaultParagraphStyle(
    fragmentStyles,
    fragmentRun as Map<string, OoxmlNode>,
    fragmentPara as Map<string, OoxmlNode>
  );
  foldDefaultParagraphStyle(
    targetStyles,
    targetRun as Map<string, OoxmlNode>,
    targetPara as Map<string, OoxmlNode>
  );

  const runDiffers = new Map<string, OoxmlNode>();
  for (const [localName, prop] of fragmentRun) {
    const other = targetRun.get(localName);
    if (!other || nodeSignature(other) !== nodeSignature(prop)) runDiffers.set(localName, prop);
  }
  const paraDiffers = new Map<string, OoxmlNode>();
  for (const [localName, prop] of fragmentPara) {
    if (localName === 'sectPr') continue;
    const other = targetPara.get(localName);
    if (!other || nodeSignature(other) !== nodeSignature(prop)) paraDiffers.set(localName, prop);
  }
  if (runDiffers.size === 0 && paraDiffers.size === 0) return blocks;

  let stamp = 0;
  const freshId = (): string => `fragment#materialized-${stamp++}`;

  const cloneProp = (prop: OoxmlNode): OoxmlNode => {
    const clone = (node: OoxmlNode): OoxmlNode =>
      node.kind === 'textValue'
        ? { id: freshId(), kind: 'textValue', value: node.value }
        : ({ ...node, id: freshId(), children: node.children.map(clone) } as OoxmlNode);
    return clone(prop);
  };

  const withContainer = (
    element: OoxmlElement,
    localName: 'rPr' | 'pPr',
    additions: readonly OoxmlNode[]
  ): OoxmlElement => {
    if (additions.length === 0) return element;
    const existing = propertyContainerOf(element, localName);
    if (existing) {
      // SCHEMA POSITION, not prepend: CT_PPrBase/CT_RPr are sequences, and a `w:spacing`
      // emitted before `w:pStyle` is markup Word refuses. Each addition lands before the
      // first existing child whose canonical order is greater.
      const order = localName === 'rPr' ? RPR_CHILD_ORDER : PPR_CHILD_ORDER;
      const children = [...existing.children];
      for (const addition of additions) {
        const additionOrder =
          addition.kind === 'textValue'
            ? Number.MAX_SAFE_INTEGER
            : (order.get(addition.localName) ?? Number.MAX_SAFE_INTEGER);
        let at = children.length;
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index]!;
          if (child.kind === 'textValue') continue;
          const childOrder = order.get(child.localName);
          if (childOrder !== undefined && childOrder > additionOrder) {
            at = index;
            break;
          }
        }
        children.splice(at, 0, addition);
      }
      const merged = { ...existing, children } as OoxmlElement;
      return {
        ...element,
        children: element.children.map((child) => (child === existing ? merged : child)),
      } as OoxmlElement;
    }
    const container = {
      id: freshId(),
      kind: localName === 'rPr' ? 'runProperties' : 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: additions,
    } as unknown as OoxmlElement;
    return { ...element, children: [container, ...element.children] } as OoxmlElement;
  };

  /**
   * `paragraph` with the source default spacing attributes that differ from the target's and
   * that neither its direct `w:spacing` nor its style chain states, merged into the direct
   * `w:spacing` or added as one.
   */
  const withMissingSpacing = (
    paragraph: OoxmlElement,
    pPr: OoxmlElement,
    source: OoxmlElement,
    target: OoxmlNode | undefined,
    pStyleId: string | undefined
  ): OoxmlElement => {
    const stated = chainSpacingAttributes(fragmentStyles, pStyleId);
    const direct = pPr.children.find((child) => isWml(child, 'spacing'));
    if (direct && isElementNode(direct))
      for (const attribute of direct.attributes) stated.add(attribute.localName);
    const targetValues = new Map(
      target && isElementNode(target)
        ? target.attributes.map((attribute) => [attribute.localName, attribute.value] as const)
        : []
    );
    const missing = source.attributes.filter(
      (attribute) =>
        !stated.has(attribute.localName) &&
        targetValues.get(attribute.localName) !== attribute.value
    );
    if (missing.length === 0) return paragraph;
    const spacing =
      direct && isElementNode(direct)
        ? ({ ...direct, attributes: [...direct.attributes, ...missing] } as OoxmlElement)
        : ({ ...source, id: freshId(), attributes: missing, children: [] } as OoxmlElement);
    const nextPPr = direct
      ? ({
          ...pPr,
          children: pPr.children.map((child) => (child === direct ? spacing : child)),
        } as OoxmlElement)
      : (withContainer(paragraph, 'pPr', [spacing]).children.find((child) =>
          isWml(child, 'pPr')
        ) as OoxmlElement);
    return {
      ...paragraph,
      children: paragraph.children.map((child) => (child === pPr ? nextPPr : child)),
    } as OoxmlElement;
  };

  const rewriteParagraph = (paragraph: OoxmlElement): OoxmlElement => {
    const pPr = propertyContainerOf(paragraph, 'pPr');
    const pStyleNode = pPr?.children.find((child) => isWml(child, 'pStyle'));
    const pStyleId = pStyleNode ? attributeValueOf(pStyleNode, 'val') : undefined;

    const paraAdditions: OoxmlNode[] = [];
    let base = paragraph;
    for (const [localName, prop] of paraDiffers) {
      const explicit = pPr?.children.some(
        (child) => child.kind !== 'textValue' && child.localName === localName
      );
      const chained = !!pStyleId && chainDefines(fragmentStyles, pStyleId, 'pPr', localName);
      // `w:spacing` merges attribute by attribute, so a paragraph or style that states part of
      // it still takes the source default for the attributes it leaves out.
      if (localName === 'spacing' && (explicit || chained) && pPr !== null && isElementNode(prop))
        base = withMissingSpacing(base, pPr, prop, targetPara.get('spacing'), pStyleId);
      if (explicit || chained) continue;
      // NO skip for unstyled paragraphs: the source default paragraph style does not
      // travel with them (the target's own default resolves instead), so its values are
      // exactly what must stamp — the fold above already folded them into `paraDiffers`.
      paraAdditions.push(cloneProp(prop));
    }

    const stampRuns = (node: OoxmlNode): OoxmlNode => {
      if (node.kind === 'textValue') return node;
      if (node.kind === 'run') {
        const rPr = propertyContainerOf(node, 'rPr');
        const rStyleNode = rPr?.children.find((child) => isWml(child, 'rStyle'));
        const rStyleId = rStyleNode ? attributeValueOf(rStyleNode, 'val') : undefined;
        const additions: OoxmlNode[] = [];
        for (const [localName, prop] of runDiffers) {
          const explicit = rPr?.children.some(
            (child) => child.kind !== 'textValue' && child.localName === localName
          );
          if (explicit) continue;
          if (rStyleId && chainDefines(fragmentStyles, rStyleId, 'rPr', localName)) continue;
          if (pStyleId && chainDefines(fragmentStyles, pStyleId, 'rPr', localName)) continue;
          additions.push(cloneProp(prop));
        }
        return withContainer(node, 'rPr', additions);
      }
      if (node.kind === 'paragraphProperties' || node.kind === 'runProperties') return node;
      const children = node.children.map(stampRuns);
      return children.some((child, index) => child !== node.children[index])
        ? ({ ...node, children } as OoxmlNode)
        : node;
    };

    const stamped = stampRuns(withContainer(base, 'pPr', paraAdditions)) as OoxmlElement;
    return stamped;
  };

  const rewriteBlock = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'paragraph') return rewriteParagraph(node);
    const children = node.children.map(rewriteBlock);
    return children.some((child, index) => child !== node.children[index])
      ? ({ ...node, children } as OoxmlNode)
      : node;
  };
  return blocks.map(rewriteBlock);
}
