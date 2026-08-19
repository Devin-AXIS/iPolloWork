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
  | "header.edit"
  | "header.preview"
  | "header.previewComingSoon"
  | "preview.aiEditingWarning"
  | "header.undo"
  | "header.redo"
  | "header.capture"
  | "header.capturing"
  | "header.captureCurrentFrame"
  | "header.saveAsTemplate"
  | "header.templates"
  | "header.askAi"
  | "header.openRepository"
  | "header.reloadStudio"
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
  | "assets.import"
  | "assets.source"
  | "assets.sourceUnavailable"
  | "assets.searchPlaceholder"
  | "assets.dropUpload"
  | "assets.mediaTypes"
  | "assets.dropMediaHere"
  | "assets.filterAll"
  | "assets.filterUsed"
  | "assets.filterUnused"
  | "assets.categoryAudio"
  | "assets.categoryImages"
  | "assets.categoryVideo"
  | "assets.categoryFonts"
  | "animation.searchPlaceholder"
  | "animation.searchLabel"
  | "animation.selected"
  | "animation.filterAll"
  | "animation.filterBoxAutomation"
  | "animation.filterText"
  | "animation.used"
  | "animation.unused"
  | "animation.inUse"
  | "animation.apply"
  | "animation.edit"
  | "animation.remove"
  | "animation.close"
  | "animation.start"
  | "animation.end"
  | "animation.speed"
  | "animation.loop"
  | "animation.done"
  | "animation.saving"
  | "animation.saveError"
  | "animation.noMatches"
  | "animation.selectElement"
  | "animation.applied"
  | "animation.updated"
  | "animation.removed"
  | "sidebar.selectFile"
  | "sidebar.lint"
  | "sidebar.linting"
  | "right.resizeInspector"
  | "right.resizePanes"
  | "right.design"
  | "right.designTooltip"
  | "right.voice"
  | "right.voiceTooltip"
  | "right.style"
  | "right.styleTooltip"
  | "right.assets"
  | "right.assetsTooltip"
  | "right.animation"
  | "right.animationTooltip"
  | "right.animationTemplates"
  | "right.animationProperties"
  | "right.catalog"
  | "right.catalogTooltip"
  | "right.effects"
  | "right.effectsTooltip"
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
  | "right.openingProperties"
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
    "header.edit": "Edit",
    "header.preview": "Preview",
    "header.previewComingSoon": "Preview is coming soon",
    "preview.aiEditingWarning": "AI is editing the video · Avoid manual edits",
    "header.undo": "Undo",
    "header.redo": "Redo",
    "header.capture": "Capture",
    "header.capturing": "Capturing...",
    "header.captureCurrentFrame": "Capture current frame",
    "header.saveAsTemplate": "Save as work template",
    "header.templates": "Templates",
    "header.askAi": "Ask AI",
    "header.openRepository": "Open project repository",
    "header.reloadStudio": "Reload Video Studio",
    "header.inspector": "Properties",
    "header.renderInProgress": "A render is already in progress",
    "header.renderExport": "Open export settings",
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
    "assets.import": "Import",
    "assets.source": "Source",
    "assets.sourceUnavailable": "Source selection is not available yet",
    "assets.searchPlaceholder": "Search assets...",
    "assets.dropUpload": "Drop files to upload",
    "assets.mediaTypes": "Images, video, audio, and fonts",
    "assets.dropMediaHere": "Drop media files here",
    "assets.filterAll": "All",
    "assets.filterUsed": "In use",
    "assets.filterUnused": "Unused",
    "assets.categoryAudio": "Audio",
    "assets.categoryImages": "Images",
    "assets.categoryVideo": "Video",
    "assets.categoryFonts": "Fonts",
    "animation.searchPlaceholder": "Search animations...",
    "animation.searchLabel": "Search animations",
    "animation.selected": "Selected: {label}",
    "animation.filterAll": "All",
    "animation.filterBoxAutomation": "Box & Automation",
    "animation.filterText": "Text",
    "animation.used": "In use",
    "animation.unused": "Unused",
    "animation.inUse": "In Use",
    "animation.apply": "Apply",
    "animation.edit": "Edit",
    "animation.remove": "Remove",
    "animation.close": "Close",
    "animation.start": "Start",
    "animation.end": "End",
    "animation.speed": "Speed",
    "animation.loop": "Loop",
    "animation.done": "Done",
    "animation.saving": "Saving...",
    "animation.saveError": "The animation couldn't be saved. Please try again.",
    "animation.noMatches": "No matching animations",
    "animation.selectElement": "Select an element in the video preview first",
    "animation.applied": "Animation applied",
    "animation.updated": "Animation updated",
    "animation.removed": "Animation removed",
    "sidebar.selectFile": "Select a file to edit",
    "sidebar.lint": "Lint",
    "sidebar.linting": "Linting...",
    "right.resizeInspector": "Resize inspector panel",
    "right.resizePanes": "Resize Layers and Design panes",
    "right.design": "Layers",
    "right.designTooltip": "Element styles and properties",
    "right.voice": "Voice",
    "right.voiceTooltip": "Voiceover settings",
    "right.style": "Style",
    "right.styleTooltip": "Video design system",
    "right.assets": "Assets",
    "right.assetsTooltip": "Videos, images, audio, and fonts",
    "right.animation": "Animation",
    "right.animationTooltip": "Browse templates and edit selected-element animation",
    "right.animationTemplates": "Animation templates",
    "right.animationProperties": "Animation properties",
    "right.catalog": "Effects",
    "right.catalogTooltip": "Insert opening, ending, and transition effect clips",
    "right.effects": "Scenes",
    "right.effectsTooltip": "Browse transition and background scenes",
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
    "right.openingProperties": "Opening properties...",
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
    "header.edit": "编辑",
    "header.preview": "预览",
    "header.previewComingSoon": "预览功能即将开放",
    "preview.aiEditingWarning": "AI 修改视频中，建议不要手动修改",
    "header.undo": "撤销",
    "header.redo": "重做",
    "header.capture": "截图",
    "header.capturing": "截图中...",
    "header.captureCurrentFrame": "截取当前帧",
    "header.saveAsTemplate": "保存为作品模板",
    "header.templates": "模板",
    "header.askAi": "交给 AI",
    "header.openRepository": "打开项目仓库",
    "header.reloadStudio": "重新加载视频工作室",
    "header.inspector": "属性",
    "header.renderInProgress": "已有渲染任务正在进行",
    "header.renderExport": "打开导出设置",
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
    "assets.import": "导入",
    "assets.source": "来源",
    "assets.sourceUnavailable": "暂不支持选择来源",
    "assets.searchPlaceholder": "搜索素材...",
    "assets.dropUpload": "拖放文件以上传",
    "assets.mediaTypes": "图片、视频、音频和字体",
    "assets.dropMediaHere": "将媒体文件拖到这里",
    "assets.filterAll": "全部",
    "assets.filterUsed": "使用中",
    "assets.filterUnused": "未使用",
    "assets.categoryAudio": "音频",
    "assets.categoryImages": "图片",
    "assets.categoryVideo": "视频",
    "assets.categoryFonts": "字体",
    "animation.searchPlaceholder": "搜索动画...",
    "animation.searchLabel": "搜索动画",
    "animation.selected": "已选中：{label}",
    "animation.filterAll": "全部",
    "animation.filterBoxAutomation": "盒子与自动化",
    "animation.filterText": "文字动画",
    "animation.used": "已使用",
    "animation.unused": "未使用",
    "animation.inUse": "已应用",
    "animation.apply": "应用",
    "animation.edit": "编辑",
    "animation.remove": "取消应用",
    "animation.close": "关闭",
    "animation.start": "开始",
    "animation.end": "结束",
    "animation.speed": "倍速",
    "animation.loop": "循环播放",
    "animation.done": "完成",
    "animation.saving": "保存中...",
    "animation.saveError": "动画未能保存，请重试。",
    "animation.noMatches": "没有匹配的动画",
    "animation.selectElement": "请先在视频播放区选中元素",
    "animation.applied": "动画已应用",
    "animation.updated": "动画已更新",
    "animation.removed": "动画已取消应用",
    "sidebar.selectFile": "选择一个文件进行编辑",
    "sidebar.lint": "检查",
    "sidebar.linting": "检查中...",
    "right.resizeInspector": "调整检查器面板宽度",
    "right.resizePanes": "调整图层与设计面板高度",
    "right.design": "图层",
    "right.designTooltip": "元素风格和属性",
    "right.voice": "配音",
    "right.voiceTooltip": "视频配音设置",
    "right.style": "主题",
    "right.styleTooltip": "视频设计系统",
    "right.assets": "素材",
    "right.assetsTooltip": "视频、图片、音频和字体",
    "right.animation": "动画",
    "right.animationTooltip": "浏览模板并编辑所选元素动画",
    "right.animationTemplates": "动画模板",
    "right.animationProperties": "动画属性",
    "right.catalog": "特效",
    "right.catalogTooltip": "插入开头、结尾和转场特效片段",
    "right.effects": "场景",
    "right.effectsTooltip": "浏览转场场景和背景场景",
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
    "right.openingProperties": "正在打开属性...",
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

