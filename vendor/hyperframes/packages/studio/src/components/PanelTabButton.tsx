import { Tooltip } from "./ui";

/** Tab-bar button for the right inspector panel header. */
export function PanelTabButton({
  label,
  tooltip,
  active,
  onClick,
}: {
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        style={active ? { color: "#ffffff" } : undefined}
        className={`relative z-10 h-7 rounded-[7px] px-[11px] text-[11px] font-medium transition-[background-color,color,box-shadow,transform] hover:z-20 hover:shadow-[0_5px_12px_rgba(0,0,0,0.14)] active:scale-[0.98] ${
          active
            ? "bg-[#171816] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
            : "text-[#858a94] hover:bg-panel-input hover:text-panel-text-1"
        }`}
      >
        <span className="relative z-10 whitespace-nowrap text-current">{label}</span>
      </button>
    </Tooltip>
  );
}
