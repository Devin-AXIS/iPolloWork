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

export type DesignDeckRuntimeInfo = {
  slideCount: number;
  dataSlideCount: number;
  topLevelSectionSlideCount?: number;
  explicitDeckContainer: boolean;
  deckControlCount: number;
  templateDeck?: boolean;
};

export function shouldRunDesignDeckRuntime(info: DesignDeckRuntimeInfo) {
  return info.slideCount >= 2
    && (info.dataSlideCount >= 2 || (info.topLevelSectionSlideCount ?? 0) >= 2 || info.explicitDeckContainer || info.deckControlCount > 0 || Boolean(info.templateDeck));
}

export function designDeckDirectionForKey(key: string): "previous" | "next" | null {
  if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") return "previous";
  if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " ") return "next";
  return null;
}

export function designDeckFitScale(viewportWidth: number, contentWidth: number, viewportHeight?: number, contentHeight?: number) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
  const widthScale = contentWidth > viewportWidth ? (Math.max(0, viewportWidth) - 16) / contentWidth : 1;
  const heightScale = viewportHeight !== undefined && contentHeight !== undefined && Number.isFinite(viewportHeight) && Number.isFinite(contentHeight) && contentHeight > 0
    ? contentHeight > viewportHeight ? (Math.max(0, viewportHeight) - 16) / contentHeight : 1
    : 1;
  return Math.max(0.1, Math.min(1, widthScale, heightScale));
}

export function designPreviewFitScale(viewportWidth: number, contentWidth: number, viewportHeight?: number, contentHeight?: number, mode: "fluid" | "artboard" = "fluid") {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
  const widthScale = contentWidth > viewportWidth ? (Math.max(0, viewportWidth) - 16) / contentWidth : 1;
  const heightScale = mode === "artboard" && viewportHeight !== undefined && contentHeight !== undefined && Number.isFinite(viewportHeight) && Number.isFinite(contentHeight) && contentHeight > 0
    ? contentHeight > viewportHeight ? (Math.max(0, viewportHeight) - 16) / contentHeight : 1
    : 1;
  return Math.max(0.1, Math.min(1, widthScale, heightScale));
}

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

export function buildDesignPreviewDocument(source: string, includeEditor: boolean, templateTokenCss = "", editing = includeEditor) {
  const tokenStyle = templateTokenCss.trim()
    ? `<style id="ipollowork-design-template-token-style">${templateTokenCss.replace(/<\/style/gi, "<\\/style")}</style>`
    : "";
  const deckRuntimeDetector = shouldRunDesignDeckRuntime.toString();
  const previewFitRuntime = `<script id="ipollowork-design-preview-fit-runtime">(${designPreviewFitRuntime.toString()})(${deckRuntimeDetector});<\/script>`;
  const navigationRuntime = `<script id="ipollowork-design-navigation-runtime">(${designNavigationRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${editing ? "true" : "false"});<\/script>`;
  const deckRuntime = `<script id="ipollowork-design-deck-runtime">(${designDeckRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${deckRuntimeDetector});<\/script>`;
  const editingRuntime = includeEditor
    ? `<script id="ipollowork-design-runtime">(${designRuntime.toString()})(${JSON.stringify(DESIGN_MESSAGE_CHANNEL)},${JSON.stringify(DESIGN_STYLE_FIELDS)},${editing ? "true" : "false"});<\/script>`
    : "";
  const runtime = `${tokenStyle}${previewFitRuntime}${navigationRuntime}${deckRuntime}${editingRuntime}`;
  const bodyEnd = source.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd >= 0) {
    return `${source.slice(0, bodyEnd)}${runtime}${source.slice(bodyEnd)}`;
  }
  return `${source}${runtime}`;
}

