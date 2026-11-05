/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Clapperboard, ExternalLink, Eye, FolderOpen, Globe2, Loader2, Palette } from "lucide-react";

import type { DesktopApplication } from "@/app/lib/desktop";
import { getDesktopApplicationsForFile, openDesktopWithApp } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { t } from "@/i18n";

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const SUPPORTED_PANEL_PREVIEWS = new Set(["markdown", "sheet", "slides", "image", "pdf", "html", "text"]);

type LinkActionMenuProps = {
  target: OpenTarget;
  anchorRect: DOMRect;
  onOpenTarget: (target: OpenTarget, options?: OpenTargetOptions) => void;
  onClose: () => void;
};

export function LinkActionMenu({ target, anchorRect, onOpenTarget, onClose }: LinkActionMenuProps) {
  const [apps, setApps] = useState<DesktopApplication[] | null>(null);
  const [appsLoading, setAppsLoading] = useState(false);
  const canOpenInPanel = target.kind === "file" && SUPPORTED_PANEL_PREVIEWS.has(target.preview);
  const isHtmlFile = target.kind === "file" && target.preview === "html";
  const canOpenInVideoStudio = isHtmlFile
    && /(?:^|\/)video\/[^/]+\/index\.html$/i.test(target.value.replaceAll("\\", "/"));
  const canOpenExternally = isElectronRuntime() && target.kind === "file";

  useEffect(() => {
    if (!canOpenExternally) return;
    setAppsLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDesktopApplicationsForFile(target.value);
        if (!cancelled) {
          setApps(result.slice(0, 12));
        }
      } catch {
        if (!cancelled) setApps([]);
      } finally {
        if (!cancelled) setAppsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canOpenExternally, target.value]);

  const handleOpenDefault = () => {
    onOpenTarget(target, { external: true });
    onClose();
  };

  const handleOpenInPanel = () => {
    onOpenTarget(target);
    onClose();
  };

  const handleOpenWithViewer = (viewer: "design" | "preview" | "video") => {
    onOpenTarget(target, { viewer });
    onClose();
  };

  const handleReveal = () => {
    onOpenTarget(target, { external: true, reveal: true });
    onClose();
  };

  const handleOpenWithApp = async (app: DesktopApplication) => {
    try {
      await openDesktopWithApp(target.value, app.appPath);
    } catch {
      // fall back to default open
      onOpenTarget(target, { external: true });
    }
    onClose();
  };

  return (
    <DropdownMenu open onOpenChange={open => { if (!open) onClose(); }}>
      <DropdownMenuTrigger aria-label={t("session.outputs.more_actions")} style={{position:"fixed",left:anchorRect.left,top:anchorRect.top,width:anchorRect.width,height:anchorRect.height,opacity:0,pointerEvents:"none"}} />
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-16px)]" positionerClassName="z-[80]">
      <DropdownMenuItem
        onClick={handleOpenDefault}
        disabled={!canOpenExternally}
      >
        <ExternalLink className="size-4 shrink-0" />
        {t("link_action.open_default")}
      </DropdownMenuItem>
      {canOpenInPanel ? (
        <DropdownMenuItem
          onClick={handleOpenInPanel}
        >
          <Eye className="size-4 shrink-0" />
          {t(isHtmlFile ? "link_action.open_recommended" : "link_action.open_panel")}
        </DropdownMenuItem>
      ) : null}
      {isHtmlFile ? (
        <>
          <DropdownMenuItem
            onClick={() => handleOpenWithViewer("design")}
          >
            <Palette className="size-4 shrink-0" />
            {t("link_action.open_design")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleOpenWithViewer("preview")}
          >
            <Globe2 className="size-4 shrink-0" />
            {t("link_action.open_web_preview")}
          </DropdownMenuItem>
          {canOpenInVideoStudio ? (
            <DropdownMenuItem
              onClick={() => handleOpenWithViewer("video")}
            >
              <Clapperboard className="size-4 shrink-0" />
              {t("link_action.open_video_studio")}
            </DropdownMenuItem>
          ) : null}
        </>
      ) : null}
      <DropdownMenuItem
        onClick={handleReveal}
        disabled={!canOpenExternally}
      >
        <FolderOpen className="size-4 shrink-0" />
        {t("link_action.show_in_folder")}
      </DropdownMenuItem>
      {canOpenExternally && apps && apps.length > 0 ? (
        <>
          <div className="my-1 h-px bg-foreground/5" />
          <div className="max-h-48 overflow-y-auto">
            {apps.map((app) => (
              <DropdownMenuItem
                key={app.appPath}
                onClick={() => void handleOpenWithApp(app)}
              >
                {app.icon ? (
                  <img src={app.icon} alt="" className="size-4 shrink-0 object-contain" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="truncate">{app.name}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </>
      ) : appsLoading ? (
        <>
          <div className="my-1 h-px bg-foreground/5" />
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            {t("link_action.loading_apps")}
          </div>
        </>
      ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
