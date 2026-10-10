import type { Annotator as ImageEngine } from "@labelu/image";
import type { AnnotatorRef as ImageAnnotatorRef, ImageSample } from "@labelu/image-annotator-react";
import type { AudioAndVideoAnnotatorRef, MediaSample } from "@labelu/audio-annotator-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const ImageAnnotator = lazy(() => import("@labelu/image-annotator-react").then((module) => ({ default: module.Annotator })));
const VideoAnnotator = lazy(() => import("@labelu/video-annotator-react").then((module) => ({ default: module.Annotator })));
const AudioAnnotator = lazy(() => import("@labelu/audio-annotator-react").then((module) => ({ default: module.Annotator })));

type Modality = "image" | "video" | "audio" | "text";
type AnnotationMap = Record<string, unknown>;

type ProjectSummary = {
  id: string;
  title: string;
  modality: Modality;
  revision: number;
  updatedAt: string;
  updateSource: "user" | "ai";
  annotationCount: number;
  annotationCounts: Record<string, number>;
  status: "not_started" | "in_progress";
};

type ProjectPayload = ProjectSummary & {
  schemaVersion: 2;
  sourcePath: string | null;
  mimeType: string | null;
  textContent: string | null;
  labels: string[];
  labelColors: Record<string, string>;
  annotations: AnnotationMap;
  createdAt: string;
  mediaUrl: string | null;
};

type TrainingTemplateSummary = {
  id: string;
  title: string;
  modality: Modality;
  description: string;
  instruction: string;
  difficulty: "入门" | "进阶";
  labels: string[];
  labelColors: Record<string, string>;
};

type TextSpan = {
  id: string;
  start: number;
  end: number;
  label: string;
  text: string;
};

type LabelDraft = {
  id: string;
  originalName: string | null;
  name: string;
  color: string;
};

type RemovedLabel = {
  name: string;
  count: number;
  replacementId: string;
};

const palette = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4f46e5"];
const modalityCopy: Record<Modality, { name: string; description: string; accept: string }> = {
  image: {
    name: "图片标注",
    description: "框选、点选和轮廓标记",
    accept: "image/jpeg,image/png,image/gif,image/webp,image/bmp",
  },
  video: {
    name: "视频标注",
    description: "时间片段和关键帧标记",
    accept: "video/mp4,video/quicktime,video/webm,video/ogg",
  },
  audio: {
    name: "音频标注",
    description: "波形区间和时间点标记",
    accept: "audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac",
  },
  text: {
    name: "文字标注",
    description: "文本区间和文档分类",
    accept: "text/plain",
  },
};

function projectLabelDrafts(project: ProjectPayload): LabelDraft[] {
  return project.labels.map((name, index) => ({
    id: crypto.randomUUID(),
    originalName: name,
    name,
    color: project.labelColors[name] ?? palette[index % palette.length],
  }));
}

function configuredLabels(project: ProjectPayload | null, fallback: string): Array<{ color: string; key: string; value: string }> {
  const names = project?.labels.length ? project.labels : [fallback];
  return names.map((name, index) => ({
    color: project?.labelColors[name] ?? palette[index % palette.length],
    key: name,
    value: name,
  }));
}

function annotationLabelUsage(value: unknown, counts: Record<string, number> = {}): Record<string, number> {
  if (Array.isArray(value)) {
    for (const entry of value) annotationLabelUsage(entry, counts);
    return counts;
  }
  if (!value || typeof value !== "object") return counts;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "label" && typeof nested === "string") counts[nested] = (counts[nested] ?? 0) + 1;
    else annotationLabelUsage(nested, counts);
  }
  return counts;
}

function query(): string {
  const parameters = new URLSearchParams(window.location.search);
  const token = parameters.get("token") ?? "";
  const session = parameters.get("session") ?? "";
  if (!token || !session) throw new Error("标注页面地址无效，请从 iPolloWork 重新打开。");
  return new URLSearchParams({ token, session }).toString();
}

