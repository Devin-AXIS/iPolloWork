// Host-neutral numbering writes. Each list edits its own instance override, never a shared template.
import { ensureListDefinition } from '../store/package/numbering-part.ts';
import { createNodeIdAllocator, replaceNode } from '../store/package/ooxml-edit.ts';
import { withPart, type OoxmlPackage } from '../store/package/ooxml-package.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI as W } from '../store/package/ooxml-shared.ts';
import { readTwipsMeasure } from '../store/units.ts';

export type AutomationListBullet =
  'Custom' | 'Solid' | 'Hollow' | 'Square' | 'Diamonds' | 'Arrow' | 'Checkmark';
export type AutomationListNumbering =
  'None' | 'Arabic' | 'UpperRoman' | 'LowerRoman' | 'UpperLetter' | 'LowerLetter';
export interface AutomationListLevelFormat {
  readonly bullet?: AutomationListBullet;
  readonly charCode?: number;
  readonly fontName?: string;
  readonly numbering?: AutomationListNumbering;
  readonly formatString?: readonly (string | number)[];
  readonly startingNumber?: number;
  readonly textIndent?: number;
  readonly bulletNumberPictureIndent?: number;
}
const child = (node: OoxmlElement, name: string): OoxmlElement | undefined =>
  (node.children as readonly OoxmlNode[]).find(
    (n): n is OoxmlElement => n.kind !== 'textValue' && n.namespaceUri === W && n.localName === name
  );
const attr = (node: OoxmlElement, name: string): string | undefined =>
  node.attributes.find((a) => a.namespaceUri === W && a.localName === name)?.value;
const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const validText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 255 &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]/.test(value);
const formats: Record<AutomationListNumbering, string> = {
  None: 'none',
  Arabic: 'decimal',
  UpperRoman: 'upperRoman',
  LowerRoman: 'lowerRoman',
  UpperLetter: 'upperLetter',
  LowerLetter: 'lowerLetter',
};
const bullets: Record<Exclude<AutomationListBullet, 'Custom'>, readonly [string, string]> = {
  Solid: ['\uF0B7', 'Symbol'],
  Hollow: ['o', 'Courier New'],
  Square: ['\uF0A7', 'Wingdings'],
  Diamonds: ['\uF076', 'Wingdings'],
  Arrow: ['\uF0D8', 'Wingdings'],
  Checkmark: ['\uF0FC', 'Wingdings'],
};

export function createAutomationList(
  pkg: OoxmlPackage
): { readonly pkg: OoxmlPackage; readonly numId: string } | null {
  const created = ensureListDefinition(pkg, 'bullet');
  if (!created) return null;
  let next = created.pkg;
  for (let level = 0; level <= 8; level += 1) {
    if (!automationListLevelExists(next, created.numId, level)) {
      const defined = formatAutomationListLevel(next, created.numId, level, {
        bullet: level % 3 === 0 ? 'Solid' : level % 3 === 1 ? 'Hollow' : 'Square',
      });
      if (!defined) return null;
      next = defined;
    }
  }
  return { pkg: next, numId: created.numId };
}

/** Whether this list instance or its template declares the requested nesting level. */
export function automationListLevelExists(
  pkg: OoxmlPackage,
  numId: string,
  level: number
): boolean {
  const root = pkg.parts.get('/word/numbering.xml')?.root;
  if (!root) return false;
  const nodes = root.children as readonly OoxmlNode[];
  const num = nodes.find(
    (n) =>
      n.kind !== 'textValue' &&
      n.namespaceUri === W &&
      n.localName === 'num' &&
      attr(n as OoxmlElement, 'numId') === numId
  ) as OoxmlElement | undefined;
  if (!num) return false;
  const override = (num.children as readonly OoxmlNode[]).find(
    (n) =>
      n.kind !== 'textValue' &&
      n.namespaceUri === W &&
      n.localName === 'lvlOverride' &&
      attr(n as OoxmlElement, 'ilvl') === String(level)
  ) as OoxmlElement | undefined;
  if (override && child(override, 'lvl')) return true;
  const abstractId = child(num, 'abstractNumId');
  const abstract =
    abstractId &&
    (nodes.find(
      (n) =>
        n.kind !== 'textValue' &&
        n.namespaceUri === W &&
        n.localName === 'abstractNum' &&
        attr(n as OoxmlElement, 'abstractNumId') === attr(abstractId, 'val')
    ) as OoxmlElement | undefined);
  return (
    !!abstract &&
    !child(abstract, 'numStyleLink') &&
    abstract.children.some(
      (n) =>
        n.kind !== 'textValue' &&
        n.namespaceUri === W &&
        n.localName === 'lvl' &&
        attr(n as OoxmlElement, 'ilvl') === String(level)
    )
  );
}

