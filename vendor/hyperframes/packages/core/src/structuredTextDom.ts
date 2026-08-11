import type {
  CompiledStructuredTextMotion,
  StructuredTextLayer,
  StructuredTextRole,
} from "./structuredTextMotion.js";

const STRUCTURE_ATTRIBUTE = "data-ipw-motion-structure";
const SOURCE_ATTRIBUTE = "data-ipw-motion-source";
const ROLE_ATTRIBUTE = "data-ipw-motion-role";

export interface StructuredTextSnapshot {
  attributes: Array<{ name: string; value: string }>;
  childNodes: Node[];
}

type ContentPiece =
  | { kind: "text"; value: string }
  | { kind: "unit"; value: string };

function encodeSourceText(sourceText: string): string {
  return JSON.stringify(sourceText);
}

function readSourceText(target: Element): string | undefined {
  const encoded = target.getAttribute(SOURCE_ATTRIBUTE);
  if (encoded === null) return undefined;
  try {
    const source = JSON.parse(encoded);
    return typeof source === "string" ? source : undefined;
  } catch {
    return undefined;
  }
}

function addText(pieces: ContentPiece[], value: string): void {
  if (!value) return;
  const previous = pieces.at(-1);
  if (previous?.kind === "text") {
    previous.value += value;
    return;
  }
  pieces.push({ kind: "text", value });
}

function addUnit(pieces: ContentPiece[], value: string): void {
  if (value) pieces.push({ kind: "unit", value });
}

function splitInterveningText(pieces: ContentPiece[], value: string, prefix: { value: string }): void {
  for (const part of value.split(/(\s+)/u)) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) {
      addText(pieces, part);
      continue;
    }
    const previous = pieces.at(-1);
    if (previous?.kind === "unit") {
      previous.value += part;
    } else {
      prefix.value += part;
    }
  }
}

function buildWordPieces(sourceText: string, compiled: CompiledStructuredTextMotion): ContentPiece[] {
  const pieces: ContentPiece[] = [];
  const prefix = { value: "" };
  let cursor = 0;

  for (const unit of compiled.units) {
    const index = sourceText.indexOf(unit.sourceText, cursor);
    if (index < 0) return [{ kind: "unit", value: sourceText }];
    splitInterveningText(pieces, sourceText.slice(cursor, index), prefix);
    addUnit(pieces, prefix.value + unit.sourceText);
    prefix.value = "";
    cursor = index + unit.sourceText.length;
  }

  splitInterveningText(pieces, sourceText.slice(cursor), prefix);
  if (prefix.value) addText(pieces, prefix.value);
  return pieces;
}

function buildCharacterPieces(sourceText: string, compiled: CompiledStructuredTextMotion): ContentPiece[] {
  const pieces: ContentPiece[] = [];
  let cursor = 0;
  for (const unit of compiled.units) {
    const index = sourceText.indexOf(unit.sourceText, cursor);
    if (index < 0) return [{ kind: "unit", value: sourceText }];
    addText(pieces, sourceText.slice(cursor, index));
    if (/^\s+$/u.test(unit.sourceText)) {
      addText(pieces, unit.sourceText);
    } else {
      addUnit(pieces, unit.sourceText);
    }
    cursor = index + unit.sourceText.length;
  }
  addText(pieces, sourceText.slice(cursor));
  return pieces;
}

function buildContentPieces(sourceText: string, compiled: CompiledStructuredTextMotion): ContentPiece[] {
  if (compiled.split === "whole") return sourceText ? [{ kind: "unit", value: sourceText }] : [];
  return compiled.split === "word"
    ? buildWordPieces(sourceText, compiled)
    : buildCharacterPieces(sourceText, compiled);
}

function createLayer(document: Document, layer: StructuredTextLayer): HTMLElement {
  const element = document.createElement("span");
  element.className = layer.className;
  element.setAttribute(ROLE_ATTRIBUTE, layer.role);
  return element;
}

