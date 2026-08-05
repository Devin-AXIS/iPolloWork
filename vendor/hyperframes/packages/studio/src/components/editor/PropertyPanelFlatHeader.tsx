import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { ClipboardList, X } from "../../icons/SystemIcons";

export function PropertyPanelFlatHeader({
  name,
  meta,
  elementKind,
  hidden,
  onToggleHidden,
  copied,
  onCopy,
  onClear,
  onUngroup,
  showUngroup,
}: {
  name: string;
  meta: string;
  elementKind: "text" | "media" | "other";
  hidden: boolean;
  onToggleHidden?: () => void;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
  onUngroup?: () => void;
  showUngroup: boolean;
}) {
  const track = useTrackDesignInput();
  const visibilityLabel = hidden ? "Show element" : "Hide element";

  return (
    <div
      data-element-kind={elementKind}
      className="group flex min-h-12 items-center gap-2.5 border-b border-panel-hairline px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-semibold text-[#171816] dark:text-panel-text-0">
          {name}
        </span>
        <span className="truncate text-[10px] text-[#858a94]">{meta}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 text-panel-text-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {showUngroup && (
          <button
            type="button"
            aria-label="Ungroup"
            title="Ungroup (⌘⇧G)"
            onClick={() => {
              track("button", "Ungroup");
              onUngroup?.();
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
              <rect x="7.5" y="7.5" width="7" height="7" rx="1" />
            </svg>
          </button>
        )}
        {onToggleHidden && (
          <button
            type="button"
            aria-label={visibilityLabel}
            title={visibilityLabel}
            onClick={() => {
              track("toggle", "Element visibility");
              onToggleHidden();
            }}
          >
            {hidden ? <EyeSlash size={13} weight="bold" /> : <Eye size={13} weight="bold" />}
          </button>
        )}
        <button
          type="button"
          aria-label="Copy element info to clipboard"
          title={copied ? "Copied!" : "Copy element info for any AI agent"}
          onClick={() => {
            track("button", "Copy element info");
            onCopy();
          }}
          className={copied ? "text-panel-accent" : undefined}
        >
          <ClipboardList size={13} />
        </button>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => {
            track("button", "Clear selection");
            onClear();
          }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
