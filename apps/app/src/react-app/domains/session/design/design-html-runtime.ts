export const DESIGN_MESSAGE_CHANNEL = "ipollowork-design-html-v1";

export const DESIGN_STYLE_FIELDS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "borderRadius",
  "padding",
  "margin",
  "position",
  "left",
  "top",
  "width",
  "height",
  "opacity",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "boxShadow",
] as const;

export type DesignStyleField = (typeof DESIGN_STYLE_FIELDS)[number];
export type DesignField = "text" | "href" | "src" | "alt" | DesignStyleField;

export type DesignSelection = {
  id: string;
  tag: string;
  text: string;
  href: string;
  src: string;
  alt: string;
  canEditText: boolean;
  colorField: "color" | "backgroundColor";
  rangeText: string;
  rect: { top: number; left: number; width: number; height: number };
  styles: Record<DesignStyleField, string>;
};

export type DesignDeckState = {
  index: number;
  total: number;
  title: string;
};

export type DesignRuntimeMessage =
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "selected"; selection: DesignSelection }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "editing"; selection: DesignSelection }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "draft"; html: string; selection: DesignSelection }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "document-draft"; html: string }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "snapshot"; requestId: string; html: string }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "navigate"; href: string }
  | { channel: typeof DESIGN_MESSAGE_CHANNEL; type: "deck"; deck: DesignDeckState };

export function isLocalHtmlPath(path: string) {
  return /\.html?$/i.test(path.trim());
}

export function resolveDesignNavigationPath(currentPath: string, rootPath: string, href: string) {
  const value = href.trim();
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return null;
  const [rawPath, rawHash = ""] = value.split("#", 2);
  const pathname = rawPath.split("?", 1)[0] ?? "";
  const rootDirectory = rootPath.replace(/[^/]+$/, "").replace(/\/$/, "");
  const currentDirectory = currentPath.replace(/[^/]+$/, "").replace(/\/$/, "");
  const requested = pathname.startsWith("/") ? `${rootDirectory}/${pathname.replace(/^\/+/, "")}` : `${currentDirectory}/${pathname}`;
  const segments: string[] = [];
  for (const segment of requested.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  let path = segments.join("/");
  if (pathname === "/") path = rootPath;
  else if (pathname.endsWith("/")) path = `${path}/index.html`;
  else if (!/\.html?$/i.test(path)) path = `${path}.html`;
  if (path !== rootPath && !path.startsWith(`${rootDirectory}/`)) return null;
  let hash = rawHash;
  try { hash = rawHash ? decodeURIComponent(rawHash) : ""; } catch { hash = rawHash; }
  return { path, hash };
}

export function buildDesignPreviewDocument(
  source: string,
  includeEditor: boolean,
  templateTokenCss = "",
  editing = includeEditor,
  fixedSlideStage = false,
  isPresentationTemplate = fixedSlideStage,
) {
  const tokenStyle = templateTokenCss.trim()
    ? `<style id="ipollowork-design-template-token-style">${templateTokenCss.replace(/<\/style/gi, "<\\/style")}</style>`
    : "";
  const navigationRuntime = `<script id="ipollowork-design-navigation-runtime">(${designNavigationRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${editing ? "true" : "false"});<\/script>`;
  const deckRuntime = isPresentationTemplate && (includeEditor || fixedSlideStage)
    ? `<script id="ipollowork-design-deck-runtime">(${designDeckRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${fixedSlideStage ? "true" : "false"});<\/script>`
    : "";
  const fixedSlideRuntime = fixedSlideStage
    ? `<script id="ipollowork-design-fixed-slide-runtime">(${designFixedSlideRuntime.toString()})();<\/script>`
    : "";
  const editingRuntime = includeEditor
    ? `<script id="ipollowork-design-runtime">(${designRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${JSON.stringify(DESIGN_STYLE_FIELDS)},${editing ? "true" : "false"},${fixedSlideStage ? "true" : "false"});<\/script>`
    : "";
  const runtime = `${tokenStyle}${navigationRuntime}${deckRuntime}${fixedSlideRuntime}${editingRuntime}`;
  const bodyEnd = source.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd >= 0) {
    return `${source.slice(0, bodyEnd)}${runtime}${source.slice(bodyEnd)}`;
  }
  return `${source}${runtime}`;
}

