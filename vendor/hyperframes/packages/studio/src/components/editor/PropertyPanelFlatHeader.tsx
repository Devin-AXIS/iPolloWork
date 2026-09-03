import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import askAiSparkleSrc from "../../icons/figmaAskAiSparkle.svg?url";
import askAiWordmarkSrc from "../../icons/figmaAskAiWordmark.svg?url";

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
  const { locale, tx } = useStudioI18n();

  return (
    <div
      data-element-kind={elementKind}
      className="flex min-h-[69px] items-center justify-between gap-3 border-b-[0.5px] border-[var(--hf-studio-divider)] px-4 py-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold tracking-[-0.3px] text-[#171816] dark:text-panel-text-0">
          {name}
        </span>
        <span className="truncate text-[12px] tracking-[-0.3px] text-[#858a94]">{meta}</span>
      </div>
      <button
        type="button"
        aria-label={tx("Ask AI about selected element")}
        title={tx("Ask AI")}
        disabled={!onAskAgent}
        onClick={() => {
          track("button", "Ask agent");
          onAskAgent?.();
        }}
        className="hf-property-ask-ai flex h-7 flex-shrink-0 items-center justify-center rounded-[6px] px-3 py-2 text-[12px] font-bold leading-none tracking-[1px] transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-panel-bg"
      >
        {locale === "zh" ? (
          <span className="flex items-center justify-center gap-1 whitespace-nowrap">
            <img
              src={askAiSparkleSrc}
              alt=""
              aria-hidden="true"
              className="h-3 w-[13px] flex-shrink-0"
            />
            <span>{tx("Ask AI")}</span>
          </span>
        ) : (
          <img
            src={askAiWordmarkSrc}
            alt=""
            aria-hidden="true"
            className="h-3 w-[54.063px] flex-shrink-0"
          />
        )}
      </button>
    </div>
  );
}
