import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import askAiSparkleSrc from "../../icons/figmaAskAiSparkle.svg?url";

export function PropertyPanelFlatHeader({
  name,
  meta,
  elementKind,
  onAskAgent,
}: {
  name: string;
  meta: string;
  elementKind: "text" | "media" | "other";
  onAskAgent?: () => void;
}) {
  const track = useTrackDesignInput();

  return (
    <div
      data-element-kind={elementKind}
      className="flex min-h-[69px] items-center justify-between gap-3 border-b-[0.5px] border-[#ebebeb] px-4 py-4 dark:border-panel-hairline"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold tracking-[-0.3px] text-[#171816] dark:text-panel-text-0">
          {name}
        </span>
        <span className="truncate text-[12px] tracking-[-0.3px] text-[#858a94]">{meta}</span>
      </div>
      <button
        type="button"
        aria-label="Ask AI about selected element"
        title="Ask AI"
        disabled={!onAskAgent}
        onClick={() => {
          track("button", "Ask agent");
          onAskAgent?.();
        }}
        className="hf-property-ask-ai flex h-8 flex-shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#54b2ff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-[#ffcc73]/70 dark:focus-visible:ring-offset-panel-bg"
      >
        <img src={askAiSparkleSrc} alt="" aria-hidden="true" className="size-[18px] flex-shrink-0" />
        <span className="hf-property-ask-ai__label whitespace-nowrap">Ask AI</span>
      </button>
    </div>
  );
}