function designPreviewFitRuntime(shouldRunDeckRuntime: (info: DesignDeckRuntimeInfo) => boolean) {
  const deckSlideSelector = "[data-ipw-slide], body > section.slide, [data-ipw-deck] .slide, .deck .slide, #deck .slide, .stage .slide";
  const deckControlSelector = "[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],button[aria-label^='Go to slide']";
  const templateDeck = () => /\b(deck|ppt|slide|slides|present|weekly-update)\b/i.test(
    document.documentElement.getAttribute("data-ipw-template") || document.body.getAttribute("data-ipw-template") || "",
  );
  const deckInfo = () => ({
    slideCount: document.querySelectorAll(deckSlideSelector).length,
    dataSlideCount: document.querySelectorAll("[data-ipw-slide]").length,
    topLevelSectionSlideCount: document.querySelectorAll("body > section.slide").length,
    explicitDeckContainer: Boolean(document.querySelector("[data-ipw-deck],.deck,#deck")),
    deckControlCount: document.querySelectorAll(deckControlSelector).length,
    templateDeck: templateDeck(),
  });
  if (shouldRunDeckRuntime(deckInfo())) return;

  const fitStyleId = "ipollowork-design-preview-fit-style";
  const fitTargetAttribute = "data-ipw-design-preview-fit-target";
  const fitModeAttribute = "data-ipw-design-preview-fit";
  const runtimeIds = new Set([
    "ipollowork-design-preview-fit-runtime",
    "ipollowork-design-navigation-runtime",
    "ipollowork-design-deck-runtime",
    "ipollowork-design-runtime",
    "ipollowork-design-runtime-style",
    "ipollowork-design-template-token-style",
    "ipollowork-design-transform-overlay",
  ]);
  const style = document.createElement("style");
  style.id = fitStyleId;
  document.head.appendChild(style);

  const fitScale = (viewportWidth: number, contentWidth: number, viewportHeight?: number, contentHeight?: number, mode: "fluid" | "artboard" = "fluid") => {
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
    const widthScale = contentWidth > viewportWidth ? (Math.max(0, viewportWidth) - 16) / contentWidth : 1;
    const heightScale = mode === "artboard" && viewportHeight !== undefined && contentHeight !== undefined && Number.isFinite(viewportHeight) && Number.isFinite(contentHeight) && contentHeight > 0
      ? contentHeight > viewportHeight ? (Math.max(0, viewportHeight) - 16) / contentHeight : 1
      : 1;
    return Math.max(0.1, Math.min(1, widthScale, heightScale));
  };

  const ignored = (element: Element) => runtimeIds.has(element.id) || element.hasAttribute("data-ipw-brand-slot") || element.tagName === "SCRIPT" || element.tagName === "STYLE";
  const explicitTarget = () => document.querySelector<HTMLElement>("[data-ipw-frame='artboard'],[data-ipw-frame='fluid'],[data-ipw-artboard]");
  const bodyChildren = () => Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !ignored(element));
  const widestChild = () => bodyChildren().reduce<HTMLElement | null>((best, child) => {
    const rect = child.getBoundingClientRect();
    const width = Math.max(child.scrollWidth, rect.width);
    if (!best) return child;
    const bestRect = best.getBoundingClientRect();
    const bestWidth = Math.max(best.scrollWidth, bestRect.width);
    return width > bestWidth ? child : best;
  }, null);
  const targetElement = () => {
    const explicit = explicitTarget();
    if (explicit) return explicit;
    const children = bodyChildren();
    if (children.length === 1) return children[0];
    return document.body;
  };
  const frameMode = (target: HTMLElement): "fluid" | "artboard" => (
    target.getAttribute("data-ipw-frame") === "artboard" || target.hasAttribute("data-ipw-artboard") || document.body.getAttribute("data-ipw-frame") === "artboard"
      ? "artboard"
      : "fluid"
  );
  const measure = (target: HTMLElement) => {
    style.textContent = "";
    target.removeAttribute(fitTargetAttribute);
    document.documentElement.removeAttribute(fitModeAttribute);
    const widest = widestChild();
    const targetRect = target.getBoundingClientRect();
    const widestRect = widest?.getBoundingClientRect();
    const contentWidth = Math.ceil(Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      target.scrollWidth,
      targetRect.width,
      widest?.scrollWidth || 0,
      widestRect?.width || 0,
      window.innerWidth,
    ));
    const contentHeight = Math.ceil(Math.max(
      target.scrollHeight,
      targetRect.height,
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      window.innerHeight,
    ));
    return { contentWidth, contentHeight };
  };

  let pending = false;
  let fallbackTimer: number | null = null;
  const fit = () => {
    pending = false;
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    const target = targetElement();
    const { contentWidth, contentHeight } = measure(target);
    const mode = frameMode(target);
    const scale = fitScale(window.innerWidth, contentWidth, window.innerHeight, contentHeight, mode);
    if (scale >= 0.999) return;
    target.setAttribute(fitTargetAttribute, "true");
    document.documentElement.setAttribute(fitModeAttribute, mode);
    style.textContent = `
      html[${fitModeAttribute}] {
        overflow-x: hidden !important;
      }
      [${fitTargetAttribute}="true"] {
        --ipw-design-preview-fit-scale: ${scale};
        --ipw-design-preview-fit-width: ${contentWidth}px;
        min-width: var(--ipw-design-preview-fit-width) !important;
        max-width: none !important;
        margin-left: auto !important;
        margin-right: auto !important;
        transform-origin: top center !important;
        zoom: var(--ipw-design-preview-fit-scale);
      }
    `;
  };
  const scheduleFit = () => {
    if (pending) return;
    pending = true;
    const runFit = () => {
      if (!pending) return;
      fit();
    };
    window.requestAnimationFrame(runFit);
    fallbackTimer = window.setTimeout(runFit, 80);
  };
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("load", scheduleFit);
  new MutationObserver(scheduleFit).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "data-ipw-frame"] });
  scheduleFit();
  window.setTimeout(scheduleFit, 180);
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
    const conventionalHref = /^(?:登录|登陆|sign\s*in|log\s*in)$/.test(label) ? "login.html" : "";
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

