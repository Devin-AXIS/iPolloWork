import { publicAssetUrl } from "@/app/lib/public-asset";
import { cn } from "@/lib/utils";

export const NAVIGATION_ICON_STROKE_WIDTH = 1.5;

const PROJECT_FOLDER_ICON_URL = publicAssetUrl("sidebar-icon/figma-folder-closed.svg");

export function ProjectFolderIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block h-3 w-3.5 shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url(${PROJECT_FOLDER_ICON_URL})`,
        maskImage: `url(${PROJECT_FOLDER_ICON_URL})`,
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
