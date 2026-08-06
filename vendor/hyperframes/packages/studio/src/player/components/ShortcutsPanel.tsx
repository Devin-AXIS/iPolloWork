import { useState, useCallback, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import { formatTime, frameToSeconds } from "../lib/time";
import { Tooltip } from "../../components/ui";
import keyboardIconSrc from "../../icons/figmaToolbarKeyboard.svg?url";
import { useStudioI18n } from "../../i18n";

const SHORTCUTS_TOOLBAR_SLOT_ID = "hf-shortcuts-toolbar-slot";

const SHORTCUT_SECTIONS = [
  {
    title: "Playback",
    hints: [
      { key: "Space", label: "Play / Pause" },
      { key: "J", label: "Play backward" },
      { key: "K", label: "Stop" },
      { key: "L", label: "Play forward" },
      { key: "M", label: "Toggle mute" },
      { key: "Shift+L", label: "Toggle loop" },
      { key: "Left/Right", label: "Step 1 frame" },
      { key: "Shift+Left/Right", label: "Step 10 frames" },
    ],
  },
  {
    title: "Keyframes",
    hints: [
      { key: "K", label: "Add keyframe at playhead" },
      { key: "Del", label: "Delete selected keyframe" },
      { key: "R", label: "Record gesture" },
    ],
  },
  {
    title: "Editing",
    hints: [
      { key: "Ctrl/Cmd+Z", label: "Undo" },
      { key: "Ctrl/Cmd+Shift+Z", label: "Redo" },
      { key: "Ctrl/Cmd+C", label: "Copy element" },
      { key: "Ctrl/Cmd+V", label: "Paste element" },
      { key: "Ctrl/Cmd+X", label: "Cut element" },
      { key: "S", label: "Split clip at playhead" },
      { key: "Ctrl/Cmd+G", label: "Group elements" },
      { key: "Ctrl/Cmd+Shift+G", label: "Ungroup" },
      { key: "Del", label: "Delete selected element" },
    ],
  },
  {
    title: "Gesture recording modifiers",
    hints: [
      { key: "Drag", label: "Record x / y position" },
      { key: "Scroll", label: "Record z depth" },
      { key: "Shift+Drag", label: "Record rotationX / rotationY" },
      { key: "Alt+Drag", label: "Record rotation" },
    ],
  },
  {
    title: "Canvas",
    hints: [
      { key: "Drag", label: "Move element / add keyframe" },
      { key: "Alt+Drag", label: "Move entire animation path" },
    ],
  },
  {
    title: "Crop",
    hints: [
      { key: "Drag edge", label: "Crop a side" },
      { key: "Drag center", label: "Reposition the crop" },
    ],
  },
  {
    title: "Panels",
    hints: [
      { key: "Ctrl/Cmd+1", label: "Compositions tab" },
      { key: "Ctrl/Cmd+2", label: "Assets tab" },
    ],
  },
  {
    title: "Work area",
    hints: [
      { key: "I", label: "Set in-point" },
      { key: "Shift+I", label: "Clear in-point" },
      { key: "O", label: "Set out-point" },
      { key: "Shift+O", label: "Clear out-point" },
      { key: "A", label: "Jump to in-point" },
      { key: "E", label: "Jump to out-point" },
    ],
  },
] as const;

interface ShortcutsPanelProps {
  disabled: boolean;
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  setInPoint: (v: number | null) => void;
  setOutPoint: (v: number | null) => void;
  onSeek: (time: number) => void;
}

export const ShortcutsPanel = memo(function ShortcutsPanel({
  disabled,
  duration,
  inPoint,
  outPoint,
  setInPoint,
  setOutPoint,
  onSeek,
}: ShortcutsPanelProps) {
  const { tx } = useStudioI18n();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [jumpFrame, setJumpFrame] = useState("");
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const findSlot = () => {
      const slot = document.getElementById(SHORTCUTS_TOOLBAR_SLOT_ID);
      setToolbarSlot(slot);
      return Boolean(slot);
    };
    if (findSlot()) return;
    const observer = new MutationObserver(() => {
      if (findSlot()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showShortcuts) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (shortcutsPanelRef.current && !shortcutsPanelRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showShortcuts]);

  const commitJumpFrame = useCallback(() => {
    if (disabled) return;
    const frame = Number.parseInt(jumpFrame, 10);
    if (!Number.isFinite(frame) || duration <= 0) return;
    onSeek(Math.min(duration, frameToSeconds(Math.max(0, frame))));
  }, [disabled, duration, jumpFrame, onSeek]);

  const handleJumpSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  const handleJumpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitJumpFrame();
    },
    [commitJumpFrame],
  );

  const panel = (
    <div ref={shortcutsPanelRef} className="relative flex-shrink-0">
      <Tooltip label={tx("Shortcuts and tools")}>
        <button
          type="button"
          onClick={() => setShowShortcuts((v) => !v)}
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#858a94]/35 ${
            showShortcuts
              ? "bg-[#f2f2f0]"
              : "hover:bg-[#f2f2f0]"
          }`}
          aria-label={tx("Shortcuts and tools")}
          aria-expanded={showShortcuts}
        >
          <img src={keyboardIconSrc} width="16" height="16" alt="" aria-hidden="true" />
        </button>
      </Tooltip>
      {showShortcuts && (
        <div
          className={`hf-shortcuts-panel z-[100] min-w-[220px] overflow-y-auto rounded-lg shadow-xl ${
            toolbarSlot ? "fixed" : "absolute bottom-full right-0 mb-2"
          }`}
          style={{
            background: "var(--hf-shortcuts-bg)",
            border: "1px solid var(--hf-shortcuts-border)",
            maxHeight: "min(280px, calc(100vh - 80px))",
            ...(toolbarSlot && shortcutsPanelRef.current
              ? {
                  bottom: window.innerHeight - shortcutsPanelRef.current.getBoundingClientRect().top + 8,
                  right: window.innerWidth - shortcutsPanelRef.current.getBoundingClientRect().right,
                }
              : {}),
          }}
        >
          <div className="px-3 pt-3 pb-2.5">
            <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              {tx("Jump to frame")}
            </p>
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5">
              <input
                value={jumpFrame}
                onChange={(e) => setJumpFrame(e.target.value)}
                disabled={disabled}
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={tx("Jump to frame")}
                placeholder={tx("frame number")}
                className="h-6 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-mono tabular-nums text-neutral-200 outline-none transition-colors placeholder:text-neutral-600 focus:border-studio-accent/60"
                onKeyDown={handleJumpKeyDown}
                onBlur={commitJumpFrame}
              />
              <Tooltip label={tx("Jump to frame")}>
                <button
                  type="submit"
                  disabled={disabled}
                  className="h-6 px-2 rounded border border-neutral-700 text-[10px] text-neutral-300 transition-colors hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-40"
                >
                  {tx("Go")}
                </button>
              </Tooltip>
            </form>
          </div>
          <div className="hf-shortcuts-divider" />
          <div className="px-3 pt-2.5 pb-2">
            <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
              {tx("Work area")}
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    I
                  </span>
                  <span className="text-[10px] text-neutral-400">{tx("In-point")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {inPoint !== null ? (
                    <>
                      <span className="font-mono text-[10px] text-neutral-300">
                        {formatTime(inPoint)}
                      </span>
                      <Tooltip label={tx("Clear in-point")}>
                        <button
                          type="button"
                          onClick={() => setInPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label={tx("Clear in-point")}
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <span className="text-[10px] text-neutral-600">-</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[20px] text-center"
                    style={{ background: "rgba(255,255,255,0.05)" }}
                  >
                    O
                  </span>
                  <span className="text-[10px] text-neutral-400">{tx("Out-point")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {outPoint !== null ? (
                    <>
                      <span className="font-mono text-[10px] text-neutral-300">
                        {formatTime(outPoint)}
                      </span>
                      <Tooltip label={tx("Clear out-point")}>
                        <button
                          type="button"
                          onClick={() => setOutPoint(null)}
                          className="w-4 h-4 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 transition-colors"
                          aria-label={tx("Clear out-point")}
                        >
                          <svg
                            width="8"
                            height="8"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </Tooltip>
                    </>
                  ) : (
                    <span className="text-[10px] text-neutral-600">-</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
          <div className="px-3 pt-2.5 pb-3 flex flex-col gap-3">
            {SHORTCUT_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider mb-1.5">
                  {tx(section.title)}
                </p>
                <div className="flex flex-col gap-1">
                  {section.hints.map((hint) => (
                    <div key={hint.key} className="flex items-center gap-3">
                      <span
                        className="font-mono text-[10px] rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300 min-w-[36px] text-center"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      >
                        {hint.key}
                      </span>
                      <span className="text-[10px] text-neutral-400">{tx(hint.label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  return toolbarSlot ? createPortal(panel, toolbarSlot) : panel;
});