function designDeckRuntime(channel: string, shouldRunDeckRuntime: (info: DesignDeckRuntimeInfo) => boolean) {
  const directionForKey = (key: string): "previous" | "next" | null => {
    if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") return "previous";
    if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " ") return "next";
    return null;
  };
  const fitScale = (viewportWidth: number, contentWidth: number, viewportHeight?: number, contentHeight?: number) => {
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
    const widthScale = contentWidth > viewportWidth ? (Math.max(0, viewportWidth) - 16) / contentWidth : 1;
    const heightScale = viewportHeight !== undefined && contentHeight !== undefined && Number.isFinite(viewportHeight) && Number.isFinite(contentHeight) && contentHeight > 0
      ? contentHeight > viewportHeight ? (Math.max(0, viewportHeight) - 16) / contentHeight : 1
      : 1;
    return Math.max(0.1, Math.min(1, widthScale, heightScale));
  };
  const slideSelector = "[data-ipw-slide], body > section.slide, [data-ipw-deck] section.slide, .deck section.slide, #deck section.slide";
  const deckControlSelector = "[data-ipw-deck-control],[data-action='prev'],[data-action='previous'],[data-action='next'],button[aria-label^='Go to slide']";
  const slides = Array.from(document.querySelectorAll<HTMLElement>(slideSelector))
    .filter((element, index, list) => list.indexOf(element) === index);
  if (!shouldRunDeckRuntime({
    slideCount: slides.length,
    dataSlideCount: document.querySelectorAll("[data-ipw-slide]").length,
    topLevelSectionSlideCount: document.querySelectorAll("body > section.slide").length,
    explicitDeckContainer: Boolean(document.querySelector("[data-ipw-deck],.deck,#deck")),
    deckControlCount: document.querySelectorAll(deckControlSelector).length,
  })) return;

  slides.forEach((slide, index) => {
    if (!slide.hasAttribute("data-ipw-slide")) slide.setAttribute("data-ipw-slide", String(index + 1));
  });
  const fitTargetAttribute = "data-ipw-design-deck-fit-target";
  const fitStyleId = "ipollowork-design-deck-fit-style";
  const fitTarget = slides[0]?.closest<HTMLElement>("[data-ipw-deck],.deck,#deck") || slides[0]?.parentElement || document.body;
  fitTarget.setAttribute(fitTargetAttribute, "true");
  const fitStyle = document.createElement("style");
  fitStyle.id = fitStyleId;
  document.head.appendChild(fitStyle);

  const deckControl = (direction: "previous" | "next") => {
    const aliases = direction === "previous"
      ? ["[data-ipw-deck-control='previous']", "[data-action='prev']", "[data-action='previous']", "[aria-label*='Previous' i]", "[aria-label*='上一页']"]
      : ["[data-ipw-deck-control='next']", "[data-action='next']", "[aria-label*='Next' i]", "[aria-label*='下一页']"];
    return document.querySelector<HTMLElement>(aliases.join(","));
  };

  const activeIndex = () => {
    const hash = window.location.hash.slice(1);
    const hashIndex = Number.parseInt(hash, 10);
    if (String(hashIndex) === hash && hashIndex >= 1 && hashIndex <= slides.length) return hashIndex - 1;
    const visible = slides.findIndex((slide) => slide.getAttribute("aria-hidden") === "false");
    if (visible >= 0) return visible;
    const active = slides.findIndex((slide) => slide.classList.contains("is-active") || slide.classList.contains("active"));
    if (active >= 0) return active;
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

  const fitDeck = () => {
    const active = slides[activeIndex()] || slides[0];
    const contentWidth = Math.max(
      active?.scrollWidth || 0,
      active?.getBoundingClientRect().width || 0,
      window.innerWidth,
    );
    const contentHeight = Math.max(
      active?.scrollHeight || 0,
      active?.getBoundingClientRect().height || 0,
      window.innerHeight,
    );
    const scale = fitScale(window.innerWidth, contentWidth, window.innerHeight, contentHeight);
    fitStyle.textContent = `
      [${fitTargetAttribute}="true"] {
        --ipw-design-deck-fit-scale: ${scale};
        --ipw-design-deck-fit-width: ${Math.ceil(contentWidth)}px;
        min-width: var(--ipw-design-deck-fit-width) !important;
        max-width: none !important;
        margin-left: auto !important;
        margin-right: auto !important;
        transform-origin: top center !important;
        zoom: var(--ipw-design-deck-fit-scale);
      }
    `;
  };

  let lastState = "";
  const report = () => {
    fitDeck();
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
    if (hasIsActive || hasActive) {
      const className = hasIsActive ? "is-active" : "active";
      slides.forEach((slide, slideIndex) => {
        slide.classList.toggle(className, slideIndex === next);
        slide.setAttribute("aria-hidden", String(slideIndex !== next));
      });
    } else {
      slides[next]?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
    }
    window.setTimeout(report, 0);
  };

  const navigate = (direction: "previous" | "next" | "index", requestedIndex?: number) => {
    if (direction === "previous" || direction === "next") {
      const control = deckControl(direction);
      if (control) {
        control.click();
        window.setTimeout(report, 0);
        return;
      }
      showFallback(activeIndex() + (direction === "next" ? 1 : -1));
      return;
    }
    if (typeof requestedIndex === "number") showFallback(requestedIndex);
  };

  document.addEventListener("click", () => window.setTimeout(report, 0), true);
  window.addEventListener("keydown", (event) => {
    const direction = directionForKey(event.key);
    if (!direction) {
      window.setTimeout(report, 0);
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable='true']")) return;
    const before = activeIndex();
    event.preventDefault();
    window.setTimeout(() => {
      if (activeIndex() === before) navigate(direction);
      else report();
    }, 0);
  }, true);
  document.addEventListener("scroll", () => window.setTimeout(report, 0), true);
  window.addEventListener("resize", () => window.setTimeout(report, 0));
  window.addEventListener("hashchange", report);
  new MutationObserver(report).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "aria-hidden"] });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.channel !== channel || data.type !== "deck-navigate") return;
    if (data.direction === "previous" || data.direction === "next") navigate(data.direction);
    else if (data.direction === "index" && typeof data.index === "number") navigate("index", data.index);
  });
  report();
}

