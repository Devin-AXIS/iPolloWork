import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { extname, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

type PluginRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
};

type Modality = "image" | "video" | "audio" | "text";
type UpdateSource = "user" | "ai";
type AnnotationMap = Record<string, unknown>;

type ProjectRecord = {
  schemaVersion: 2;
  id: string;
  title: string;
  modality: Modality;
  sourcePath: string | null;
  mimeType: string | null;
  textContent: string | null;
  labels: string[];
  labelColors: Record<string, string>;
  annotations: AnnotationMap;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updateSource: UpdateSource;
};

type Launch = {
  workspaceRoot: string;
  expiresAt: number;
};

type TrainingTemplate = {
  id: string;
  title: string;
  modality: Modality;
  description: string;
  instruction: string;
  difficulty: "入门" | "进阶";
  labels: string[];
  labelColors: Record<string, string>;
  assetFile?: string;
  textContent?: string;
};

const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_LIST_FILES = 1_000;
const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 48;
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LABEL_COLOR_RE = /^#[0-9a-f]{6}$/i;
const moduleRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const appRoot = resolve(moduleRoot, moduleRoot.endsWith(`${sep}dist`) ? "../../app/dist" : "../app/dist");
const pdfAssetRoot = moduleRoot.endsWith(`${sep}dist`)
  ? resolve(moduleRoot, "pdfjs")
  : resolve(moduleRoot, "../node_modules/pdfjs-dist");

