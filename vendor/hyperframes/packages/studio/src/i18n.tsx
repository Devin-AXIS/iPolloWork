import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type StudioLocale = "en" | "zh";

type TranslationKey =
  | "app.loadingProject"
  | "app.waitingForServer"
  | "header.viewLabel"
  | "header.storyboard"
  | "header.preview"
  | "header.undo"
  | "header.redo"
  | "header.capture"
  | "header.capturing"
  | "header.captureCurrentFrame"
  | "header.inspector"
  | "header.renderInProgress"
  | "header.renderExport"
  | "header.rendering"
  | "header.export"
  | "sidebar.show"
  | "sidebar.hide"
  | "sidebar.resize"
  | "sidebar.loadingFile"
  | "sidebar.code"
  | "sidebar.comps"
  | "sidebar.assets"
  | "sidebar.catalog"
  | "sidebar.codeTooltip"
  | "sidebar.compsTooltip"
  | "sidebar.assetsTooltip"
  | "sidebar.catalogTooltip"
  | "sidebar.selectFile"
  | "sidebar.lint"
  | "sidebar.linting"
  | "right.resizeInspector"
  | "right.resizePanes"
  | "right.design"
  | "right.designTooltip"
  | "right.layers"
  | "right.layersTooltip"
  | "right.renders"
  | "right.rendersCount"
  | "right.rendersTooltip"
  | "right.slideshow"
  | "right.slideshowTooltip"
  | "right.variables"
  | "right.variablesTooltip"
  | "right.inspectorUnavailable"
  | "right.showRenders"
  | "player.audioMutedSpeed"
  | "player.unmuteAudio"
  | "player.muteAudio"
  | "player.loop"
  | "player.disableLoop"
  | "player.enableLoop"
  | "player.exitFullscreen"
  | "player.enterFullscreen"
  | "player.seek"
  | "player.pause"
  | "player.play"
  | "player.switchToFrames"
  | "player.switchToTime";