function designFixedSlideRuntime() {
  const stage = document.querySelector<HTMLElement>("[data-ipw-template-kind='slides'],.deck");
  if (!stage) return;

  const stageWidth = 1600;
  const stageHeight = 900;
  const style = document.createElement("style");
  style.id = "ipollowork-design-fixed-slide-runtime-style";
  document.head.appendChild(style);

  // PPTX-compatible templates keep a single slide canvas. Remove only viewport
  // media queries so a narrow preview scales the same page instead of reflowing it.
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
        const rule = sheet.cssRules[index];
        if (rule instanceof CSSMediaRule && /(?:max-width|max-height|orientation)/i.test(rule.conditionText)) {
          sheet.deleteRule(index);
        }
      }
    } catch {
      // Cross-origin style sheets are not readable, but compatible templates use local styles.
    }
  }

  const applyScale = () => {
    const scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    style.textContent = `
      html, body { width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; overflow: hidden !important; }
      body { display: grid !important; place-items: center !important; }
      [data-ipw-template-kind='slides'], .deck {
        width: 1600px !important;
        min-width: 1600px !important;
        max-width: none !important;
        height: 900px !important;
        min-height: 900px !important;
        max-height: none !important;
        aspect-ratio: 16 / 9 !important;
        flex: none !important;
        zoom: ${scale} !important;
        transform: none !important;
        transform-origin: initial !important;
      }
      .slide-counter, .controls, .deck-chrome, .deck-controls, .dots, .counter,
      [data-ipw-deck-control], [data-ipw-prev], [data-ipw-next], [data-action='prev'], [data-action='previous'], [data-action='next'] {
        display: none !important;
      }
    `;
  };

  window.requestAnimationFrame(applyScale);
  window.addEventListener("resize", () => window.requestAnimationFrame(applyScale));
}