const trainingTemplates: readonly TrainingTemplate[] = [
  {
    id: "image-campus-safety",
    title: "校园安全帽检测",
    modality: "image",
    description: "识别校园施工实训图中的人物和安全帽。",
    instruction: "分别框选人物与安全帽，检查目标是否完整落在框内。",
    difficulty: "入门",
    labels: ["人物", "安全帽"],
    labelColors: { "人物": "#2563eb", "安全帽": "#f59e0b" },
    assetFile: "campus-safety-helmets.svg",
  },
  {
    id: "image-recycling",
    title: "垃圾分类识别",
    modality: "image",
    description: "对不同颜色的垃圾分类容器进行目标框选。",
    instruction: "框选每个垃圾桶，并按可回收物、厨余、有害或其他垃圾选择标签。",
    difficulty: "入门",
    labels: ["可回收物", "厨余垃圾", "有害垃圾", "其他垃圾"],
    labelColors: { "可回收物": "#2563eb", "厨余垃圾": "#16a34a", "有害垃圾": "#dc2626", "其他垃圾": "#64748b" },
    assetFile: "recycling-bins.svg",
  },
  {
    id: "image-plant-leaves",
    title: "植物叶片框选",
    modality: "image",
    description: "在植物实训图中区分叶片与病斑。",
    instruction: "使用矩形或多边形标记叶片，并单独标记黄色病斑。",
    difficulty: "进阶",
    labels: ["叶片", "病斑"],
    labelColors: { "叶片": "#16a34a", "病斑": "#f59e0b" },
    assetFile: "plant-leaves.svg",
  },
  {
    id: "video-classroom-behavior",
    title: "课堂行为片段",
    modality: "video",
    description: "标记课堂画面中的活动片段。",
    instruction: "沿时间轴标记移动、停留和互动片段，可添加关键帧。",
    difficulty: "入门",
    labels: ["移动", "停留", "互动"],
    labelColors: { "移动": "#2563eb", "停留": "#64748b", "互动": "#ea580c" },
    assetFile: "classroom-behavior.mp4",
  },
  {
    id: "video-sports-motion",
    title: "体育动作关键帧",
    modality: "video",
    description: "跟踪运动目标并标出动作阶段。",
    instruction: "标记准备、运动和完成三个时间片段，并选取关键帧。",
    difficulty: "进阶",
    labels: ["准备", "运动", "完成"],
    labelColors: { "准备": "#0891b2", "运动": "#f59e0b", "完成": "#16a34a" },
    assetFile: "sports-motion.mp4",
  },
  {
    id: "video-traffic-event",
    title: "交通事件切片",
    modality: "video",
    description: "对模拟道路视频中的交通事件分段。",
    instruction: "标记车辆进入、交汇和驶离画面的时间范围。",
    difficulty: "进阶",
    labels: ["车辆进入", "车辆交汇", "车辆驶离"],
    labelColors: { "车辆进入": "#2563eb", "车辆交汇": "#dc2626", "车辆驶离": "#16a34a" },
    assetFile: "traffic-event.mp4",
  },
  {
    id: "audio-mandarin-segmentation",
    title: "普通话语音分段",
    modality: "audio",
    description: "从普通话录音中划分语音与静音区间。",
    instruction: "在波形上分别标记有效语音和停顿，边界尽量贴近声音起止点。",
    difficulty: "入门",
    labels: ["有效语音", "静音"],
    labelColors: { "有效语音": "#2563eb", "静音": "#94a3b8" },
    assetFile: "mandarin-segmentation.m4a",
  },
  {
    id: "audio-campus-sounds",
    title: "校园声音分类",
    modality: "audio",
    description: "识别校园录音中的不同声音事件。",
    instruction: "标记上课铃、脚步或跑步声、校园广播对应的区间。",
    difficulty: "入门",
    labels: ["上课铃", "运动声", "校园广播"],
    labelColors: { "上课铃": "#f59e0b", "运动声": "#16a34a", "校园广播": "#2563eb" },
    assetFile: "campus-sounds.m4a",
  },
  {
    id: "audio-speaker-turns",
    title: "说话人片段",
    modality: "audio",
    description: "划分对话中不同角色的发言区间。",
    instruction: "按照老师和学生两个角色标记每段发言，不包含段间静音。",
    difficulty: "进阶",
    labels: ["老师", "学生"],
    labelColors: { "老师": "#4f46e5", "学生": "#16a34a" },
    assetFile: "speaker-turns.m4a",
  },
  {
    id: "text-news-entities",
    title: "新闻实体抽取",
    modality: "text",
    description: "从校园新闻中抽取人物、组织、地点和时间。",
    instruction: "选中正文中的实体文字并添加对应标签，最后填写文档分类。",
    difficulty: "入门",
    labels: ["人物", "组织", "地点", "时间"],
    labelColors: { "人物": "#2563eb", "组织": "#9333ea", "地点": "#16a34a", "时间": "#ea580c" },
    textContent: "8月5日下午，智慧未来学校人工智能社团在学校报告厅举办数据标注公开课。指导教师李老师带领三十名学生完成了图片与文字标注实训。",
  },
  {
    id: "text-sentiment",
    title: "评论情感分类",
    modality: "text",
    description: "判断多条课程评价中的情感倾向。",
    instruction: "选取具有情感含义的短语并标记正向、负向或中性，再填写文档分类。",
    difficulty: "入门",
    labels: ["正向", "负向", "中性"],
    labelColors: { "正向": "#16a34a", "负向": "#dc2626", "中性": "#64748b" },
    textContent: "这次实训步骤清楚，示例也很容易理解。视频加载稍微有点慢，但标注工具整体很顺手。我希望下一次能增加更多音频案例。",
  },
  {
    id: "text-notice-elements",
    title: "通知要素标注",
    modality: "text",
    description: "抽取校园通知中的关键执行要素。",
    instruction: "标记时间、地点、参与人和事项，注意不要把标点包含在区间内。",
    difficulty: "进阶",
    labels: ["时间", "地点", "参与人", "事项"],
    labelColors: { "时间": "#ea580c", "地点": "#16a34a", "参与人": "#2563eb", "事项": "#9333ea" },
    textContent: "请全体人工智能实训班学生于本周五14:00前往第二实训楼302室，参加多模态数据标注阶段测评，并携带学生证。",
  },
] as const;

const modalityFiles: Record<Exclude<Modality, "text">, {
  extensions: ReadonlySet<string>;
  maximumBytes: number;
  label: string;
}> = {
  image: {
    extensions: new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]),
    maximumBytes: 50 * 1024 * 1024,
    label: "图片",
  },
  video: {
    extensions: new Set([".mp4", ".mov", ".m4v", ".webm", ".ogv"]),
    maximumBytes: 2 * 1024 * 1024 * 1024,
    label: "视频",
  },
  audio: {
    extensions: new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]),
    maximumBytes: 500 * 1024 * 1024,
    label: "音频",
  },
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredString(input: Record<string, unknown>, key: string, maximum = 2_000): string {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  if (value.length > maximum) throw new Error(`${key} is too long`);
  return value;
}

function isModality(value: unknown): value is Modality {
  return value === "image" || value === "video" || value === "audio" || value === "text";
}

function validateProjectId(value: string): string {
  if (!PROJECT_ID_RE.test(value)) throw new Error("projectId must contain only letters, numbers, dots, underscores, or hyphens");
  return value;
}

function savedLabelColors(value: unknown, labels: string[]): Record<string, string> {
  const colors = object(value);
  if (!colors) return {};
  return Object.fromEntries(labels.flatMap((label) => {
    const color = colors[label];
    return typeof color === "string" && LABEL_COLOR_RE.test(color) ? [[label, color.toLowerCase()]] : [];
  }));
}