/** Validate untrusted protocol values before constructing any numbering nodes. */
export function validAutomationListFormat(
  level: number,
  format: AutomationListLevelFormat
): boolean {
  if (!Number.isInteger(level) || level < 0 || level > 8 || !format || typeof format !== 'object')
    return false;
  if (format.bullet !== undefined) {
    if (format.numbering !== undefined) return false;
    if (format.bullet === 'Custom') {
      if (
        !Number.isInteger(format.charCode) ||
        format.charCode! < 1 ||
        format.charCode! > 0xffff ||
        (format.charCode! >= 0xd800 && format.charCode! <= 0xdfff)
      )
        return false;
      if (!validText(String.fromCharCode(format.charCode!))) return false;
    } else if (!Object.hasOwn(bullets, format.bullet)) return false;
    if (format.fontName !== undefined && (!validText(format.fontName) || !format.fontName.trim()))
      return false;
  }
  if (format.numbering !== undefined && !Object.hasOwn(formats, format.numbering)) return false;
  if (
    format.formatString !== undefined &&
    (!Array.isArray(format.formatString) ||
      format.formatString.length > 32 ||
      format.formatString.some((v) =>
        typeof v === 'number'
          ? !Number.isInteger(v) || v < 0 || v > level
          : !validText(v) || /%[1-9]/.test(v)
      ))
  )
    return false;
  if (
    format.startingNumber !== undefined &&
    (!Number.isInteger(format.startingNumber) ||
      format.startingNumber < 0 ||
      format.startingNumber > 2147483647)
  )
    return false;
  for (const value of [format.textIndent, format.bulletNumberPictureIndent]) {
    if (value !== undefined && (!Number.isFinite(value) || Math.abs(value) > 1584)) return false;
  }
  const keys = [
    'bullet',
    'charCode',
    'fontName',
    'numbering',
    'formatString',
    'startingNumber',
    'textIndent',
    'bulletNumberPictureIndent',
  ];
  if (Object.keys(format).some((key) => !keys.includes(key))) return false;
  if (
    format.bullet === undefined &&
    (format.charCode !== undefined || format.fontName !== undefined)
  )
    return false;
  if (format.numbering === undefined && format.formatString !== undefined) return false;
  return Object.keys(format).length > 0;
}