function designNavigationRuntime(channel: string, editing: boolean) {
  let editingEnabled = editing;
  document.addEventListener("click", (event) => {
    if (editingEnabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const control = target.closest<HTMLElement>("button,[role='button']");
    const inlineAction = control?.getAttribute("onclick") || "";
    const inlineHref = inlineAction.match(/(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1]
      || inlineAction.match(/window\.open\(\s*['\"]([^'\"]+)['\"]/i)?.[1]
      || "";
    const label = control?.textContent?.trim().toLowerCase() || "";
    const conventionalHref = /^(?:login|sign\s*in|log\s*in|登录|登入)$/.test(label) ? "login.html" : "";
    const href = anchor?.getAttribute("href")?.trim()
      || control?.getAttribute("data-href")?.trim()
      || control?.getAttribute("data-url")?.trim()
      || control?.getAttribute("formaction")?.trim()
      || inlineHref
      || conventionalHref;
    if (!href || /^(?:mailto:|tel:|javascript:)/i.test(href)) return;
    const mobileHeader = (anchor || control)?.closest<HTMLElement>("header[data-menu-open]");
    if (mobileHeader) {
      mobileHeader.dataset.menuOpen = "false";
      const mobileToggle = mobileHeader.querySelector<HTMLElement>(".mobile-nav-toggle");
      mobileToggle?.setAttribute("aria-expanded", "false");
      if (mobileToggle) mobileToggle.setAttribute("aria-label", mobileToggle.getAttribute("aria-label")?.includes("关闭") ? "打开导航" : "Open navigation");
    }
    event.stopPropagation();
    if (href.startsWith("#")) {
      event.preventDefault();
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch {}
      if (!id) window.scrollTo({ top: 0, behavior: "smooth" });
      else document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    event.preventDefault();
    window.parent.postMessage({ channel, type: "navigate", href }, "*");
  }, true);
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel) return;
    if (data.type === "set-editing" && typeof data.editing === "boolean") {
      editingEnabled = data.editing;
      return;
    }
    if (data.type !== "scroll-to" || typeof data.hash !== "string") return;
    if (!data.hash) window.scrollTo({ top: 0 });
    else document.getElementById(data.hash)?.scrollIntoView({ block: "start" });
  });
}

function designDeckRuntime(channel: string, runtimeOwnsNavigation = false) {
  const slideSelector = "[data-ipw-slide],section.slide,.slide,.slide-frame";
  const slides = Array.from(document.querySelectorAll<HTMLElement>(slideSelector))
    .filter((element, index, list) => list.indexOf(element) === index);
  if (!slides.length) return;

  const addedSlideAttribute = "data-ipollowork-deck-added-slide";
  const originalAriaHiddenAttribute = "data-ipollowork-deck-original-aria-hidden";
  const hadAriaHiddenAttribute = "data-ipollowork-deck-had-aria-hidden";
  const originalClassAttribute = "data-ipollowork-deck-original-class";
  const hadClassAttribute = "data-ipollowork-deck-had-class";
  const originalWrapperClassAttribute = "data-ipollowork-deck-original-wrapper-class";
  const hadWrapperClassAttribute = "data-ipollowork-deck-had-wrapper-class";
  const rememberAttribute = (element: HTMLElement, attribute: string, originalAttribute: string, hadAttribute: string) => {
    if (element.hasAttribute(hadAttribute)) return;
    element.setAttribute(hadAttribute, String(element.hasAttribute(attribute)));
    element.setAttribute(originalAttribute, element.getAttribute(attribute) || "");
  };
  slides.forEach((slide, index) => {
    rememberAttribute(slide, "aria-hidden", originalAriaHiddenAttribute, hadAriaHiddenAttribute);
    rememberAttribute(slide, "class", originalClassAttribute, hadClassAttribute);
    if (!slide.hasAttribute("data-ipw-slide")) {
      slide.setAttribute("data-ipw-slide", String(index + 1));
      slide.setAttribute(addedSlideAttribute, "true");
    }
  });
  const slideWrappers = slides.map((slide) => slide.closest<HTMLElement>(".slide-wrap"));
  const usesSlideWrappers = slideWrappers.every(Boolean);
  slideWrappers.forEach((wrapper) => {
    if (wrapper) rememberAttribute(wrapper, "class", originalWrapperClassAttribute, hadWrapperClassAttribute);
  });

  // Some templates include a static, vertically stacked preview fallback.
  // The deck runtime owns aria-hidden so only the active page is laid out.
  const visibilityStyle = document.createElement("style");
  visibilityStyle.id = "ipollowork-design-deck-runtime-style";
  visibilityStyle.textContent = `
    [data-ipw-slide][aria-hidden="true"] { display: none !important; opacity: 0 !important; pointer-events: none !important; }
    [data-ipw-slide][aria-hidden="false"] { opacity: 1 !important; pointer-events: auto !important; }
  `;
  document.head.appendChild(visibilityStyle);

  const deckControl = (direction: "previous" | "next") => {
    const aliases = direction === "previous"
      ? ["[data-ipw-deck-control='previous']", "[data-action='prev']", "[data-action='previous']", "[aria-label*='Previous' i]", "[aria-label*='上一页']"]
      : ["[data-ipw-deck-control='next']", "[data-action='next']", "[aria-label*='Next' i]", "[aria-label*='下一页']"];
    return document.querySelector<HTMLElement>(aliases.join(","));
  };

  const activeIndex = () => {
    if (usesSlideWrappers) {
      const wrapperIndex = slideWrappers.findIndex((wrapper) => wrapper && !wrapper.classList.contains("hidden"));
      if (wrapperIndex >= 0) return wrapperIndex;
    }
    const active = slides.findIndex((slide) => slide.classList.contains("is-active") || slide.classList.contains("active"));
    if (active >= 0) return active;
    const visible = slides.findIndex((slide) => slide.getAttribute("aria-hidden") === "false");
    if (visible >= 0) return visible;
    const hash = window.location.hash.slice(1);
    const hashIndex = Number.parseInt(hash, 10);
    if (String(hashIndex) === hash && hashIndex >= 1 && hashIndex <= slides.length) return hashIndex - 1;
    const scroller = document.body.scrollWidth > document.body.clientWidth + 1 || document.body.scrollHeight > document.body.clientHeight + 1
      ? document.body
      : document.scrollingElement || document.documentElement;
    if (scroller.scrollWidth > scroller.clientWidth + 1) {
      return slides.reduce((best, slide, index) => (
        Math.abs(slide.getBoundingClientRect().left) < Math.abs(slides[best].getBoundingClientRect().left) ? index : best
      ), 0);
    }
    if (scroller.scrollHeight > scroller.clientHeight + 1) {
      return slides.reduce((best, slide, index) => (
        Math.abs(slide.getBoundingClientRect().top) < Math.abs(slides[best].getBoundingClientRect().top) ? index : best
      ), 0);
    }
    return 0;
  };

  const setSlideVisibility = (index: number) => {
    const visibleIndex = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, slideIndex) => {
      const hidden = String(slideIndex !== visibleIndex);
      if (slide.getAttribute("aria-hidden") !== hidden) slide.setAttribute("aria-hidden", hidden);
      if (usesSlideWrappers) slideWrappers[slideIndex]?.classList.toggle("hidden", slideIndex !== visibleIndex);
    });
  };

  let lastState = "";
  const report = () => {
    const index = activeIndex();
    const title = slides[index]?.getAttribute("data-title") || slides[index]?.querySelector("h1,h2,h3")?.textContent?.trim() || "";
    const key = `${index}:${title}`;
    if (key === lastState) return;
    lastState = key;
    window.parent.postMessage({ channel, type: "deck", deck: { index, total: slides.length, title } }, "*");
  };

  const showFallback = (index: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, index));
    const hasIsActive = slides.some((slide) => slide.classList.contains("is-active"));
    const hasActive = !hasIsActive && slides.some((slide) => slide.classList.contains("active"));
    if (usesSlideWrappers) {
      setSlideVisibility(next);
    } else if (hasIsActive || hasActive) {
      const className = hasIsActive ? "is-active" : "active";
      slides.forEach((slide, slideIndex) => {
        slide.classList.toggle(className, slideIndex === next);
      });
      setSlideVisibility(next);
    } else {
      slides[next]?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
      setSlideVisibility(next);
    }
    window.setTimeout(report, 0);
  };

  const navigate = (direction: "previous" | "next" | "index", requestedIndex?: number) => {
    if (direction === "previous" || direction === "next") {
      const control = runtimeOwnsNavigation ? null : deckControl(direction);
      if (control) {
        control.click();
        window.setTimeout(() => {
          setSlideVisibility(activeIndex());
          report();
        }, 0);
        return;
      }
      showFallback(activeIndex() + (direction === "next" ? 1 : -1));
      return;
    }
    if (typeof requestedIndex === "number") showFallback(requestedIndex);
  };

  const isEditableTarget = (target: EventTarget | null) => target instanceof Element
    && Boolean(target.closest("input,textarea,select,[contenteditable]"));
  const keyboardDirection = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") return "next";
    if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") return "previous";
    return null;
  };

  setSlideVisibility(activeIndex());

  document.addEventListener("click", () => window.setTimeout(() => {
    setSlideVisibility(activeIndex());
    report();
  }, 0), true);
  document.addEventListener("keydown", (event) => {
    const direction = !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && !isEditableTarget(event.target)
      ? keyboardDirection(event)
      : null;
    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate(direction);
      return;
    }
    window.setTimeout(report, 0);
  }, true);
  document.addEventListener("scroll", () => window.setTimeout(report, 0), true);
  window.addEventListener("hashchange", report);
  new MutationObserver(() => {
    setSlideVisibility(activeIndex());
    report();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "aria-hidden"] });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel || data.type !== "deck-navigate") return;
    if (data.direction === "previous" || data.direction === "next") navigate(data.direction);
    else if (data.direction === "index" && typeof data.index === "number") navigate("index", data.index);
  });
  report();
}

