import { Annotator, useTool, useAnnotationCtx } from "@labelu/image-annotator-react";
import type { AnnotatorRef, ImageAnnotatorProps } from "@labelu/image-annotator-react";
import type { Annotator as ImageEngine } from "@labelu/image";
import { forwardRef, useRef } from "react";
import { AnnotationPanels } from "./annotation-panels";
import type { AnnotationPanelProps } from "./annotation-panels";

function ImagePanels(props: AnnotationPanelProps) {
  const { engine, attributeModalOpen, currentTool, labels } = useTool();
  const { selectedAnnotation, sortedImageAnnotations, disabled } = useAnnotationCtx();
  const name = selectedAnnotation?.attributes?.标记名称;
  return <>
    {currentTool === "polygon" ? <span className="polygon-hint">至少 3 个点，点击起点闭合完成</span> : null}
    <AnnotationPanels {...props} rootSelector=".labelu-image-annotator" annotations={sortedImageAnnotations} attributeModalOpen={attributeModalOpen}>
      {selectedAnnotation ? <>
      <label>标记名称<input aria-label="标记名称" maxLength={80} placeholder="为这条标记命名" disabled={disabled}
        value={typeof name === "string" ? name : ""}
        onChange={event => engine.setAttributes({ ...selectedAnnotation.attributes, 标记名称: event.currentTarget.value })} /></label>
      <label>标签类别<select aria-label="标记标签类别" disabled={disabled} value={selectedAnnotation.label}
        onChange={event => engine.setLabel(event.currentTarget.value)}>
        {labels.map(label => <option key={label.value} value={label.value}>{label.key}</option>)}
      </select></label>
      <p className="muted">名称仅用于这条标记，保存项目后保留。</p>

      </> : null}
    </AnnotationPanels>
  </>;
}

// Keep LabelU integration here; annotation/history/label persistence stay with their existing owners.
export default forwardRef<AnnotatorRef, ImageAnnotatorProps & AnnotationPanelProps>(
  function ImageAnnotator({ labelsPanel, panelTab, onPanelTabChange, labelsBusy, toolbarExtra, onLoad, ...props }, ref) {
    const engineRef = useRef<ImageEngine>();
    return <div className="image-annotation-surface" onMouseDownCapture={(event) => {
      const engine = engineRef.current;
      if (props.disabled || event.button !== 0 || !(event.target instanceof HTMLCanvasElement) ||
        !engine || engine.keyboard?.Space || engine.activeToolName !== "polygon") return;
      const tool = engine.activeTool;
      if (!tool || !("sketch" in tool) || !tool.sketch || !("shapes" in tool.sketch)) return;
      const points = tool.sketch.shapes[0]?.dynamicCoordinate;
      if (!points || points.length < 4) return; // Includes the trailing mouse-preview point.
      const bounds = event.target.getBoundingClientRect();
      if (Math.hypot(event.clientX - bounds.left - points[0].x, event.clientY - bounds.top - points[0].y) > 10) return;
      event.preventDefault();
      event.stopPropagation();
      // Route closure through LabelU's normal finish gesture, retaining validation, undo and selection.
      event.target.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true, button: 2, clientX: event.clientX, clientY: event.clientY,
      }));
    }}>
      <Annotator {...props} ref={ref} onLoad={(engine) => { engineRef.current = engine; onLoad?.(engine); }}
        toolbarExtra={<>{toolbarExtra}<ImagePanels labelsPanel={labelsPanel} panelTab={panelTab} onPanelTabChange={onPanelTabChange} labelsBusy={labelsBusy} /></>} />
    </div>;
  },
);