const messages: Record<StudioLocale, Record<TranslationKey, string>> = {
  en: {
    "app.loadingProject": "Loading project...",
    "app.waitingForServer": "Waiting for Studio server...",
    "header.viewLabel": "Studio view",
    "header.storyboard": "Storyboard",
    "header.preview": "Preview",
    "header.undo": "Undo",
    "header.redo": "Redo",
    "header.capture": "Capture",
    "header.capturing": "Capturing...",
    "header.captureCurrentFrame": "Capture current frame",
    "header.inspector": "Design",
    "header.renderInProgress": "A render is already in progress",
    "header.renderExport": "Render and export this composition",
    "header.rendering": "Rendering...",
    "header.export": "Export",
    "sidebar.show": "Show sidebar",
    "sidebar.hide": "Hide sidebar",
    "sidebar.resize": "Resize sidebar",
    "sidebar.loadingFile": "Loading {path}...",
    "sidebar.code": "Code",
    "sidebar.comps": "Comps",
    "sidebar.assets": "Assets",
    "sidebar.catalog": "Catalog",
    "sidebar.codeTooltip": "Source code editor",
    "sidebar.compsTooltip": "Compositions and sub-compositions",
    "sidebar.assetsTooltip": "Videos, images, audio, fonts",
    "sidebar.catalogTooltip": "Browse blocks and components",
    "sidebar.selectFile": "Select a file to edit",
    "sidebar.lint": "Lint",
    "sidebar.linting": "Linting...",
    "right.resizeInspector": "Resize inspector panel",
    "right.resizePanes": "Resize Layers and Design panes",
    "right.design": "Design",
    "right.designTooltip": "Element styles and properties",
    "right.layers": "Layers",
    "right.layersTooltip": "Composition layer stack",
    "right.renders": "Export",
    "right.rendersCount": "Export ({count})",
    "right.rendersTooltip": "Export queue",
    "right.slideshow": "Slideshow",
    "right.slideshowTooltip": "Slideshow branching editor",
    "right.variables": "Variables",
    "right.variablesTooltip": "Template variables - declare, preview with values",
    "right.inspectorUnavailable":
      "Inspector is unavailable right now - select the Design or Layers pane above, or pause playback/recording to inspect elements.",
    "right.showRenders": "Show Renders",
    "player.audioMutedSpeed": "Audio muted above 1x speed",
    "player.unmuteAudio": "Unmute audio",
    "player.muteAudio": "Mute audio",
    "player.loop": "Loop playback",
    "player.disableLoop": "Disable loop playback",
    "player.enableLoop": "Enable loop playback",
    "player.exitFullscreen": "Exit fullscreen",
    "player.enterFullscreen": "Enter fullscreen",
    "player.seek": "Seek",
    "player.pause": "Pause",
    "player.play": "Play",
    "player.switchToFrames": "Switch to frame display",
    "player.switchToTime": "Switch to time display",
  },
  zh: {
    "app.loadingProject": "正在加载项目...",
    "app.waitingForServer": "正在等待 Studio 服务...",
    "header.viewLabel": "Studio 视图",
    "header.storyboard": "故事板",
    "header.preview": "预览",
    "header.undo": "撤销",
    "header.redo": "重做",
    "header.capture": "截图",
    "header.capturing": "截图中...",
    "header.captureCurrentFrame": "截取当前帧",
    "header.inspector": "设计",
    "header.renderInProgress": "已有渲染任务正在进行",
    "header.renderExport": "渲染并导出当前合成",
    "header.rendering": "渲染中...",
    "header.export": "导出",
    "sidebar.show": "显示侧栏",
    "sidebar.hide": "隐藏侧栏",
    "sidebar.resize": "调整侧栏宽度",
    "sidebar.loadingFile": "正在加载 {path}...",
    "sidebar.code": "代码",
    "sidebar.comps": "合成",
    "sidebar.assets": "素材",
    "sidebar.catalog": "组件",
    "sidebar.codeTooltip": "源代码编辑器",
    "sidebar.compsTooltip": "合成与子合成",
    "sidebar.assetsTooltip": "视频、图片、音频、字体",
    "sidebar.catalogTooltip": "浏览区块和组件",
    "sidebar.selectFile": "选择一个文件进行编辑",
    "sidebar.lint": "检查",
    "sidebar.linting": "检查中...",
    "right.resizeInspector": "调整检查器面板宽度",
    "right.resizePanes": "调整图层与设计面板高度",
    "right.design": "设计",
    "right.designTooltip": "元素样式和属性",
    "right.layers": "图层",
    "right.layersTooltip": "合成图层堆栈",
    "right.renders": "导出",
    "right.rendersCount": "导出 ({count})",
    "right.rendersTooltip": "导出队列",
    "right.slideshow": "幻灯片",
    "right.slideshowTooltip": "幻灯片分支编辑器",
    "right.variables": "变量",
    "right.variablesTooltip": "模板变量 - 声明并用取值预览",
    "right.inspectorUnavailable":
      "检查器当前不可用 - 请在上方选择设计或图层面板，或暂停播放/录制后再检查元素。",
    "right.showRenders": "显示渲染",
    "player.audioMutedSpeed": "播放速度超过 1x 时音频已静音",
    "player.unmuteAudio": "取消静音",
    "player.muteAudio": "静音",
    "player.loop": "循环播放",
    "player.disableLoop": "关闭循环播放",
    "player.enableLoop": "开启循环播放",
    "player.exitFullscreen": "退出全屏",
    "player.enterFullscreen": "进入全屏",
    "player.seek": "定位播放进度",
    "player.pause": "暂停",
    "player.play": "播放",
    "player.switchToFrames": "切换到帧显示",
    "player.switchToTime": "切换到时间显示",
  },
};

type I18nContextValue = {
  locale: StudioLocale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

const StudioI18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key) => messages.en[key],
});

function resolveStudioLocale(value: unknown): StudioLocale {
  if (typeof value !== "string") return "en";
  return value.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function readLocaleFromHash(): string | null {
  const query = window.location.hash.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get("locale");
}

function readInitialLocale(): StudioLocale {
  if (typeof window === "undefined") return "en";
  const searchParams = new URLSearchParams(window.location.search);
  const queryLocale = searchParams.get("locale") ?? readLocaleFromHash();
  if (queryLocale) return resolveStudioLocale(queryLocale);
  try {
    const stored = window.localStorage.getItem("ipollowork.language");
    if (stored) return resolveStudioLocale(stored);
  } catch {
    // Ignore storage access failures; the parent app will post the live locale.
  }
  return resolveStudioLocale(document.documentElement.lang || navigator.language);
}

export function StudioI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<StudioLocale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; locale?: unknown } | null;
      if (!data || data.type !== "ipollowork:studio-locale") return;
      const nextLocale = resolveStudioLocale(data.locale);
      setLocale(nextLocale);
      try {
        window.localStorage.setItem("ipollowork.language", nextLocale);
      } catch {
        // Ignore storage access failures; the URL and parent app remain authoritative.
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      let out = messages[locale][key] ?? messages.en[key] ?? key;
      for (const [name, value] of Object.entries(params ?? {})) {
        out = out.replace(`{${name}}`, String(value));
      }
      return out;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <StudioI18nContext.Provider value={value}>{children}</StudioI18nContext.Provider>;
}

export function useStudioI18n() {
  return useContext(StudioI18nContext);
}
