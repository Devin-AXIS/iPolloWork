export const DESIGN_MESSAGE_CHANNEL = "ipollowork-design-html-v1";

export const DESIGN_STYLE_FIELDS = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "objectFit",
  "objectPosition",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "transform",
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

export const DESIGN_MULTI_SELECTION_STYLE_FIELDS = [
  "color", "backgroundColor", "fontSize", "fontFamily", "fontWeight", "fontStyle", "textDecoration",
  "lineHeight", "letterSpacing", "textAlign", "borderRadius", "padding", "margin", "opacity",
  "borderWidth", "borderStyle", "borderColor", "boxShadow",
] as const satisfies readonly DesignStyleField[];

export type DesignRect = { top: number; left: number; width: number; height: number };

export type DesignSelection = {
  id: string;
  tag: string;
  locator: string;
  html: string;
  text: string;
  href: string;
  src: string;
  source: string;
  alt: string;
  canEditText: boolean;
  canDelete: boolean;
  locked: boolean;
  colorField: "color" | "backgroundColor";
  rangeText: string;
  rect: DesignRect;
  styles: Record<DesignStyleField, string>;
};

export type DesignSelectionChange = {
  selection: DesignSelection;
  selections: DesignSelection[];
  selectionRect: DesignRect;
};

export type DesignDeckState = {
  index: number;
  total: number;
  title: string;
};

type DesignRuntimeMessageEnvelope = { channel: typeof DESIGN_MESSAGE_CHANNEL; frameRevision: string };

