import { useStudioShellContext } from "../../contexts/StudioContext";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { formatTime } from "../lib/time";
import { buildTimelineAgentPrompt } from "./timelineEditing";
import { deliverStudioAgentPrompt } from "../../components/editor/domEditingAgentPrompt";
import { AskAgentModal } from "../../components/AskAgentModal";

interface EditPopoverProps {
  rangeStart: number;
  rangeEnd: number;
  anchorX?: number;
  anchorY?: number;
  selectedElements?: TimelineElement[];
  onClose: () => void;
}

export function EditPopover({ rangeStart, rangeEnd, selectedElements, onClose }: EditPopoverProps) {
  const { activeCompPath, showToast } = useStudioShellContext();
  const elements = usePlayerStore((state) => state.elements);
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const elementsInRange = selectedElements ?? elements.filter((element) =>
    element.start < end && element.start + element.duration > start,
  );

  return (
    <AskAgentModal
      selectionLabel={`${selectedElements ? `选中片段 · ${selectedElements.map((element) => element.label || element.id).join("、")}\n` : "时间范围 · "}${formatTime(start)} — ${formatTime(end)} (${(end - start).toFixed(3)} 秒)`}
      contextPreview={buildTimelineAgentPrompt({
        sourceFile: activeCompPath || "index.html", rangeStart: start, rangeEnd: end,
        elements: elementsInRange, prompt: "",
      })}
      allowEmptyInstruction
      copyInstruction
      onSubmit={async (instruction) => {
        const sourceFile = activeCompPath || "index.html";
        const copied = await deliverStudioAgentPrompt(buildTimelineAgentPrompt({
          sourceFile, rangeStart: start, rangeEnd: end, elements: elementsInRange,
          prompt: instruction,
        }), sourceFile, { instruction: instruction || "修改选定时间范围内的视频内容" });
        if (!copied) throw new Error("无法复制提示词，请重试");
        showToast(window.parent === window ? "已复制提示词" : "已交给左侧 AI 对话", "info");
        onClose();
      }}
      onClose={onClose}
    />
  );
}