/** Return an updated package for the transaction gate, or refuse unsupported numbering structures. */
export function formatAutomationListLevel(
  pkg: OoxmlPackage,
  numId: string,
  level: number,
  format: AutomationListLevelFormat
): OoxmlPackage | null {
  if (!validAutomationListFormat(level, format)) return null;
  const part = pkg.parts.get('/word/numbering.xml');
  if (!part) return null;
  const num = (part.root.children as readonly OoxmlNode[]).find(
    (n): n is OoxmlElement =>
      n.kind !== 'textValue' &&
      n.namespaceUri === W &&
      n.localName === 'num' &&
      attr(n as OoxmlElement, 'numId') === numId
  );
  const abstractId = num && child(num, 'abstractNumId');
  if (!num || !abstractId) return null;
  const abstract = (part.root.children as readonly OoxmlNode[]).find(
    (n): n is OoxmlElement =>
      n.kind !== 'textValue' &&
      n.namespaceUri === W &&
      n.localName === 'abstractNum' &&
      attr(n as OoxmlElement, 'abstractNumId') === attr(abstractId, 'val')
  );
  if (!abstract || child(abstract, 'numStyleLink')) return null;
  const override = (num.children as readonly OoxmlNode[]).find(
    (n): n is OoxmlElement =>
      n.kind !== 'textValue' &&
      n.namespaceUri === W &&
      n.localName === 'lvlOverride' &&
      attr(n as OoxmlElement, 'ilvl') === String(level)
  );
  let base =
    (override && child(override, 'lvl')) ??
    (abstract.children as readonly OoxmlNode[]).find(
      (n): n is OoxmlElement =>
        n.kind !== 'textValue' &&
        n.namespaceUri === W &&
        n.localName === 'lvl' &&
        attr(n as OoxmlElement, 'ilvl') === String(level)
    );
  if (base && child(base, 'lvlPicBulletId')) return null;
  const nextId = createNodeIdAllocator(part);
  const fresh = (n: OoxmlNode): OoxmlNode =>
    n.kind === 'textValue'
      ? { ...n, id: nextId() }
      : ({ ...n, id: nextId(), children: n.children.map(fresh) } as OoxmlNode);
  const element = (xml: string): OoxmlElement | null => {
    const parsed = readOoxmlPart(`<w:numbering xmlns:w="${W}">${xml}</w:numbering>`, {
      name: part.name,
      contentType: part.contentType,
    });
    const first = parsed.ok ? parsed.part.root.children[0] : undefined;
    return first && first.kind !== 'textValue' ? (fresh(first) as OoxmlElement) : null;
  };
  base ??=
    element(
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
    ) ?? undefined;
  if (!base) return null;
  let children = [...base.children];
  const sequence = [
    'start',
    'numFmt',
    'lvlRestart',
    'pStyle',
    'isLgl',
    'suff',
    'lvlText',
    'lvlPicBulletId',
    'legacy',
    'lvlJc',
    'pPr',
    'rPr',
  ];
  const put = (name: string, xml: string): boolean => {
    const node = element(xml);
    if (!node) return false;
    const index = children.findIndex(
      (n) => n.kind !== 'textValue' && n.namespaceUri === W && n.localName === name
    );
    if (index >= 0) {
      const previous = children[index] as OoxmlElement;
      children.splice(index, 1, {
        ...previous,
        attributes: [
          ...previous.attributes.filter(
            (attribute) =>
              !node.attributes.some(
                (authored) =>
                  authored.namespaceUri === attribute.namespaceUri &&
                  authored.localName === attribute.localName
              )
          ),
          ...node.attributes,
        ],
      } as OoxmlElement);
    } else {
      const at = children.findIndex(
        (n) =>
          n.kind !== 'textValue' &&
          n.namespaceUri === W &&
          sequence.indexOf(n.localName) > sequence.indexOf(name)
      );
      children.splice(at < 0 ? children.length : at, 0, node);
    }
    return true;
  };
  if (
    format.startingNumber !== undefined &&
    !put('start', `<w:start w:val="${format.startingNumber}"/>`)
  )
    return null;
  if (format.numbering !== undefined) {
    const text =
      format.formatString?.map((v) => (typeof v === 'number' ? `%${v + 1}` : v)).join('') ??
      (format.numbering === 'None' ? '' : `%${level + 1}.`);
    if (
      !put('numFmt', `<w:numFmt w:val="${formats[format.numbering]}"/>`) ||
      !put('lvlText', `<w:lvlText w:val="${escape(text)}"/>`)
    )
      return null;
  }
  if (format.numbering !== undefined) {
    // A Symbol/Wingdings bullet face must not turn decimal digits into symbol glyphs.
    children = children.map((node) =>
      node.kind !== 'textValue' && node.namespaceUri === W && node.localName === 'rPr'
        ? ({
            ...node,
            children: node.children.filter(
              (n) => n.kind === 'textValue' || n.namespaceUri !== W || n.localName !== 'rFonts'
            ),
          } as OoxmlElement)
        : node
    );
  }
  if (format.bullet !== undefined) {
    const [text, font] =
      format.bullet === 'Custom'
        ? [String.fromCharCode(format.charCode!), format.fontName ?? 'Symbol']
        : bullets[format.bullet];
    if (
      !put('numFmt', '<w:numFmt w:val="bullet"/>') ||
      !put('lvlText', `<w:lvlText w:val="${escape(text)}"/>`)
    )
      return null;
    const previous = child(base, 'rPr');
    const fonts = element(`<w:rFonts w:ascii="${escape(font)}" w:hAnsi="${escape(font)}"/>`);
    if (!fonts) return null;
    const rest =
      previous?.children.filter(
        (n) => n.kind === 'textValue' || n.namespaceUri !== W || n.localName !== 'rFonts'
      ) ?? [];
    const rPr = previous ? { ...previous, children: [fonts, ...rest] } : element('<w:rPr/>');
    if (!rPr) return null;
    const at = children.findIndex(
      (n) => n.kind !== 'textValue' && n.namespaceUri === W && n.localName === 'rPr'
    );
    if (at < 0) children.push({ ...rPr, children: [fonts, ...rest] } as OoxmlElement);
    else children[at] = { ...rPr, children: [fonts, ...rest] } as OoxmlElement;
  }
  if (format.textIndent !== undefined || format.bulletNumberPictureIndent !== undefined) {
    const previous = child(base, 'pPr');
    const oldIndent = previous && child(previous, 'ind');
    const attributes =
      oldIndent?.attributes.filter(
        (a) =>
          a.namespaceUri !== W || !['left', 'start', 'firstLine', 'hanging'].includes(a.localName)
      ) ?? [];
    // The authored value is re-read as whole twips, never copied into the markup below.
    const left =
      format.textIndent === undefined
        ? String(readTwipsMeasure(attr(oldIndent ?? base, 'left')) ?? 0)
        : String(Math.round(format.textIndent * 20));
    const relative = format.bulletNumberPictureIndent;
    const first =
      relative === undefined
        ? (oldIndent?.attributes.filter(
            (a) => a.namespaceUri === W && ['firstLine', 'hanging'].includes(a.localName)
          ) ?? [])
        : [];
    const indent = element(
      `<w:ind w:left="${left}"${relative === undefined ? '' : ` w:${relative < 0 ? 'hanging' : 'firstLine'}="${Math.abs(Math.round(relative * 20))}"`}/>`
    );
    if (!indent) return null;
    const updated = { ...indent, attributes: [...attributes, ...first, ...indent.attributes] };
    const rest =
      previous?.children.filter(
        (n) => n.kind === 'textValue' || n.namespaceUri !== W || n.localName !== 'ind'
      ) ?? [];
    const pPr = previous ?? element('<w:pPr/>');
    if (!pPr) return null;
    const oldAt = oldIndent ? (previous!.children as readonly OoxmlNode[]).indexOf(oldIndent) : -1;
    const inserted = [...rest];
    const following = [
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
    ];
    const nextAt = inserted.findIndex(
      (n) => n.kind !== 'textValue' && n.namespaceUri === W && following.includes(n.localName)
    );
    inserted.splice(
      oldAt >= 0 ? oldAt : nextAt >= 0 ? nextAt : inserted.length,
      0,
      updated as OoxmlNode
    );
    const replacement = { ...pPr, children: inserted } as OoxmlElement;
    const at = children.findIndex(
      (n) => n.kind !== 'textValue' && n.namespaceUri === W && n.localName === 'pPr'
    );
    if (at >= 0) children[at] = replacement;
    else {
      const before = children.findIndex(
        (n) => n.kind !== 'textValue' && n.localName === 'rPr' && n.namespaceUri === W
      );
      children.splice(before < 0 ? children.length : before, 0, replacement);
    }
  }
  const authoredLevel = fresh({ ...base, children } as OoxmlElement);
  const startOverride =
    override?.children.filter(
      (node) =>
        node.kind === 'textValue' ||
        node.namespaceUri !== W ||
        (node.localName !== 'lvl' &&
          (format.startingNumber === undefined || node.localName !== 'startOverride'))
    ) ?? [];
  // Every `w:num` over one template counts on one shared counter, and a `w:lvl` override alone
  // does not restart it. So the starting number is a `w:startOverride`, and the level's own
  // `w:start` agrees with it. CT_NumLvl puts `w:startOverride` before `w:lvl`.
  const restart =
    format.startingNumber === undefined
      ? null
      : element(`<w:startOverride w:val="${format.startingNumber}"/>`);
  if (format.startingNumber !== undefined && !restart) return null;
  const shell = override ?? element(`<w:lvlOverride w:ilvl="${level}"/>`);
  if (!shell) return null;
  const updatedOverride = {
    ...shell,
    children: [...(restart ? [restart] : []), ...startOverride, authoredLevel],
  } as OoxmlElement;
  const numChildren = [...num.children];
  const at = override ? numChildren.indexOf(override) : -1;
  if (at >= 0) numChildren[at] = updatedOverride;
  else numChildren.push(updatedOverride);
  const result = replaceNode(part, num.id, { ...num, children: numChildren } as OoxmlElement);
  return result.ok ? withPart(pkg, result.part) : null;
}
