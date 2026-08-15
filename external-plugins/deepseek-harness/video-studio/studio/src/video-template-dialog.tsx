import * as React from "react";
import type { TemplateCatalogItem } from "@ipollowork/types/templates";
import type { VideoRuntimeSession } from "./api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listTemplates: () => Promise<TemplateCatalogItem[]>;
  getCover: (templateId: string) => Promise<{ data: ArrayBuffer; contentType: string | null }>;
  applyTemplate: (templateId: string) => Promise<VideoRuntimeSession>;
  onApplied: (runtime: VideoRuntimeSession) => void;
};

function TemplateCover(props: Pick<Props, "getCover"> & { template: TemplateCatalogItem }) {
  const [source, setSource] = React.useState("");
  React.useEffect(() => {
    let active = true;
    let objectUrl = "";
    void props.getCover(props.template.manifest.id).then((cover) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([cover.data], { type: cover.contentType ?? "image/png" }));
      setSource(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.getCover, props.template.manifest.id]);
  return source
    ? <img src={source} alt={`${props.template.manifest.title} 封面`} />
    : <div className="ivideo-template-placeholder"><span>VIDEO</span></div>;
}

export function VideoTemplateDialog(props: Props) {
  const [templates, setTemplates] = React.useState<TemplateCatalogItem[]>([]);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<TemplateCatalogItem | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "applying" | "error">("idle");
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setStatus("loading");
    setError("");
    void props.listTemplates().then((items) => {
      setTemplates(items);
      setStatus("idle");
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "模板加载失败。");
      setStatus("error");
    });
  }, [props.listTemplates]);

  React.useEffect(() => {
    if (props.open && templates.length === 0 && status === "idle") load();
  }, [load, props.open, status, templates.length]);
  React.useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "applying") props.onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props, status]);

  if (!props.open) return null;
  const normalized = query.trim().toLowerCase();
  const visible = templates.filter((template) => !normalized || [
    template.manifest.title,
    template.manifest.description,
    template.manifest.subcategory,
    ...template.manifest.tags,
  ].join(" ").toLowerCase().includes(normalized));

  const apply = () => {
    if (!selected) return;
    setStatus("applying");
    setError("");
    void props.applyTemplate(selected.manifest.id).then((runtime) => {
      props.onApplied(runtime);
      setSelected(null);
      setStatus("idle");
      props.onOpenChange(false);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "模板应用失败，原项目已恢复。");
      setStatus("error");
    });
  };

  return (
    <div className="ivideo-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && status !== "applying") props.onOpenChange(false);
    }}>
      <section className="ivideo-template-dialog" role="dialog" aria-modal="true" aria-labelledby="ivideo-template-title">
        <header>
          <div><h2 id="ivideo-template-title">Video 模板</h2><p>27 个可编辑 HyperFrames 模板，只替换当前会话的视频项目。</p></div>
          <button type="button" className="ivideo-dialog-close" onClick={() => props.onOpenChange(false)} aria-label="关闭" disabled={status === "applying"}>×</button>
        </header>
        <label className="ivideo-template-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索视频模板" autoFocus /></label>
        <div className="ivideo-template-grid">
          {status === "loading" ? <div className="ivideo-template-message"><span className="ivideo-spinner" />正在加载模板…</div> : null}
          {status === "error" && templates.length === 0 ? <div className="ivideo-template-message"><strong>模板暂时无法打开</strong><span>{error}</span><button type="button" onClick={load}>重新尝试</button></div> : null}
          {status !== "loading" && visible.map((template) => (
            <button key={template.manifest.id} type="button" className="ivideo-template-card" onClick={() => setSelected(template)}>
              <div className="ivideo-template-cover"><TemplateCover template={template} getCover={props.getCover} /></div>
              <div className="ivideo-template-copy"><strong>{template.manifest.title}</strong><span>{template.manifest.description}</span></div>
            </button>
          ))}
          {status !== "loading" && templates.length > 0 && visible.length === 0 ? <div className="ivideo-template-message">没有找到匹配模板。</div> : null}
        </div>
        {selected ? (
          <div className="ivideo-template-confirm" role="alertdialog" aria-label="确认更换视频模板">
            <div><strong>使用“{selected.manifest.title}”模板？</strong><span>当前视频将被安全替换；如果应用失败，会自动恢复。</span>{error ? <em>{error}</em> : null}</div>
            <div><button type="button" onClick={() => { setSelected(null); setError(""); setStatus("idle"); }} disabled={status === "applying"}>取消</button><button type="button" className="primary" onClick={apply} disabled={status === "applying"}>{status === "applying" ? "正在应用…" : "使用模板"}</button></div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
