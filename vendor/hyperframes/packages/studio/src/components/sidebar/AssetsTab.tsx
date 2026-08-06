// fallow-ignore-file code-duplication
import { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { MEDIA_EXT, FONT_EXT, isHtmlIllustrationAsset } from "../../utils/mediaTypes";
import { copyTextToClipboard } from "../../utils/clipboard";
import { usePlayerStore } from "../../player/store/playerStore";
import { type MediaCategory, getCategory, FILTER_ORDER } from "./assetHelpers";
import { AudioRow } from "./AudioRow";
import { AssetCard, FontRow } from "./AssetCard";
import { useStudioI18n } from "../../i18n";
import importIconSrc from "../../icons/figmaAssetsImport.svg?url";
import searchIconSrc from "../../icons/figmaAssetsSearch.svg?url";
import { useStudioI18n } from "../../i18n";

const ASSET_VIRTUAL_OVERSCAN_PX = 480;

function VirtualAssetSlot({
  asset,
  visible,
  kind,
  register,
  render,
}: {
  asset: string;
  visible: boolean;
  kind: "tile" | "row";
  register: (asset: string, element: HTMLElement | null) => void;
  render: () => React.ReactNode;
}) {
  const setSlotRef = useCallback(
    (element: HTMLDivElement | null) => register(asset, element),
    [asset, register],
  );

  return (
    <div
      ref={setSlotRef}
      data-asset-path={asset}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: kind === "tile" ? "150px" : "52px",
      }}
    >
      {visible ? (
        render()
      ) : kind === "tile" ? (
        <div aria-hidden="true" className="min-w-0">
          <div className="aspect-[37/26] w-full rounded-lg bg-panel-input/35" />
          <div className="h-[23px]" />
        </div>
      ) : (
        <div aria-hidden="true" className="h-[52px] w-full" />
      )}
    </div>
  );
}

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onRefresh?: () => Promise<void> | void;
  onImport?: (files: FileList) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}

export type UsageFilter = "all" | "used" | "unused";

/** Filter assets by whether the composition references them. Pure — unit-tested. */
export function filterByUsage(
  assets: string[],
  usedPaths: Set<string>,
  usageFilter: UsageFilter,
): string[] {
  if (usageFilter === "used") return assets.filter((a) => usedPaths.has(a));
  if (usageFilter === "unused") return assets.filter((a) => !usedPaths.has(a));
  return assets;
}

/** Count used vs unused over a media set. Pure — unit-tested. */
export function countUsage(
  assets: string[],
  usedPaths: Set<string>,
): { used: number; unused: number } {
  let used = 0;
  for (const a of assets) if (usedPaths.has(a)) used++;
  return { used, unused: assets.length - used };
}

/**
 * Project-relative asset paths referenced by composition elements — the set the
 * "in use" badge, used-first sort, and usage filter all key on. Element src is
 * populated from the core runtime's `resolveNodeAssetUrl` which calls
 * `new URL(raw, document.baseURI).toString()`, turning authored relative paths
 * into fully-absolute URLs with percent-encoded characters, e.g.
 *   "assets/my file (1).mp4"
 *   → "http://localhost:3012/api/projects/demo/preview/assets/my%20file%20(1).mp4"
 *
 * This function normalizes every src shape to the bare project-relative path so
 * it matches the asset-list entries:
 *   - Absolute URL  → strip origin + /api/projects/<id>/preview/ prefix, decode %XX
 *   - Server-relative /api/…preview/… → same strip + decode
 *   - Relative "./"-prefixed or bare → strip leading ./ or /
 *   - ?query / #hash → dropped
 *
 * Pure — unit-tested.
 */
