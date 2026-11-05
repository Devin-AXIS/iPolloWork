import { memo } from "react";
import { createPortal } from "react-dom";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useStudioI18n } from "../../i18n";
import { SUPPORTED_EASES } from "@hyperframes/core/gsap-constants";

export interface KeyframeDiamondContextMenuState {
  x: number;
  y: number;
  elementId: string;
  percentage: number;
  tweenPercentage?: number;
  currentEase?: string;
  property?: string;
}

interface KeyframeDiamondContextMenuProps {
  state: KeyframeDiamondContextMenuState;
  onClose: () => void;
  onDelete: (elementId: string, percentage: number) => void;
  onDeleteAll?: (elementId: string) => void;
  onChangeEase?: (elementId: string, percentage: number, ease: string) => void;
  onCopyProperties?: (elementId: string, percentage: number) => void;
  /** Retime the keyframe to the current playhead, preserving its value + ease. */
  onMoveToPlayhead?: (elementId: string, fromPercentage: number) => void;
}

export const KeyframeDiamondContextMenu = memo(function KeyframeDiamondContextMenu({
  state,
  onClose,
  onDelete,
  onDeleteAll,
  onMoveToPlayhead,
  onChangeEase,
}: KeyframeDiamondContextMenuProps) {
  const { tx } = useStudioI18n();
  const menuRef = useContextMenuDismiss(onClose);

  const menuWidth = 200;
  const menuHeight = onMoveToPlayhead ? 100 : 70;
  const overflowY = state.y + menuHeight - window.innerHeight;
  const adjustedX = state.x + menuWidth > window.innerWidth ? state.x - menuWidth : state.x;
  const adjustedY = overflowY > 0 ? state.y - overflowY - 8 : state.y;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {onMoveToPlayhead && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 cursor-pointer text-left"
          onClick={() => {
            // Pass clip-% — resolveKeyframeTarget keys the cache lookup on clip-%
            // and returns the tween-% for the mutation. Passing tween-% here would
            // miss the lookup on any tween whose window is shorter than the clip.
            onMoveToPlayhead(state.elementId, state.percentage);
            onClose();
          }}
        >
          {tx("Move to Playhead")}
        </button>
      )}

      {/* Delete */}
      {onChangeEase && (
        <label className="block px-3 py-1.5 text-xs text-neutral-200">
          {tx("Easing")}
          <select
            aria-label={`${state.property ?? ""} keyframe easing`}
            value={state.currentEase ?? "none"}
            className="mt-1 w-full rounded bg-neutral-800 p-1"
            onChange={(event) => {
              onChangeEase(state.elementId, state.percentage, event.target.value);
              onClose();
            }}
          >
            {SUPPORTED_EASES.map((ease) => (
              <option key={ease} value={ease}>
                {ease}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onDelete(state.elementId, state.percentage);
          onClose();
        }}
      >
        {tx("Delete Keyframe")}
      </button>

      {onDeleteAll && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
          onClick={() => {
            onDeleteAll(state.elementId);
            onClose();
          }}
        >
          {tx("Delete All Keyframes")}
        </button>
      )}
    </div>,
    document.body,
  );
});
