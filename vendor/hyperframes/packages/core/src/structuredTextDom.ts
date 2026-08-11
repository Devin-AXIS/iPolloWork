import type {
  CompiledStructuredTextMotion,
  StructuredTextLayer,
  StructuredTextRole,
} from "./structuredTextMotion.js";

const STRUCTURE_ATTRIBUTE = "data-ipw-motion-structure";
const SOURCE_ATTRIBUTE = "data-ipw-motion-source";
const ROLE_ATTRIBUTE = "data-ipw-motion-role";
const STRUCTURED_TEXT_STYLE_ID = "ipw-structured-text-motion-styles";
const STRUCTURED_TEXT_STYLES = `
[data-ipw-motion-role="clone-primary"]::before,
[data-ipw-motion-role="clone-accent"]::before {
  content: attr(data-ipw-motion-clone-text);
}
`;

export interface StructuredTextSnapshot {
  attributes: Array<{ name: string; value: string }>;
  childNodes: Node[];
}

type ContentPiece =
  | { kind: "text"; value: string }
  | { kind: "unit"; value: string; unitIndex: number };

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

function addUnit(pieces: ContentPiece[], value: string, unitIndex: number): void {
  if (value) pieces.push({ kind: "unit", value, unitIndex });
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
    if (index < 0) return [{ kind: "unit", value: sourceText, unitIndex: 0 }];
    splitInterveningText(pieces, sourceText.slice(cursor, index), prefix);
    addUnit(pieces, prefix.value + unit.sourceText, unit.index);
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
    if (index < 0) return [{ kind: "unit", value: sourceText, unitIndex: 0 }];
    addText(pieces, sourceText.slice(cursor, index));
    if (/^\s+$/u.test(unit.sourceText)) {
      addText(pieces, unit.sourceText);
    } else {
      addUnit(pieces, unit.sourceText, unit.index);
    }
    cursor = index + unit.sourceText.length;
  }
  addText(pieces, sourceText.slice(cursor));
  return pieces;
}

function buildContentPieces(sourceText: string, compiled: CompiledStructuredTextMotion): ContentPiece[] {
  if (compiled.split === "whole") {
    return sourceText
      ? [{ kind: "unit", value: sourceText, unitIndex: compiled.units[0]?.index ?? 0 }]
      : [];
  }
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

function ensureStructuredTextStyles(document: Document): void {
  if (document.getElementById(STRUCTURED_TEXT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STRUCTURED_TEXT_STYLE_ID;
  style.textContent = STRUCTURED_TEXT_STYLES;
  document.head?.append(style);
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
  } else if (role === "clone-primary" || role === "clone-accent") {
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
    layer.style.userSelect = "none";
  } else if (role === "particle-container") {
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
  }
}

function createUnit(
  document: Document,
  value: string,
  layers: StructuredTextLayer[],
  split: CompiledStructuredTextMotion["split"],
  recipeId: string,
): HTMLElement {
  const unitLayer = layers.find((layer) => layer.role === "unit");
  const unit = createLayer(document, unitLayer ?? {
    role: "unit",
    perUnit: true,
    className: "ipw-motion-unit",
  });
  if (split === "word") unit.setAttribute("data-ipw-motion-word", "");
  if (split === "character") unit.setAttribute("data-ipw-motion-char", "");
  applyUnitStyles(unit);
  if (recipeId === "caption-highlight.word-sweep") {
    unit.style.padding = "0.075em 0.15em 0.1em";
    unit.style.lineHeight = "1";
  }

  let hasTextLayer = false;
  for (const layer of layers) {
    if (!layer.perUnit || layer.role === "unit" || layer.role === "particle") continue;
    const child = createLayer(document, layer);
    applyLayerStyles(child, layer.role);
    if (layer.role === "text" && !hasTextLayer) {
      child.textContent = value;
      hasTextLayer = true;
    } else if (layer.role === "clone-primary" || layer.role === "clone-accent") {
      child.dataset.ipwMotionCloneText = value;
      child.setAttribute("aria-hidden", "true");
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

function appendParticles(
  compiled: CompiledStructuredTextMotion,
  unitByIndex: Map<number, HTMLElement>,
): void {
  if (!compiled.particles) return;
  const particleLayer = compiled.layers.find((layer) => layer.role === "particle");
  for (const particle of compiled.particles) {
    if (
      !Number.isInteger(particle.unitIndex) ||
      !Number.isFinite(particle.x) ||
      !Number.isFinite(particle.y) ||
      !Number.isFinite(particle.size) ||
      !Number.isFinite(particle.delay)
    ) continue;
    const unit = unitByIndex.get(particle.unitIndex);
    if (!unit) continue;
    const container = Array.from(unit.children).find(
      (child) => child.getAttribute(ROLE_ATTRIBUTE) === "particle-container",
    ) as HTMLElement | undefined ?? unit;
    const element = createLayer(unit.ownerDocument, particleLayer ?? {
      role: "particle",
      perUnit: true,
      className: "ipw-motion-particle",
    });
    const size = Math.max(0, particle.size);
    const delay = Math.max(0, particle.delay);
    element.setAttribute("aria-hidden", "true");
    element.dataset.ipwMotionParticleX = String(particle.x);
    element.dataset.ipwMotionParticleY = String(particle.y);
    element.dataset.ipwMotionParticleSize = String(size);
    element.dataset.ipwMotionParticleDelay = String(delay);
    element.style.position = "absolute";
    element.style.pointerEvents = "none";
    element.style.left = "50%";
    element.style.top = "50%";
    element.style.setProperty("--ipw-motion-particle-x", `${particle.x}px`);
    element.style.setProperty("--ipw-motion-particle-y", `${particle.y}px`);
    element.style.setProperty("--ipw-motion-particle-size", `${size}px`);
    element.style.setProperty("--ipw-motion-particle-delay", `${delay}s`);
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.animationDelay = `${delay}s`;
    container.append(element);
  }
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
  const source = readSourceText(target) ?? sourceText ?? target.textContent ?? "";
  if (target.hasAttribute(STRUCTURE_ATTRIBUTE) || target.hasAttribute(SOURCE_ATTRIBUTE)) {
    unwrapStructuredText(target);
  }
  if (compiled.layers.some(
    (layer) => layer.role === "clone-primary" || layer.role === "clone-accent",
  )) ensureStructuredTextStyles(document);

  const fragment = document.createDocumentFragment();
  const unitByIndex = new Map<number, HTMLElement>();
  for (const piece of buildContentPieces(source, compiled)) {
    if (piece.kind === "text") {
      fragment.append(document.createTextNode(piece.value));
    } else {
      const unit = createUnit(document, piece.value, compiled.layers, compiled.split, compiled.recipeId);
      unitByIndex.set(piece.unitIndex, unit);
      fragment.append(unit);
    }
  }
  target.replaceChildren(fragment);
  appendParticles(compiled, unitByIndex);
  appendGlobalDecorativeLayers(target, compiled.layers);
  target.setAttribute(STRUCTURE_ATTRIBUTE, "v1");
  target.setAttribute(SOURCE_ATTRIBUTE, encodeSourceText(source));
}
