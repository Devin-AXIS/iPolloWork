import { forwardRef, lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { MediaAnnotatorWrapper, useAnnotationCtx, useTool } from "@labelu/audio-annotator-react";
import type { AnnotatorProps, AudioAndVideoAnnotatorRef, MediaPlayerProps } from "@labelu/audio-annotator-react";
import { AnnotationPanels } from "./annotation-panels";
import type { AnnotationPanelProps } from "./annotation-panels";
import "@labelu/video-react/dist/style.css";

const AudioPlayer = lazy(() => import("@labelu/audio-react"));
const VideoPlayer = lazy(() => import("@labelu/video-react"));
type MediaExtensions = AnnotationPanelProps & { modality: "audio" | "video"; onDirty: () => void };

function MediaPanels({ modality, onDirty, ...panelProps }: MediaExtensions) {
  const { attributeModalOpen, labels, player, config, selectedLabel, requestEdit, onAttributeChange } = useTool();
  const { annotationsWithGlobal, selectedAnnotation, sortedMediaAnnotations, disabled, onAnnotationChange, onAnnotationSelect } = useAnnotationCtx();
  // Observe actual data, including native delete/undo/redo. View controls and label drafts are not edits.
  const annotationSnapshot = useMemo(() => JSON.stringify(
    Object.values(annotationsWithGlobal).map(annotation => {
      if (!("visible" in annotation)) return annotation;
      const { visible: _visible, ...data } = annotation;
      return data;
    }),
  ), [annotationsWithGlobal]);
  const previousSnapshot = useRef(annotationSnapshot);
  useEffect(() => {
    if (previousSnapshot.current !== annotationSnapshot && !disabled) onDirty();
    previousSnapshot.current = annotationSnapshot;
  }, [annotationSnapshot, disabled, onDirty]);
  const selected = selectedAnnotation;
  useEffect(() => {
    if (!selected) return;
    const time = selected.type === "frame" ? selected.time : selected.start;
    const video = document.querySelector<HTMLVideoElement>(".labelu-video-wrapper video");
    if (video) { video.pause(); video.currentTime = time; }
    else { player.pause(); player.setCurrentTime(time); }
  }, [selected?.id, player]);
  const name = selected?.attributes?.标记名称;
  const description = selected?.attributes?.描述;
  const update = (field: "标记名称" | "描述", value: string) => {
    if (!selected || disabled || (requestEdit && !requestEdit("update", { toolName: selected.type, label: selected.label }))) return;
    const attributes = { ...selected.attributes };
    if (value) attributes[field] = value; else delete attributes[field];
    // LabelU’s runtime accepts AttributeForm payloads; its published type incorrectly describes a flat record.
    Reflect.apply(onAttributeChange, undefined, [{ attributes }]);
  };
  return <>
    {modality === "video" ? <button className="secondary-button compact" type="button" disabled={disabled}
      onClick={event => {
        const label = config?.frame?.find(item => item.value === selectedLabel?.value) ?? config?.frame?.[0];
        if (!label || disabled || (requestEdit && !requestEdit("create", { toolName: "frame", label: label.value }))) return;
        const video = document.querySelector<HTMLVideoElement>(".labelu-video-wrapper video");
        if (!video || video.readyState < 2) return;
        video.pause();
        const time = video.currentTime;
        const existing = sortedMediaAnnotations.find(item => item.type === "frame" && Math.abs(item.time - time) < 0.001 && item.label === label.value);
        const frame = existing ?? { id: crypto.randomUUID(), type: "frame" as const, time, label: label.value,
          order: Math.max(0, ...sortedMediaAnnotations.map(item => item.order)) + 1 };
        if (!existing) onAnnotationChange(frame);
        onAnnotationSelect(frame, event);
      }}>标记当前关键帧</button> : null}
    <AnnotationPanels {...panelProps} rootSelector=".labelu-audio-editor" annotations={sortedMediaAnnotations} attributeModalOpen={attributeModalOpen}>
      {selected ? <>
        <strong>{selected.type === "frame" ? `关键帧 · ${selected.time.toFixed(2)} 秒` : `片段 · ${selected.start.toFixed(2)}–${selected.end.toFixed(2)} 秒`}</strong>
        <label>标记名称<input aria-label="标记名称" maxLength={80} disabled={disabled} placeholder="为这条标记命名"
          value={typeof name === "string" ? name : ""} onChange={event => update("标记名称", event.currentTarget.value)} /></label>
        <label>描述<textarea aria-label="标注描述" rows={4} maxLength={2000} disabled={disabled} placeholder="描述此片段或关键帧的内容…"
          value={typeof description === "string" ? description : ""} onChange={event => update("描述", event.currentTarget.value)} /></label>
        <label>标签类别<select aria-label="标记标签类别" disabled={disabled} value={selected.label} onChange={event => {
          if (disabled || (requestEdit && !requestEdit("update", { toolName: selected.type, label: selected.label }))) return;
          Reflect.apply(onAttributeChange, undefined, [{ label: event.currentTarget.value, attributes: selected.attributes ?? {} }]);
        }}>{labels.map(label => <option key={label.value} value={label.value}>{label.key}</option>)}</select></label>
        <p className="muted">名称与描述随项目保存。</p>
      </> : null}
    </AnnotationPanels>
  </>;
}

// Use the player's existing lower timeline for drag selection, resizing and history.
function MediaPlayer({ modality, ...props }: MediaPlayerProps & Pick<MediaExtensions, "modality">) {
  const Player = modality === "audio" ? AudioPlayer : VideoPlayer;
  // LabelU reloads audio when this callback changes.
  const onLoad = useCallback(() => props.onLoad?.(), [props.onLoad]);
  return <div className="media-selection-player">
    <Suspense fallback={<div className="engine-loading">正在加载标注器…</div>}>
      <Player {...props} onLoad={onLoad} onAnnotateEnd={() => { /* Edit from the right-hand list after creation. */ }} className={`labelu-${modality}-wrapper`} />
    </Suspense>
  </div>;
}

export default forwardRef<AudioAndVideoAnnotatorRef, AnnotatorProps & MediaExtensions>(
  function MediaAnnotator({ modality, onDirty, labelsPanel, panelTab, onPanelTabChange, labelsBusy, ...props }, ref) {
    return <MediaAnnotatorWrapper {...props} ref={ref} selectedLabel={props.selectedLabel ?? props.config?.segment?.[0]?.value}
      toolbarRight={<MediaPanels modality={modality} onDirty={onDirty} labelsPanel={labelsPanel} panelTab={panelTab} onPanelTabChange={onPanelTabChange} labelsBusy={labelsBusy} />}>
      {playerProps => <MediaPlayer key={playerProps.src} {...playerProps} modality={modality} />}
    </MediaAnnotatorWrapper>;
  },
);
