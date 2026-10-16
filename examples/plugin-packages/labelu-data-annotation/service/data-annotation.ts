import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { extname, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import WordExtractor from "word-extractor";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { ProjectReview, WorkbenchRole, MediaSource } from "../types";

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
  review: ProjectReview;
  mediaSource?: MediaSource;
};

type Launch = {
  workspaceRoot: string;
  expiresAt: number;
  role: WorkbenchRole;
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
  mediaSource?: MediaSource;
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
    title: "施工现场安全帽检测",
    modality: "image",
    description: "在真实施工现场照片中识别人物与安全帽，练习遮挡目标的边界判断。",
    instruction: "分别框选两位人物的可见部分与黄色安全帽；不推测被墙面遮挡的身体范围。",
    difficulty: "入门",
    labels: ["人物", "安全帽"],
    labelColors: { "人物": "#2563eb", "安全帽": "#f59e0b" },
    assetFile: "construction-worker.jpg",
    mediaSource: { title: "Construction worker CT", author: "HelenOnline (Helen Riding)", url: "https://commons.wikimedia.org/wiki/File:Construction_worker_CT.jpg", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "使用 Wikimedia 提供的 1280px 缩略图，未裁切；同许可分发" },
  },
  {
    id: "image-recycling",
    title: "垃圾分类识别",
    modality: "image",
    description: "对不同颜色的垃圾分类容器进行目标框选。",
    instruction: "按照片从左到右标记纸类（蓝）、玻璃（绿）、塑料包装（黄）容器；以可见轮廓为边界。",
    difficulty: "入门",
    labels: ["纸类", "玻璃", "塑料包装"],
    labelColors: { "纸类": "#2563eb", "玻璃": "#16a34a", "塑料包装": "#f59e0b" },
    assetFile: "recycling-bins.jpg",
    mediaSource: { title: "Barcelona recycling bins", author: "William Avery", url: "https://commons.wikimedia.org/wiki/File:Barcelona_recycling_bins.jpg", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "使用 Wikimedia 提供的 1280px 缩略图，未裁切；同许可分发" },
  },
  {
    id: "image-plant-leaves",
    title: "植物叶片框选",
    modality: "image",
    description: "在自然环境照片中标记前景叶片，练习多边形轮廓和遮挡处理。",
    instruction: "框选或沿轮廓标记前景中清晰可辨的叶片；用线工具标记可见叶脉，不把远处树木纳入目标。",
    difficulty: "进阶",
    labels: ["叶片", "叶脉"],
    labelColors: { "叶片": "#16a34a", "叶脉": "#f59e0b" },
    assetFile: "plant-leaf.jpg",
    mediaSource: { title: "The top of a leaf", author: "Ranjithkanth Tamilselvan J", url: "https://commons.wikimedia.org/wiki/File:The_top_of_a_leaf.jpg", license: "CC0 1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", changes: "使用 Wikimedia 提供的 1280px 缩略图，未裁切" },
  },
  {
    id: "video-classroom-behavior",
    title: "行人与道路活动片段",
    modality: "video",
    description: "观察公园旁道路与过街行人的实拍视频，标记活动时间段。",
    instruction: "先完整播放，按实际画面标记行人出现、车辆通行和静态场景；不同事件可重叠。",
    difficulty: "入门",
    labels: ["行人出现", "车辆通行", "静态场景"],
    labelColors: { "行人出现": "#2563eb", "车辆通行": "#ea580c", "静态场景": "#64748b" },
    assetFile: "pedestrians.mp4",
    mediaSource: { title: "Park, roads and pedestrian crossing (30s, 720p)", author: "Samplelib", url: "https://samplelib.com/sample-mp4.html", license: "Samplelib 自由使用许可", licenseUrl: "https://samplelib.com/license.html", changes: "H.264 转码并移除配乐，保留完整画面与时长" },
  },
  {
    id: "video-flower-bloom",
    title: "花朵开放关键帧",
    modality: "video",
    description: "观察真实花朵开放的延时摄影，标出不同阶段和代表性关键帧。",
    instruction: "按画面标记花苞、展开和盛开阶段；用关键帧工具记录花瓣状态明显变化的时刻。",
    difficulty: "进阶",
    labels: ["花苞", "展开", "盛开"],
    labelColors: { "花苞": "#0891b2", "展开": "#f59e0b", "盛开": "#16a34a" },
    assetFile: "flower.mp4",
    mediaSource: { title: "Flower (MDN interactive examples)", author: "MDN contributors", url: "https://github.com/mdn/interactive-examples/tree/main/live-examples/media/cc0-videos", license: "CC0 1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", changes: "原始视频，未修改" },
  },
  {
    id: "video-traffic-event",
    title: "交通事件切片",
    modality: "video",
    description: "对真实城市道路视频中的车辆活动分段，练习短事件的起止边界。",
    instruction: "标记车辆进入、交汇和驶离画面的时间范围。",
    difficulty: "进阶",
    labels: ["车辆进入", "车辆交汇", "车辆驶离"],
    labelColors: { "车辆进入": "#2563eb", "车辆交汇": "#dc2626", "车辆驶离": "#16a34a" },
    assetFile: "road-traffic.mp4",
    mediaSource: { title: "Road in a city (5s, 720p)", author: "Samplelib", url: "https://samplelib.com/sample-mp4.html", license: "Samplelib 自由使用许可", licenseUrl: "https://samplelib.com/license.html", changes: "H.264 转码并移除配乐，保留完整画面与时长" },
  },
  {
    id: "audio-mandarin-segmentation",
    title: "普通话语音分段",
    modality: "audio",
    description: "使用真人朗读王维唐诗的录音，划分语音与停顿区间。",
    instruction: "在波形上分别标记有效语音和停顿，边界尽量贴近声音起止点。",
    difficulty: "入门",
    labels: ["有效语音", "静音"],
    labelColors: { "有效语音": "#2563eb", "静音": "#94a3b8" },
    assetFile: "mandarin-reading.m4a",
    mediaSource: { title: "唐诗三百首卷一 · 送綦毋潜落第还乡（普通话）", author: "Jin Yilin / LibriVox；诗作：王维", url: "https://librivox.org/three-hundred-tang-poems-volume-1-by-various/", license: "LibriVox 公有领域录音", licenseUrl: "https://librivox.org/pages/public-domain/", changes: "第 014 轨截取 15–60 秒，AAC 转码" },
  },
  {
    id: "audio-campus-sounds",
    title: "诗歌朗读停顿",
    modality: "audio",
    description: "聆听真人朗读《望岳》，区分朗读、停顿和呼吸声。",
    instruction: "听辨后再划定区间；呼吸声与底噪不能当作词语。可在句末添加时间点标记。",
    difficulty: "入门",
    labels: ["朗读", "停顿", "呼吸声"],
    labelColors: { "朗读": "#2563eb", "停顿": "#64748b", "呼吸声": "#16a34a" },
    assetFile: "poem-pauses.m4a",
    mediaSource: { title: "唐诗三百首卷一 · 望岳（普通话）", author: "Graham / LibriVox；诗作：杜甫", url: "https://librivox.org/three-hundred-tang-poems-volume-1-by-various/", license: "LibriVox 公有领域录音", licenseUrl: "https://librivox.org/pages/public-domain/", changes: "第 008 轨截取 15–50 秒，AAC 转码" },
  },
  {
    id: "audio-speaker-turns",
    title: "说话人片段",
    modality: "audio",
    description: "两位真人朗读者的片段拼接练习，区分不同声音，不是原始对话。",
    instruction: "第一位出现的声音记为说话人 A，另一位记为说话人 B；按每段实际发声范围标记，排除停顿。",
    difficulty: "进阶",
    labels: ["说话人 A", "说话人 B"],
    labelColors: { "说话人 A": "#4f46e5", "说话人 B": "#16a34a" },
    assetFile: "two-readers.m4a",
    mediaSource: { title: "唐诗三百首卷一 · 两位朗读者选段", author: "Jin Yilin、David Barnes / LibriVox；诗作：王维、张九龄", url: "https://librivox.org/three-hundred-tang-poems-volume-1-by-various/", license: "LibriVox 公有领域录音", licenseUrl: "https://librivox.org/pages/public-domain/", changes: "第 014、002 轨各截取 20–35 秒并依次拼接，AAC 转码" },
  },
  {
    id: "text-news-entities",
    title: "新闻实体抽取",
    modality: "text",
    description: "多段原创校园新闻，包含采访、活动安排、组织全称和相对时间。",
    instruction: "抽取人物、组织、地点和时间，重复出现也要标注；职务不并入人名，完整日期作为一个实体。文末为教学说明。",
    difficulty: "入门",
    labels: ["人物", "组织", "地点", "时间"],
    labelColors: { "人物": "#2563eb", "组织": "#9333ea", "地点": "#16a34a", "时间": "#ea580c" },
    textContent: `【教学示例｜以下人物、组织与事件为虚构，用于实体抽取练习】

智慧未来学校开展多模态数据标注实践周

2026年9月14日上午，智慧未来学校人工智能社团在创新楼三层实验室举行实践周启动活动。指导教师李明介绍，本次活动由学校信息技术中心与青禾社区服务站联合组织，三十六名学生将分组完成图片、视频、语音和文字四类标注任务。

启动环节中，社团负责人陈晓展示了上学期制作的校园植物观察手册。她表示：“同一张照片，如果有人只框住叶片的一半，有人把背景也算进去，最后得到的数据就很难统一。开始操作前，大家要先讨论目标边界和标签含义。”来自信息技术中心的周宁补充说，标注人员应根据素材本身做判断，遇到看不清的内容时不要猜测。

当天下午，第一小组前往青禾社区的东门广场采集垃圾分类设施照片；第二小组在学校图书馆整理已经获得使用许可的阅读材料。负责协调的王悦提醒大家，涉及个人联系方式的原始文档必须先完成脱敏，整理后的材料统一存放在指定项目中，不通过个人聊天群传递。

9月16日，李明在创新楼组织了一次交叉检查。审核组发现，部分记录遗漏了重复出现的机构名称，还有同学把“下周三”改写成自己推算的日期。老师要求保留原文中的表达，只对原文已有的字符区间添加标签，不补写没有出现的信息。随后，陈晓带领小组逐条核对问题，并把修改意见写入审核记录。

根据计划，实践周成果交流会将于9月18日15:00在学校报告厅举行。青禾社区服务站的工作人员将旁听学生展示，信息技术中心负责收集规范建议。通过审核的标注结果将导出为 JSON，供下一阶段的检索实验使用；尚未通过的记录留在本地，按照意见修订后再次提交。

练习提示：人物姓名、机构全称和地点可能反复出现，不能只标记第一次。“当天下午”“上学期”“下一阶段”均需按团队约定判断是否属于时间实体。数量“三十六名”不属于本项目的四类标签。`,
  },
  {
    id: "text-sentiment",
    title: "评论情感分类",
    modality: "text",
    description: "八条原创实训反馈，覆盖褒贬混合、转折、建议和客观事实。",
    instruction: "以能独立表达态度的短语为区间，分别标记正向、负向或中性；转折前后分开，不把建议自动判为负向。",
    difficulty: "入门",
    labels: ["正向", "负向", "中性"],
    labelColors: { "正向": "#16a34a", "负向": "#dc2626", "中性": "#64748b" },
    textContent: `【教学示例｜以下八条评价为原创虚构文本，不代表真实用户反馈】

评价一：第一次做图片标注时，我以为需要记很多快捷键，实际跟着示例就能完成。标签颜色区分得很清楚，保存后还能继续打开，这一点很方便。不过，我在较小的屏幕上查看项目设置时，觉得需要来回切换面板，希望以后能让说明更容易找到。

评价二：今天的课程安排是先看演示，再分组操作，最后交换作品检查。我们组用了三张图片和一段视频，一共花了四十五分钟。老师要求每个人记录遇到的问题。这些是课堂安排，我暂时没有特别的好坏评价。

评价三：音频里的停顿比较明显，适合刚开始练习的人。我最喜欢可以反复播放同一个片段，不必从头再听。但是，背景里出现轻微呼吸声时，我还是分不清应该归入哪一类，这让我有点困惑。补充一个边界案例的讲解可能会更有帮助。

评价四：看到记录被退回时，我一开始很失落。打开意见后才发现，是我漏标了两处重复出现的组织名称。意见写得具体，修改起来并不麻烦。重新通过审核后，我对这一套检查方式的印象明显变好了。

评价五：不能否认示例很丰富，但有两份文字的段落太长，找实体时容易漏行。我不讨厌长文本，只是希望长短案例搭配出现。要是每次练习都只有一句话，也很难接近实际工作。这条建议不意味着我对整门课程不满意。

评价六：我们昨天导入了一份通知，正文包含活动时间、地点和参与对象。今天又增加了两段补充说明，原来的审核结果因此需要重新确认。我理解这种安排，因为修改后的内容应该再看一遍，直接沿用旧结果反而会让我不放心。

评价七：最后的 JSON 导出很实用，字段名称容易理解，拿去做后续统计省了不少整理时间。可惜小组开始时没有统一标签，同一个概念用了两个名字，合并数据时遇到了麻烦。下次我会先和同学商量规则，再开始操作。

评价八：这次没有出现文件丢失，但我在操作中仍然习惯随时保存。视频案例的时间不长，足够观察几个关键动作。我期待增加更多真实的工作场景，也愿意再做一轮类似练习。整体体验符合我的预期。

练习提示：同一条评价可以同时包含正向、负向和中性区间。注意“不是不满意”“不讨厌”等否定表达，不要只按单个词语判断。请分别标记表达情绪的文字区间，不要用某一条评价的情绪代表整篇。`,
  },
  {
    id: "text-notice-elements",
    title: "通知要素标注",
    modality: "text",
    description: "一份含报名、培训、提交、审核及变更条款的完整活动通知。",
    instruction: "分别标记时间、地点、参与人和事项；把截止时间与活动时间分开，区分原安排、变更安排和条件说明。",
    difficulty: "进阶",
    labels: ["时间", "地点", "参与人", "事项"],
    labelColors: { "时间": "#ea580c", "地点": "#16a34a", "参与人": "#2563eb", "事项": "#9333ea" },
    textContent: `【教学示例｜原创虚构通知，用于要素抽取练习】

关于开展多模态数据标注阶段实训的通知

人工智能实训班全体学生、各组负责人及审核志愿者：

为检查前一阶段的学习情况，课程组拟于2026年10月12日至10月16日组织综合实训。此次实训包含素材整理、标注、交叉审核和成果导出四个环节。请各组先确认标签规范，再分配工作；同一项目中的标签名称、边界规则和保存要求应保持一致。

一、报名与材料准备。各组负责人须于10月9日17:00前，将成员名单和选择的实训主题提交至课程平台。每组四至六人，至少安排一人负责交叉检查。请使用经过授权或自行拍摄的素材，图片不少于三张，音视频各一段，文字材料应包含完整段落。不得上传带有真实证件号码、私人电话号码等未经处理的信息。

二、集中培训。全体参与学生于10月12日14:00在第二实训楼302室集合，携带学生证和可使用的笔记本电脑。培训内容包括目标框选、音视频区间切分、文本实体边界及审核意见填写。无法到场的同学应提前向指导教师说明情况，并于当日晚间查看课程平台中的录播说明。

三、提交与审核。标注员应在10月14日18:00前保存本组记录，审核志愿者于次日9:00起逐条打开详情进行检查。发现漏标、错标或边界不一致时，应退回并写明具体位置和修改要求。标注员修改后需重新保存，原来的通过状态不继续沿用。通过审核的记录由组负责人导出 JSON，文件名中注明项目名称。

四、成果交流。原定10月16日15:00在学校报告厅举行的交流活动，因场地维护调整到创新楼一层多功能室，开始时间不变。每组展示不超过八分钟，重点说明标签规范、一个分歧案例和最终处理办法。审核志愿者需提前二十分钟到场核对展示顺序。

五、补充安排。如因设备故障影响提交，请在截止前联系课程助教登记问题，获确认后可延长至10月15日12:00。该安排仅适用于已登记的组，其他组仍按原时间完成。实训结束后，本地项目保留到学期末，便于复查；对外展示的材料须另行核对来源和使用范围。

课程组
2026年10月7日

练习提示：“原定”与“调整到”后的地点都在正文中出现，应分别标注，不能删除旧安排。参与对象既包括全体学生，也包括负责人和审核志愿者；根据具体句子的指向确定区间。`,
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
  if (!PROJECT_ID_RE.test(value)) throw Object.assign(new Error("projectId must contain only letters, numbers, dots, underscores, or hyphens"), { statusCode: 400 });
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

function pendingReview(): ProjectReview {
  return { status: "pending", comment: "", reviewedAt: null, revision: null };
}

function savedReview(value: unknown, revision: number): ProjectReview {
  const review = object(value);
  if (!review || (review.status !== "approved" && review.status !== "rejected")
    || review.revision !== revision || typeof review.reviewedAt !== "string"
    || typeof review.comment !== "string") return pendingReview();
  return { status: review.status, comment: review.comment, reviewedAt: review.reviewedAt, revision };
}

function savedMediaSource(value: unknown): MediaSource | undefined {
  const source = object(value);
  if (!source || typeof source.title !== "string" || typeof source.author !== "string"
    || typeof source.url !== "string" || typeof source.license !== "string"
    || typeof source.licenseUrl !== "string" || typeof source.changes !== "string") return undefined;
  return { title: source.title, author: source.author, url: source.url, license: source.license,
    licenseUrl: source.licenseUrl, changes: source.changes };
}

// Serialize read/check/write for a record across all workbench sessions in this service.
const projectWrites = new Map<string, Promise<unknown>>();
async function withProjectWrite<T>(root: string, id: string, action: () => Promise<T>): Promise<T> {
  const key = projectPath(root, id).toLowerCase();
  const previous = projectWrites.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(action);
  projectWrites.set(key, operation);
  try { return await operation; }
  finally { if (projectWrites.get(key) === operation) projectWrites.delete(key); }
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
      review: savedReview(record.review, revision),
      mediaSource: savedMediaSource(record.mediaSource),
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
      review: pendingReview(),
    };
  }

  throw new Error("saved annotation project is invalid");
}