/**
 * Labels owned by the embedded HyperFrames editor.
 *
 * The editor predates iPolloWork's locale bridge and many inspector controls
 * still pass their English copy through shared UI primitives. Keeping those
 * literals here lets the primitives translate both their visible labels and
 * accessible names without changing the CSS/property values they edit.
 */
const studioLiteralZh: Record<string, string> = {
  "3D Transform": "3D 变换",
  "Add a new animation effect to this element": "为此元素添加动画效果",
  "Add animation": "添加动画",
  "Add keyframe": "添加关键",
  "Add keyframe at playhead": "当前片段时刻添加关键帧",
  "Add keyframe at playhead (K)": "在播放头位置添加关键帧（K）",
  "Add text": "添加文本",
  "Add text field": "添加文本字段",
  Adjust: "调整",
  Align: "对齐",
  "Align center": "居中对齐",
  "Align left": "左对齐",
  "Align right": "右对齐",
  "All project media": "项目中的全部媒体",
  Alpha: "透明度",
  "Alpha percent": "透明度百分比",
  Angle: "角度",
  Animation: "动画",
  Animate: "变化到",
  "Animate In": "从设定值进入",
  "From → To": "起始 → 结束",
  Set: "立即设置",
  "Set Instantly": "立即设置",
  "Instantly snap to these values — no transition": "立即切换到这些值，不产生过渡动画",
  "Smoothly animate the element to these target values": "让元素平滑变化到目标值",
  "Element starts at these values and transitions to its normal state":
    "元素从这些值开始，并过渡到正常状态",
  "Animate from one state to another": "让元素从一种状态变化到另一种状态",
  "+ Add effect": "+ 添加动画",
  "+ Effect": "+ 动画属性",
  "+ From property": "+ 起始属性",
  "Add another animated property to this effect": "为此动画再添加一个变化属性",
  "Add a from-state property": "添加起始状态属性",
  "Animation editing is disabled": "动画编辑已停用",
  "Arc Motion": "弧线运动",
  "Auto-Rotate": "自动旋转",
  "Add at least 2 position keyframes to enable arc motion.":
    "至少添加 2 个位置关键帧，才能启用弧线运动。",
  "Disable arc motion": "关闭弧线运动",
  "Enable arc motion": "启用弧线运动",
  "Disable auto-rotate along path": "关闭沿路径自动旋转",
  "Rotate element to follow path tangent": "让元素沿路径方向自动旋转",
  Curviness: "弯曲度",
  "Reset to auto-generated control points": "恢复自动生成的控制点",
  "Custom curve": "自定义曲线",
  "Speed curve": "速度曲线",
  "time →": "时间 →",
  "cubic-bezier control points": "三次贝塞尔曲线控制点",
  "Playing…": "播放中…",
  Preview: "预览",
  "Per-keyframe easing": "逐关键帧缓动",
  "Apply one ease to all segments": "为所有区段应用同一种缓动",
  "Apply one ease to every segment (clears per-segment overrides)":
    "为所有区段应用同一种缓动，并清除各区段的单独设置",
  "Set all…": "全部设置…",
  "Delete Keyframe": "删除关键帧",
  "Delete All Keyframes": "删除全部关键帧",
  "Move to Playhead": "移到播放头",
  "Computed value — edit it in the Code tab.": "这是计算值，请在代码标签页中编辑。",
  "Unroll to edit": "展开后编辑",
  "Rewrite the helper/loop into explicit tweens so this keyframe edits directly":
    "将辅助函数或循环展开为明确动画，以便直接编辑此关键帧",
  "Choose property…": "选择属性…",
  "Visible — click to hide": "当前显示，点击隐藏",
  "Hidden — click to show": "当前隐藏，点击显示",
  Bright: "提亮",
  Gray: "灰度",
  Inset: "内缩",
  "Move X": "水平移动",
  "Move Y": "垂直移动",
  "Move Z": "前后移动",
  Rotate: "旋转",
  "Rotate X": "绕 X 轴旋转",
  "Rotate Y": "绕 Y 轴旋转",
  "Rotate Z": "绕 Z 轴旋转",
  Perspective: "透视",
  "Transform Origin": "变换原点",
  Visibility: "可见性",
  Visible: "显示",
  "Stretch X": "水平拉伸",
  Filter: "滤镜",
  "Clip Path": "裁剪路径",
  Background: "背景色",
  "Border Color": "边框颜色",
  "Font Size": "字号",
  Tracking: "字间距",
  "Skew X": "水平倾斜",
  "Skew Y": "垂直倾斜",
  "Counter Value": "计数终值",
  "Move left/right (negative = left, positive = right)": "水平移动，负值向左，正值向右",
  "Move up/down (negative = up, positive = down)": "垂直移动，负值向上，正值向下",
  "How visible (0 = invisible, 1 = fully visible)": "可见程度，0 为完全透明，1 为完全显示",
  "Size multiplier (1 = normal, 2 = double, 0.5 = half)":
    "缩放倍数，1 为原始大小，2 为两倍，0.5 为一半",
  "Horizontal stretch (1 = normal)": "水平拉伸倍数，1 为正常",
  "Vertical stretch (1 = normal)": "垂直拉伸倍数，1 为正常",
  "Spin angle (360 = full rotation)": "旋转角度，360 为旋转一周",
  "Move forward/back along the Z axis": "沿 Z 轴前后移动",
  "Rotate around the horizontal X axis": "绕水平 X 轴旋转",
  "Rotate around the vertical Y axis": "绕垂直 Y 轴旋转",
  "Rotate around the screen-facing Z axis": "绕面向屏幕的 Z 轴旋转",
  "3D depth context for child elements; set it on a parent when rotating children in 3D":
    "子元素的 3D 透视深度；对子元素进行 3D 旋转时，请在父元素上设置",
  "3D depth for THIS element's own X/Y rotation — lower = stronger perspective (try 600–1000)":
    "当前元素绕 X/Y 轴旋转时的 3D 透视深度；数值越小透视越强，建议 600–1000",
  "Pivot point for transforms, for example center center or 50% 50%":
    "变换的中心点，例如 center center 或 50% 50%",
  "Element width": "元素宽度",
  "Element height": "元素高度",
  "Like opacity but hides element completely at 0": "类似不透明度，但为 0 时会完全隐藏元素",
  "Show or hide the element": "显示或隐藏元素",
  "End value for a number roll-up (the number it counts up/down to)":
    "数字滚动的结束值，也就是最终计数到的数字",
  Length: "时长",
  "Starts at": "开始时间",
  Speed: "速度",
  "How long this effect lasts": "此动画持续多长时间",
  "When this effect begins on the timeline": "此动画在时间轴上的开始时间",
  "When this effect plays": "此动画的播放时间",
  "Derived from this animation's position inside its owner clip":
    "根据动画在所属片段中的位置自动判断",
  Shared: "共享",
  "This animation uses a shared selector. It is read-only here so editing one element cannot change another. Add a new effect to create an independent animation for this element.":
    "此动画使用共享选择器，因此在这里为只读，避免修改一个元素时影响其他元素。请添加新动画，为当前元素创建独立动画。",
  "Keyframed — click a segment below to edit its curve": "已使用关键帧，点击下方区段可编辑速度曲线",
  "Copy description to clipboard — paste into agent prompts":
    "复制动画说明，可粘贴到 Agent 提示词中",
  Copied: "已复制",
  From: "起始状态",
  To: "结束状态",
  Remove: "移除",
  "Remove this animation": "移除此动画",
  "drag to move": "拖动以移动",
  Reset: "重置",
  Appearance: "外观",
  Apply: "应用",
  Applying: "正在应用",
  "Applied cutout": "抠图已应用",
  balanced: "均衡",
  best: "最佳",
  "Ask AI": "交给AI",
  "Ask AI about selected element": "让 AI 处理所选元素",
  "Copy prompt to AI agent": "将提示词复制给 AI Agent",
  "Describe what you want to change…": "描述你想修改的内容…",
  "Context included in prompt": "提示词中包含的上下文",
  "Copy prompt": "复制提示词",
  Close: "关闭",
  "Close right panel": "关闭右侧面板",
  Assets: "素材",
  "Assets tab": "素材标签页",
  Audio: "音频",
  Images: "图片",
  Video: "视频",
  Fonts: "字体",
  "Drop files to upload": "拖入文件以上传",
  "Images, video, audio, and fonts": "图片、视频、音频和字体",
  "Source selection is not available yet": "暂不支持切换素材来源",
  "Project 01": "项目 01",
  Import: "导入",
  "Search assets…": "搜索素材…",
  All: "全部",
  "In use": "使用中",
  Unused: "未使用",
  "Drop media files here": "将媒体文件拖到这里",
  Backdrop: "背景模糊",
  "BG plate": "背景底图",
  "Black Point": "黑场",
  Blend: "混合模式",
  Blur: "模糊",
  Bold: "粗体",
  "Bring forward": "上移一层",
  "Bring to front": "置于顶层",
  "Bulleted list": "项目符号列表",
  Canvas: "画布",
  Cancel: "取消",
  Cancelled: "已取消",
  "Capture current frame": "截取当前帧",
  "Capturing current frame": "正在截取当前帧",
  "Choose image media": "选择图片素材",
  "Choose media": "选择媒体",
  "Clear in-point": "清除入点",
  "Clear out-point": "清除出点",
  "Clear selection": "清除选择",
  "Click any element on the canvas to edit it, or drag to select several.":
    "单击画布中的元素即可编辑，也可以拖动框选多个元素。",
  "Close all gaps": "关闭所有间隙",
  "Close color picker": "关闭颜色选择器",
  "Close gap": "关闭间隙",
  "Close gap(s)": "关闭间隙",
  "Close gradient editor": "关闭渐变编辑器",
  Collapse: "收起",
  Color: "颜色",
  Contrast: "对比度",
  "Color grading": "调色",
  "Compare original": "对比原图",
  "Compositions tab": "合成标签页",
  Content: "内容",
  contain: "适应",
  cover: "填满",
  Copy: "复制",
  "Copy element": "复制元素",
  "Copy grade to": "将调色复制到",
  "Copy media path": "复制媒体路径",
  "Copy Prompt": "复制提示词",
  "Copy to Agent": "发给 Agent",
  Crop: "裁剪",
  "Crop a side": "裁剪一侧",
  "Current file media": "当前文件中的媒体",
  "Custom LUT": "自定义 LUT",
  Cutout: "抠图",
  Circle: "圆形",
  Column: "纵向",
  Custom: "自定义",
  "Cut element": "剪切元素",
  "Delete selected element": "删除所选元素",
  "Delete selected keyframe": "删除所选关键帧",
  Delete: "删除",
  "Delete?": "确认删除？",
  "Delete render file": "删除渲染文件",
  Download: "下载",
  Depth: "深度",
  Direction: "方向",
  "Drag to adjust the view": "拖动调整视角",
  "Drag vertically to reorder this layer": "上下拖动以调整图层顺序",
  "Drop media files to import": "拖入媒体文件即可导入",
  "Drop media here or describe your video to start": "将媒体拖到这里，或描述视频内容以开始创作",
  Duration: "时长",
  Edit: "编辑",
  Editing: "编辑",
  "Edit gradient": "编辑渐变",
  End: "结束",
  "Enter to copy": "Enter 复制",
  Entrance: "入场",
  "External URL": "外部网址",
  Effects: "效果",
  Export: "导出",
  Format: "格式",
  Resolution: "分辨率",
  "Frame rate": "帧率",
  Draft: "草稿",
  Standard: "标准",
  "High Quality": "高质量",
  "About video formats": "关于视频格式",
  "Best for general use. Smallest file, universal playback.":
    "适合一般用途。文件最小，兼容各种播放器。",
  "Transparent video. Works in Final Cut Pro, DaVinci Resolve, and most video editors. Large files.":
    "支持透明背景，适用于 Final Cut Pro、DaVinci Resolve 和大多数视频编辑器，文件较大。",
  "Transparent video for web. Smaller than MOV but limited editor support.":
    "适合网页使用的透明视频，文件比 MOV 小，但视频编辑器支持有限。",
  "Fast render, smaller file": "渲染更快，文件更小",
  "Good quality, balanced file size": "画质与文件大小均衡",
  "Best quality, larger file": "画质最佳，文件较大",
  Exposure: "曝光",
  Failed: "失败",
  fast: "快速",
  Feather: "羽化",
  Fill: "填充",
  "Fill type": "填充类型",
  Finishing: "细节处理",
  Fit: "适应",
  Flex: "弹性布局",
  Front: "正面",
  "Flip horizontally (unavailable)": "水平翻转（暂不可用）",
  "Flip vertically (unavailable)": "垂直翻转（暂不可用）",
  "Flip horizontally": "水平翻转",
  "Flip vertically": "垂直翻转",
  Font: "字体",
  "Font family": "字体系列",
  "Font style": "字体样式",
  Gap: "间距",
  Grade: "调色",
  Gradient: "渐变",
  Hex: "十六进制",
  "Gradient color format": "渐变颜色格式",
  Grain: "颗粒",
  "Grain settings": "颗粒设置",
  "Grain Size": "颗粒大小",
  "Grid spacing": "网格间距",
  "Group elements": "组合元素",
  "Group selection": "组合所选元素",
  "Has audio track": "包含音轨",
  "Hex color": "十六进制颜色",
  "Hold to show original": "按住查看原图",
  Highlights: "高光",
  Hue: "色相",
  Image: "图片",
  "Image fill": "图片填充",
  "Import .cube LUT": "导入 .cube LUT",
  "Import local font files": "导入本地字体文件",
  "Increase indent": "增加缩进",
  "Invert mask": "反转蒙版",
  Italic: "斜体",
  "Jump to frame": "跳转到帧",
  "Jump to in-point": "跳转到入点",
  "Jump to out-point": "跳转到出点",
  Justify: "分布",
  Keyframes: "关键帧",
  "Layer blur": "图层模糊",
  Layout: "布局",
  Left: "左侧",
  "Letter spacing": "字间距",
  "Line height": "行高",
  "List formatting": "列表格式",
  "Loading composition": "正在加载合成",
  "Locked in the composition source": "已在合成源文件中锁定",
  "Low Angle": "低角度",
  "LUT strength": "LUT 强度",
  Mask: "蒙版",
  "Mask circle": "蒙层圆形",
  "Mask rectangle": "蒙层矩形",
  "Mask inversion is not supported by the current clip-path renderer":
    "当前裁剪路径渲染器不支持反转蒙版",
  "Media start": "媒体起点",
  Media: "媒体",
  Midpoint: "中点",
  "Move element / add keyframe": "移动元素或添加关键帧",
  "Move entire animation path": "移动整条动画路径",
  "No fill": "无填充",
  "No fonts found.": "未找到字体。",
  "No gap here": "此处没有间隙",
  "No gaps on this track": "此轨道没有间隙",
  "No layers": "没有图层",
  "No compositions found": "未找到合成",
  "No renders yet": "还没有导出记录",
  "No stable source target is available": "没有可稳定定位的源元素",
  "No image assets yet. Upload one here and Studio will also add it to the Assets tab.":
    "还没有图片素材。上传后，Studio 也会将它加入素材标签页。",
  None: "无",
  "Nothing selected": "未选择任何元素",
  "Numbered list": "编号列表",
  Opacity: "不透明度",
  "Open the parent composition to edit this nested layer": "打开父级合成以编辑此嵌套图层",
  "Pick color from screen": "从屏幕取色",
  Pixelate: "像素化",
  Loop: "循环播放",
  Muted: "静音",
  "Playback rate": "播放速度",
  "Playback speed": "播放速度",
  Playback: "播放",
  Panels: "面板",
  "Play / Pause": "播放或暂停",
  "Play backward": "反向播放",
  "Play forward": "正向播放",
  "Paste element": "粘贴元素",
  Position: "位置",
  "Preparing preview assets": "正在准备预览素材",
  Preset: "预设",
  Preparing: "正在准备",
  Processing: "处理中",
  "Post-processing": "后处理",
  "Project asset": "项目素材",
  Quality: "质量",
  Radius: "圆角",
  Rectangle: "矩形",
  Rate: "速率",
  "Record gesture": "录制手势",
  "Record a gesture": "录制手势",
  "Record gesture (R)": "录制手势（R）",
  "Record x / y position": "录制 X / Y 位置",
  "Record z depth": "录制 Z 轴深度",
  "Record rotationX / rotationY": "录制 X / Y 轴旋转",
  "Record rotation": "录制旋转",
  "Remove animation": "移除动画",
  "Remove background": "移除背景",
  "Remove background and save a transparent asset": "移除背景并保存透明素材",
  "Remove BG": "移除背景",
  "Remove keyframe at playhead": "移除播放头位置的关键帧",
  "Remove keyframe at playhead (K)": "移除播放头位置的关键帧（K）",
  "Remove text field": "移除文本字段",
  "Remove — fall back to default": "移除并恢复默认值",
  "Reset 3D orientation": "重置 3D 方向",
  "Reset 3D transform": "重置 3D 变换",
  "Reset color grading": "重置调色",
  "Reset video to fit": "缩放视频以适应画布",
  "Rename clip": "重命名片段",
  "Couldn't rename clip. Try again.": "片段重命名保存失败，请重试。",
  Retry: "重试",
  "Rendering…": "正在渲染…",
  Rendering: "正在渲染",
  Keep: "保留",
  "just now": "刚刚",
  "Preparing…": "正在准备…",
  "Hide finished": "隐藏已完成项目",
  "Hide finished renders from this list (files stay on disk)":
    "从列表中隐藏已完成项目（文件仍保留在磁盘上）",
  "Dismiss error": "关闭错误提示",
  "Reverse gradient": "反转渐变",
  "Rotate clockwise": "顺时针旋转",
  Rotation: "旋转",
  Right: "右侧",
  Row: "横向",
  Roughness: "粗糙度",
  Roundness: "圆度",
  Saturation: "饱和度",
  Save: "保存",
  "Saving…": "保存中…",
  "Saturation and brightness": "饱和度与亮度",
  "Send backward": "下移一层",
  "Send to back": "置于底层",
  Shadow: "阴影",
  Shadows: "阴影",
  Tint: "色调",
  Vibrance: "自然饱和度",
  "Shortcuts and tools": "快捷键与工具",
  Size: "大小",
  "Snap to grid": "吸附到网格",
  "Snapping enabled": "吸附已开启",
  "Snapping disabled": "吸附已关闭",
  "Grid visible (G)": "网格已显示（G）",
  "Grid hidden (G)": "网格已隐藏（G）",
  Solid: "纯色",
  "Solid color": "纯色",
  Source: "来源",
  Start: "开始",
  Stop: "停止",
  "Step 1 frame": "前进或后退 1 帧",
  "Step 10 frames": "前进或后退 10 帧",
  "Set in-point": "设置入点",
  "Set out-point": "设置出点",
  Strength: "强度",
  Strikethrough: "删除线",
  Stroke: "描边",
  "Stroke color": "描边颜色",
  "Stroke style": "描边样式",
  Style: "样式",
  "Text alignment": "文本对齐",
  "Text formatting": "文本格式",
  Text: "文本",
  Timeline: "时间轴",
  "Timeline zoom": "时间轴缩放",
  Timing: "时间",
  "Toggle grid": "显示或隐藏网格",
  "Toggle snapping": "开启或关闭吸附",
  "Toggle mute": "切换静音",
  "Toggle loop": "切换循环播放",
  Ungroup: "取消组合",
  "Ungroup (⌘⇧G)": "取消组合（⌘⇧G）",
  "Copy element info to clipboard": "将元素信息复制到剪贴板",
  "Copied!": "已复制！",
  "Hide all": "全部隐藏",
  "Select a single element to edit its properties": "请选择单个元素以编辑属性",
  "shift-click to add or remove": "按住 Shift 单击可添加或移除",
  "Upload image": "上传图片",
  "Upload image asset": "上传图片素材",
  "Vignette settings": "暗角设置",
  Vignette: "暗角",
  View: "视角",
  Volume: "音量",
  Warmth: "色温",
  Weight: "字重",
  Width: "宽度",
  "Z-index": "层级",
  "→ Row": "→ 横向",
  Working: "处理中",
  Uploading: "正在上传",
  "Uploading…": "正在上传…",
  "Choose Media": "选择媒体",
  "Select a project-local image or video asset": "请选择项目内的图片或视频素材",
  "Select a clip and place the playhead inside it": "请选择片段，并将播放头移到片段内部",
  "Select an animated element to add a keyframe": "请选择带动画的元素后添加关键帧",
  "Inferred from this element's animation — edit to pin an explicit clip range.":
    "当前时间范围根据元素动画推算；编辑后将保存为明确的片段范围。",
  "This file has multiple GSAP timelines. Animation editing is disabled to prevent data loss — consolidate into a single timeline to enable editing.":
    "此文件包含多条 GSAP 时间轴。为避免数据丢失，动画编辑已停用；请合并为一条时间轴后再编辑。",
  "This timeline uses a computed key the editor can't resolve statically.":
    "此时间轴使用了编辑器无法静态解析的计算属性名。",
  'This timeline uses a computed key (window.__timelines[variable]) the editor can\'t resolve statically. Use a string-literal key (window.__timelines["id"]) or a variable declaration (const tl = gsap.timeline()) to enable editing.':
    '此时间轴使用了编辑器无法静态解析的计算属性名（window.__timelines[variable]）。请改用字符串键（window.__timelines["id"]）或变量声明（const tl = gsap.timeline()）后再编辑。',
  "This layer has no valid editable duration": "此图层没有有效的可编辑时长",
  "This row contains multiple clips; reorder clips individually":
    "此行包含多个片段，请分别调整顺序",
  "Timing is inferred; the first edit saves explicit timing":
    "当前时间为自动推算，首次编辑后将保存明确时间",
  Editable: "可编辑",
  "Work area": "工作区间",
  "Gesture recording modifiers": "手势录制辅助键",
  "In-point": "入点",
  "Out-point": "出点",
  Go: "跳转",
  "Describe your video to start creating": "描述你的视频内容以开始创作",
  "A clip on this track can't be moved": "此轨道中有片段无法移动",
  center: "居中",
  top: "顶部",
  bottom: "底部",
  left: "左侧",
  right: "右侧",
  "left top": "左上",
  "right top": "右上",
  "left bottom": "左下",
  "right bottom": "右下",
  fill: "拉伸填满",
  "scale-down": "缩小适应",
  "White Point": "白场",
  Neutral: "中性",
  "Natural Lift": "自然提亮",
  "Fresh Pop": "清新鲜亮",
  "Warm Daylight": "暖调日光",
  "Clean Studio": "影棚清透",
  "Skin Soft": "柔和肤色",
  "Food Pop": "美食鲜亮",
  "Night Lift": "夜景提亮",
  "Muted Editorial": "低饱和编辑风",
  "Vintage Wash": "复古淡彩",
  "Mono Clean": "清透黑白",
  "Mono Fade": "柔淡黑白",
  "Warm Clean": "暖调清透",
  "Cool Clean": "冷调清透",
  "Soft Boost": "柔和增强",
  "Bright Pop": "明亮鲜活",
  "Deep Contrast": "深度对比",
  "SDR preview": "SDR 预览",
  "These controls use the current SDR shader preview path. Render may stay HDR-tagged, but this is not true HDR color grading yet.":
    "这些控件使用当前的 SDR 着色器预览。渲染结果可能仍保留 HDR 标记，但目前还不是真正的 HDR 调色。",
  "Zoom timeline in": "放大时间轴",
  "Zoom timeline out": "缩小时间轴",
  "Split at playhead": "在播放头位置分割",
  "Split at playhead (S)": "在播放头位置分割（S）",
  "Split clip at playhead": "当前片段时刻分割",
  Undo: "撤销",
  Redo: "重做",
  "Composition canvas": "合成画布",
  "Reposition crop": "调整裁剪位置",
  "Rotate selection": "旋转所选元素",
  "Timeline layer": "时间轴图层",
  "frame number": "帧编号",
  Captions: "字幕",
  Dismiss: "关闭",
  Transform: "变换",
  Scale: "缩放",
  Ease: "缓动",
  Stagger: "错开",
  Intensity: "强度",
  Highlight: "强调",
  Exit: "退场",
  Design: "设计",
  Send: "发送",
  "Select caption words to edit their style": "请选择字幕文字以编辑样式",
  "Select a caption group to edit animations": "请选择字幕组以编辑动画",
  "Apply to all groups": "应用到所有字幕组",
  "Thanks for the feedback!": "感谢你的反馈！",
  "Any details? (enter to send, esc to close)": "还有什么细节？（回车发送，Esc 关闭）",
  "Recommend HyperFrames?": "愿意推荐 HyperFrames 吗？",
  "Console errors in preview": "预览中的控制台错误",
  "Fix these runtime console errors from the composition preview":
    "修复合成预览中的这些运行时控制台错误",
  "Something went wrong": "出现了问题",
  "Try again": "重试",
  "Reload Studio": "重新加载工作台",
  "Element editing": "元素编辑",
  "Edit element text": "编辑元素文本",
  "Open Design properties": "打开设计属性",
  "Composition navigation": "合成导航",
  "Back (Esc, or double-click empty timeline)": "返回（按 Esc 或双击时间轴空白处）",
  "Back to parent composition": "返回上一级合成",
  "Resize timeline (arrow keys)": "调整时间轴高度（方向键）",
  "Resize layer panel (arrow keys)": "调整图层面板宽度（方向键）",
  "Close preview": "关闭预览",
  none: "无",
  fade: "淡入淡出",
  "slide-up": "向上滑动",
  "slide-down": "向下滑动",
  "slide-left": "向左滑动",
  "slide-right": "向右滑动",
  pop: "弹出",
  slam: "冲击",
  bounce: "弹跳",
  typewriter: "打字机",
  "blur-in": "模糊进入",
  flip: "翻转",
  drop: "下落",
  "color-change": "颜色变化",
  "scale-pop": "缩放弹出",
  "glow-pulse": "光晕脉冲",
  "underline-sweep": "下划线扫过",
  "background-fill": "背景填充",
  scatter: "散开",
  collapse: "收拢",
  "blur-out": "模糊退出",
  shrink: "缩小",
};