function applyUnitStyles(unit: HTMLElement): void {
  unit.style.display = "inline-block";
  unit.style.position = "relative";
  unit.style.isolation = "isolate";
}

function applyLayerStyles(layer: HTMLElement, role: StructuredTextRole): void {
  if (role === "background") {
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.zIndex = "0";
    layer.style.pointerEvents = "none";
    layer.style.transformOrigin = "left center";
  } else if (role === "text") {
    layer.style.position = "relative";
    layer.style.zIndex = "1";
  }
}

function createUnit(
  document: Document,
  value: string,
  layers: StructuredTextLayer[],
): HTMLElement {
  const unitLayer = layers.find((layer) => layer.role === "unit");
  const unit = createLayer(document, unitLayer ?? {
    role: "unit",
    perUnit: true,
    className: "ipw-motion-unit",
  });
  unit.setAttribute("data-ipw-motion-word", "");
  applyUnitStyles(unit);

  let hasTextLayer = false;
  for (const layer of layers) {
    if (!layer.perUnit || layer.role === "unit") continue;
    const child = createLayer(document, layer);
    applyLayerStyles(child, layer.role);
    if (layer.role === "text" && !hasTextLayer) {
      child.textContent = value;
      hasTextLayer = true;
    } else {
      child.setAttribute("aria-hidden", "true");
    }
    unit.append(child);
  }

  if (!hasTextLayer) {
    const text = createLayer(document, {
      role: "text",
      perUnit: true,
      className: "ipw-motion-text",
    });
    text.textContent = value;
    applyLayerStyles(text, "text");
    unit.append(text);
  }
  return unit;
}

function appendGlobalDecorativeLayers(
  target: Element,
  layers: StructuredTextLayer[],
): void {
  const document = target.ownerDocument;
  if (!document) return;
  for (const layer of layers) {
    if (layer.perUnit || layer.role === "unit" || layer.role === "text") continue;
    const decorative = createLayer(document, layer);
    decorative.setAttribute("aria-hidden", "true");
    applyLayerStyles(decorative, layer.role);
    target.append(decorative);
  }
}

export function snapshotStructuredText(target: Element): StructuredTextSnapshot {
  return {
    attributes: Array.from(target.attributes, ({ name, value }) => ({ name, value })),
    childNodes: Array.from(target.childNodes),
  };
}

export function restoreStructuredText(target: Element, snapshot: StructuredTextSnapshot): void {
  for (const attribute of Array.from(target.attributes)) target.removeAttribute(attribute.name);
  for (const attribute of snapshot.attributes) target.setAttribute(attribute.name, attribute.value);
  target.replaceChildren(...snapshot.childNodes);
}

export function unwrapStructuredText(target: Element): void {
  const sourceText = readSourceText(target) ?? target.textContent ?? "";
  const document = target.ownerDocument;
  if (!document) return;
  target.replaceChildren(document.createTextNode(sourceText));
  target.removeAttribute(STRUCTURE_ATTRIBUTE);
  target.removeAttribute(SOURCE_ATTRIBUTE);
}

export function materializeStructuredText(
  target: Element,
  compiled: CompiledStructuredTextMotion,
  sourceText?: string,
): void {
  const document = target.ownerDocument;
  if (!document) return;
  const source = sourceText ?? readSourceText(target) ?? target.textContent ?? "";
  if (target.hasAttribute(STRUCTURE_ATTRIBUTE) || target.hasAttribute(SOURCE_ATTRIBUTE)) {
    unwrapStructuredText(target);
  }

  const fragment = document.createDocumentFragment();
  for (const piece of buildContentPieces(source, compiled)) {
    fragment.append(piece.kind === "text"
      ? document.createTextNode(piece.value)
      : createUnit(document, piece.value, compiled.layers));
  }
  target.replaceChildren(fragment);
  appendGlobalDecorativeLayers(target, compiled.layers);
  target.setAttribute(STRUCTURE_ATTRIBUTE, "v1");
  target.setAttribute(SOURCE_ATTRIBUTE, encodeSourceText(source));
}