async function readProject(root: string, projectId: string): Promise<ProjectRecord> {
  const currentPath = projectPath(root, projectId);
  const payload = await readFile(currentPath, "utf8").catch(async (error: unknown) => {
    if (fileErrorCode(error) !== "ENOENT") throw error;
    return readFile(legacyTaskPath(root, projectId), "utf8").catch((legacyError: unknown) => {
      if (fileErrorCode(legacyError) === "ENOENT") {
        throw Object.assign(new Error("标注记录不存在或已删除。"), { statusCode: 404 });
      }
      throw legacyError;
    });
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
    review: project.review,
    annotationCount,
    annotationCounts: counts,
    status: annotationCount > 0 ? "in_progress" : "not_started",
  };
}

async function listProjects(root: string, limit: number): Promise<ReturnType<typeof projectSummary>[]> {
  const projects = await Promise.all((await projectIds(root)).map(async (id) => {
    try { return await readProject(root, id); }
    catch (error) {
      if (error instanceof Error && Reflect.get(error, "statusCode") === 404) return null;
      throw error;
    }
  }));
  return projects
    .filter((project): project is ProjectRecord => project !== null)
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
  updateSource: UpdateSource = "user",
): Promise<ProjectRecord> {
  return withProjectWrite(root, projectId, async () => {
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
      updateSource,
      review: pendingReview(),
    };
    if (JSON.stringify(project.annotations) === JSON.stringify(next.annotations) && project.textContent === next.textContent) return project;
    await writeProject(root, next);
    return next;
  });
}

