/* ------------------------------------------------------------------ */
/*  FlatToggle — Layer inspector switch row                            */
/*  (split out of propertyPanelFlatPrimitives.tsx to stay under the    */
/*  600-line file-size gate)                                           */
/* ------------------------------------------------------------------ */

import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";

export function FlatToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const track = useTrackDesignInput();
  return (
    <div className="flex h-[34px] items-center justify-between rounded-[6px] bg-panel-input px-[10px]">
      <span
        data-flat-toggle-label="true"
        className="text-[10px] font-normal text-[#858a94]"
      >
        {label}
      </span>
      <button
        type="button"
        data-flat-toggle="true"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          track("toggle", label);
          onChange(!checked);
        }}
        className={`relative h-4 w-7 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-panel-accent/35" : "bg-panel-hover"
        }`}
      >
        <span
          data-flat-toggle-knob="true"
          className={`absolute top-0.5 size-3 rounded-full transition-all ${
            checked ? "right-0.5 bg-panel-accent" : "left-0.5 bg-panel-text-4"
          }`}
        />
      </button>
    </div>
  );
}
