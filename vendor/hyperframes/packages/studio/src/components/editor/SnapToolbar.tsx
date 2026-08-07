import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { usePlayerStore } from "../../player/store/playerStore";
import magnetIconSrc from "../../icons/figmaToolbarMagnet.svg?url";
import gridIconSrc from "../../icons/figmaToolbarGrid.svg?url";
import { useStudioI18n } from "../../i18n";

const SNAP_TOOLBAR_SLOT_ID = "hf-canvas-snap-toolbar-slot";
const GRID_TOOLBAR_SLOT_ID = "hf-canvas-grid-toolbar-slot";

const SNAP_DEFAULTS = {
  snapEnabled: true,
  gridVisible: false,
  gridSpacing: 50,
  snapToGrid: false,
};

function readSnapPrefs() {
  const prefs = readStudioUiPreferences();
  return {
    snapEnabled: prefs.snapEnabled ?? SNAP_DEFAULTS.snapEnabled,
    gridVisible: prefs.gridVisible ?? SNAP_DEFAULTS.gridVisible,
    gridSpacing: prefs.gridSpacing ?? SNAP_DEFAULTS.gridSpacing,
    snapToGrid: prefs.snapToGrid ?? SNAP_DEFAULTS.snapToGrid,
  };
}

interface SnapToolbarProps {
  onSnapChange?: (prefs: {
    snapEnabled: boolean;
    gridVisible: boolean;
    gridSpacing: number;
    snapToGrid: boolean;
  }) => void;
}

// fallow-ignore-next-line complexity
export const SnapToolbar = memo(function SnapToolbar({ onSnapChange }: SnapToolbarProps) {
  const { tx } = useStudioI18n();
  const [prefs, setPrefs] = useState(readSnapPrefs);
  const [gridPopoverOpen, setGridPopoverOpen] = useState(false);
  const [toolbarSlots, setToolbarSlots] = useState<{
    snap: HTMLElement | null;
    grid: HTMLElement | null;
  }>({ snap: null, grid: null });
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const findSlots = () => {
      const snap = document.getElementById(SNAP_TOOLBAR_SLOT_ID);
      const grid = document.getElementById(GRID_TOOLBAR_SLOT_ID);
      setToolbarSlots((current) =>
        current.snap === snap && current.grid === grid ? current : { snap, grid },
      );
      return Boolean(snap && grid);
    };
    if (findSlots()) return;
    const observer = new MutationObserver(() => {
      if (findSlots()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const updatePrefs = useCallback(
    (patch: Partial<typeof prefs>) => {
      setPrefs((previous) => {
        const next = { ...previous, ...patch };
        writeStudioUiPreferences(patch);
        onSnapChange?.(next);
        return next;
      });
    },
    [onSnapChange],
  );

  const toggleSnap = useCallback(() => {
    const enabled = !prefs.snapEnabled;
    updatePrefs({ snapEnabled: enabled });
    usePlayerStore.getState().setTimelineSnapEnabled(enabled);
  }, [prefs.snapEnabled, updatePrefs]);

  const toggleGrid = useCallback(() => {
    updatePrefs({ gridVisible: !prefs.gridVisible });
  }, [prefs.gridVisible, updatePrefs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (target instanceof HTMLIFrameElement) return;
      if (event.key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        updatePrefs({ gridVisible: !readSnapPrefs().gridVisible });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [updatePrefs]);

  useEffect(() => {
    if (!gridPopoverOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || gridButtonRef.current?.contains(target)) return;
      setGridPopoverOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [gridPopoverOpen]);

  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors outline-none hover:bg-[#f2f2f0] focus-visible:ring-2 focus-visible:ring-[#858a94]/35";
  const snapControls = (
    <div className="flex items-center gap-2" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`${iconButton} ${prefs.snapEnabled ? "bg-[#f2f2f0]" : ""}`}
        onClick={toggleSnap}
        title={tx(prefs.snapEnabled ? "Snapping enabled" : "Snapping disabled")}
        aria-label={tx("Toggle snapping")}
        aria-pressed={prefs.snapEnabled}
      >
        <img src={magnetIconSrc} width="16" height="16" alt="" aria-hidden="true" />
      </button>
    </div>
  );

  const gridControl = (
    <button
      ref={gridButtonRef}
      type="button"
      className={`${iconButton} ${prefs.gridVisible ? "bg-[#f2f2f0]" : ""}`}
      onClick={toggleGrid}
      onContextMenu={(event) => {
        event.preventDefault();
        setGridPopoverOpen((open) => !open);
      }}
      title={tx(prefs.gridVisible ? "Grid visible (G)" : "Grid hidden (G)")}
      aria-label={tx("Toggle grid")}
      aria-pressed={prefs.gridVisible}
    >
      <img src={gridIconSrc} width="16" height="16" alt="" aria-hidden="true" />
    </button>
  );

  const gridButtonRect = gridButtonRef.current?.getBoundingClientRect();
  const gridPopover = gridPopoverOpen && gridButtonRect &&
    createPortal(
      <div
        ref={popoverRef}
        className="fixed z-[100] min-w-[180px] rounded-lg border border-neutral-700 bg-neutral-800 p-3 shadow-xl"
        style={{ top: gridButtonRect.bottom + 4, right: window.innerWidth - gridButtonRect.right }}
      >
        <label className="mb-2 flex items-center justify-between text-xs text-white/80">
          <span>{tx("Grid spacing")}</span>
          <input
            type="number"
            min={10}
            max={500}
            step={10}
            value={prefs.gridSpacing}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value >= 10 && value <= 500) {
                updatePrefs({ gridSpacing: value });
              }
            }}
            className="w-16 rounded border border-neutral-600 bg-neutral-900 px-1.5 py-0.5 text-right text-xs tabular-nums text-white outline-none focus:border-studio-accent"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={prefs.snapToGrid}
            onChange={() => updatePrefs({ snapToGrid: !prefs.snapToGrid })}
            className="accent-studio-accent"
          />
          <span>{tx("Snap to grid")}</span>
        </label>
      </div>,
      document.body,
    );

  if (toolbarSlots.snap && toolbarSlots.grid) {
    return (
      <>
        {createPortal(snapControls, toolbarSlots.snap)}
        {createPortal(gridControl, toolbarSlots.grid)}
        {gridPopover}
      </>
    );
  }

  return (
    <div className="absolute right-2 top-2 z-50 flex items-center gap-1">
      {snapControls}
      {gridControl}
      {gridPopover}
    </div>
  );
});