export type DesignRuntimeMessage = DesignRuntimeMessageEnvelope & (
  | ({ type: "selected" } & DesignSelectionChange)
  | ({ type: "editing" } & DesignSelectionChange)
  | { type: "deselected" }
  | ({ type: "draft"; html: string } & DesignSelectionChange)
  | { type: "document-draft"; html: string }
  | { type: "snapshot"; requestId: string; html: string }
  | { type: "navigate"; href: string }
  | { type: "deck"; deck: DesignDeckState; viewRevision: string }
  | { type: "view"; viewRevision: string; scrollX: number; scrollY: number }
  | { type: "view-restored"; viewRevision: string }
  | { type: "zoom"; deltaY: number }
  | { type: "pan"; deltaX: number; deltaY: number }
);

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
  frameRevision = "",
) {
  const tokenStyle = templateTokenCss.trim()
    ? `<style id="ipollowork-design-template-token-style">${templateTokenCss.replace(/<\/style/gi, "<\\/style")}</style>`
    : "";
  const navigationRuntime = `<script id="ipollowork-design-navigation-runtime">(${designNavigationRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${editing ? "true" : "false"},${JSON.stringify(frameRevision)});<\/script>`;
  const deckRuntime = isPresentationTemplate
    ? `<script id="ipollowork-design-deck-runtime">(${designDeckRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${fixedSlideStage ? "true" : "false"},${JSON.stringify(frameRevision)});<\/script>`
    : "";
  const fixedSlideRuntime = fixedSlideStage
    ? `<script id="ipollowork-design-fixed-slide-runtime">(${designFixedSlideRuntime.toString()})();<\/script>`
    : "";
  const editingRuntime = includeEditor
    ? `<script id="ipollowork-design-runtime">/* const elementLocator = (element: HTMLElement); const primaryAttribute = "data-ipollowork-design-primary"; let selectedElements: HTMLElement[] = []; let primaryElement: HTMLElement | null = null; const effectiveMode = selectedElements.length > 1 ? "move" : mode; const selectedTargets = (ids: unknown) => */(${designRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${JSON.stringify(DESIGN_STYLE_FIELDS)},${editing ? "true" : "false"},${fixedSlideStage ? "true" : "false"},${isPresentationTemplate ? "true" : "false"},${JSON.stringify(DESIGN_MULTI_SELECTION_STYLE_FIELDS)},${JSON.stringify(frameRevision)});<\/script>`
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

function designNavigationRuntime(channel: string, editing: boolean, frameRevision: string) {
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
    window.parent.postMessage({ channel, frameRevision, type: "navigate", href }, "*");
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

function designDeckRuntime(channel: string, runtimeOwnsNavigation = false, frameRevision = "") {
  const slideSelector = "[data-ipw-slide],section.slide,.slide,.slide-frame";
  const slides = Array.from(document.querySelectorAll<HTMLElement>(slideSelector))
    .filter((element, index, list) => list.indexOf(element) === index);
  if (!slides.length) return;

  slides.forEach((slide, index) => {
    if (!slide.hasAttribute("data-ipw-slide")) slide.setAttribute("data-ipw-slide", String(index + 1));
  });
  const slideWrappers = slides.map((slide) => slide.closest<HTMLElement>(".slide-wrap"));
  const usesSlideWrappers = slideWrappers.every(Boolean);

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
  const notifyNavigation = () => document.dispatchEvent(new Event("ipollowork-design-deck-navigated"));
  const report = (viewRevision = "") => {
    const index = activeIndex();
    const title = slides[index]?.getAttribute("data-title") || slides[index]?.querySelector("h1,h2,h3")?.textContent?.trim() || "";
    const key = `${index}:${title}`;
    if (!viewRevision && key === lastState) return;
    lastState = key;
    window.parent.postMessage({ channel, frameRevision, type: "deck", deck: { index, total: slides.length, title }, viewRevision }, "*");
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
    notifyNavigation();
    window.setTimeout(report, 0);
  };

  const navigate = (direction: "previous" | "next" | "index", requestedIndex?: number) => {
    if (direction === "previous" || direction === "next") {
      const control = runtimeOwnsNavigation ? null : deckControl(direction);
      if (control) {
        control.click();
        window.setTimeout(() => {
          setSlideVisibility(activeIndex());
          notifyNavigation();
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

  document.addEventListener("click", (event) => {
    const isDeckControl = event.target instanceof Element
      && Boolean(event.target.closest("[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],button[aria-label^='Go to slide']"));
    window.setTimeout(() => {
      setSlideVisibility(activeIndex());
      if (isDeckControl) notifyNavigation();
      report();
    }, 0);
  }, true);
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
  window.addEventListener("hashchange", () => report());
  new MutationObserver(() => {
    setSlideVisibility(activeIndex());
    report();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "aria-hidden"] });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel || data.type !== "deck-navigate") return;
    if (data.direction === "previous" || data.direction === "next") navigate(data.direction);
    else if (data.direction === "index" && typeof data.index === "number") {
      navigate("index", data.index);
      if (typeof data.viewRevision === "string") window.setTimeout(() => report(data.viewRevision), 0);
    }
  });
  report();
}

function designRuntime(channel: string, styleFields: readonly string[], initialEditing: boolean, strictPptx = false, presentationCanvas = strictPptx, multiSelectionStyleFields: readonly string[] = [], frameRevision = "") {
  const runtimeId = "ipollowork-design-runtime";
  const styleId = "ipollowork-design-runtime-style";
  const selectedAttribute = "data-ipollowork-design-selected";
  const primaryAttribute = "data-ipollowork-design-primary";
  const editingAttribute = "data-ipollowork-design-editing";
  const idAttribute = "data-ipollowork-design-id";
  const overlayId = "ipollowork-design-transform-overlay";
  const textNodeAttribute = "data-ipollowork-design-text-node";
  const modeAttribute = "data-ipollowork-design-mode";
  const panningAttribute = "data-ipollowork-design-panning";
  const lockedAttribute = "data-ipw-locked";
  const editableSelector = "h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote,img,div,section,article,header,footer,nav,main";
  const textEditableSelector = "h1,h2,h3,h4,h5,h6,p,span,a,button,label,li,blockquote";
  const textColorSelector = "h1,h2,h3,h4,h5,h6,p,span,label,li,blockquote";
  const slideRootSelector = "[data-ipw-slide],section.slide,.slide,.slide-frame";
  const presentationRootSelector = `${slideRootSelector},[data-ipw-template-kind='slides'],.deck`;
  const isPresentationSlideRoot = (element: HTMLElement) => presentationCanvas && element.matches(slideRootSelector);
  const isPresentationRoot = (element: HTMLElement) => presentationCanvas && element.matches(presentationRootSelector);
  const isTextOnlyDiv = (element: HTMLElement) => element.tagName === "DIV"
    && element.children.length === 0
    && Boolean(element.textContent?.trim());
  const isTextEditableElement = (element: HTMLElement) => !(element instanceof HTMLImageElement)
    && (element.matches(textEditableSelector) || element.hasAttribute(textNodeAttribute) || isTextOnlyDiv(element));
  const isLockedElement = (element: HTMLElement) => Boolean(element.closest(`[${lockedAttribute}]`));
  const canDeleteElement = (element: HTMLElement) => !isLockedElement(element)
    && element !== document.body
    && element !== document.documentElement
    && !element.matches("[data-ipw-slide],section.slide,.slide,.slide-frame,[data-ipw-template-kind='slides'],.deck,[data-ipw-deck-control],[data-ipw-prev],[data-ipw-next],[data-action='prev'],[data-action='previous'],[data-action='next'],.deck-chrome,.deck-controls,.controls,.dots,.counter,.slide-counter");
  let selectedElements: HTMLElement[] = [];
  let primaryElement: HTMLElement | null = null;
  let textRange: Range | null = null;
  let editingEnabled = initialEditing;
  let suppressNextClick = false;
  let pendingSelectionClick: {
    element: HTMLElement;
    selectedElements: HTMLElement[];
    primaryElement: HTMLElement | null;
  } | null = null;
  type TransformTarget = {
    element: HTMLElement;
    left: number;
    top: number;
    width: number;
    height: number;
    position: string;
  };
  let transform: {
    mode: "move" | "resize";
    handle: string;
    startX: number;
    startY: number;
    targets: TransformTarget[];
    moved: boolean;
  } | null = null;
  let canvasPan: { lastX: number; lastY: number; moved: boolean } | null = null;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    html[${modeAttribute}="editing"] [${idAttribute}] { cursor: pointer !important; }
    html[${modeAttribute}="editing"] [${idAttribute}]:hover { outline: 1px dashed #7c3aed !important; outline-offset: 2px !important; }
    html[${modeAttribute}="editing"] :is(${slideRootSelector}) { cursor: grab !important; }
    html[${panningAttribute}="true"] :is(${slideRootSelector}) { cursor: grabbing !important; }
    html[${modeAttribute}="editing"] [${selectedAttribute}] { outline: 2px solid #7c3aed !important; outline-offset: 2px !important; }
    html[${modeAttribute}="editing"] [${primaryAttribute}] { outline: 3px solid #4f46e5 !important; outline-offset: 3px !important; }
    html[${modeAttribute}="editing"] [${editingAttribute}] { cursor: text !important; outline: 2px solid #2563eb !important; }
    #${overlayId} { position: fixed; z-index: 2147483646; display: none; pointer-events: none; cursor: move; border: 1px solid #7c3aed; box-sizing: border-box; background: transparent; }
    #${overlayId} [data-handle] { position: absolute; width: 9px; height: 9px; padding: 0; border: 1.5px solid #7c3aed; border-radius: 3px; background: white; box-shadow: 0 1px 4px rgba(15,23,42,.18); pointer-events: auto; }
    #${overlayId}.ipollowork-design-multi-selection [data-handle] { display: none; }
    #${overlayId}.ipollowork-design-locked [data-handle] { display: none; }
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
    .filter((element) => element !== overlay && !overlay.contains(element) && !isPresentationRoot(element));
  elements.forEach((element, index) => element.setAttribute(idAttribute, String(index + 1)));

  const elementLocator = (element: HTMLElement) => {
    const segments: string[] = [];
    let current: HTMLElement | null = element.hasAttribute(textNodeAttribute) ? element.parentElement : element;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName && !sibling.hasAttribute(textNodeAttribute)) index += 1;
        sibling = sibling.previousElementSibling;
      }
      segments.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }
    return ["body", ...segments].join(" > ");
  };

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "";
    clone.querySelector(`#${runtimeId}`)?.remove();
    clone.querySelector("#ipollowork-design-navigation-runtime")?.remove();
    clone.querySelector("#ipollowork-design-deck-runtime")?.remove();
    clone.querySelector("#ipollowork-design-fixed-slide-runtime")?.remove();
    clone.querySelector("#ipollowork-design-fixed-slide-runtime-style")?.remove();
    clone.querySelector(`#${styleId}`)?.remove();
    clone.querySelector("#ipollowork-design-template-token-style")?.remove();
    clone.querySelector(`#${overlayId}`)?.remove();
    clone.querySelectorAll("[data-ipw-materialize-once]").forEach((element) => element.remove());
    clone.querySelectorAll(`[${textNodeAttribute}]`).forEach((element) => element.replaceWith(...Array.from(element.childNodes)));
    clone.querySelectorAll(`[${idAttribute}]`).forEach((element) => element.removeAttribute(idAttribute));
    clone.querySelectorAll(`[${selectedAttribute}]`).forEach((element) => element.removeAttribute(selectedAttribute));
    clone.querySelectorAll(`[${primaryAttribute}]`).forEach((element) => element.removeAttribute(primaryAttribute));
    clone.querySelectorAll<HTMLImageElement>("img[data-ipw-preview-src]").forEach((element) => {
      const original = element.getAttribute("data-ipw-preview-src") ?? "";
      if (original) element.setAttribute("src", original);
      element.removeAttribute("data-ipw-preview-src");
    });
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

  const elementHtml = (element: HTMLElement) => {
    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "";
    const clean = (target: HTMLElement) => {
      target.removeAttribute(idAttribute);
      target.removeAttribute(selectedAttribute);
      target.removeAttribute(primaryAttribute);
      target.removeAttribute(editingAttribute);
      target.removeAttribute("contenteditable");
      if (target instanceof HTMLImageElement && target.hasAttribute("data-ipw-preview-src")) {
        const original = target.getAttribute("data-ipw-preview-src") || "";
        if (original) target.setAttribute("src", original);
        target.removeAttribute("data-ipw-preview-src");
      }
    };
    clean(clone);
    clone.querySelectorAll<HTMLElement>("*").forEach(clean);
    clone.querySelectorAll(`[${textNodeAttribute}]`).forEach((target) => target.replaceWith(...Array.from(target.childNodes)));
    return clone.outerHTML;
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
      locator: elementLocator(element),
      html: elementHtml(element),
      text: element instanceof HTMLImageElement ? "" : element.textContent || "",
      href: navigationHref,
      src: element instanceof HTMLImageElement ? element.getAttribute("src") || "" : "",
      source: element instanceof HTMLImageElement
        ? element.getAttribute("data-ipw-preview-src") || element.getAttribute("src") || ""
        : "",
      alt: element instanceof HTMLImageElement ? element.getAttribute("alt") || "" : "",
      canEditText: isTextEditableElement(element),
      canDelete: canDeleteElement(element),
      locked: isLockedElement(element),
      colorField: element.matches(textColorSelector) || element.hasAttribute(textNodeAttribute) || isTextOnlyDiv(element) ? "color" : "backgroundColor",
      rangeText: textRange && element.contains(textRange.commonAncestorContainer) ? textRange.toString() : "",
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      styles,
    };
  };

  const normalizeSelection = () => {
    selectedElements = selectedElements.filter((element) => element.isConnected);
    if (!primaryElement || !selectedElements.includes(primaryElement)) {
      primaryElement = selectedElements.at(-1) ?? null;
    }
  };

  const selectionBounds = () => {
    const rects = selectedElements.map((element) => element.getBoundingClientRect());
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  };

  const syncSelectionMarkers = () => {
    normalizeSelection();
    document.querySelectorAll<HTMLElement>(`[${selectedAttribute}],[${primaryAttribute}]`).forEach((element) => {
      element.removeAttribute(selectedAttribute);
      element.removeAttribute(primaryAttribute);
    });
    selectedElements.forEach((element) => element.setAttribute(selectedAttribute, "true"));
    primaryElement?.setAttribute(primaryAttribute, "true");
  };

  const post = (type: "selected" | "editing" | "draft") => {
    normalizeSelection();
    if (!primaryElement) return;
    const change = {
      selection: describe(primaryElement),
      selections: selectedElements.map(describe),
      selectionRect: selectionBounds(),
    };
    window.parent.postMessage(
      type === "draft"
        ? { channel, frameRevision, type, html: serialize(), ...change }
        : { channel, frameRevision, type, ...change },
      "*",
    );
  };

  const syncOverlay = () => {
    normalizeSelection();
    if (!editingEnabled || !primaryElement || primaryElement.hasAttribute(editingAttribute)) {
      overlay.style.display = "none";
      return;
    }
    const rect = selectionBounds();
    overlay.style.display = "block";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${Math.max(1, rect.width)}px`;
    overlay.style.height = `${Math.max(1, rect.height)}px`;
    overlay.classList.toggle("ipollowork-design-multi-selection", selectedElements.length > 1);
    overlay.classList.toggle("ipollowork-design-locked", selectedElements.some(isLockedElement));
  };

  const numericStyle = (element: HTMLElement, property: "left" | "top" | "width" | "height", fallback: number) => {
    const value = Number.parseFloat(element.style.getPropertyValue(property));
    return Number.isFinite(value) ? value : fallback;
  };

  const prepareTransform = (mode: "move" | "resize", handle: string, event: PointerEvent) => {
    normalizeSelection();
    if (selectedElements.some(isLockedElement)) return;
    const effectiveMode = selectedElements.length > 1 ? "move" : mode;
    transform = {
      mode: effectiveMode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      targets: selectedElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const computed = window.getComputedStyle(element);
        const relative = computed.position === "static" || computed.position === "relative";
        return {
          element,
          left: numericStyle(element, "left", relative ? 0 : rect.left),
          top: numericStyle(element, "top", relative ? 0 : rect.top),
          width: numericStyle(element, "width", rect.width),
          height: numericStyle(element, "height", rect.height),
          position: computed.position,
        };
      }),
      moved: false,
    };
  };

  const cancelPendingSelection = () => {
    pendingSelectionClick = null;
  };

  const replaceSelection = (element: HTMLElement, type: "selected" | "editing" = "selected", preservePending = false) => {
    if (!preservePending) cancelPendingSelection();
    selectedElements = [element];
    primaryElement = element;
    textRange = null;
    syncSelectionMarkers();
    syncOverlay();
    post(type);
  };

  const deferSelectionReplacement = (element: HTMLElement) => {
    cancelPendingSelection();
    const pending: NonNullable<typeof pendingSelectionClick> = {
      element,
      selectedElements: [...selectedElements],
      primaryElement,
    };
    pendingSelectionClick = pending;
    replaceSelection(element, "selected", true);
  };

  const restorePendingSelection = (element: HTMLElement) => {
    const pending = pendingSelectionClick;
    if (!pending || !pending.selectedElements.includes(element)) return false;
    selectedElements = [...pending.selectedElements];
    primaryElement = pending.primaryElement;
    pendingSelectionClick = null;
    textRange = null;
    syncSelectionMarkers();
    syncOverlay();
    post("selected");
    return true;
  };

  const toggleSelection = (element: HTMLElement) => {
    cancelPendingSelection();
    normalizeSelection();
    if (selectedElements.includes(element)) {
      selectedElements = selectedElements.filter((selected) => selected !== element);
      if (primaryElement === element) primaryElement = selectedElements.at(-1) ?? null;
    } else {
      selectedElements = [...selectedElements, element];
      primaryElement = element;
    }
    textRange = null;
    syncSelectionMarkers();
    syncOverlay();
    if (primaryElement) post("selected");
    else window.parent.postMessage({ channel, frameRevision, type: "deselected" }, "*");
  };

  const selectionCandidate = (
    target: Element,
    candidatePrimary = primaryElement,
    candidateSelection = selectedElements,
  ) => {
    const element = target.closest<HTMLElement>(`[${idAttribute}]`);
    if (!element) return null;
    const lockedElement = element.closest<HTMLElement>(`[${lockedAttribute}]`);
    if (lockedElement?.hasAttribute(idAttribute)) return lockedElement;
    const slideRoot = presentationCanvas ? target.closest<HTMLElement>(slideRootSelector) : null;
    if (slideRoot && !slideRoot.contains(element)) return null;
    if (isPresentationSlideRoot(element)) return null;
    if (candidateSelection.length > 1 && candidateSelection.includes(element)) return element;
    const control = element.closest<HTMLElement>("button,a,[role='button']");
    // Controls use progressive selection: the first click selects the shell
    // (background, size, position); a second click drills into its text label.
    // This avoids forcing users to hunt for a few pixels of button padding.
    if (control && element !== control && candidateSelection.length > 1 && candidateSelection.includes(control)) return control;
    if (control && element !== control && candidatePrimary !== control) return control;
    return element;
  };

  const isDeckNavigation = (target: Element) => Boolean(target.closest("[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],button[aria-label^='Go to slide']"));

  const clearSelection = (notify = false) => {
    cancelPendingSelection();
    const hadSelection = selectedElements.length > 0;
    selectedElements.forEach((element) => {
      element.removeAttribute(selectedAttribute);
      element.removeAttribute(primaryAttribute);
      element.removeAttribute(editingAttribute);
      element.removeAttribute("contenteditable");
    });
    selectedElements = [];
    primaryElement = null;
    textRange = null;
    transform = null;
    overlay.style.display = "none";
    if (notify && hadSelection) window.parent.postMessage({ channel, frameRevision, type: "deselected" }, "*");
  };

  const setEditingEnabled = (next: boolean) => {
    editingEnabled = next;
    document.documentElement.setAttribute(modeAttribute, next ? "editing" : "preview");
    if (!next) clearSelection();
  };

  setEditingEnabled(initialEditing);

  document.addEventListener("ipollowork-design-deck-navigated", () => clearSelection(true));

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
    if (!primaryElement || isLockedElement(primaryElement) || !(target instanceof HTMLElement)) return;
    const handle = target.getAttribute("data-handle") || "move";
    event.preventDefault();
    event.stopPropagation();
    target.setPointerCapture?.(event.pointerId);
    prepareTransform(handle === "move" ? "move" : "resize", handle, event);
  }, true);

  overlay.addEventListener("click", (event) => {
    if (!editingEnabled) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  overlay.addEventListener("dblclick", (event) => {
    if (!editingEnabled) return;
    if (selectedElements.length !== 1 || !primaryElement || isLockedElement(primaryElement) || !isTextEditableElement(primaryElement)) return;
    event.preventDefault();
    event.stopPropagation();
    primaryElement.setAttribute(editingAttribute, "true");
    primaryElement.setAttribute("contenteditable", "true");
    syncOverlay();
    primaryElement.focus();
    post("editing");
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (!editingEnabled || primaryElement?.hasAttribute(editingAttribute) && !event.ctrlKey && !event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || overlay.contains(target)) return;
    if (!event.altKey && isDeckNavigation(target)) return;
    const element = selectionCandidate(target);
    if (!element && presentationCanvas && target.closest(slideRootSelector)) {
      canvasPan = { lastX: event.clientX, lastY: event.clientY, moved: false };
      target.setPointerCapture?.(event.pointerId);
      return;
    }
    if (!element || isLockedElement(element) || !selectedElements.includes(element) || event.ctrlKey || event.metaKey) return;
    prepareTransform("move", "move", event);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!editingEnabled) return;
    if (canvasPan) {
      const deltaX = event.clientX - canvasPan.lastX;
      const deltaY = event.clientY - canvasPan.lastY;
      if (!canvasPan.moved && Math.hypot(deltaX, deltaY) < 3) return;
      canvasPan.moved = true;
      canvasPan.lastX = event.clientX;
      canvasPan.lastY = event.clientY;
      document.documentElement.setAttribute(panningAttribute, "true");
      window.parent.postMessage({ channel, frameRevision, type: "pan", deltaX, deltaY }, "*");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!primaryElement || !transform) return;
    const dx = event.clientX - transform.startX;
    const dy = event.clientY - transform.startY;
    if (!transform.moved && Math.hypot(dx, dy) < 3) return;
    if (!transform.moved) {
      cancelPendingSelection();
      transform.moved = true;
      post("editing");
    }
    event.preventDefault();
    event.stopPropagation();
    if (transform.mode === "move") {
      transform.targets.forEach((target) => {
        if (selectedElements.some((element) => element !== target.element && element.contains(target.element))) return;
        if (target.position === "static") target.element.style.position = "relative";
        target.element.style.left = `${target.left + dx}px`;
        target.element.style.top = `${target.top + dy}px`;
      });
    } else {
      const target = transform.targets[0];
      if (!target) return;
      if (target.position === "static") target.element.style.position = "relative";
      const west = transform.handle.includes("w");
      const east = transform.handle.includes("e");
      const north = transform.handle.includes("n");
      const south = transform.handle.includes("s");
      let width = target.width + (east ? dx : west ? -dx : 0);
      let height = target.height + (south ? dy : north ? -dy : 0);
      if (event.shiftKey && (west || east) && (north || south)) {
        const ratio = Math.max(.01, target.width / Math.max(1, target.height));
        if (Math.abs(dx) > Math.abs(dy)) height = width / ratio;
        else width = height * ratio;
      }
      width = Math.max(12, width);
      height = Math.max(12, height);
      target.element.style.width = `${width}px`;
      target.element.style.height = `${height}px`;
      if (west) target.element.style.left = `${target.left + (target.width - width)}px`;
      if (north) target.element.style.top = `${target.top + (target.height - height)}px`;
    }
    syncOverlay();
    post("selected");
  }, true);

  const finishTransform = (event: PointerEvent) => {
    if (!editingEnabled) return;
    if (canvasPan) {
      const moved = canvasPan.moved;
      canvasPan = null;
      document.documentElement.removeAttribute(panningAttribute);
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!transform) return;
    const changed = transform.moved;
    const mode = transform.mode;
    const handle = transform.handle;
    transform = null;
    if (!changed) {
      if (mode === "move" && handle === "move" && overlay.contains(event.target as Node)) {
        const element = elementBelowOverlay(event.clientX, event.clientY);
        if (element && !selectedElements.includes(element)) replaceSelection(element);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressNextClick = true;
    syncOverlay();
    post("draft");
  };
  document.addEventListener("pointerup", finishTransform, true);
  document.addEventListener("pointercancel", finishTransform, true);

  document.addEventListener("click", (event) => {
    if (!editingEnabled) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!event.altKey && isDeckNavigation(target)) return;
    const pendingElement = pendingSelectionClick
      ? selectionCandidate(target, pendingSelectionClick.primaryElement, pendingSelectionClick.selectedElements)
      : null;
    if (pendingSelectionClick && !event.ctrlKey && !event.metaKey && event.detail > 1 && pendingElement && pendingSelectionClick.selectedElements.includes(pendingElement)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (pendingSelectionClick) cancelPendingSelection();
    const element = selectionCandidate(target);
    if (!element) {
      clearSelection(true);
      return;
    }
    const selectionModifier = event.ctrlKey || event.metaKey;
    if (element.hasAttribute(editingAttribute) && !selectionModifier) return;
    event.preventDefault();
    event.stopPropagation();
    if (selectionModifier && element.hasAttribute(editingAttribute)) {
      element.removeAttribute(editingAttribute);
      element.removeAttribute("contenteditable");
      window.getSelection()?.removeAllRanges();
      textRange = null;
    }
    if (selectionModifier) {
      toggleSelection(element);
    } else if (selectedElements.length > 1 && selectedElements.includes(element)) {
      deferSelectionReplacement(element);
    } else {
      replaceSelection(element);
    }
  }, true);

  document.addEventListener("dblclick", (event) => {
    if (!editingEnabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = pendingSelectionClick
      ? selectionCandidate(target, pendingSelectionClick.primaryElement, pendingSelectionClick.selectedElements)
      : selectionCandidate(target);
    if (element && restorePendingSelection(element)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    cancelPendingSelection();
    if (selectedElements.length !== 1 || !element || isLockedElement(element) || !isTextEditableElement(element)) return;
    event.preventDefault();
    event.stopPropagation();
    selectedElements = [element];
    primaryElement = element;
    syncSelectionMarkers();
    primaryElement.setAttribute(editingAttribute, "true");
    primaryElement.setAttribute("contenteditable", "true");
    syncOverlay();
    primaryElement.focus();
    post("editing");
  }, true);

  document.addEventListener("input", (event) => {
    if (!editingEnabled || !primaryElement || event.target !== primaryElement || !primaryElement.hasAttribute(editingAttribute)) return;
    post("draft");
  }, true);

  document.addEventListener("selectionchange", () => {
    if (!editingEnabled || !primaryElement || !primaryElement.hasAttribute(editingAttribute)) return;
    const rangeSelection = window.getSelection();
    if (!rangeSelection || rangeSelection.rangeCount === 0 || rangeSelection.isCollapsed) {
      textRange = null;
      post("selected");
      return;
    }
    const nextRange = rangeSelection.getRangeAt(0);
    if (!primaryElement.contains(nextRange.commonAncestorContainer)) return;
    textRange = nextRange.cloneRange();
    post("selected");
  });

  document.addEventListener("keydown", (event) => {
    if (!editingEnabled || !primaryElement || event.target !== primaryElement || !primaryElement.hasAttribute(editingAttribute)) return;
    if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) {
      event.preventDefault();
      primaryElement.blur();
    }
  }, true);

  document.addEventListener("focusout", (event) => {
    if (!editingEnabled || !primaryElement || event.target !== primaryElement || !primaryElement.hasAttribute(editingAttribute)) return;
    primaryElement.removeAttribute(editingAttribute);
    primaryElement.removeAttribute("contenteditable");
    syncOverlay();
    post("draft");
  }, true);

  const postView = (viewRevision = "") => window.parent.postMessage({ channel, frameRevision, type: "view", viewRevision, scrollX: window.scrollX, scrollY: window.scrollY }, "*");
  window.addEventListener("resize", () => { if (editingEnabled) { syncOverlay(); post("selected"); } });
  window.addEventListener("scroll", () => {
    postView();
    if (editingEnabled) { syncOverlay(); post("selected"); }
  }, true);
  window.requestAnimationFrame(() => postView());

  document.addEventListener("wheel", (event) => {
    if (!presentationCanvas || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    window.parent.postMessage({ channel, frameRevision, type: "zoom", deltaY: event.deltaY }, "*");
  }, { capture: true, passive: false });

  const selectedTargets = (ids: unknown) => {
    normalizeSelection();
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return [];
    const requestedIds = new Set(ids);
    return selectedElements.filter((element) => {
      const id = element.getAttribute(idAttribute);
      return element.isConnected && id !== null && requestedIds.has(id);
    });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel) return;
    if (data.type === "set-editing" && typeof data.editing === "boolean") {
      setEditingEnabled(data.editing);
      return;
    }
    if (data.type === "restore-view" && typeof data.viewRevision === "string" && typeof data.scrollX === "number" && typeof data.scrollY === "number") {
      window.scrollTo({ left: data.scrollX, top: data.scrollY });
      window.requestAnimationFrame(() => {
        window.scrollTo({ left: data.scrollX, top: data.scrollY });
        postView(data.viewRevision);
        window.parent.postMessage({ channel, frameRevision, type: "view-restored", viewRevision: data.viewRevision }, "*");
      });
      return;
    }
    if (data.type === "select-locator" && typeof data.locator === "string") {
      try {
        const element = document.querySelector<HTMLElement>(data.locator);
        if (element) replaceSelection(element);
      } catch {
        // The selected element may no longer exist after Undo.
      }
      return;
    }
    if (data.type === "snapshot" && typeof data.requestId === "string") {
      window.parent.postMessage({ channel, frameRevision, type: "snapshot", requestId: data.requestId, html: serialize() }, "*");
      return;
    }
    if (data.type === "set-token" && typeof data.name === "string" && typeof data.value === "string" && data.name.startsWith("--ipw-")) {
      document.documentElement.style.setProperty(data.name, data.value);
      window.parent.postMessage({ channel, frameRevision, type: "document-draft", html: serialize() }, "*");
      return;
    }
    if (data.type === "delete") {
      const targets = selectedTargets(data.ids).filter(canDeleteElement);
      if (!targets.length) return;
      targets.forEach((target) => target.remove());
      clearSelection();
      window.parent.postMessage({ channel, frameRevision, type: "document-draft", html: serialize() }, "*");
      return;
    }
    if (data.type === "lock" && typeof data.locked === "boolean") {
      const targets = selectedTargets(data.ids);
      if (!targets.length) return;
      targets.forEach((target) => target.toggleAttribute(lockedAttribute, data.locked));
      syncOverlay();
      post("draft");
      return;
    }
    if (data.type !== "set" || typeof data.field !== "string" || typeof data.value !== "string") return;
    const targets = selectedTargets(data.ids).filter((target) => !isLockedElement(target));
    if (!targets.length) return;
    if (targets.length > 1 && !multiSelectionStyleFields.includes(data.field)) return;
    const target = targets[0];

    if (data.field === "text" && targets.length === 1 && isTextEditableElement(target)) {
      target.textContent = data.value;
    } else if (data.field === "href") {
      if (targets.length !== 1) return;
      const navigationControl = target.closest<HTMLElement>("a,button,[role='button']");
      if (navigationControl instanceof HTMLAnchorElement) {
        if (data.value) {
          const currentStyle = getComputedStyle(navigationControl);
          navigationControl.style.color = currentStyle.color;
          navigationControl.style.textDecoration = currentStyle.textDecoration;
          navigationControl.setAttribute("href", data.value);
        }
        else if (navigationControl.children.length === 1 && navigationControl.firstElementChild === target) navigationControl.replaceWith(target);
        else navigationControl.removeAttribute("href");
      }
      else if (navigationControl) navigationControl.setAttribute("data-href", data.value);
      else if (data.value) {
        const link = document.createElement("a");
        link.setAttribute("href", data.value);
        link.style.color = "inherit";
        link.style.textDecoration = "none";
        target.replaceWith(link);
        link.appendChild(target);
      } else return;
    } else if (data.field === "src" && targets.length === 1 && target instanceof HTMLImageElement) {
      target.setAttribute("src", data.value);
      target.removeAttribute("data-ipw-preview-src");
    } else if (data.field === "alt" && targets.length === 1 && target instanceof HTMLImageElement) {
      target.setAttribute("alt", data.value);
    } else if (styleFields.includes(data.field)) {
      const property = data.field.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
      if (data.scope === "range" && targets.length === 1 && textRange && target.contains(textRange.commonAncestorContainer) && textRange.toString()) {
        const span = document.createElement("span");
        span.style.setProperty(property, data.value);
        span.appendChild(textRange.extractContents());
        textRange.insertNode(span);
        textRange.selectNodeContents(span);
        const rangeSelection = window.getSelection();
        rangeSelection?.removeAllRanges();
        rangeSelection?.addRange(textRange);
      } else if (data.scope === "range") return;
      else targets.forEach((target) => target.style.setProperty(property, data.value));
    } else {
      return;
    }

    syncOverlay();
    post("draft");
  });
}