async function workspaceRoot(context: Record<string, unknown>): Promise<string> {
  const directory = requiredString(context, "directory", 4_000);
  const root = await realpath(resolve(directory));
  if (!(await stat(root)).isDirectory()) throw new Error("active workspace is not a directory");
  return root;
}

function pluginDirectory(root: string): string {
  return resolve(root, ".ipollowork", "plugins", "labelu-data-annotation");
}

function projectsDirectory(root: string): string {
  return resolve(pluginDirectory(root), "projects");
}

function uploadsDirectory(root: string): string {
  return resolve(pluginDirectory(root), "uploads");
}

function legacyTasksDirectory(root: string): string {
  return resolve(pluginDirectory(root), "tasks");
}

function projectPath(root: string, projectId: string): string {
  return resolve(projectsDirectory(root), `${validateProjectId(projectId)}.json`);
}

function legacyTaskPath(root: string, projectId: string): string {
  return resolve(legacyTasksDirectory(root), `${validateProjectId(projectId)}.json`);
}

function fileErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function projectFromPayload(payload: unknown): ProjectRecord {
  const record = object(payload);
  if (!record || typeof record.id !== "string" || typeof record.title !== "string") {
    throw new Error("saved annotation project is invalid");
  }
  const id = validateProjectId(record.id);
  const annotations = object(record.annotations) ?? {};
  const labels = Array.isArray(record.labels) ? record.labels.filter((value): value is string => typeof value === "string") : [];
  const labelColors = savedLabelColors(record.labelColors, labels);
  const revision = typeof record.revision === "number" && Number.isInteger(record.revision) ? record.revision : 0;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const updateSource: UpdateSource = record.updateSource === "ai" ? "ai" : "user";

  if (record.schemaVersion === 2 && isModality(record.modality)) {
    return {
      schemaVersion: 2,
      id,
      title: record.title,
      modality: record.modality,
      sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : null,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
      textContent: typeof record.textContent === "string" ? record.textContent : null,
      labels,
      labelColors,
      annotations,
      revision,
      createdAt,
      updatedAt,
      updateSource,
    };
  }

  if (record.schemaVersion === 1 && typeof record.sourcePath === "string") {
    return {
      schemaVersion: 2,
      id,
      title: record.title,
      modality: "image",
      sourcePath: record.sourcePath,
      mimeType: mimeType(record.sourcePath),
      textContent: null,
      labels: labels.length ? labels : ["目标"],
      labelColors,
      annotations,
      revision,
      createdAt,
      updatedAt,
      updateSource,
    };
  }

  throw new Error("saved annotation project is invalid");
}

async function readProject(root: string, projectId: string): Promise<ProjectRecord> {
  const currentPath = projectPath(root, projectId);
  const payload = await readFile(currentPath, "utf8").catch(async (error: unknown) => {
    if (fileErrorCode(error) !== "ENOENT") throw error;
    return readFile(legacyTaskPath(root, projectId), "utf8");
  });
  const project = projectFromPayload(JSON.parse(payload));
  if (project.id !== projectId) throw new Error("saved annotation project is invalid");
  return project;
}

