function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeCssNumber(value: string, scale: number) {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 * scale : 0;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number * scale : 0;
}

function includesUnsupportedColorFunction(value: string | null | undefined) {
  return /color\(\s*(?:display-p3|srgb)\b/i.test(value ?? "");
}

function documentForRoot(root: ParentNode) {
  // `root` normally belongs to the export iframe (and html2canvas creates yet
  // another iframe). Cross-realm DOM objects fail the host window's
  // `instanceof Document`, `HTMLElement` and `SVGElement` checks.
  return root.nodeType === 9 ? root as Document : root.ownerDocument;
}

function isElementNode(node: Node): node is HTMLElement | SVGElement {
  return node.nodeType === 1;
}

export function colorDisplayP3ToSrgb(value: string) {
  return value.replace(/color\(\s*(?:display-p3|srgb)\s+([^)]+)\)/gi, (_match, rawBody: string) => {
    const [rawChannels = "", rawAlpha = "1"] = rawBody.split("/");
    const channels = rawChannels.trim().split(/\s+/).filter(Boolean);
    if (channels.length < 3) return "rgb(0, 0, 0)";

    const red = clampColorChannel(normalizeCssNumber(channels[0], 255));
    const green = clampColorChannel(normalizeCssNumber(channels[1], 255));
    const blue = clampColorChannel(normalizeCssNumber(channels[2], 255));
    const alpha = Math.max(0, Math.min(1, normalizeCssNumber(rawAlpha, 1)));

    return alpha >= 1 ? `rgb(${red}, ${green}, ${blue})` : `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(4))})`;
  });
}

/**
 * Sanitize the HTML/CSS before it is parsed by the export iframe. Doing this
 * at the source boundary is important: html2canvas clones every stylesheet
 * before `onclone` runs, and Chromium can otherwise preserve `color(...)` in
 * computed styles (including shadows, gradients and pseudo-elements).
 */
export function downgradeUnsupportedPdfExportColorText(value: string) {
  return colorDisplayP3ToSrgb(value);
}

function inlineComputedCompatibleColors(root: ParentNode) {
  const document = documentForRoot(root);
  const window = document?.defaultView;
  if (!window) return;

  const rootElements = isElementNode(root) ? [root] : [];
  const elements = [...rootElements, ...Array.from(root.querySelectorAll<HTMLElement | SVGElement>("*"))];
  for (const element of elements) {
    const computed = window.getComputedStyle(element);
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      const value = computed.getPropertyValue(property);
      if (includesUnsupportedColorFunction(value)) {
        element.style.setProperty(property, colorDisplayP3ToSrgb(value), computed.getPropertyPriority(property));
      }
    }
  }
}

function installCompatibleStylesheetCopies(document: Document) {
  const stylesheets = Array.from(document.styleSheets);
  for (const sheet of stylesheets) {
    let cssText = "";
    try {
      cssText = Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
    } catch {
      continue;
    }
    if (!includesUnsupportedColorFunction(cssText)) continue;

    const compatible = colorDisplayP3ToSrgb(cssText);
    const style = document.createElement("style");
    style.dataset.ipwPdfCompatibleColors = "";
    style.textContent = compatible;
    document.head.append(style);

    const ownerNode = sheet.ownerNode;
    if (ownerNode && (ownerNode.nodeName === "STYLE" || ownerNode.nodeName === "LINK")) {
      (ownerNode as HTMLStyleElement | HTMLLinkElement).disabled = true;
    }
  }
}

export function downgradeUnsupportedPdfExportColors(root: ParentNode) {
  const document = documentForRoot(root);
  if (document) installCompatibleStylesheetCopies(document);

  root.querySelectorAll<HTMLStyleElement>("style").forEach((style) => {
    if (includesUnsupportedColorFunction(style.textContent)) {
      style.textContent = colorDisplayP3ToSrgb(style.textContent);
    }
  });

  root.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    if (includesUnsupportedColorFunction(element.getAttribute("style"))) {
      element.setAttribute("style", colorDisplayP3ToSrgb(element.getAttribute("style") ?? ""));
    }
  });

  inlineComputedCompatibleColors(root);
}