function designRuntime(channel: string, styleFields: readonly string[], initialEditing: boolean, strictPptx = false) {
  const runtimeId = "ipollowork-design-runtime";
  const styleId = "ipollowork-design-runtime-style";
  const selectedAttribute = "data-ipollowork-design-selected";
  const editingAttribute = "data-ipollowork-design-editing";
  const idAttribute = "data-ipollowork-design-id";
  const overlayId = "ipollowork-design-transform-overlay";
  const textNodeAttribute = "data-ipollowork-design-text-node";
  const modeAttribute = "data-ipollowork-design-mode";
  const editableSelector = "h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote,img,div,section,article,header,footer,nav,main";
  const textEditableSelector = "h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote";
  const textColorSelector = "h1,h2,h3,h4,h5,h6,p,span,label,li,blockquote";
  let selected: HTMLElement | null = null;
  let textRange: Range | null = null;
  let editingEnabled = initialEditing;
  let transform: {
    mode: "move" | "resize";
    handle: string;
    startX: number;
    startY: number;
    rect: DOMRect;
    left: number;
    top: number;
    width: number;
    height: number;
    position: string;
    moved: boolean;
  } | null = null;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    html[${modeAttribute}="editing"] [${idAttribute}] { cursor: pointer !important; }
    html[${modeAttribute}="editing"] [${idAttribute}]:hover { outline: 1px dashed #7c3aed !important; outline-offset: 2px !important; }
    html[${modeAttribute}="editing"] [${selectedAttribute}] { outline: 2px solid #7c3aed !important; outline-offset: 2px !important; }
    html[${modeAttribute}="editing"] [${editingAttribute}] { cursor: text !important; outline: 2px solid #2563eb !important; }
    #${overlayId} { position: fixed; z-index: 2147483646; display: none; pointer-events: auto; cursor: move; border: 1px solid #7c3aed; box-sizing: border-box; background: transparent; }
    #${overlayId} [data-handle] { position: absolute; width: 9px; height: 9px; padding: 0; border: 1.5px solid #7c3aed; border-radius: 3px; background: white; box-shadow: 0 1px 4px rgba(15,23,42,.18); pointer-events: auto; }
    #${overlayId} [data-handle="nw"] { left: -5px; top: -5px; cursor: nwse-resize; }
    #${overlayId} [data-handle="n"] { left: 50%; top: -5px; transform: translateX(-50%); cursor: ns-resize; }
    #${overlayId} [data-handle="ne"] { right: -5px; top: -5px; cursor: nesw-resize; }
    #${overlayId} [data-handle="e"] { right: -5px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
    #${overlayId} [data-handle="se"] { right: -5px; bottom: -5px; cursor: nwse-resize; }
    #${overlayId} [data-handle="s"] { left: 50%; bottom: -5px; transform: translateX(-50%); cursor: ns-resize; }
    #${overlayId} [data-handle="sw"] { left: -5px; bottom: -5px; cursor: nesw-resize; }
    #${overlayId} [data-handle="w"] { left: -5px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = overlayId;
  for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const control = document.createElement("button");
    control.type = "button";
    control.setAttribute("data-handle", handle);
    control.setAttribute("aria-label", `Resize ${handle}`);
    overlay.appendChild(control);
  }
  document.body.appendChild(overlay);

  // Direct button text has no DOM element of its own, which makes it impossible
  // to distinguish a click on the label from a click on the button shell. Give
  // those labels an editor-only span and unwrap it again during serialization.
  document.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach((control) => {
    Array.from(control.childNodes).forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return;
      const label = document.createElement("span");
      label.setAttribute(textNodeAttribute, "true");
      node.replaceWith(label);
      label.appendChild(node);
    });
  });

  const elements = Array.from(document.querySelectorAll<HTMLElement>(`${editableSelector},[${textNodeAttribute}]`))
    .filter((element) => element !== overlay && !overlay.contains(element));
  elements.forEach((element, index) => element.setAttribute(idAttribute, String(index + 1)));

  const restoreDeckRuntimeState = (root: HTMLElement) => {
    const restoreAttribute = (element: Element, attribute: string, originalAttribute: string, hadAttribute: string) => {
      const originalValue = element.getAttribute(originalAttribute) || "";
      if (element.getAttribute(hadAttribute) === "true") element.setAttribute(attribute, originalValue);
      else element.removeAttribute(attribute);
      element.removeAttribute(originalAttribute);
      element.removeAttribute(hadAttribute);
    };
    root.querySelectorAll("[data-ipollowork-deck-had-aria-hidden]").forEach((element) => {
      restoreAttribute(element, "aria-hidden", "data-ipollowork-deck-original-aria-hidden", "data-ipollowork-deck-had-aria-hidden");
    });
    root.querySelectorAll("[data-ipollowork-deck-had-class]").forEach((element) => {
      restoreAttribute(element, "class", "data-ipollowork-deck-original-class", "data-ipollowork-deck-had-class");
    });
    root.querySelectorAll("[data-ipollowork-deck-had-wrapper-class]").forEach((element) => {
      restoreAttribute(element, "class", "data-ipollowork-deck-original-wrapper-class", "data-ipollowork-deck-had-wrapper-class");
    });
    root.querySelectorAll("[data-ipollowork-deck-added-slide]").forEach((element) => {
      element.removeAttribute("data-ipw-slide");
      element.removeAttribute("data-ipollowork-deck-added-slide");
    });
  };

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "";
    clone.querySelector(`#${runtimeId}`)?.remove();
    clone.querySelector("#ipollowork-design-navigation-runtime")?.remove();
    clone.querySelector("#ipollowork-design-deck-runtime")?.remove();
    clone.querySelector("#ipollowork-design-deck-runtime-style")?.remove();
    clone.querySelector("#ipollowork-design-fixed-slide-runtime")?.remove();
    clone.querySelector("#ipollowork-design-fixed-slide-runtime-style")?.remove();
    clone.querySelector(`#${styleId}`)?.remove();
    clone.querySelector("#ipollowork-design-template-token-style")?.remove();
    clone.querySelector(`#${overlayId}`)?.remove();
    restoreDeckRuntimeState(clone);
    clone.querySelectorAll("[data-ipw-materialize-once]").forEach((element) => element.remove());
    clone.querySelectorAll(`[${textNodeAttribute}]`).forEach((element) => element.replaceWith(...Array.from(element.childNodes)));
    clone.querySelectorAll(`[${idAttribute}]`).forEach((element) => element.removeAttribute(idAttribute));
    clone.querySelectorAll(`[${selectedAttribute}]`).forEach((element) => element.removeAttribute(selectedAttribute));
    clone.querySelectorAll(`[${editingAttribute}]`).forEach((element) => {
      element.removeAttribute(editingAttribute);
      element.removeAttribute("contenteditable");
    });
    if (strictPptx) {
      clone.querySelectorAll("script,[data-ipw-notes],.ipw-notes,.slide-counter,.controls,.deck-chrome,.deck-controls,.dots,.counter,[data-ipw-deck-control],[data-ipw-prev],[data-ipw-next],[data-action='prev'],[data-action='previous'],[data-action='next']")
        .forEach((element) => element.remove());
    }
    clone.removeAttribute(modeAttribute);
    const doctype = document.doctype
      ? `<!DOCTYPE ${document.doctype.name}${document.doctype.publicId ? ` PUBLIC \"${document.doctype.publicId}\"` : ""}${document.doctype.systemId ? ` \"${document.doctype.systemId}\"` : ""}>\n`
      : "";
    return `${doctype}${clone.outerHTML}`;
  };

  const describe = (element: HTMLElement) => {
    const computed = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const navigationControl = element.closest<HTMLElement>("a,button,[role='button']");
    const navigationHref = navigationControl instanceof HTMLAnchorElement
      ? navigationControl.getAttribute("href") || ""
      : navigationControl?.getAttribute("data-href") || navigationControl?.getAttribute("data-url") || navigationControl?.getAttribute("formaction") || "";
    const styles: Record<string, string> = {};
    styleFields.forEach((field) => {
      styles[field] = element.style.getPropertyValue(field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)) || Reflect.get(computed, field) || "";
    });
    return {
      id: element.getAttribute(idAttribute) || "",
      tag: element.tagName.toLowerCase(),
      text: element instanceof HTMLImageElement ? "" : element.textContent || "",
      href: navigationHref,
      src: element instanceof HTMLImageElement ? element.getAttribute("src") || "" : "",
      alt: element instanceof HTMLImageElement ? element.getAttribute("alt") || "" : "",
      canEditText: !(element instanceof HTMLImageElement) && (element.matches(textEditableSelector) || element.hasAttribute(textNodeAttribute)),
      colorField: element.matches(textColorSelector) || element.hasAttribute(textNodeAttribute) ? "color" : "backgroundColor",
      rangeText: textRange && element.contains(textRange.commonAncestorContainer) ? textRange.toString() : "",
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
  };

  const post = (type: "selected" | "editing" | "draft") => {
    if (!selected) return;
    const selection = describe(selected);
    window.parent.postMessage(
      type === "draft"
        ? { channel, type, html: serialize(), selection }
        : { channel, type, selection },
      "*",
    );
  };

  const syncOverlay = () => {
    if (!editingEnabled || !selected || !selected.isConnected || selected.hasAttribute(editingAttribute)) {
      overlay.style.display = "none";
      return;
    }
    const rect = selected.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${Math.max(1, rect.width)}px`;
    overlay.style.height = `${Math.max(1, rect.height)}px`;
  };

  const numericStyle = (element: HTMLElement, property: "left" | "top" | "width" | "height", fallback: number) => {
    const value = Number.parseFloat(element.style.getPropertyValue(property));
    return Number.isFinite(value) ? value : fallback;
  };

  const prepareTransform = (element: HTMLElement, mode: "move" | "resize", handle: string, event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    const relative = computed.position === "static" || computed.position === "relative";
    transform = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      left: numericStyle(element, "left", relative ? 0 : rect.left),
      top: numericStyle(element, "top", relative ? 0 : rect.top),
      width: numericStyle(element, "width", rect.width),
      height: numericStyle(element, "height", rect.height),
      position: computed.position,
      moved: false,
    };
  };

  const selectElement = (element: HTMLElement, type: "selected" | "editing" = "selected") => {
    selected?.removeAttribute(selectedAttribute);
    selected = element;
    selected.setAttribute(selectedAttribute, "true");
    syncOverlay();
    post(type);
  };

  const selectionCandidate = (target: Element) => {
    const element = target.closest<HTMLElement>(`[${idAttribute}]`);
    if (!element) return null;
    const control = element.closest<HTMLElement>("button,a,[role='button']");
    // Controls use progressive selection: the first click selects the shell
    // (background, size, position); a second click drills into its text label.
    // This avoids forcing users to hunt for a few pixels of button padding.
    if (control && element !== control && selected !== control) return control;
    return element;
  };

  const isDeckNavigation = (target: Element) => Boolean(target.closest("[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],button[aria-label^='Go to slide']"));

  const clearSelection = () => {
    selected?.removeAttribute(selectedAttribute);
    selected?.removeAttribute(editingAttribute);
    selected?.removeAttribute("contenteditable");
    selected = null;
    textRange = null;
    transform = null;
    overlay.style.display = "none";
  };

  const setEditingEnabled = (next: boolean) => {
    editingEnabled = next;
    document.documentElement.setAttribute(modeAttribute, next ? "editing" : "preview");
    if (!next) clearSelection();
  };

  setEditingEnabled(initialEditing);

  const elementBelowOverlay = (x: number, y: number) => {
    const previous = overlay.style.pointerEvents;
    overlay.style.pointerEvents = "none";
    const target = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = previous;
    return target instanceof Element ? selectionCandidate(target) : null;
  };

  overlay.addEventListener("pointerdown", (event) => {
    if (!editingEnabled) return;
    const target = event.target;
    if (!selected || !(target instanceof HTMLElement)) return;
    const handle = target.getAttribute("data-handle") || "move";
    event.preventDefault();
    event.stopPropagation();
    target.setPointerCapture?.(event.pointerId);
    prepareTransform(selected, handle === "move" ? "move" : "resize", handle, event);
  }, true);

  overlay.addEventListener("click", (event) => {
    if (!editingEnabled) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  overlay.addEventListener("dblclick", (event) => {
    if (!editingEnabled) return;
    if (!selected || selected instanceof HTMLImageElement || !(selected.matches(textEditableSelector) || selected.hasAttribute(textNodeAttribute))) return;
    event.preventDefault();
    event.stopPropagation();
    selected.setAttribute(editingAttribute, "true");
    selected.setAttribute("contenteditable", "true");
    syncOverlay();
    selected.focus();
    post("editing");
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!editingEnabled || !selected || selected.hasAttribute(editingAttribute)) return;
    const target = event.target;
    if (!(target instanceof Element) || overlay.contains(target)) return;
    if (!event.altKey && isDeckNavigation(target)) return;
    const element = selectionCandidate(target);
    if (element !== selected) return;
    prepareTransform(selected, "move", "move", event);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!editingEnabled || !selected || !transform) return;
    const dx = event.clientX - transform.startX;
    const dy = event.clientY - transform.startY;
    if (!transform.moved && Math.hypot(dx, dy) < 3) return;
    if (!transform.moved) {
      transform.moved = true;
      if (transform.position === "static") selected.style.position = "relative";
      post("editing");
    }
    event.preventDefault();
    event.stopPropagation();
    if (transform.mode === "move") {
      selected.style.left = `${transform.left + dx}px`;
      selected.style.top = `${transform.top + dy}px`;
    } else {
      const west = transform.handle.includes("w");
      const east = transform.handle.includes("e");
      const north = transform.handle.includes("n");
      const south = transform.handle.includes("s");
      let width = transform.width + (east ? dx : west ? -dx : 0);
      let height = transform.height + (south ? dy : north ? -dy : 0);
      if (event.shiftKey && (west || east) && (north || south)) {
        const ratio = Math.max(.01, transform.width / Math.max(1, transform.height));
        if (Math.abs(dx) > Math.abs(dy)) height = width / ratio;
        else width = height * ratio;
      }
      width = Math.max(12, width);
      height = Math.max(12, height);
      selected.style.width = `${width}px`;
      selected.style.height = `${height}px`;
      if (west) selected.style.left = `${transform.left + (transform.width - width)}px`;
      if (north) selected.style.top = `${transform.top + (transform.height - height)}px`;
    }
    syncOverlay();
    post("selected");
  }, true);

  const finishTransform = (event: PointerEvent) => {
    if (!editingEnabled) return;
    if (!transform) return;
    const changed = transform.moved;
    const mode = transform.mode;
    const handle = transform.handle;
    transform = null;
    if (!changed) {
      if (mode === "move" && handle === "move" && overlay.contains(event.target as Node)) {
        const element = elementBelowOverlay(event.clientX, event.clientY);
        if (element && element !== selected) selectElement(element);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    syncOverlay();
    post("draft");
  };
  document.addEventListener("pointerup", finishTransform, true);
  document.addEventListener("pointercancel", finishTransform, true);

  document.addEventListener("click", (event) => {
    if (!editingEnabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!event.altKey && isDeckNavigation(target)) return;
    const element = selectionCandidate(target);
    if (!element) return;
    if (element.hasAttribute(editingAttribute)) return;
    event.preventDefault();
    event.stopPropagation();
    selectElement(element);
  }, true);

  document.addEventListener("dblclick", (event) => {
    if (!editingEnabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = target.closest<HTMLElement>(`[${idAttribute}]`);
    if (!element || element instanceof HTMLImageElement || !(element.matches(textEditableSelector) || element.hasAttribute(textNodeAttribute))) return;
    event.preventDefault();
    event.stopPropagation();
    selected?.removeAttribute(selectedAttribute);
    selected = element;
    selected.setAttribute(selectedAttribute, "true");
    selected.setAttribute(editingAttribute, "true");
    selected.setAttribute("contenteditable", "true");
    syncOverlay();
    selected.focus();
    post("editing");
  }, true);

  document.addEventListener("input", (event) => {
    if (!editingEnabled || !selected || event.target !== selected || !selected.hasAttribute(editingAttribute)) return;
    post("draft");
  }, true);

  document.addEventListener("selectionchange", () => {
    if (!editingEnabled || !selected || !selected.hasAttribute(editingAttribute)) return;
    const rangeSelection = window.getSelection();
    if (!rangeSelection || rangeSelection.rangeCount === 0 || rangeSelection.isCollapsed) {
      textRange = null;
      post("editing");
      return;
    }
    const nextRange = rangeSelection.getRangeAt(0);
    if (!selected.contains(nextRange.commonAncestorContainer)) return;
    textRange = nextRange.cloneRange();
    post("editing");
  });

  document.addEventListener("keydown", (event) => {
    if (!editingEnabled || !selected || event.target !== selected || !selected.hasAttribute(editingAttribute)) return;
    if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
      event.preventDefault();
      selected.blur();
    }
  }, true);

  document.addEventListener("focusout", (event) => {
    if (!editingEnabled || !selected || event.target !== selected || !selected.hasAttribute(editingAttribute)) return;
    selected.removeAttribute(editingAttribute);
    selected.removeAttribute("contenteditable");
    syncOverlay();
    post("draft");
  }, true);

  window.addEventListener("resize", () => { if (editingEnabled) { syncOverlay(); post("selected"); } });
  window.addEventListener("scroll", () => { if (editingEnabled) { syncOverlay(); post("selected"); } }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel) return;
    if (data.type === "set-editing" && typeof data.editing === "boolean") {
      setEditingEnabled(data.editing);
      return;
    }
    if (data.type === "snapshot" && typeof data.requestId === "string") {
      window.parent.postMessage({ channel, type: "snapshot", requestId: data.requestId, html: serialize() }, "*");
      return;
    }
    if (data.type === "set-token" && typeof data.name === "string" && typeof data.value === "string" && data.name.startsWith("--ipw-")) {
      document.documentElement.style.setProperty(data.name, data.value);
      window.parent.postMessage({ channel, type: "document-draft", html: serialize() }, "*");
      return;
    }
    if (!selected || data.type !== "set") return;
    if (data.id !== selected.getAttribute(idAttribute) || typeof data.field !== "string" || typeof data.value !== "string") return;

    if (data.field === "text" && !(selected instanceof HTMLImageElement) && (selected.matches(textEditableSelector) || selected.hasAttribute(textNodeAttribute))) {
      selected.textContent = data.value;
    } else if (data.field === "href") {
      const navigationControl = selected.closest<HTMLElement>("a,button,[role='button']");
      if (navigationControl instanceof HTMLAnchorElement) navigationControl.setAttribute("href", data.value);
      else if (navigationControl) navigationControl.setAttribute("data-href", data.value);
      else return;
    } else if (data.field === "src" && selected instanceof HTMLImageElement) {
      selected.setAttribute("src", data.value);
    } else if (data.field === "alt" && selected instanceof HTMLImageElement) {
      selected.setAttribute("alt", data.value);
    } else if (styleFields.includes(data.field)) {
      const property = data.field.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
      if (data.scope === "range" && textRange && selected.contains(textRange.commonAncestorContainer) && textRange.toString()) {
        const span = document.createElement("span");
        span.style.setProperty(property, data.value);
        span.appendChild(textRange.extractContents());
        textRange.insertNode(span);
        textRange.selectNodeContents(span);
        const rangeSelection = window.getSelection();
        rangeSelection?.removeAllRanges();
        rangeSelection?.addRange(textRange);
      } else {
        selected.style.setProperty(property, data.value);
      }
    } else {
      return;
    }

    syncOverlay();
    post("draft");
  });
}