async function updateProjectLabels(
  root: string,
  projectId: string,
  labels: unknown,
  replacements: unknown,
  expectedRevision: unknown,
  updateSource: UpdateSource = "user",
): Promise<ProjectRecord> {
  return withProjectWrite(root, projectId, async () => {
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
      updateSource,
      review: pendingReview(),
    };
    if (JSON.stringify(project.labels) === JSON.stringify(next.labels)
      && JSON.stringify(project.labelColors) === JSON.stringify(next.labelColors)
      && JSON.stringify(project.annotations) === JSON.stringify(next.annotations)) return project;
    await writeProject(root, next);
    return next;
  });
}

async function reviewProject(root: string, projectId: string, body: Record<string, unknown>, updateSource: UpdateSource = "user"): Promise<ProjectRecord> {
  return withProjectWrite(root, projectId, async () => {
    const project = await readProject(root, projectId);
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== project.revision) {
      throw Object.assign(new Error("记录已更新，请重新打开详情后审核。"), { statusCode: 409 });
    }
    if (body.status !== "approved" && body.status !== "rejected") {
      throw Object.assign(new Error("请选择通过或退回。"), { statusCode: 400 });
    }
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (comment.length > 2000 || (body.status === "rejected" && !comment)) {
      throw Object.assign(new Error("退回时请填写意见，审核意见最多 2000 字。"), { statusCode: 400 });
    }
    if (body.status === "approved" && projectSummary(project).annotationCount === 0) {
      throw Object.assign(new Error("该记录还没有已保存的标注，暂不能通过。"), { statusCode: 409 });
    }
    const now = new Date().toISOString();
    const revision = project.revision + 1;
    const next: ProjectRecord = { ...project, revision, updatedAt: now, updateSource,
      review: { status: body.status, comment, reviewedAt: now, revision } };
    await writeProject(root, next);
    return next;
  });
}

