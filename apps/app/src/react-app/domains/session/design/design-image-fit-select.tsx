/** @jsxImportSource react */
import { DesignPanelSelect } from "./design-panel-select";

export type DesignImageFitMode = "fill" | "fit" | "crop";

type DesignImageFitSelectProps = {
  value: DesignImageFitMode;
  onChange: (value: DesignImageFitMode) => void;
  className?: string;
  ariaLabel?: string;
};

export function DesignImageFitSelect({ value, onChange, className, ariaLabel = "Image fit mode" }: DesignImageFitSelectProps) {
  return (
    <DesignPanelSelect
      value={value}
      options={IMAGE_FIT_OPTIONS}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={className ?? "h-[34px] w-full rounded-lg bg-[#f5f6f9]"}
    />
  );
}

const IMAGE_FIT_OPTIONS = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "crop", label: "Crop" },
] as const;