function endpoint(path: string, apiQuery: string, extra?: Record<string, string>): string {
  const parameters = new URLSearchParams(apiQuery);
  for (const [key, value] of Object.entries(extra ?? {})) parameters.set(key, value);
  return `${path}?${parameters.toString()}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error ?? `请求失败 (${response.status})`);
  if (!payload) throw new Error("服务返回了空结果");
  return payload;
}

function annotationCounts(annotations: AnnotationMap): Record<string, number> {
  return Object.fromEntries(Object.entries(annotations).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.length : value == null || value === "" ? 0 : 1,
  ]));
}

function totalAnnotations(annotations: AnnotationMap): number {
  return Object.values(annotationCounts(annotations)).reduce((sum, count) => sum + count, 0);
}

function textSpans(annotations: AnnotationMap): TextSpan[] {
  if (!Array.isArray(annotations.spans)) return [];
  return annotations.spans.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const span = value as Record<string, unknown>;
    if (
      typeof span.id !== "string" ||
      typeof span.start !== "number" ||
      typeof span.end !== "number" ||
      typeof span.label !== "string" ||
      typeof span.text !== "string"
    ) return [];
    return [{ id: span.id, start: span.start, end: span.end, label: span.label, text: span.text }];
  });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function EngineLoading() {
  return <div className="engine-loading">正在加载标注引擎…</div>;
}

function EmptyProjects() {
  return (
    <div className="empty-projects">
      <strong>还没有保存的标注</strong>
      <span>从上面选择一种类型开始。</span>
    </div>
  );
}

type TextEditorProps = {
  content: string;
  spans: TextSpan[];
  classification: string;
  labels: string[];
  onContentChange: (value: string) => void;
  onSpansChange: (value: TextSpan[]) => void;
  onClassificationChange: (value: string) => void;
};

function TextEditor({
  content,
  spans,
  classification,
  labels,
  onContentChange,
  onSpansChange,
  onClassificationChange,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeLabel, setActiveLabel] = useState(labels[0] ?? "实体");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!labels.includes(activeLabel)) setActiveLabel(labels[0] ?? "实体");
  }, [activeLabel, labels]);

  const addSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setNotice("请先在正文中选择一段文字。");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next: TextSpan = {
      id: crypto.randomUUID(),
      start,
      end,
      label: activeLabel,
      text: content.slice(start, end),
    };
    onSpansChange([...spans, next].sort((left, right) => left.start - right.start));
    setNotice(`已添加“${activeLabel}”标注。`);
  }, [activeLabel, content, onSpansChange, spans]);

  return (
    <div className="text-editor">
      <section className="text-source" aria-labelledby="text-source-title">
        <div className="section-heading">
          <div>
            <h2 id="text-source-title">正文</h2>
            <p>选择文字，再添加区间标签。</p>
          </div>
          <div className="text-actions">
            <label>
              标签
              <select value={activeLabel} onChange={(event) => setActiveLabel(event.currentTarget.value)}>
                {labels.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={addSelection}>标注所选文字</button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          spellCheck={false}
          aria-label="待标注正文"
          onChange={(event) => {
            if (spans.length) onSpansChange([]);
            onContentChange(event.currentTarget.value);
            setNotice(spans.length ? "正文已修改，原有区间标注已清除。" : "");
          }}
        />
        <div className="inline-status" aria-live="polite">{notice}</div>
      </section>
      <aside className="text-inspector" aria-label="文字标注结果">
        <label className="classification-field">
          文档分类
          <input
            value={classification}
            placeholder="例如：通知、合同、正向"
            onChange={(event) => onClassificationChange(event.currentTarget.value)}
          />
        </label>
        <div className="span-heading">
          <strong>区间标注</strong>
          <span>{spans.length} 条</span>
        </div>
        <div className="span-list">
          {spans.length ? spans.map((span) => (
            <div className="span-item" key={span.id}>
              <div>
                <span className="span-label">{span.label}</span>
                <p>{span.text}</p>
                <small>{span.start}-{span.end}</small>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => onSpansChange(spans.filter((item) => item.id !== span.id))}
              >
                删除
              </button>
            </div>
          )) : <p className="muted">还没有区间标注。</p>}
        </div>
      </aside>
    </div>
  );
}

export function AnnotationApp() {
  const imageRef = useRef<ImageAnnotatorRef>(null);
  const mediaRef = useRef<AudioAndVideoAnnotatorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const uploadModalityRef = useRef<Exclude<Modality, "text">>("image");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trainingTemplates, setTrainingTemplates] = useState<TrainingTemplateSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectPayload | null>(null);
  const [homeTab, setHomeTab] = useState<"start" | "training">("start");
  const [templateFilter, setTemplateFilter] = useState<Modality | "all">("all");
  const [loading, setLoading] = useState(true);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState("");
  const [opening, setOpening] = useState("");
  const [uploading, setUploading] = useState<Modality | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState<LabelDraft[]>([]);
  const [removedLabels, setRemovedLabels] = useState<RemovedLabel[]>([]);
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelNotice, setLabelNotice] = useState("");
  const [labelError, setLabelError] = useState("");
  const [error, setError] = useState("");
  const [textFormOpen, setTextFormOpen] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [pdfImporting, setPdfImporting] = useState(false);
  const [pdfNotice, setPdfNotice] = useState("");
  const [textContent, setTextContent] = useState("");
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [classification, setClassification] = useState("");
  const apiQuery = useMemo(query, []);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch(endpoint("/api/projects", apiQuery), { cache: "no-store" });
      const payload = await responseJson<{ projects: ProjectSummary[] }>(response);
      setProjects(payload.projects);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取我的标注");
    } finally {
      setLoading(false);
    }
  }, [apiQuery]);

  const loadTrainingTemplates = useCallback(async () => {
    if (templatesLoaded || templatesLoading) return;
    setTemplatesLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint("/api/training-templates", apiQuery), { cache: "no-store" });
      const payload = await responseJson<{ templates: TrainingTemplateSummary[] }>(response);
      setTrainingTemplates(payload.templates);
      setTemplatesLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取实训项目");
    } finally {
      setTemplatesLoading(false);
    }
  }, [apiQuery, templatesLoaded, templatesLoading]);

  const selectHomeTab = useCallback((tab: "start" | "training") => {
    setHomeTab(tab);
    setError("");
    if (tab === "training") {
      setTextFormOpen(false);
      void loadTrainingTemplates();
    }
  }, [loadTrainingTemplates]);

  const handleHomeTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = homeTab === "start" ? "training" : "start";
    selectHomeTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  }, [homeTab, selectHomeTab]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const prepareProject = useCallback((project: ProjectPayload) => {
    setActiveProject(project);
    setTextContent(project.textContent ?? "");
    setSpans(textSpans(project.annotations));
    setClassification(typeof project.annotations.classification === "string" ? project.annotations.classification : "");
    setLabelDraft(projectLabelDrafts(project));
    setRemovedLabels([]);
    setLabelNotice("");
    setLabelError("");
    setDirty(false);
    setPanelOpen(false);
    setError("");
  }, []);

  const openProject = useCallback(async (projectId: string) => {
    setOpening(projectId);
    setError("");
    try {
      const response = await fetch(endpoint("/api/project", apiQuery, { projectId }), { cache: "no-store" });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      prepareProject(payload.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开标注项目");
    } finally {
      setOpening("");
    }
  }, [apiQuery, prepareProject]);

  const beginFileProject = useCallback((modality: Exclude<Modality, "text">) => {
    uploadModalityRef.current = modality;
    if (fileInputRef.current) fileInputRef.current.accept = modalityCopy[modality].accept;
    fileInputRef.current?.click();
  }, []);

  const uploadProject = useCallback(async (file: File, modality: Exclude<Modality, "text">) => {
    setUploading(modality);
    setError("");
    try {
      const response = await fetch(endpoint("/api/project-file", apiQuery, { modality, name: file.name }), {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      prepareProject(payload.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${modalityCopy[modality].name}创建失败`);
    } finally {
      setUploading(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [apiQuery, prepareProject]);

  const importPdf = useCallback(async (file: File) => {
    if (!file.name.toLocaleLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("PDF 文件不能超过 50 MB。");
      return;
    }
    setPdfImporting(true);
    setPdfNotice("");
    setError("");
    try {
      const response = await fetch(endpoint("/api/extract-pdf", apiQuery), {
        method: "POST",
        headers: { "content-type": "application/pdf" },
        body: file,
      });
      const payload = await responseJson<{ textContent: string; pageCount: number; characterCount: number }>(response);
      setTextDraft(payload.textContent);
      setTextTitle((current) => current.trim() || file.name.replace(/\.pdf$/i, "").slice(0, 200));
      setPdfNotice(`已导入 ${payload.pageCount} 页，共 ${payload.characterCount} 个字符。请确认正文后开始标注。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF 导入失败");
    } finally {
      setPdfImporting(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }, [apiQuery]);

  const createTextProject = useCallback(async () => {
    if (!textDraft.trim()) {
      setError("请先输入需要标注的文字。");
      return;
    }
    setUploading("text");
    setError("");
    try {
      const response = await fetch(endpoint("/api/project-text", apiQuery), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: textTitle, textContent: textDraft }),
      });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      setTextFormOpen(false);
      setTextTitle("");
      setTextDraft("");
      setPdfNotice("");
      prepareProject(payload.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文字项目创建失败");
    } finally {
      setUploading(null);
    }
  }, [apiQuery, prepareProject, textDraft, textTitle]);

  const createTrainingProject = useCallback(async (templateId: string) => {
    if (creatingTemplate) return;
    setCreatingTemplate(templateId);
    setError("");
    try {
      const response = await fetch(endpoint("/api/training-project", apiQuery), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      prepareProject(payload.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "实训项目创建失败");
    } finally {
      setCreatingTemplate("");
    }
  }, [apiQuery, creatingTemplate, prepareProject]);

  const imageConfig = useMemo(() => {
    const labels = configuredLabels(activeProject, "目标");
    return {
      width: 0,
      height: 0,
      image: { url: "", rotate: 0 },
      point: { maxPointAmount: 100, labels },
      line: { lineType: "line" as const, minPointAmount: 2, maxPointAmount: 100, edgeAdsorptive: false, labels },
      rect: { minWidth: 1, minHeight: 1, labels },
      polygon: { lineType: "line" as const, minPointAmount: 3, maxPointAmount: 100, edgeAdsorptive: false, labels },
    };
  }, [activeProject]);

  const mediaConfig = useMemo(() => {
    const labels = configuredLabels(activeProject, activeProject?.modality === "audio" ? "声音" : "片段");
    return {
      segment: labels,
      frame: labels,
    };
  }, [activeProject]);

  const imageSample = useMemo<ImageSample | null>(() => {
    if (!activeProject || activeProject.modality !== "image" || !activeProject.mediaUrl) return null;
    return {
      id: activeProject.id,
      name: activeProject.title,
      url: activeProject.mediaUrl,
      data: activeProject.annotations as ImageSample["data"],
    };
  }, [activeProject]);

  const mediaSample = useMemo<MediaSample | null>(() => {
    if (!activeProject || !activeProject.mediaUrl || (activeProject.modality !== "audio" && activeProject.modality !== "video")) return null;
    return {
      id: activeProject.id,
      name: activeProject.title,
      url: activeProject.mediaUrl,
      data: activeProject.annotations as MediaSample["data"],
    };
  }, [activeProject]);

  const currentAnnotations = useCallback((): AnnotationMap | null => {
    if (!activeProject) return null;
    if (activeProject.modality === "image") return imageRef.current?.getAnnotations() ?? null;
    if (activeProject.modality === "audio" || activeProject.modality === "video") return mediaRef.current?.getAnnotations() ?? null;
    return { spans, classification };
  }, [activeProject, classification, spans]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!activeProject || saving) return false;
    const annotations = currentAnnotations();
    if (!annotations) return false;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(endpoint("/api/project", apiQuery, { projectId: activeProject.id }), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          annotations,
          expectedRevision: activeProject.revision,
          textContent: activeProject.modality === "text" ? textContent : undefined,
        }),
      });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      setActiveProject(payload.project);
      setDirty(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeProject, apiQuery, currentAnnotations, saving, textContent]);

  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [save]);

  const returnHome = useCallback(async () => {
    if (dirty && !(await save())) return;
    setActiveProject(null);
    setPanelOpen(false);
    setDirty(false);
    await loadProjects();
  }, [dirty, loadProjects, save]);

  const onImageLoad = useCallback((engine: ImageEngine) => {
    const changed = () => setDirty(true);
    engine.on("add", changed);
    engine.on("change", changed);
    engine.on("delete", changed);
  }, []);

  const activeLabelUsage = useMemo(
    () => activeProject ? annotationLabelUsage(activeProject.annotations) : {},
    [activeProject],
  );
  const effectiveRemovedLabels = useMemo(() => {
    const currentNames = new Set(labelDraft.map((label) => label.name.trim()));
    return removedLabels.filter((label) => !currentNames.has(label.name));
  }, [labelDraft, removedLabels]);
  const labelHasChanges = useMemo(() => {
    if (!activeProject) return false;
    const saved = activeProject.labels.map((name, index) => ({
      name,
      color: activeProject.labelColors[name] ?? palette[index % palette.length],
    }));
    const draft = labelDraft.map((label) => ({ name: label.name.trim(), color: label.color.toLowerCase() }));
    return JSON.stringify(saved) !== JSON.stringify(draft) || effectiveRemovedLabels.length > 0;
  }, [activeProject, effectiveRemovedLabels, labelDraft]);

  const addLabel = useCallback(() => {
    if (labelDraft.length >= 50) {
      setLabelError("每个项目最多可以设置 50 个标签。");
      return;
    }
    const existing = new Set(labelDraft.map((label) => label.name.trim().toLocaleLowerCase()));
    let suffix = 1;
    let name = "新标签";
    while (existing.has(name.toLocaleLowerCase())) {
      suffix += 1;
      name = `新标签 ${suffix}`;
    }
    setLabelDraft((current) => [...current, {
      id: crypto.randomUUID(),
      originalName: null,
      name,
      color: palette[current.length % palette.length],
    }]);
    setLabelNotice("已添加标签，请修改名称后应用。");
    setLabelError("");
  }, [labelDraft]);

  const moveLabel = useCallback((id: string, direction: -1 | 1) => {
    setLabelDraft((current) => {
      const index = current.findIndex((label) => label.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const selected = next[index];
      next[index] = next[target];
      next[target] = selected;
      return next;
    });
    setLabelNotice("");
    setLabelError("");
  }, []);

  const removeLabel = useCallback((id: string) => {
    const selected = labelDraft.find((label) => label.id === id);
    if (!selected) return;
    if (labelDraft.length === 1) {
      setLabelError("项目至少需要保留一个标签。");
      return;
    }
    const remaining = labelDraft.filter((label) => label.id !== id);
    const fallback = remaining[0]?.id ?? "";
    const count = selected.originalName ? activeLabelUsage[selected.originalName] ?? 0 : 0;
    setLabelDraft(remaining);
    setRemovedLabels((current) => {
      const next = current.map((label) => label.replacementId === id ? { ...label, replacementId: fallback } : label);
      if (!selected.originalName || count === 0) return next;
      return [...next.filter((label) => label.name !== selected.originalName), {
        name: selected.originalName,
        count,
        replacementId: fallback,
      }];
    });
    setLabelNotice(count ? "这个标签已有标注，请确认替换标签。" : "标签已从草稿中移除。");
    setLabelError("");
  }, [activeLabelUsage, labelDraft]);

  const restoreRemovedLabel = useCallback((name: string) => {
    if (!activeProject) return;
    const originalIndex = activeProject.labels.indexOf(name);
    setLabelDraft((current) => [...current, {
      id: crypto.randomUUID(),
      originalName: name,
      name,
      color: activeProject.labelColors[name] ?? palette[Math.max(0, originalIndex) % palette.length],
    }]);
    setRemovedLabels((current) => current.filter((label) => label.name !== name));
    setLabelNotice("已撤销删除。");
    setLabelError("");
  }, [activeProject]);

  const resetLabelEditor = useCallback(() => {
    if (!activeProject) return;
    setLabelDraft(projectLabelDrafts(activeProject));
    setRemovedLabels([]);
    setLabelNotice("");
    setLabelError("");
  }, [activeProject]);

  const applyLabels = useCallback(async () => {
    if (!activeProject || labelSaving) return;
    if (dirty) {
      setLabelError("请先保存当前标注，再修改标签。");
      return;
    }
    const definitions = labelDraft.map((label) => ({
      name: label.name.trim(),
      color: label.color.toLowerCase(),
    }));
    const names = new Set<string>();
    for (const definition of definitions) {
      if (!definition.name || definition.name.length > 48) {
        setLabelError("标签名称不能为空，且不能超过 48 个字符。");
        return;
      }
      const comparable = definition.name.toLocaleLowerCase();
      if (names.has(comparable)) {
        setLabelError(`标签“${definition.name}”重复，请使用不同名称。`);
        return;
      }
      names.add(comparable);
    }
    const finalNames = new Set(definitions.map((definition) => definition.name));
    const replacements: Record<string, string> = {};
    for (const [index, label] of labelDraft.entries()) {
      const nextName = definitions[index]?.name ?? "";
      if (label.originalName && label.originalName !== nextName && !finalNames.has(label.originalName)) {
        replacements[label.originalName] = nextName;
      }
    }
    for (const removed of effectiveRemovedLabels) {
      const replacement = labelDraft.find((label) => label.id === removed.replacementId)?.name.trim() ?? "";
      if (!replacement || !finalNames.has(replacement)) {
        setLabelError(`请为“${removed.name}”选择一个有效的替换标签。`);
        return;
      }
      replacements[removed.name] = replacement;
    }
    setLabelSaving(true);
    setLabelError("");
    setLabelNotice("");
    try {
      const response = await fetch(endpoint("/api/project-labels", apiQuery, { projectId: activeProject.id }), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labels: definitions,
          replacements,
          expectedRevision: activeProject.revision,
        }),
      });
      const payload = await responseJson<{ project: ProjectPayload }>(response);
      setActiveProject(payload.project);
      setTextContent(payload.project.textContent ?? "");
      setSpans(textSpans(payload.project.annotations));
      setClassification(typeof payload.project.annotations.classification === "string" ? payload.project.annotations.classification : "");
      setLabelDraft(projectLabelDrafts(payload.project));
      setRemovedLabels([]);
      setDirty(false);
      setLabelNotice("标签已更新，标注工具已经同步。");
    } catch (cause) {
      setLabelError(cause instanceof Error ? cause.message : "标签更新失败");
    } finally {
      setLabelSaving(false);
    }
  }, [activeProject, apiQuery, dirty, effectiveRemovedLabels, labelDraft, labelSaving]);

  const filteredTrainingTemplates = useMemo(
    () => templateFilter === "all"
      ? trainingTemplates
      : trainingTemplates.filter((template) => template.modality === templateFilter),
    [templateFilter, trainingTemplates],
  );
  const activeCounts = useMemo(() => activeProject ? annotationCounts(activeProject.annotations) : {}, [activeProject]);

  if (loading) return <main className="message">正在打开数据标注工作台…</main>;

  return (
    <div className="workbench">
      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void uploadProject(file, uploadModalityRef.current);
        }}
      />
      <input
        ref={pdfInputRef}
        className="file-input"
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void importPdf(file);
        }}
      />

      {!activeProject ? (
        <main className="home-shell">
          <header className="home-header">
            <div>
              <p className="eyebrow">智慧未来学校</p>
              <h1>数据标注实训云</h1>
              <p>上传自己的素材，或直接打开已经配好素材与标签的实训项目。</p>
            </div>
          </header>

          <div className="home-tabs" role="tablist" aria-label="标注项目来源">
            <button
              id="start-tab"
              type="button"
              role="tab"
              aria-selected={homeTab === "start"}
              aria-controls="start-panel"
              tabIndex={homeTab === "start" ? 0 : -1}
              onClick={() => selectHomeTab("start")}
              onKeyDown={handleHomeTabKeyDown}
            >
              开始标注
            </button>
            <button
              id="training-tab"
              type="button"
              role="tab"
              aria-selected={homeTab === "training"}
              aria-controls="training-panel"
              tabIndex={homeTab === "training" ? 0 : -1}
              onClick={() => selectHomeTab("training")}
              onKeyDown={handleHomeTabKeyDown}
            >
              选择实训项目
            </button>
          </div>

          {homeTab === "start" ? (
            <section
              id="start-panel"
              className="training-section"
              role="tabpanel"
              aria-labelledby="start-tab"
            >
              <div className="training-heading">
                <h2>上传自己的素材</h2>
                <p>选择标注类型后上传文件；文字项目可以直接输入正文或导入 PDF。</p>
              </div>
              <div className="modality-grid">
                {(Object.keys(modalityCopy) as Modality[]).map((modality) => (
                  <button
                    className="modality-option"
                    type="button"
                    key={modality}
                    disabled={uploading !== null}
                    onClick={() => {
                      if (modality === "text") setTextFormOpen(true);
                      else beginFileProject(modality);
                    }}
                  >
                    <span>{modalityCopy[modality].name}</span>
                    <small>{uploading === modality ? "正在创建…" : modalityCopy[modality].description}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section
              id="training-panel"
              className="training-section"
              role="tabpanel"
              aria-labelledby="training-tab"
            >
              <div className="training-heading training-heading-row">
                <div>
                  <h2>选择实训项目</h2>
                  <p>素材、任务说明和标签已经配置好，点击后直接开始标注。</p>
                </div>
                <span>{trainingTemplates.length} 个项目</span>
              </div>
              <div className="template-filters" aria-label="实训项目分类">
                {(["all", "image", "video", "audio", "text"] as const).map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    aria-pressed={templateFilter === filter}
                    onClick={() => setTemplateFilter(filter)}
                  >
                    {filter === "all" ? "全部" : modalityCopy[filter].name.replace("标注", "")}
                  </button>
                ))}
              </div>
              {templatesLoading ? (
                <div className="template-status" aria-live="polite">正在加载实训项目…</div>
              ) : filteredTrainingTemplates.length ? (
                <div className="template-grid">
                  {filteredTrainingTemplates.map((template) => (
                    <button
                      className="template-card"
                      type="button"
                      key={template.id}
                      disabled={Boolean(creatingTemplate)}
                      onClick={() => void createTrainingProject(template.id)}
                    >
                      <span className="template-meta">
                        <span>{modalityCopy[template.modality].name}</span>
                        <span>{template.difficulty}</span>
                      </span>
                      <strong>{template.title}</strong>
                      <small>{template.description}</small>
                      <span className="template-instruction">{template.instruction}</span>
                      <span className="template-labels" aria-label="预设标签">
                        {template.labels.map((label) => (
                          <span key={label}>
                            <i style={{ backgroundColor: template.labelColors[label] }} />
                            {label}
                          </span>
                        ))}
                      </span>
                      <span className="template-open">
                        {creatingTemplate === template.id ? "正在打开…" : "直接开始"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="template-status">这个分类暂时没有实训项目。</div>
              )}
            </section>
          )}

          {homeTab === "start" && textFormOpen ? (
            <section className="text-project-form" aria-labelledby="new-text-title">
              <div className="section-heading">
                <div>
                  <h2 id="new-text-title">新建文字标注</h2>
                  <p>输入正文或从 PDF 提取文字，再进入区间标注页面。</p>
                </div>
                <button className="text-button" type="button" onClick={() => setTextFormOpen(false)}>取消</button>
              </div>
              <div className="pdf-import-row">
                <div>
                  <strong>从 PDF 导入</strong>
                  <span>支持含可复制文字的 PDF，最大 50 MB；扫描件需要先完成 OCR。</span>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pdfImporting || uploading === "text"}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  {pdfImporting ? "正在提取…" : "选择 PDF"}
                </button>
              </div>
              {pdfNotice ? <p className="pdf-import-notice" aria-live="polite">{pdfNotice}</p> : null}
              <label>
                项目名称
                <input value={textTitle} placeholder="可选" onChange={(event) => setTextTitle(event.currentTarget.value)} />
              </label>
              <label>
                正文
                <textarea value={textDraft} placeholder="粘贴需要标注的文字，或从 PDF 导入" onChange={(event) => setTextDraft(event.currentTarget.value)} />
              </label>
              <div className="form-actions">
                <button className="primary-button" type="button" disabled={pdfImporting || uploading === "text"} onClick={() => void createTextProject()}>
                  {uploading === "text" ? "正在创建…" : "创建并开始"}
                </button>
              </div>
            </section>
          ) : null}

          <section className="projects-section" aria-labelledby="projects-title">
            <div className="projects-heading">
              <div>
                <h2 id="projects-title">我的标注</h2>
                <p>打开以前保存的项目继续标注。</p>
              </div>
              <span>{projects.length} 个项目</span>
            </div>
            {projects.length ? (
              <div className="project-list">
                {projects.map((project) => (
                  <button
                    className="project-row"
                    type="button"
                    key={project.id}
                    disabled={opening === project.id}
                    onClick={() => void openProject(project.id)}
                  >
                    <span className="project-type">{modalityCopy[project.modality].name.replace("标注", "")}</span>
                    <span className="project-main">
                      <strong>{project.title}</strong>
                      <small>{project.annotationCount ? `${project.annotationCount} 条标注` : "尚未标注"}</small>
                    </span>
                    <span className="project-time">{opening === project.id ? "正在打开…" : formatTime(project.updatedAt)}</span>
                  </button>
                ))}
              </div>
            ) : <EmptyProjects />}
          </section>
          {error ? <div className="page-error" role="alert">{error}</div> : null}
        </main>
      ) : (
        <main className="editor-shell">
          <header className="app-header">
            <button className="header-button" type="button" onClick={() => void returnHome()}>我的标注</button>
            <div className="project-title">
              <strong>{activeProject.title}</strong>
              <span>{modalityCopy[activeProject.modality].name} · v{activeProject.revision}</span>
            </div>
            <div className="header-actions">
              <span className={error ? "save-status error-text" : "save-status"} aria-live="polite">
                {error || (saving ? "保存中…" : dirty ? "未保存" : "已保存")}
              </span>
              <button className="header-button" type="button" onClick={() => setPanelOpen((value) => !value)}>项目</button>
              <button className="primary-button compact" type="button" disabled={!dirty || saving} onClick={() => void save()}>保存</button>
            </div>
          </header>

          <div className="editor-body">
            <section
              className="editor-engine"
              aria-label={`${modalityCopy[activeProject.modality].name}编辑器`}
              onPointerDown={() => {
                if (activeProject.modality === "audio" || activeProject.modality === "video") setDirty(true);
              }}
            >
              {activeProject.modality === "image" && imageSample ? (
                <Suspense fallback={<EngineLoading />}>
                  <ImageAnnotator
                    key={`${activeProject.id}:${activeProject.revision}`}
                    ref={imageRef}
                    samples={[imageSample]}
                    editingSample={imageSample}
                    config={imageConfig}
                    renderSidebar={null}
                    offsetTop={44}
                    primaryColor="#2563eb"
                    onLoad={onImageLoad}
                    onError={(event) => setError(event.message)}
                  />
                </Suspense>
              ) : null}
              {activeProject.modality === "video" && mediaSample ? (
                <Suspense fallback={<EngineLoading />}>
                  <VideoAnnotator
                    key={`${activeProject.id}:${activeProject.revision}`}
                    ref={mediaRef}
                    samples={[mediaSample]}
                    editingSample={mediaSample}
                    config={mediaConfig}
                    selectedTool="segment"
                    renderSidebar={() => null}
                    offsetTop={44}
                    primaryColor="#2563eb"
                  />
                </Suspense>
              ) : null}
              {activeProject.modality === "audio" && mediaSample ? (
                <Suspense fallback={<EngineLoading />}>
                  <AudioAnnotator
                    key={`${activeProject.id}:${activeProject.revision}`}
                    ref={mediaRef}
                    samples={[mediaSample]}
                    editingSample={mediaSample}
                    config={mediaConfig}
                    selectedTool="segment"
                    renderSidebar={() => null}
                    offsetTop={44}
                    primaryColor="#2563eb"
                  />
                </Suspense>
              ) : null}
              {activeProject.modality === "text" ? (
                <TextEditor
                  content={textContent}
                  spans={spans}
                  classification={classification}
                  labels={activeProject.labels.length ? activeProject.labels : ["实体"]}
                  onContentChange={(value) => { setTextContent(value); setDirty(true); }}
                  onSpansChange={(value) => { setSpans(value); setDirty(true); }}
                  onClassificationChange={(value) => { setClassification(value); setDirty(true); }}
                />
              ) : null}
            </section>

            {panelOpen ? (
              <aside className="project-inspector" aria-label="项目状态">
                <div className="inspector-heading">
                  <strong>项目状态</strong>
                  <button className="text-button" type="button" onClick={() => setPanelOpen(false)}>收起</button>
                </div>
                <dl>
                  <div><dt>类型</dt><dd>{modalityCopy[activeProject.modality].name}</dd></div>
                  <div><dt>版本</dt><dd>v{activeProject.revision}</dd></div>
                  <div><dt>上次保存</dt><dd>{formatTime(activeProject.updatedAt)}</dd></div>
                  <div><dt>标注数量</dt><dd>{totalAnnotations(activeProject.annotations)}</dd></div>
                </dl>
                <div className="inspector-section label-editor">
                  <div className="label-editor-heading">
                    <strong>标签设置</strong>
                    <button className="text-button" type="button" disabled={labelDraft.length >= 50} onClick={addLabel}>新增标签</button>
                  </div>
                  <p className="muted">标签只属于当前项目。可以改名、换颜色或调整顺序。</p>
                  <div className="label-list">
                    {labelDraft.map((label, index) => (
                      <div className="label-row" key={label.id}>
                        <div className="label-fields">
                          <label className="label-color-field">
                            <span className="visually-hidden">{label.name || `标签 ${index + 1}`}的颜色</span>
                            <input
                              type="color"
                              value={label.color}
                              onChange={(event) => {
                                const color = event.currentTarget.value;
                                setLabelDraft((current) => current.map((item) => item.id === label.id ? { ...item, color } : item));
                                setLabelNotice("");
                                setLabelError("");
                              }}
                            />
                          </label>
                          <label className="label-name-field">
                            <span className="visually-hidden">标签名称</span>
                            <input
                              value={label.name}
                              maxLength={48}
                              aria-label={`第 ${index + 1} 个标签名称`}
                              onChange={(event) => {
                                const name = event.currentTarget.value;
                                setLabelDraft((current) => current.map((item) => item.id === label.id ? { ...item, name } : item));
                                setLabelNotice("");
                                setLabelError("");
                              }}
                            />
                          </label>
                        </div>
                        <div className="label-row-actions">
                          <button type="button" disabled={index === 0} onClick={() => moveLabel(label.id, -1)}>上移</button>
                          <button type="button" disabled={index === labelDraft.length - 1} onClick={() => moveLabel(label.id, 1)}>下移</button>
                          <button className="danger-text" type="button" onClick={() => removeLabel(label.id)}>删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {effectiveRemovedLabels.length ? (
                    <div className="label-replacements" aria-label="标签删除保护">
                      {effectiveRemovedLabels.map((removed) => (
                        <div className="label-replacement" key={removed.name}>
                          <div>
                            <strong>“{removed.name}”已用于 {removed.count} 条</strong>
                            <button className="text-button" type="button" onClick={() => restoreRemovedLabel(removed.name)}>撤销</button>
                          </div>
                          <label>
                            删除后替换为
                            <select
                              value={removed.replacementId}
                              onChange={(event) => {
                                const replacementId = event.currentTarget.value;
                                setRemovedLabels((current) => current.map((item) => item.name === removed.name ? { ...item, replacementId } : item));
                                setLabelError("");
                              }}
                            >
                              {labelDraft.map((label) => <option key={label.id} value={label.id}>{label.name || "未命名标签"}</option>)}
                            </select>
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {dirty ? <p className="label-warning">请先保存当前标注，再应用标签修改。</p> : null}
                  {labelError ? <p className="label-feedback error-text" role="alert">{labelError}</p> : null}
                  {!labelError && labelNotice ? <p className="label-feedback" aria-live="polite">{labelNotice}</p> : null}
                  <div className="label-editor-actions">
                    <button className="secondary-button" type="button" disabled={!labelHasChanges || labelSaving} onClick={resetLabelEditor}>还原</button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!labelHasChanges || dirty || saving || labelSaving}
                      onClick={() => void applyLabels()}
                    >
                      {labelSaving ? "应用中…" : "应用标签"}
                    </button>
                  </div>
                </div>
                <div className="inspector-section">
                  <strong>已保存标注</strong>
                  {Object.keys(activeCounts).length ? Object.entries(activeCounts).map(([key, count]) => (
                    <div className="count-row" key={key}><span>{key}</span><span>{count}</span></div>
                  )) : <p className="muted">尚未保存标注。</p>}
                </div>
                <p className="inspector-note">左侧 AI 只能读取这里已经保存的项目状态，不会操作当前页面。</p>
              </aside>
            ) : null}
          </div>
        </main>
      )}
    </div>
  );
}