async function createTextProject(root: string, body: Record<string, unknown>, updateSource: UpdateSource = "user"): Promise<ProjectRecord> {
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
    review: pendingReview(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updateSource,
  };
  await writeProject(root, project);
  return project;
}

async function exportProject(root: string, projectId: string) {
  const project = await readProject(root, projectId);
  if (project.review.status !== "approved" || project.review.revision !== project.revision) {
    throw Object.assign(new Error("只有当前版本审核通过的记录才能导出 JSON。"), { statusCode: 409 });
  }
  return { format: "ipollowork.annotation", schemaVersion: 1, exportedAt: new Date().toISOString(), project };
}

async function deleteProject(root: string, projectId: string, expectedRevision?: unknown) {
  return withProjectWrite(root, projectId, async () => {
    if (expectedRevision !== undefined) {
      const project = await readProject(root, projectId);
      if (!Number.isInteger(expectedRevision) || expectedRevision !== project.revision) {
        throw Object.assign(new Error("记录已更新，请重新读取后删除。"), { statusCode: 409 });
      }
    }
    // Remove records only; never remove source media, which may belong to the user.
    await rm(legacyTaskPath(root, projectId), { force: true });
    await rm(projectPath(root, projectId), { force: true });
    return { ok: true, projectId };
  });
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
  return { spans: [] };
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

async function createTrainingProject(root: string, templateId: unknown, updateSource: UpdateSource = "user"): Promise<ProjectRecord> {
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
    mediaSource: template.mediaSource,
    review: pendingReview(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    updateSource,
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
    throw Object.assign(new Error(`文件不能超过 ${maximumBytes / 1024 / 1024} MB。`), { statusCode: 413 });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw Object.assign(new Error(`文件不能超过 ${maximumBytes / 1024 / 1024} MB。`), { statusCode: 413 });
    chunks.push(bytes);
  }
  if (!size) throw Object.assign(new Error("文件为空。"), { statusCode: 400 });
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
        if (url.pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")
          && url.pathname !== "/api/role") {
          const launch = launchFrom(url);
          const requiredRole = url.pathname === "/api/project-review" ? "reviewer" : "annotator";
          if (launch.role !== requiredRole) {
            throw Object.assign(new Error(requiredRole === "reviewer" ? "请先切换为审核员。" : "审核员只能查看和审核，请切换为标注员后修改。"), { statusCode: 403 });
          }
        }
        if (url.pathname === "/api/role" && (request.method === "GET" || request.method === "POST")) {
          const launch = launchFrom(url);
          if (request.method === "POST") {
            const body = await requestBody(request);
            if (body.role !== "annotator" && body.role !== "reviewer") {
              throw Object.assign(new Error("角色无效。"), { statusCode: 400 });
            }
            launch.role = body.role;
          }
          json(response, 200, { role: launch.role });
          return;
        }
        if (url.pathname === "/api/project-review" && request.method === "POST") {
          const launch = launchFrom(url);
          const project = await reviewProject(launch.workspaceRoot, projectIdFrom(url), await requestBody(request));
          json(response, 200, { project: projectForBrowser(project, url.searchParams.toString()) });
          return;
        }
        if (url.pathname === "/api/project-export" && request.method === "GET") {
          const launch = launchFrom(url);
          const exported = await exportProject(launch.workspaceRoot, projectIdFrom(url));
          const { project } = exported;
          response.setHeader("content-disposition", `attachment; filename="annotation-${project.id}.json"; filename*=UTF-8''${encodeURIComponent(`${project.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100)}.json`)}`);
          json(response, 200, exported);
          return;
        }
        if (url.pathname === "/api/projects" && request.method === "GET") {
          const launch = launchFrom(url);
          json(response, 200, { projects: await listProjects(launch.workspaceRoot, 100), role: launch.role });
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
        if (url.pathname === "/api/project" && request.method === "DELETE") {
          const launch = launchFrom(url);
          const projectId = projectIdFrom(url);
          await deleteProject(launch.workspaceRoot, projectId);
          json(response, 200, { ok: true });
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
            review: pendingReview(),
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
        if (url.pathname === "/api/extract-document" && request.method === "POST") {
          launchFrom(url);
          const extension = extname(url.searchParams.get("name") ?? "").toLowerCase();
          if (![".doc", ".docx", ".txt"].includes(extension)) {
            throw Object.assign(new Error("请选择 Word（.doc、.docx）或 TXT 文件。"), { statusCode: 400 });
          }
          const bytes = await requestBytes(request, extension === ".txt" ? MAX_TEXT_BYTES : MAX_PDF_BYTES);
          let textContent: string;
          try {
            if (extension === ".txt") {
              const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
                : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
              try {
                textContent = new TextDecoder(encoding, { fatal: true }).decode(bytes);
              } catch {
                textContent = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
              }
              if (textContent.includes("\u0000")) throw new Error("binary text");
            } else {
              const document = await new WordExtractor().extract(bytes);
              textContent = document.getBody();
            }
          } catch {
            throw Object.assign(new Error("无法读取文件，请确认文件格式正确、未损坏且未加密。"), { statusCode: 400 });
          }
          textContent = textContent.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
          if (!textContent.trim()) {
            throw Object.assign(new Error("文件中没有可提取的文字。"), { statusCode: 422 });
          }
          if (Buffer.byteLength(textContent) > MAX_TEXT_BYTES) {
            throw Object.assign(new Error("提取的正文不能超过 5 MB。"), { statusCode: 413 });
          }
          json(response, 200, { textContent, characterCount: textContent.length });
          return;
        }
        if (url.pathname === "/api/project-text" && request.method === "POST") {
          const launch = launchFrom(url);
          const body = await requestBody(request);
          const project = await createTextProject(launch.workspaceRoot, body);
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
        launches.set(session, { workspaceRoot: root, expiresAt: Date.now() + 24 * 60 * 60 * 1_000, role: "annotator" });
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

      "list-training-templates": async (_input: Record<string, unknown>, context: Record<string, unknown>) => {
        await workspaceRoot(context);
        return trainingTemplateSummaries();
      },
      "create-training-project": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        createTrainingProject(await workspaceRoot(context), input.templateId, "ai"),
      "create-text-project": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        createTextProject(await workspaceRoot(context), input, "ai"),
      "update-project": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        updateProject(await workspaceRoot(context), validateProjectId(requiredString(input, "projectId", 128)),
          input.annotations, input.expectedRevision, input.textContent, "ai"),
      "update-project-labels": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        updateProjectLabels(await workspaceRoot(context), validateProjectId(requiredString(input, "projectId", 128)),
          input.labels, input.replacements, input.expectedRevision, "ai"),
      "review-project": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        reviewProject(await workspaceRoot(context), validateProjectId(requiredString(input, "projectId", 128)), input, "ai"),
      "export-project": async (input: Record<string, unknown>, context: Record<string, unknown>) =>
        exportProject(await workspaceRoot(context), validateProjectId(requiredString(input, "projectId", 128))),
      "delete-project": async (input: Record<string, unknown>, context: Record<string, unknown>) => {
        if (!Number.isInteger(input.expectedRevision)) throw Object.assign(new Error("expectedRevision is required"), { statusCode: 400 });
        return deleteProject(await workspaceRoot(context), validateProjectId(requiredString(input, "projectId", 128)), input.expectedRevision);
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
