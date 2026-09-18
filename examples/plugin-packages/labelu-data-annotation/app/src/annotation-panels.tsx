import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
export type AnnotationPanelProps = {
  labelsPanel: ReactNode;
  panelTab: "marks" | "labels";
  onPanelTabChange: (tab: "marks" | "labels") => void;
  labelsBusy: boolean;
};
export function AnnotationPanelTabs({ panelTab, onPanelTabChange, labelsBusy, count }: Omit<AnnotationPanelProps, "labelsPanel"> & { count: number }) {
  return <div className="annotation-panel-tabs" role="tablist" aria-label="标记与标签集">
      <button type="button" role="tab" id="marks-tab" aria-selected={panelTab === "marks"} onClick={() => onPanelTabChange("marks")}>标记 <small>{count} 条</small></button>
      <button type="button" role="tab" id="labels-tab" aria-controls="annotation-labels-panel" aria-selected={panelTab === "labels"} disabled={labelsBusy} onClick={() => onPanelTabChange("labels")}>标签集</button>
    </div>;
}

type NamedAnnotation = { id: string; label?: string; attributes?: Record<string, unknown> };
// Shared adaptation of LabelU's existing right panel and detail bubble for images and media.
export function AnnotationPanels({ labelsPanel, panelTab, onPanelTabChange, labelsBusy, rootSelector, annotations, attributeModalOpen, children }: AnnotationPanelProps & {
  rootSelector: string; annotations: NamedAnnotation[]; attributeModalOpen?: boolean; children: ReactNode;
}) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [modalBody, setModalBody] = useState<Element | null>(null);
  const [nameTargets, setNameTargets] = useState<{ target: Element; name: string; id: string }[]>([]);
  useLayoutEffect(() => {
    const root = document.querySelector(rootSelector);
    const element = root?.querySelector(".attribute-header")?.parentElement;
    if (!element) return;
    element.classList.add("annotation-attributes");
    setPanel(element);
    return () => element.classList.remove("annotation-attributes");
  }, [rootSelector]);
  useLayoutEffect(() => {
    if (!panel) return;
    panel.dataset.activeTab = panelTab;
    const grouped = new Map<string | undefined, typeof annotations>();
    for (const annotation of annotations) {
      const group = grouped.get(annotation.label) ?? [];
      group.push(annotation); grouped.set(annotation.label, group);
    }
    const targets = panel.querySelectorAll(".rc-collapse-content-box > div > div [aria-describedby]");
    const next: typeof nameTargets = [];
    Array.from(grouped.values()).flat().forEach((annotation, index) => {
      const target = targets[index];
      const name = annotation.attributes?.标记名称;
      if (target && typeof name === "string" && name.trim()) {
        target.classList.add("annotation-named");
        next.push({ target, name, id: annotation.id });
      }
    });
    setNameTargets(next);
    return () => targets.forEach(target => target.classList.remove("annotation-named"));
  }, [panel, panelTab, annotations]);
  useLayoutEffect(() => {
    if (!attributeModalOpen) { setModalBody(null); return; }
    // The native details portal mounts asynchronously; disconnect immediately once it exists.
    const observer = new MutationObserver(attach);
    function attach() {
      const body = document.querySelector(".labelu-draggable-modal .rc-dialog-body");
      if (body) { setModalBody(body); observer.disconnect(); }
    }
    observer.observe(document.body, { childList: true, subtree: true });
    attach();
    return () => observer.disconnect();
  }, [attributeModalOpen]);
  const header = panel?.querySelector(".attribute-header");

  return <>
    {header ? createPortal(<AnnotationPanelTabs panelTab={panelTab} onPanelTabChange={onPanelTabChange} labelsBusy={labelsBusy} count={annotations.length} />, header) : null}
    {panel && panelTab === "labels" ? createPortal(<section className="annotation-labels-panel" id="annotation-labels-panel" role="tabpanel" aria-labelledby="labels-tab">{labelsPanel}</section>, panel) : null}
    {nameTargets.map(item => createPortal(<span className="annotation-custom-name" title={item.name}>{item.name}</span>, item.target, item.id))}

    {attributeModalOpen && modalBody ? createPortal(<div className="annotation-detail-fields">{children}</div>, modalBody) : null}
  </>;
}
