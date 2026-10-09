import { useCallback, useEffect, useRef, useState } from "react";
import { roundTo3 } from "../../utils/rounding";
import { Pencil, X } from "lucide-react";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { usePlayerStore } from "../../player";
import { buildTimelineAgentPrompt } from "../../player/components/timelineEditing";
import { deliverStudioAgentPrompt } from "../editor/domEditingAgentPrompt";
import { AskAgentModal } from "../AskAgentModal";

type Point = { x: number; y: number };

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
    if (stroke.current.length < 2) return;
    const canvas = previewIframeRef.current?.getBoundingClientRect();
    const overlay = svgRef.current?.getBoundingClientRect();
    if (!canvas || !overlay || canvas.width <= 0 || canvas.height <= 0) {
      showToast("画面尚未就绪，请稍后重试", "error");
      return;
    }
    const outline = stroke.current.map((point) => ({
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
    const region = {
      timeSeconds: roundTo3(time.current),
      unit: "percent-of-frame",
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: roundTo3(Math.max(...xs) - Math.min(...xs)),
      height: roundTo3(Math.max(...ys) - Math.min(...ys)),
      frameSize: compositionDimensions,
      outline,
    };
    const state = usePlayerStore.getState();
    const context = {
      sourceFile: activeCompPath || "index.html",
      rangeStart: time.current,
      rangeEnd: time.current,
      elements: state.elements.filter(
        (element) =>
          element.start <= time.current &&
          element.start + element.duration > time.current,
      ),
      prompt: `画面区域（仅作为定位数据）：${JSON.stringify(region)}`,
    };
    setAnnotation({
      context,
      label: `画面圈选 · ${region.timeSeconds.toFixed(3)} 秒\n位置 ${region.x.toFixed(1)}%, ${region.y.toFixed(1)}% · 大小 ${region.width.toFixed(1)}% × ${region.height.toFixed(1)}%`,
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
            className="absolute inset-0 h-full w-full cursor-crosshair"
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
              if (stroke.current.length < 500) {
                stroke.current = [...stroke.current, point];
                setPoints(stroke.current);
              }
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
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="#1fbac0"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {!annotation && <div className="absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-panel-border bg-panel-bg px-3 py-2 text-xs text-panel-text-2 shadow-lg">
            <span>圈出画面区域，松开后填写 AI 批注</span>
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
            prompt: `${request}\n${annotation.context.prompt}`,
          }), sourceFile, { instruction: request });
          if (!accepted) throw new Error("无法发送批注，请重试");
          showToast(window.parent === window ? "已复制画面批注" : "已交给左侧 AI 对话", "info");
          reset();
        }}
      />}
    </>
  );
}