function designRuntime(channel: string, styleFields: readonly string[], initialEditing: boolean) {
  const runtimeId = "ipollowork-design-runtime";
  const styleId = "ipollowork-design-runtime-style";
  const fitStyleId = "ipollowork-design-deck-fit-style";
  const fitTargetAttribute = "data-ipw-design-deck-fit-target";
  const previewFitStyleId = "ipollowork-design-preview-fit-style";
  const previewFitTargetAttribute = "data-ipw-design-preview-fit-target";
  const previewFitAttribute = "data-ipw-design-preview-fit";
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

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "";
    clone.querySelector(`#${runtimeId}`)?.remove();
    clone.querySelector("#ipollowork-design-preview-fit-runtime")?.remove();
    clone.querySelector("#ipollowork-design-navigation-runtime")?.remove();
    clone.querySelector("#ipollowork-design-deck-runtime")?.remove();
    clone.querySelector(`#${styleId}`)?.remove();
    clone.querySelector(`#${fitStyleId}`)?.remove();
    clone.querySelector(`#${previewFitStyleId}`)?.remove();
    clone.querySelector("#ipollowork-design-template-token-style")?.remove();
    clone.querySelector(`#${overlayId}`)?.remove();
    clone.querySelectorAll(`[${textNodeAttribute}]`).forEach((element) => element.replaceWith(...Array.from(element.childNodes)));
    clone.querySelectorAll(`[${idAttribute}]`).forEach((element) => element.removeAttribute(idAttribute));
    clone.querySelectorAll(`[${fitTargetAttribute}]`).forEach((element) => element.removeAttribute(fitTargetAttribute));
    clone.querySelectorAll(`[${previewFitTargetAttribute}]`).forEach((element) => element.removeAttribute(previewFitTargetAttribute));
    clone.querySelectorAll(`[${previewFitAttribute}]`).forEach((element) => element.removeAttribute(previewFitAttribute));
    clone.querySelectorAll(`[${selectedAttribute}]`).forEach((element) => element.removeAttribute(selectedAttribute));
    clone.querySelectorAll(`[${editingAttribute}]`).forEach((element) => {
      element.removeAttribute(editingAttribute);
      element.removeAttribute("contenteditable");
    });
    clone.removeAttribute(modeAttribute);
    clone.removeAttribute(previewFitAttribute);
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