export function translateStudioLiteral(locale: StudioLocale, text: string): string {
  if (locale !== "zh" || !text) return text;
  const exact = studioLiteralZh[text];
  if (exact) return exact;

  const effectCount = text.match(/^(\d+) effects?$/);
  if (effectCount) return `${effectCount[1]} 个效果`;
  const stopRecording = text.match(/^Stop recording ([\d.]+s)$/);
  if (stopRecording) return `停止录制（${stopRecording[1]}）`;
  const collapse = text.match(/^Collapse (.+)$/);
  if (collapse) return `收起 ${translateStudioLiteral(locale, collapse[1])}`;
  const undo = text.match(/^Undo (.+)$/);
  if (undo) return `撤销：${translateStudioLiteral(locale, undo[1])}`;
  const redo = text.match(/^Redo (.+)$/);
  if (redo) return `重做：${translateStudioLiteral(locale, redo[1])}`;
  const colorFormat = text.match(/^(.+) color format$/);
  if (colorFormat) return `${translateStudioLiteral(locale, colorFormat[1])}格式`;
  const gradientStop = text.match(/^Select gradient stop (\d+)$/);
  if (gradientStop) return `选择第 ${gradientStop[1]} 个渐变色标`;
  const recommendedColor = text.match(/^Use recommended color (.+)$/);
  if (recommendedColor) return `使用推荐颜色 ${recommendedColor[1]}`;
  const selectedElements = text.match(/^(\d+) elements selected$/);
  if (selectedElements) return `已选择 ${selectedElements[1]} 个元素`;
  const selectedWords = text.match(/^(\d+) words?$/);
  if (selectedWords) return `${selectedWords[1]} 个词`;
  const assetPreview = text.match(/^Preview: (.+)$/);
  if (assetPreview) return `预览：${assetPreview[1]}`;
  const numberedAnimation = text.match(/^Animation (\d+)$/);
  if (numberedAnimation) return `动画 ${numberedAnimation[1]}`;
  const removeAnimation = text.match(/^Remove animation (\d+)$/);
  if (removeAnimation) return `移除第 ${removeAnimation[1]} 个动画`;
  const generatedTween = text.match(/^Generated by (.+) — not directly editable\.$/);
  if (generatedTween) return `由 ${generatedTween[1]} 生成，无法直接编辑。`;
  const segmentCurviness = text.match(/^Segment (\d+) curviness$/);
  if (segmentCurviness) return `第 ${segmentCurviness[1]} 段弯曲度`;
  const segment = text.match(/^Segment (\d+)$/);
  if (segment) return `第 ${segment[1]} 段`;
  const convertKeyframes = text.match(/^Convert (.+) to keyframes$/);
  if (convertKeyframes)
    return `将${translateStudioLiteral(locale, convertKeyframes[1])}转换为关键帧`;
  const removeKeyframe = text.match(/^Remove (.+) keyframe$/);
  if (removeKeyframe) return `移除${translateStudioLiteral(locale, removeKeyframe[1])}关键帧`;
  const addKeyframe = text.match(/^Add (.+) keyframe$/);
  if (addKeyframe) return `添加${translateStudioLiteral(locale, addKeyframe[1])}关键帧`;
  const removeFromProperty = text.match(/^Remove from-(.+)$/);
  if (removeFromProperty)
    return `移除起始状态的${translateStudioLiteral(locale, removeFromProperty[1])}`;
  const readOnlyAnimation = text.match(/^(Entrance|Loop|Exit) animation \(read-only\)$/);
  if (readOnlyAnimation)
    return `${translateStudioLiteral(locale, readOnlyAnimation[1])}动画（只读）`;
  const moveAnimation = text.match(/^Move (entrance|loop|exit) animation$/);
  if (moveAnimation)
    return `移动${translateStudioLiteral(
      locale,
      moveAnimation[1][0].toUpperCase() + moveAnimation[1].slice(1),
    )}动画`;
  const dragAnimation = text.match(/^Drag to move (entrance|loop|exit) animation$/);
  if (dragAnimation)
    return `拖动以移动${translateStudioLiteral(
      locale,
      dragAnimation[1][0].toUpperCase() + dragAnimation[1].slice(1),
    )}动画`;
  for (const [prefix, translated] of [
    ["Expand ", "展开 "],
    ["Select ", "选择 "],
    ["Unlock ", "解锁 "],
    ["Lock ", "锁定 "],
    ["Show ", "显示 "],
    ["Hide ", "隐藏 "],
    ["Reorder ", "调整顺序："],
    ["Bound group: ", "绑定组："],
    ["Open ", "打开 "],
    ["Download ", "下载 "],
    ["Delete ", "删除 "],
    ["Render progress: ", "渲染进度："],
  ] as const) {
    if (text.startsWith(prefix)) return `${translated}${text.slice(prefix.length)}`;
  }
  const playbackSpeed = text.match(/^Playback speed (.+)$/);
  if (playbackSpeed) return `播放速度 ${playbackSpeed[1]}`;
  const renderCount = text.match(/^(\d+) renders?$/);
  if (renderCount) return `${renderCount[1]} 个导出项目`;
  const lastRender = text.match(/^Last render took (.+)$/);
  if (lastRender) return `上次渲染耗时 ${lastRender[1]}`;
  const timeAgo = text.match(/^(\d+)([mh]) ago$/);
  if (timeAgo) return `${timeAgo[1]} ${timeAgo[2] === "m" ? "分钟前" : "小时前"}`;
  return text;
}

type I18nContextValue = {
  locale: StudioLocale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  tx: (text: string) => string;
};

const StudioI18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key) => messages.en[key],
  tx: (text) => text,
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

  const tx = useCallback((text: string) => translateStudioLiteral(locale, text), [locale]);

  const value = useMemo(() => ({ locale, t, tx }), [locale, t, tx]);
  return <StudioI18nContext.Provider value={value}>{children}</StudioI18nContext.Provider>;
}

export function useStudioI18n() {
  return useContext(StudioI18nContext);
}
