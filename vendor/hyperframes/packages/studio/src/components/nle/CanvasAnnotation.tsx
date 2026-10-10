import { useCallback, useEffect, useRef, useState } from "react";
import { roundTo3 } from "../../utils/rounding";
import { Pencil, X } from "lucide-react";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { usePlayerStore } from "../../player";
import { buildTimelineAgentPrompt, type CanvasRegionContext } from "../../player/components/timelineEditing";
import { getSelectionPolygon, polygonIntersectsRect, type Point } from "../../utils/marqueeGeometry";
import { findElementForTimelineElement, getDomLayerPatchTarget, isElementComputedVisible, resolveAllVisualDomEditTargets } from "../editor/domEditingElement";
import { isHtmlElement } from "../editor/domEditingDom";
import { deliverStudioAgentPrompt } from "../editor/domEditingAgentPrompt";
import { AskAgentModal } from "../AskAgentModal";

/** Drawing is transient context; the official timeline prompt carries the edit request. */
export function CanvasAnnotation() {
  const { projectId, activeCompPath, compositionDimensions, previewIframeRef, showToast } =
    useStudioShellContext();
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [annotation, setAnnotation] = useState<{
    label: string;
    context: Parameters<typeof buildTimelineAgentPrompt>[0];
  } | null>(null);
  const stroke = useRef<Point[]>([]);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const pressed = useRef(false);
  const time = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const reset = useCallback(() => {
    pressed.current = false;
    setPoints([]);
    stroke.current = [];
    setAnnotation(null);
    setDrawing(false);
  }, []);
  useEffect(() => {
    reset();
  }, [projectId, activeCompPath, reset]);
  useEffect(() => {
    if (drawing && Math.abs(currentTime - time.current) > 0.001) reset();
  }, [drawing, currentTime, reset]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !annotation) reset();
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [reset, annotation]);
  const pointAt = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };
  const finishDrawing = () => {
    const polygon = getSelectionPolygon(stroke.current);
    if (!polygon.length) {
      showToast("请用画笔圈出一个区域，松开后填写批注", "info");
      return;
    }
    const canvas = previewIframeRef.current?.getBoundingClientRect();
    const overlay = svgRef.current?.getBoundingClientRect();
    if (!compositionDimensions || !canvas || !overlay || canvas.width <= 0 || canvas.height <= 0) {
      showToast("画面尚未就绪，请稍后重试", "error");
      return;
    }
    const outline = polygon.map((point) => ({
      x: roundTo3(
        Math.max(
          0,
          Math.min(
            100,
            ((overlay.left + (point.x / 100) * overlay.width - canvas.left) /
              canvas.width) *
              100,
          ),
        ),
      ),
      y: roundTo3(
        Math.max(
          0,
          Math.min(
            100,
            ((overlay.top + (point.y / 100) * overlay.height - canvas.top) /
              canvas.height) *
              100,
          ),
        ),
      ),
    }));
    const xs = outline.map((point) => point.x),
      ys = outline.map((point) => point.y);
    if (
      Math.max(...xs) - Math.min(...xs) < 0.1 ||
      Math.max(...ys) - Math.min(...ys) < 0.1
    ) {
      showToast("请在画面内圈出一个区域", "error");
      return;
    }
    const region: CanvasRegionContext = {
      timeSeconds: roundTo3(time.current),
      unit: "percent-of-frame",
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: roundTo3(Math.max(...xs) - Math.min(...xs)),
      height: roundTo3(Math.max(...ys) - Math.min(...ys)),
      frameSize: compositionDimensions,
      outline,
      targets: [],
    };
    const state = usePlayerStore.getState();
    const iframe = previewIframeRef.current;
    const doc = iframe?.contentDocument;
    const width = doc?.documentElement.clientWidth || iframe?.clientWidth || compositionDimensions.width;
    const height = doc?.documentElement.clientHeight || iframe?.clientHeight || compositionDimensions.height;
    const boundsFor = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { x: roundTo3(box.left / width * 100), y: roundTo3(box.top / height * 100),
        width: roundTo3(box.width / width * 100), height: roundTo3(box.height / height * 100) };
    };
    const intersects = (element: HTMLElement) => {
      if (!isElementComputedVisible(element)) return false;
      const bounds = boundsFor(element);
      const rect = { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height };
      return polygonIntersectsRect(outline, rect);
    };
    if (doc) {
      const candidates = [...doc.querySelectorAll("body *")].filter(isHtmlElement).filter(intersects);
      // A card can own text alongside a nested badge; deepest-only click targeting
      // would discard that text even though both objects intersect the annotation.
      const ownText = (element: HTMLElement) => [...element.childNodes]
        .filter((node) => node.nodeType === 3).map((node) => node.textContent || "").join(" ").trim();
      const targets = new Set([...resolveAllVisualDomEditTargets(candidates, { activeCompositionPath: activeCompPath }),
        ...candidates.filter((element) => ownText(element))]);
      region.targets = [...targets]
        .flatMap((element) => {
          const target = getDomLayerPatchTarget(element, activeCompPath);
          return target ? [{ ...target, id: target.id ?? undefined, text: ownText(element).slice(0, 200), bounds: boundsFor(element) }] : [];
        });
    }
    const context: Parameters<typeof buildTimelineAgentPrompt>[0] = {
      sourceFile: activeCompPath || "index.html",
      rangeStart: time.current,
      rangeEnd: time.current,
      elements: state.elements.filter((element) => {
        if (element.start > time.current || element.start + element.duration <= time.current) return false;
        if (!doc) return true;
        const target = findElementForTimelineElement(doc, element, { activeCompositionPath: activeCompPath, isMasterView: !activeCompPath });
        return target ? intersects(target) : false;
      }),
      selectionKind: "canvas-region",
      canvasRegion: region,
      prompt: "",
    };
    setAnnotation({
      context,
      label: `画面圈选 · ${region.timeSeconds.toFixed(3)} 秒\n位置 ${region.x.toFixed(1)}%, ${region.y.toFixed(1)}% · 大小 ${region.width.toFixed(1)}% × ${region.height.toFixed(1)}%\n${region.targets.length ? `已定位 ${region.targets.length} 个圈内对象` : "已记录画面范围，AI 将结合源文件定位"}`,
    });
  };
  return (
    <>
      <button
        type="button"
        aria-label="圈画区域后交给 AI"
        aria-pressed={drawing}
        disabled={Boolean(annotation)}
        className="pointer-events-auto absolute left-4 top-4 z-50 rounded-md bg-panel-bg p-2 text-panel-text-1 shadow"
        onClick={() => {
          if (drawing) {
            reset();
            return;
          }
          const state = usePlayerStore.getState();
          time.current = state.currentTime;
          state.setIsPlaying(false);
          setDrawing(true);
        }}
      >
        <Pencil size={15} />
      </button>
      {drawing && (
        <div
          className="pointer-events-auto absolute inset-0 z-40"
          data-testid="canvas-annotation"
        >
          <svg
            ref={svgRef}
            className="hf-annotation-drawing absolute inset-0 h-full w-full touch-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onPointerDown={(event) => {
              if (event.button !== 0 || annotation) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              pressed.current = true;
              stroke.current = [pointAt(event)];
              setPoints(stroke.current);
            }}
            onPointerMove={(event) => {
              if (!pressed.current) return;
              const point = pointAt(event);
              const previous = stroke.current[stroke.current.length - 1]!;
              if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.2) return;
              if (stroke.current.length >= 160) stroke.current = stroke.current.filter((_, index) => index % 2 === 0);
              stroke.current = [...stroke.current, point];
              setPoints(stroke.current);
            }}
            onPointerUp={(event) => {
              if (!pressed.current) return;
              pressed.current = false;
              finishDrawing();
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              pressed.current = false;
              stroke.current = [];
              setPoints([]);
            }}
          >
            <polyline
              className="text-studio-accent"
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {!annotation && <div className="absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-panel-border bg-panel-bg px-3 py-2 text-xs text-panel-text-2 shadow-lg">
            <span>用画笔圈出画面区域，松开后填写 AI 批注 · Esc 取消</span>
            <button type="button" aria-label="取消圈画" onClick={reset}><X size={15} /></button>
          </div>}
        </div>
      )}
      {annotation && <AskAgentModal
        selectionLabel={annotation.label}
        contextPreview={buildTimelineAgentPrompt(annotation.context)}
        allowEmptyInstruction
        onClose={reset}
        onSubmit={async (instruction) => {
          const request = instruction || "修改圈画区域中的内容";
          const sourceFile = annotation.context.sourceFile || "index.html";
          const accepted = await deliverStudioAgentPrompt(buildTimelineAgentPrompt({
            ...annotation.context,
            prompt: request,
          }), sourceFile, { instruction: request, requireCompleteContext: true });
          if (!accepted) throw new Error("无法发送批注，请重试");
          showToast(window.parent === window ? "已复制画面批注" : "已交给左侧 AI 对话", "info");
          reset();
        }}
      />}
    </>
  );
}