export function deriveUsedPaths(elements: Array<{ src?: string }>): Set<string> {
  const paths = new Set<string>();
  for (const el of elements) {
    if (!el.src) continue;
    let s = el.src;

    // Strip absolute origin if present (http://host/path → /path)
    try {
      const u = new URL(s);
      s = u.pathname + (u.search ? u.search : "") + (u.hash ? u.hash : "");
    } catch {
      // Not a valid absolute URL — leave as-is (relative path)
    }

    s = s
      .replace(/^\/api\/projects\/[^/]+\/preview\//, "") // strip the dev serve prefix
      .replace(/^\.?\//, "") // strip leading ./ or /
      .split(/[?#]/)[0]; // drop query / hash

    // Decode percent-encoded characters (spaces, parens, etc.) so the path
    // matches the plain-text asset-list entries the server returns.
    try {
      s = decodeURIComponent(s);
    } catch {
      // Malformed encoding — use as-is
    }

    if (s) paths.add(s);
  }
  return paths;
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  onRefresh,
  onImport,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: AssetsTabProps) {
  const { tx } = useStudioI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [visibleAssets, setVisibleAssets] = useState<Set<string>>(() => new Set());
  const assetObserverRef = useRef<IntersectionObserver | null>(null);
  const assetSlotsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [dragOver, setDragOver] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<MediaCategory>>(new Set());
  const [manifest, setManifest] = useState<
    Map<string, { description?: string; duration?: number; width?: number; height?: number }>
  >(new Map());
  const { t } = useStudioI18n();

  useEffect(() => {
    if (!onRefresh) return;
    const refreshVisibleAssets = () => {
      if (!document.hidden) void onRefresh();
    };
    refreshVisibleAssets();
    const interval = window.setInterval(refreshVisibleAssets, 2500);
    document.addEventListener("visibilitychange", refreshVisibleAssets);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisibleAssets);
    };
  }, [onRefresh, projectId]);

  const manifest404Ref = useRef<Set<string>>(new Set());
  const categoryLabels: Record<MediaCategory, string> = {
    audio: t("assets.categoryAudio"),
    images: t("assets.categoryImages"),
    video: t("assets.categoryVideo"),
    fonts: t("assets.categoryFonts"),
  };

  const registerAssetSlot = useCallback((asset: string, element: HTMLElement | null) => {
    const previous = assetSlotsRef.current.get(asset);
    if (previous && previous !== element) assetObserverRef.current?.unobserve(previous);

    if (element) {
      assetSlotsRef.current.set(asset, element);
      assetObserverRef.current?.observe(element);
      return;
    }

    assetSlotsRef.current.delete(asset);
    setVisibleAssets((current) => {
      if (!current.has(asset)) return current;
      const next = new Set(current);
      next.delete(asset);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!scrollRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleAssets((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            const asset = entry.target.getAttribute("data-asset-path");
            if (!asset) continue;
            if (entry.isIntersecting) {
              if (!next.has(asset)) {
                next.add(asset);
                changed = true;
              }
            } else if (next.delete(asset)) {
              changed = true;
            }
          }
          return changed ? next : current;
        });
      },
      {
        root: scrollRoot,
        rootMargin: `${ASSET_VIRTUAL_OVERSCAN_PX}px 0px`,
        threshold: 0,
      },
    );
    assetObserverRef.current = observer;
    for (const slot of assetSlotsRef.current.values()) observer.observe(slot);

    return () => {
      observer.disconnect();
      if (assetObserverRef.current === observer) assetObserverRef.current = null;
    };
  }, [scrollRoot]);

  const assetsKey = assets.join("|");
  useEffect(() => {
    if (manifest404Ref.current.has(projectId)) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/preview/.media/manifest.jsonl`)
      .then((r) => {
        if (!r.ok) {
          manifest404Ref.current.add(projectId);
          return "";
        }
        return r.text();
      })
      .then((text) => {
        if (cancelled || !text) return;
        const m = new Map<
          string,
          { description?: string; duration?: number; width?: number; height?: number }
        >();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line);
            if (rec.path) m.set(rec.path, rec);
          } catch {
            /* skip */
          }
        }
        setManifest(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, assetsKey]);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragOver(false);
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      onImport?.(e.dataTransfer.files);
    },
    [onImport],
  );
  const handleCopyPath = useCallback(async (path: string) => {
    const copied = await copyTextToClipboard(path);
    if (copied) {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    }
  }, []);
  const elements = usePlayerStore((s) => s.elements);
  const usedPaths = useMemo(() => deriveUsedPaths(elements), [elements]);
  const allMediaAssets = useMemo(
    () => assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a) || isHtmlIllustrationAsset(a)),
    [assets],
  );
  const mediaAssets = useMemo(() => {
    const all = filterByUsage(allMediaAssets, usedPaths, usageFilter);
    if (!searchQuery) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((a) => {
      if (
        a
          .split("/")
          .pop()
          ?.replace(/\.[^.]*$/, "")
          .toLowerCase()
          .includes(q)
      )
        return true;
      const rec = manifest.get(a);
      return rec?.description?.toLowerCase().includes(q);
    });
  }, [allMediaAssets, searchQuery, manifest, usageFilter, usedPaths]);
  const categorized = useMemo(() => {
    const groups: Record<MediaCategory, string[]> = { audio: [], illustrations: [], images: [], video: [], fonts: [] };
    for (const a of mediaAssets) {
      const cat = getCategory(a);
      if (cat) groups[cat].push(a);
    }
    // Sort: used assets first within each category
    for (const cat of FILTER_ORDER) {
      groups[cat].sort((a, b) => {
        const aUsed = usedPaths.has(a) ? 0 : 1;
        const bUsed = usedPaths.has(b) ? 0 : 1;
        return aUsed - bUsed;
      });
    }
    return groups;
  }, [mediaAssets, usedPaths]);
  const usageCounts = useMemo(
    () => countUsage(allMediaAssets, usedPaths),
    [allMediaAssets, usedPaths],
  );
  const visibleCategories = FILTER_ORDER.filter((c) => categorized[c].length > 0);
  const toggleCategory = useCallback((category: MediaCategory) => {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);
  return (
    <div
      className={`relative flex h-full min-h-0 flex-1 flex-col overflow-hidden transition-colors ${dragOver ? "bg-studio-accent/[0.05]" : ""}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        const nextTarget = e.relatedTarget;
        if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return;
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-lg border-2 border-dashed border-panel-accent/70 bg-panel-bg/90">
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-xs font-semibold text-panel-accent">{tx("Drop files to upload")}</span>
            <span className="text-[10px] text-panel-text-3">{tx("Images, video, audio, and fonts")}</span>
          </div>
        </div>
      )}
      {/* Header — matches design panel Section pattern */}
      <div className="flex-shrink-0 border-b border-panel-border px-4 pb-[15px] pt-3">
        <div className="flex items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-[5px] text-[10px] font-medium leading-3 text-panel-text-3">
            {tx("Source")}
            <select
              disabled
              title={tx("Source selection is not available yet")}
              value="project-01"
              className="h-[34px] min-w-0 cursor-not-allowed rounded-md border-0 bg-panel-input px-[11px] text-[13px] font-medium text-panel-text-1 opacity-100 outline-none"
            >
              <option value="project-01">{tx("Project 01")}</option>
            </select>
          </label>
          {/* Import */}
          {onImport && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[34px] w-auto flex-none items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[#858a94] bg-panel-bg px-3 text-xs font-medium text-panel-text-1 transition-colors hover:bg-panel-input"
              >
                <img src={importIconSrc} alt="" className="h-4 w-4" />
                {tx("Import")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*,audio/*,font/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onImport(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
            </>
          )}
        </div>

        <div className="mt-[10px] flex h-[34px] items-center gap-2 rounded-md bg-panel-input px-[11px]">
          <img src={searchIconSrc} alt="" className="h-4 w-4 flex-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tx("Search assets…")}
            className="min-w-0 w-full bg-transparent text-[13px] text-panel-text-1 outline-none placeholder:text-[#a2a6af]"
          />
        </div>

        <div className="mt-[10px] flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setUsageFilter("all")}
            className={`h-7 rounded-md px-2.5 text-[10px] font-semibold transition-colors ${
              usageFilter === "all"
                ? "bg-[#171816] text-[#ffffff] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
                : "bg-panel-input text-panel-text-2 hover:text-panel-text-1"
            }`}
          >
            {tx("All")} {allMediaAssets.length}
          </button>
          <button
            type="button"
            onClick={() => setUsageFilter("used")}
            className={`h-7 rounded-md px-2.5 text-[10px] font-semibold transition-colors ${
              usageFilter === "used"
                ? "bg-[#171816] text-[#ffffff] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
                : "bg-panel-input text-panel-text-2 hover:text-panel-text-1"
            }`}
          >
            {tx("In use")} {usageCounts.used}
          </button>
          <button
            type="button"
            onClick={() => setUsageFilter("unused")}
            className={`h-7 rounded-md px-2.5 text-[10px] font-semibold transition-colors ${
              usageFilter === "unused"
                ? "bg-[#171816] text-[#ffffff] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
                : "bg-panel-input text-panel-text-2 hover:text-panel-text-1"
            }`}
          >
            {tx("Unused")} {usageCounts.unused}
          </button>
        </div>
      </div>

      <div
        ref={setScrollRoot}
        data-testid="assets-virtual-scroll"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {mediaAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-neutral-700"
            >
              <path
                d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
            </svg>
            <p className="text-[10px] text-neutral-600 text-center">{tx("Drop media files here")}</p>
          </div>
        ) : (
          visibleCategories.map((cat) => (
            <section key={cat} className="border-b border-panel-border">
              <button
                type="button"
                aria-expanded={!collapsedCategories.has(cat)}
                onClick={() => toggleCategory(cat)}
                className="relative flex h-12 w-full items-center justify-between px-4 text-panel-text-1 transition-colors hover:bg-panel-input/50"
              >
                <span className="flex items-center gap-[7px] text-sm font-semibold">
                  <CaretDown
                    aria-hidden="true"
                    weight="bold"
                    className={`h-3 w-3 flex-none text-[#858a94] transition-transform ${collapsedCategories.has(cat) ? "-rotate-90" : ""}`}
                  />
                  {tx(CATEGORY_LABELS[cat])}
                </span>
                <span className="text-xs font-normal tabular-nums">{categorized[cat].length}</span>
                <span
                  className="absolute inset-y-0 left-0 w-[3px] bg-[#20bbc0]"
                  aria-hidden="true"
                />
              </button>
              {!collapsedCategories.has(cat) &&
                cat === "audio" &&
                categorized[cat].map((a) => (
                  <VirtualAssetSlot
                    key={a}
                    asset={a}
                    visible={visibleAssets.has(a)}
                    kind="row"
                    register={registerAssetSlot}
                    render={() => (
                      <AudioRow
                        projectId={projectId}
                        asset={a}
                        used={usedPaths.has(a)}
                        meta={manifest.get(a)}
                        onCopy={handleCopyPath}
                        isCopied={copiedPath === a}
                        onDelete={onDelete}
                        onRename={onRename}
                        onAddAssetToTimeline={onAddAssetToTimeline}
                      />
                    )}
                  />
                ))}
              {!collapsedCategories.has(cat) && (cat === "illustrations" || cat === "images" || cat === "video") && (
                <div className="grid grid-cols-2 gap-x-[10px] gap-y-[14px] px-4 pb-6 pt-[14px]">
                  {categorized[cat].map((a) => (
                    <VirtualAssetSlot
                      key={a}
                      asset={a}
                      visible={visibleAssets.has(a)}
                      kind="tile"
                      register={registerAssetSlot}
                      render={() => (
                        <AssetCard
                          projectId={projectId}
                          asset={a}
                          used={usedPaths.has(a)}
                          duration={manifest.get(a)?.duration}
                          onCopy={handleCopyPath}
                          isCopied={copiedPath === a}
                          onDelete={onDelete}
                          onRename={onRename}
                          onAddAssetToTimeline={onAddAssetToTimeline}
                        />
                      )}
                    />
                  ))}
                </div>
              )}
              {!collapsedCategories.has(cat) &&
                cat === "fonts" &&
                categorized[cat].map((a) => (
                  <VirtualAssetSlot
                    key={a}
                    asset={a}
                    visible={visibleAssets.has(a)}
                    kind="row"
                    register={registerAssetSlot}
                    render={() => (
                      <FontRow
                        asset={a}
                        used={usedPaths.has(a)}
                        onCopy={handleCopyPath}
                        isCopied={copiedPath === a}
                        onDelete={onDelete}
                        onRename={onRename}
                        onAddAssetToTimeline={onAddAssetToTimeline}
                      />
                    )}
                  />
                ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
});