async function writeProject(root: string, project: ProjectRecord): Promise<void> {
  const directory = projectsDirectory(root);
  await mkdir(directory, { recursive: true });
  const target = projectPath(root, project.id);
  const temporary = resolve(directory, `.${project.id}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function projectIds(root: string): Promise<string[]> {
  const names = new Set<string>();
  for (const directory of [projectsDirectory(root), legacyTasksDirectory(root)]) {
    const files = await readdir(directory).catch((error: unknown) => {
      if (fileErrorCode(error) === "ENOENT") return [];
      throw error;
    });
    for (const file of files) {
      if (file.endsWith(".json") && names.size < MAX_LIST_FILES) names.add(file.slice(0, -5));
    }
  }
  return [...names];
}

function annotationCounts(annotations: AnnotationMap): Record<string, number> {
  return Object.fromEntries(Object.entries(annotations).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.length];
    const nested = object(value);
    if (nested && Array.isArray(nested.spans)) return [key, nested.spans.length];
    return [key, value == null || value === "" ? 0 : 1];
  }));
}

function projectSummary(project: ProjectRecord) {
  const counts = annotationCounts(project.annotations);
  const annotationCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    id: project.id,
    title: project.title,
    modality: project.modality,
    revision: project.revision,
    updatedAt: project.updatedAt,
    updateSource: project.updateSource,
    annotationCount,
    annotationCounts: counts,
    status: annotationCount > 0 ? "in_progress" : "not_started",
  };
}

async function listProjects(root: string, limit: number): Promise<ReturnType<typeof projectSummary>[]> {
  const projects = await Promise.all((await projectIds(root)).map((id) => readProject(root, id)));
  return projects
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(projectSummary);
}

function annotationObject(value: unknown): AnnotationMap {
  const annotations = object(value);
  if (!annotations) throw new Error("annotations must be an object");
  if (Buffer.byteLength(JSON.stringify(annotations)) > MAX_JSON_BYTES) throw new Error("annotations are too large");
  return annotations;
}

type LabelDefinition = {
  name: string;
  color: string;
};

function labelDefinitions(value: unknown): LabelDefinition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LABELS) {
    throw Object.assign(new Error(`标签数量必须在 1-${MAX_LABELS} 个之间。`), { statusCode: 400 });
  }
  const names = new Set<string>();
  return value.map((entry) => {
    const record = object(entry);
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const color = typeof record?.color === "string" ? record.color.toLowerCase() : "";
    if (!name || name.length > MAX_LABEL_LENGTH) {
      throw Object.assign(new Error(`标签名称不能为空，且不能超过 ${MAX_LABEL_LENGTH} 个字符。`), { statusCode: 400 });
    }
    const comparable = name.toLocaleLowerCase();
    if (names.has(comparable)) {
      throw Object.assign(new Error(`标签“${name}”重复，请使用不同名称。`), { statusCode: 400 });
    }
    if (!LABEL_COLOR_RE.test(color)) {
      throw Object.assign(new Error(`标签“${name}”的颜色无效。`), { statusCode: 400 });
    }
    names.add(comparable);
    return { name, color };
  });
}

function labelReplacementMap(
  value: unknown,
  currentLabels: string[],
  nextLabels: string[],
): Map<string, string> {
  if (value === undefined) return new Map();
  const record = object(value);
  if (!record) throw Object.assign(new Error("标签替换规则无效。"), { statusCode: 400 });
  const current = new Set(currentLabels);
  const next = new Set(nextLabels);
  const replacements = new Map<string, string>();
  for (const [source, rawTarget] of Object.entries(record)) {
    const target = typeof rawTarget === "string" ? rawTarget.trim() : "";
    if (!current.has(source) || next.has(source) || !next.has(target)) {
      throw Object.assign(new Error(`标签“${source}”的替换目标无效。`), { statusCode: 400 });
    }
    replacements.set(source, target);
  }
  return replacements;
}

function labelUsageCounts(value: unknown, counts = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) {
    for (const entry of value) labelUsageCounts(entry, counts);
    return counts;
  }
  const record = object(value);
  if (!record) return counts;
  for (const [key, nested] of Object.entries(record)) {
    if (key === "label" && typeof nested === "string") {
      counts.set(nested, (counts.get(nested) ?? 0) + 1);
    } else {
      labelUsageCounts(nested, counts);
    }
  }
  return counts;
}

function replaceAnnotationLabelValue(value: unknown, replacements: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaceAnnotationLabelValue(entry, replacements));
  const record = object(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => {
    if (key === "label" && typeof nested === "string") {
      return [key, replacements.get(nested) ?? nested];
    }
    return [key, replaceAnnotationLabelValue(nested, replacements)];
  }));
}

function replaceAnnotationLabels(annotations: AnnotationMap, replacements: Map<string, string>): AnnotationMap {
  if (!replacements.size) return annotations;
  return Object.fromEntries(Object.entries(annotations).map(([key, value]) => [
    key,
    replaceAnnotationLabelValue(value, replacements),
  ]));
}

async function updateProject(
  root: string,
  projectId: string,
  annotations: unknown,
  expectedRevision: unknown,
  textContent: unknown,
): Promise<ProjectRecord> {
  const project = await readProject(root, validateProjectId(projectId));
  if (!Number.isInteger(expectedRevision) || expectedRevision !== project.revision) {
    throw Object.assign(
      new Error(`annotation revision conflict: expected ${String(expectedRevision)}, current ${project.revision}`),
      { statusCode: 409 },
    );
  }
  const nextText = typeof textContent === "string" ? textContent : project.textContent;
  if (nextText && Buffer.byteLength(nextText) > MAX_TEXT_BYTES) {
    throw Object.assign(new Error("text content is larger than 5 MB"), { statusCode: 413 });
  }
  const next: ProjectRecord = {
    ...project,
    annotations: annotationObject(annotations),
    textContent: project.modality === "text" ? nextText ?? "" : null,
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
    updateSource: "user",
  };
  await writeProject(root, next);
  return next;
}

async function updateProjectLabels(
  root: string,
  projectId: string,
  labels: unknown,
  replacements: unknown,
  expectedRevision: unknown,
): Promise<ProjectRecord> {
  const project = await readProject(root, validateProjectId(projectId));
  if (!Number.isInteger(expectedRevision) || expectedRevision !== project.revision) {
    throw Object.assign(
      new Error(`标签版本冲突：预期 ${String(expectedRevision)}，当前 ${project.revision}。请重新打开项目。`),
      { statusCode: 409 },
    );
  }
  const definitions = labelDefinitions(labels);
  const names = definitions.map((definition) => definition.name);
  const nextNames = new Set(names);
  const replacementMap = labelReplacementMap(replacements, project.labels, names);
  const usage = labelUsageCounts(project.annotations);
  for (const label of project.labels) {
    if (!nextNames.has(label) && (usage.get(label) ?? 0) > 0 && !replacementMap.has(label)) {
      throw Object.assign(
        new Error(`标签“${label}”仍被 ${String(usage.get(label))} 条标注使用，请先选择替换标签。`),
        { statusCode: 409 },
      );
    }
  }
  const next: ProjectRecord = {
    ...project,
    labels: names,
    labelColors: Object.fromEntries(definitions.map((definition) => [definition.name, definition.color])),
    annotations: replaceAnnotationLabels(project.annotations, replacementMap),
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
    updateSource: "user",
  };
  await writeProject(root, next);
  return next;
}

function safeWorkspaceFile(root: string, sourcePath: string): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("sourcePath must be a safe relative path inside the active workspace");
  }
  const target = resolve(root, normalized);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new Error("sourcePath must stay inside the active workspace");
  }
  return target;
}

async function projectMedia(root: string, project: ProjectRecord): Promise<string> {
  if (!project.sourcePath || project.modality === "text") throw new Error("project has no media file");
  const path = safeWorkspaceFile(root, project.sourcePath);
  const information = await stat(path);
  if (!information.isFile()) throw new Error("project media is missing");
  return path;
}

function defaultAnnotations(modality: Modality): AnnotationMap {
  if (modality === "image") return { point: [], line: [], rect: [], polygon: [], cuboid: [], text: [], tag: [] };
  if (modality === "video" || modality === "audio") return { segment: [], frame: [], text: [], tag: [] };
  return { spans: [], classification: "" };
}

function defaultLabels(modality: Modality): string[] {
  if (modality === "image") return ["目标"];
  if (modality === "video") return ["片段"];
  if (modality === "audio") return ["声音"];
  return ["实体"];
}

function trainingTemplateSummaries() {
  return trainingTemplates.map(({ assetFile: _assetFile, textContent: _textContent, ...template }) => ({
    ...template,
    labels: [...template.labels],
    labelColors: { ...template.labelColors },
  }));
}

function trainingTemplateAssetPath(assetFile: string): string {
  const directory = resolve(appRoot, "training-assets");
  const source = resolve(directory, assetFile);
  if (source === directory || !source.startsWith(`${directory}${sep}`)) {
    throw new Error("实训项目素材路径无效。");
  }
  return source;
}

async function createTrainingProject(root: string, templateId: unknown): Promise<ProjectRecord> {
  const idValue = typeof templateId === "string" ? templateId.trim() : "";
  const template = trainingTemplates.find((candidate) => candidate.id === idValue);
  if (!template) throw Object.assign(new Error("没有找到这个实训项目。"), { statusCode: 404 });

  const id = randomUUID();
  let sourcePath: string | null = null;
  let mediaMimeType: string | null = template.modality === "text" ? "text/plain; charset=utf-8" : null;
  if (template.assetFile) {
    const source = trainingTemplateAssetPath(template.assetFile);
    const information = await stat(source).catch(() => null);
    if (!information?.isFile()) throw new Error("实训项目素材缺失，请重新安装插件。");
    const uploads = uploadsDirectory(root);
    await mkdir(uploads, { recursive: true });
    const extension = extname(template.assetFile).toLowerCase();
    const target = resolve(uploads, `${id}${extension}`);
    const temporary = resolve(uploads, `.${id}.${randomUUID()}.tmp`);
    try {
      await copyFile(source, temporary);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    sourcePath = relative(root, target).replaceAll("\\", "/");
    mediaMimeType = mimeType(target);
  }

  const now = new Date().toISOString();
  const project: ProjectRecord = {
    schemaVersion: 2,
    id,
    title: template.title,
    modality: template.modality,
    sourcePath,
    mimeType: mediaMimeType,
    textContent: template.modality === "text" ? template.textContent ?? "" : null,
    labels: [...template.labels],
    labelColors: { ...template.labelColors },
    annotations: defaultAnnotations(template.modality),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updateSource: "user",
  };
  await writeProject(root, project);
  return project;
}

function uploadedMedia(url: URL): { modality: Exclude<Modality, "text">; name: string; extension: string } {
  const modality = url.searchParams.get("modality");
  if (modality !== "image" && modality !== "video" && modality !== "audio") {
    throw Object.assign(new Error("choose image, video, or audio"), { statusCode: 400 });
  }
  const rawName = (url.searchParams.get("name") ?? "").trim().replaceAll("\\", "/");
  const name = (rawName.split("/").at(-1) ?? "").slice(0, 200);
  const extension = extname(name).toLowerCase();
  if (!name || !modalityFiles[modality].extensions.has(extension)) {
    throw Object.assign(new Error(`请选择支持的${modalityFiles[modality].label}文件。`), { statusCode: 400 });
  }
  return { modality, name, extension };
}

async function writeUpload(request: IncomingMessage, target: string, maximumBytes: number): Promise<void> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > maximumBytes) throw Object.assign(new Error("uploaded file is too large"), { statusCode: 413 });
  let size = 0;
  const limiter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBytes) {
        callback(Object.assign(new Error("uploaded file is too large"), { statusCode: 413 }));
        return;
      }
      callback(null, bytes);
    },
  });
  await pipeline(request, limiter, createWriteStream(target, { flags: "wx" }));
  if (size === 0) throw Object.assign(new Error("uploaded file is empty"), { statusCode: 400 });
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".bmp": return "image/bmp";
    case ".mp4":
    case ".m4v": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".ogv": return "video/ogg";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".ogg": return "audio/ogg";
    case ".flac": return "audio/flac";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(bytes);
  }
  const payload = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!payload) throw new Error("request body must be a JSON object");
  return payload;
}

async function requestBytes(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw Object.assign(new Error("PDF 文件不能超过 50 MB。"), { statusCode: 413 });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw Object.assign(new Error("PDF 文件不能超过 50 MB。"), { statusCode: 413 });
    chunks.push(bytes);
  }
  if (!size) throw Object.assign(new Error("PDF 文件为空。"), { statusCode: 400 });
  return Buffer.concat(chunks);
}

function pdfPageText(items: Array<TextItem | { type: string }>): string {
  let result = "";
  let previousEndedLine = false;
  for (const item of items) {
    if (!("str" in item)) continue;
    const value = item.str.replace(/[\t\f\r ]+/g, " ").trim();
    if (!value) {
      previousEndedLine ||= item.hasEOL;
      continue;
    }
    if (result) {
      if (previousEndedLine && !result.endsWith("\n")) result += "\n";
      else if (/[A-Za-z0-9)]$/.test(result) && /^[A-Za-z0-9(]/.test(value)) result += " ";
    }
    result += value;
    previousEndedLine = item.hasEOL;
  }
  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(bytes: Buffer): Promise<{ textContent: string; pageCount: number; characterCount: number }> {
  if (bytes.indexOf("%PDF-") < 0 || bytes.indexOf("%PDF-") > 1_024) {
    throw Object.assign(new Error("请选择有效的 PDF 文件。"), { statusCode: 400 });
  }
  const loadingTask = getDocument({
    cMapPacked: true,
    cMapUrl: `${resolve(pdfAssetRoot, "cmaps")}${sep}`,
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: `${resolve(pdfAssetRoot, "standard_fonts")}${sep}`,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw Object.assign(new Error(`PDF 不能超过 ${MAX_PDF_PAGES} 页。`), { statusCode: 413 });
    }
    const pages: string[] = [];
    let extractedBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfPageText(content.items);
      pages.push(text);
      extractedBytes += Buffer.byteLength(text) + 2;
      page.cleanup();
      if (extractedBytes > MAX_TEXT_BYTES) {
        throw Object.assign(new Error("PDF 提取后的文字不能超过 5 MB。"), { statusCode: 413 });
      }
    }
    const textContent = pages
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!textContent) {
      throw Object.assign(
        new Error("这个 PDF 没有可提取的文字，可能是扫描图片。请使用带文字层的 PDF。"),
        { statusCode: 422 },
      );
    }
    return { textContent, pageCount: document.numPages, characterCount: [...textContent].length };
  } catch (error) {
    if (error && typeof error === "object" && typeof Reflect.get(error, "statusCode") === "number") throw error;
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "PasswordException" || /password/i.test(message)) {
      throw Object.assign(new Error("这个 PDF 受密码保护，请先移除密码后再导入。"), { statusCode: 422 });
    }
    console.warn("[data-annotation] PDF extraction failed", error);
    throw Object.assign(new Error("无法读取这个 PDF，请确认文件没有损坏。"), { statusCode: 400 });
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

function projectForBrowser(project: ProjectRecord, apiQuery: string) {
  const parameters = new URLSearchParams(apiQuery);
  parameters.set("projectId", project.id);
  return {
    ...project,
    mediaUrl: project.sourcePath ? `/api/project-media?${parameters.toString()}` : null,
    ...projectSummary(project),
  };
}

export default async function createDataAnnotationService(runtime: PluginRuntime) {
  const accessToken = randomBytes(32).toString("base64url");
  const launches = new Map<string, Launch>();
  let server: Server | null = null;
  let origin = "";

  function launchFrom(url: URL): Launch {
    if (url.searchParams.get("token") !== accessToken) {
      throw Object.assign(new Error("invalid annotation session"), { statusCode: 401 });
    }
    const session = url.searchParams.get("session") ?? "";
    const launch = launches.get(session);
    if (!launch || launch.expiresAt < Date.now()) {
      launches.delete(session);
      throw Object.assign(new Error("annotation session expired; reopen it from iPolloWork"), { statusCode: 401 });
    }
    launch.expiresAt = Date.now() + 24 * 60 * 60 * 1_000;
    return launch;
  }

  function projectIdFrom(url: URL): string {
    return validateProjectId(url.searchParams.get("projectId") ?? "");
  }

  async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const path = resolve(appRoot, relativePath);
    if (path !== appRoot && !path.startsWith(`${appRoot}${sep}`)) {
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    }
    const information = await stat(path).catch(() => null);
    if (!information?.isFile()) throw Object.assign(new Error("not found"), { statusCode: 404 });
    response.writeHead(200, {
      "content-type": mimeType(path),
      "cache-control": relativePath === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    createReadStream(path).pipe(response);
  }

  async function ensureServer(): Promise<string> {
    if (server) return origin;
    server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/api/health" && request.method === "GET") {
          json(response, 200, { ok: true, pluginId: runtime.plugin.id, version: runtime.plugin.version });
          return;
        }
        if (url.pathname === "/api/projects" && request.method === "GET") {
          const launch = launchFrom(url);
          json(response, 200, { projects: await listProjects(launch.workspaceRoot, 100) });
          return;
        }
        if (url.pathname === "/api/training-templates" && request.method === "GET") {
          launchFrom(url);
          json(response, 200, { templates: trainingTemplateSummaries() });
          return;
        }
        if (url.pathname === "/api/training-project" && request.method === "POST") {
          const launch = launchFrom(url);
          const body = await requestBody(request);
          const project = await createTrainingProject(launch.workspaceRoot, body.templateId);
          json(response, 201, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project" && request.method === "GET") {
          const launch = launchFrom(url);
          const project = await readProject(launch.workspaceRoot, projectIdFrom(url));
          json(response, 200, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project-file" && request.method === "POST") {
          const launch = launchFrom(url);
          const upload = uploadedMedia(url);
          const id = randomUUID();
          const uploads = uploadsDirectory(launch.workspaceRoot);
          await mkdir(uploads, { recursive: true });
          const mediaPath = resolve(uploads, `${id}${upload.extension}`);
          const temporary = resolve(uploads, `.${id}.${randomUUID()}.tmp`);
          try {
            await writeUpload(request, temporary, modalityFiles[upload.modality].maximumBytes);
            await rename(temporary, mediaPath);
          } catch (error) {
            await rm(temporary, { force: true });
            throw error;
          }
          const now = new Date().toISOString();
          const project: ProjectRecord = {
            schemaVersion: 2,
            id,
            title: upload.name,
            modality: upload.modality,
            sourcePath: relative(launch.workspaceRoot, mediaPath).replaceAll("\\", "/"),
            mimeType: mimeType(mediaPath),
            textContent: null,
            labels: defaultLabels(upload.modality),
            labelColors: {},
            annotations: defaultAnnotations(upload.modality),
            revision: 0,
            createdAt: now,
            updatedAt: now,
            updateSource: "user",
          };
          await writeProject(launch.workspaceRoot, project);
          json(response, 201, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/extract-pdf" && request.method === "POST") {
          launchFrom(url);
          const bytes = await requestBytes(request, MAX_PDF_BYTES);
          json(response, 200, await extractPdfText(bytes));
          return;
        }
        if (url.pathname === "/api/project-text" && request.method === "POST") {
          const launch = launchFrom(url);
          const body = await requestBody(request);
          const textContent = requiredString(body, "textContent", MAX_TEXT_BYTES);
          if (Buffer.byteLength(textContent) > MAX_TEXT_BYTES) {
            throw Object.assign(new Error("text content is larger than 5 MB"), { statusCode: 413 });
          }
          const now = new Date().toISOString();
          const project: ProjectRecord = {
            schemaVersion: 2,
            id: randomUUID(),
            title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : "文字标注",
            modality: "text",
            sourcePath: null,
            mimeType: "text/plain; charset=utf-8",
            textContent,
            labels: defaultLabels("text"),
            labelColors: {},
            annotations: defaultAnnotations("text"),
            revision: 0,
            createdAt: now,
            updatedAt: now,
            updateSource: "user",
          };
          await writeProject(launch.workspaceRoot, project);
          json(response, 201, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project" && request.method === "PUT") {
          const launch = launchFrom(url);
          const body = await requestBody(request);
          const project = await updateProject(
            launch.workspaceRoot,
            projectIdFrom(url),
            body.annotations,
            body.expectedRevision,
            body.textContent,
          );
          json(response, 200, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project-labels" && request.method === "PATCH") {
          const launch = launchFrom(url);
          const body = await requestBody(request);
          const project = await updateProjectLabels(
            launch.workspaceRoot,
            projectIdFrom(url),
            body.labels,
            body.replacements,
            body.expectedRevision,
          );
          json(response, 200, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project-media" && request.method === "GET") {
          const launch = launchFrom(url);
          const project = await readProject(launch.workspaceRoot, projectIdFrom(url));
          const mediaPath = await projectMedia(launch.workspaceRoot, project);
          const information = await stat(mediaPath);
          const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          if (range) {
            const start = Number(range[1]);
            const requestedEnd = range[2] ? Number(range[2]) : information.size - 1;
            const end = Math.min(requestedEnd, information.size - 1);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= information.size) {
              response.writeHead(416, { "content-range": `bytes */${information.size}` });
              response.end();
              return;
            }
            response.writeHead(206, {
              "content-type": project.mimeType ?? mimeType(mediaPath),
              "content-length": String(end - start + 1),
              "content-range": `bytes ${start}-${end}/${information.size}`,
              "cache-control": "private, max-age=60",
              "accept-ranges": "bytes",
              "x-content-type-options": "nosniff",
            });
            createReadStream(mediaPath, { start, end }).pipe(response);
            return;
          }
          response.writeHead(200, {
            "content-type": project.mimeType ?? mimeType(mediaPath),
            "content-length": String(information.size),
            "cache-control": "private, max-age=60",
            "accept-ranges": "bytes",
            "x-content-type-options": "nosniff",
          });
          createReadStream(mediaPath).pipe(response);
          return;
        }
        if (url.pathname.startsWith("/api/")) throw Object.assign(new Error("not found"), { statusCode: 404 });
        await serveStatic(url.pathname, response);
      })().catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error("unexpected annotation service error");
        const rawStatus = Reflect.get(error, "statusCode");
        const statusCode = typeof rawStatus === "number" ? rawStatus : 500;
        if (!response.headersSent) json(response, statusCode, { error: error.message });
        else response.destroy(error);
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to start data annotation training service");
    origin = `http://127.0.0.1:${address.port}`;
    return origin;
  }

  return {
    actions: {
      "open-workbench": async (_input: Record<string, unknown>, context: Record<string, unknown>) => {
        const root = await workspaceRoot(context);
        const serviceOrigin = await ensureServer();
        const session = randomBytes(18).toString("base64url");
        launches.set(session, { workspaceRoot: root, expiresAt: Date.now() + 24 * 60 * 60 * 1_000 });
        const url = new URL(serviceOrigin);
        url.searchParams.set("session", session);
        url.searchParams.set("token", accessToken);
        return { url: url.toString() };
      },

      "list-projects": async (input: Record<string, unknown>, context: Record<string, unknown>) => {
        const root = await workspaceRoot(context);
        const requested = typeof input.limit === "number" && Number.isInteger(input.limit) ? input.limit : 25;
        return listProjects(root, Math.min(100, Math.max(1, requested)));
      },

      "get-project": async (input: Record<string, unknown>, context: Record<string, unknown>) => {
        const root = await workspaceRoot(context);
        return readProject(root, validateProjectId(requiredString(input, "projectId", 128)));
      },
    },

    dispose: async () => {
      launches.clear();
      if (!server) return;
      const active = server;
      server = null;
      origin = "";
      await new Promise<void>((resolvePromise, reject) => active.close((error) => error ? reject(error) : resolvePromise()));
    },
  };
}
