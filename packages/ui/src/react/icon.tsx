import { Plus, Minus, X, Check, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Download, Upload, Copy, RefreshCw, LoaderCircle, Settings, MoreHorizontal, Trash2, Pencil, File, Folder, Image, Play, Pause, ExternalLink, Info, TriangleAlert, CircleCheck, CircleX, Save, Send, type LucideProps } from "lucide-react";
import { cn } from "../common/control-styles";

const icons = { Plus, Minus, X, Check, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Download, Upload, Copy, RefreshCw, LoaderCircle, Settings, MoreHorizontal, Trash2, Pencil, File, Folder, Image, Play, Pause, ExternalLink, Info, TriangleAlert, CircleCheck, CircleX, Save, Send };
export type IconName = keyof typeof icons;
export const ICON_NAMES: readonly IconName[] = Object.keys(icons).filter((name): name is IconName => name in icons);
const sizes = {
  s: { pixels: 14, className: "size-[14px]" },
  m: { pixels: 16, className: "size-[16px]" },
  l: { pixels: 20, className: "size-[20px]" },
};
export type IconProps = Omit<LucideProps, "size" | "aria-label" | "aria-hidden" | "role" | "children"> & {
  name: IconName;
  size?: keyof typeof sizes;
  label?: string;
  "data-icon"?: "inline-start" | "inline-end";
};

export function Icon({ name, size = "m", label, className, style, ...props }: IconProps) {
  const Glyph = icons[name];
  const { pixels, className: sizeClassName } = sizes[size];
  return <Glyph {...props} data-slot="icon" data-icon-name={name} data-icon-size={size}
    className={cn("shrink-0", sizeClassName, className)}
    style={{ ...style, width: pixels, height: pixels, flexShrink: 0 }}
    role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false" />;
}
