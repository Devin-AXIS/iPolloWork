import { forwardRef, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { MediaAnnotatorWrapper } from "@labelu/audio-annotator-react";
import type { AnnotatorProps, AudioAndVideoAnnotatorRef, MediaPlayerProps } from "@labelu/audio-annotator-react";
import "@labelu/video-react/dist/style.css";

const AudioPlayer = lazy(() => import("@labelu/audio-react"));
const VideoPlayer = lazy(() => import("@labelu/video-react"));

// Keep the library's annotation/history owner; this adds only a pointer input surface.
function DragSelectionPlayer({ modality, ...props }: MediaPlayerProps & { modality: "audio" | "video" }) {
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [notice, setNotice] = useState("");
  const gesture = useRef<{ pointerId: number; start: number; clientX: number } | null>(null);
  const enabled = duration > 0 && !props.disabled && props.editingType === "segment"
    && props.toolConfig?.segment?.some((label) => label.value === props.editingLabel);
  const timeAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
  };
  const cancel = () => { gesture.current = null; setSelection(null); };
  useEffect(() => {
    if (!loaded) return;
    const player: unknown = props.playerRef.current;
    if (player && typeof player === "object") {
      const method = Reflect.get(player, modality === "audio" ? "getDuration" : "duration");
      const value: unknown = typeof method === "function" ? method.call(player) : 0;
      setDuration(typeof value === "number" && Number.isFinite(value) ? value : 0);
    }
  }, [loaded, modality, props.playerRef]);
  const onLoad = () => { setLoaded(true); props.onLoad?.(); };
  const Player = modality === "audio" ? AudioPlayer : VideoPlayer;
  return <div className="media-selection-player" onDurationChangeCapture={(event) => {
    const media = event.target;
    if (media instanceof HTMLMediaElement && Number.isFinite(media.duration)) setDuration(media.duration);
  }}>
    <Suspense fallback={<div className="engine-loading">正在加载标注器…</div>}>
      <Player {...props} onLoad={onLoad} className={`labelu-${modality}-wrapper`} />
    </Suspense>
    <div className="media-drag-panel">
      <div className="media-drag-heading">
        <strong>拖拽选区标注</strong>
        <span>{enabled ? "按住鼠标左键拖出时间区间，松开创建；Esc 取消。" : duration ? "请先选择片段工具和标签。" : "正在读取媒体时长…"}</span>
      </div>
      <div className="media-drag-track" role="group" aria-label="拖拽选区时间轴" aria-disabled={!enabled}
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}
        onPointerDown={(event) => {
          if (!enabled || event.button !== 0 || !event.isPrimary || gesture.current) return;
          if (props.requestEdit && !props.requestEdit("create", { toolName: "segment", label: props.editingLabel })) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = timeAt(event);
          gesture.current = { pointerId: event.pointerId, start, clientX: event.clientX };
          setSelection({ start, end: start });
          setNotice("");
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (active?.pointerId === event.pointerId) setSelection({ start: active.start, end: timeAt(event) });
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const end = timeAt(event);
          cancel();
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (!enabled || Math.abs(event.clientX - active.clientX) < 4 || Math.abs(end - active.start) < 0.05) return;
          const annotation = {
            id: crypto.randomUUID(), type: "segment" as const,
            start: Math.min(active.start, end), end: Math.max(active.start, end),
            label: props.editingLabel ?? "", order: Math.max(0, ...props.annotations.map((item) => item.order)) + 1,
          };
          props.onAdd?.(annotation);
          props.onAnnotateEnd?.(annotation);
          props.annotatorRef?.current?.scrollToAnnotation(annotation);
          setNotice(`已新增 ${annotation.start.toFixed(2)}–${annotation.end.toFixed(2)} 秒片段`);
        }}>
        {[0, 25, 50, 75, 100].map((percent) => <span key={percent} className="media-drag-tick" style={{ left: `${percent}%` }}>{(duration * percent / 100).toFixed(1)}s</span>)}
        {selection && duration > 0 ? <div className="media-drag-preview" style={{
          left: `${Math.min(selection.start, selection.end) / duration * 100}%`,
          width: `${Math.abs(selection.end - selection.start) / duration * 100}%`,
        }} /> : null}
      </div>
      <div className="media-drag-notice" aria-live="polite">{selection ? `${Math.min(selection.start, selection.end).toFixed(2)}–${Math.max(selection.start, selection.end).toFixed(2)} 秒` : notice || "也可使用原标注轨道、快捷键和片段边缘调整。"}</div>
    </div>
  </div>;
}

export default forwardRef<AudioAndVideoAnnotatorRef, AnnotatorProps & { modality: "audio" | "video" }>(
  function MediaAnnotator({ modality, ...props }, ref) {
    return <MediaAnnotatorWrapper {...props} ref={ref} selectedLabel={props.selectedLabel ?? props.config?.segment?.[0]?.value}>
      {(playerProps) => <DragSelectionPlayer key={playerProps.src} {...playerProps} modality={modality} />}
    </MediaAnnotatorWrapper>;
  },
);
