import { memo, useCallback } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { t } from "@/i18n";
import {
  selectSessionIsStickyBottom,
  selectSessionTopClippedMessageId,
  useSessionScrollStore,
} from "./scroll-store";

function useSessionScrollOverlayState(sessionId: string) {
  const isAtBottom = useSessionScrollStore((state) => selectSessionIsStickyBottom(state.sessions, sessionId));
  const topClippedMessageId = useSessionScrollStore((state) => selectSessionTopClippedMessageId(state.sessions, sessionId));

  return { isAtBottom, topClippedMessageId };
}

type JumpToStartButtonProps = {
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

const JumpToStartButton = memo(function JumpToStartButton({
  onJumpToStartOfMessage,
}: JumpToStartButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToStartOfMessage("smooth");
  }, [onJumpToStartOfMessage]);

  return (
    <button
      type="button"
      className="flex size-8 items-center justify-center rounded-lg text-dls-text transition-colors hover:bg-dls-hover"
      data-testid="jump-to-message-start"
      aria-label={t("session.scroll.jump_to_start")}
      title={t("session.scroll.jump_to_start")}
      onClick={handleClick}
    >
      <ArrowUp className="size-3.5" />
    </button>
  );
});

type JumpToLatestButtonProps = {
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
};

const JumpToLatestButton = memo(function JumpToLatestButton({
  onJumpToLatest,
}: JumpToLatestButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToLatest("smooth");
  }, [onJumpToLatest]);

  return (
    <button
      type="button"
      className="flex size-8 items-center justify-center rounded-lg text-dls-text transition-colors hover:bg-dls-hover"
      data-testid="jump-to-latest"
      aria-label={t("session.scroll.jump_to_latest")}
      title={t("session.scroll.jump_to_latest")}
      onClick={handleClick}
    >
      <ArrowDown className="size-3.5" />
    </button>
  );
});

type SessionScrollOverlayProps = {
  sessionId: string;
  isStreaming: boolean;
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

export const SessionScrollOverlay = memo(function SessionScrollOverlay({
  sessionId,
  isStreaming,
  onJumpToLatest,
  onJumpToStartOfMessage,
}: SessionScrollOverlayProps) {
  const { isAtBottom, topClippedMessageId } = useSessionScrollOverlayState(sessionId);
  const showJumpToStart = !isStreaming && Boolean(topClippedMessageId);
  const showJumpToLatest = !isAtBottom;

  if (!showJumpToStart && !showJumpToLatest) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex justify-end" data-testid="session-scroll-overlay">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-dls-border bg-dls-surface/95 p-0.5 backdrop-blur-md">
        {showJumpToStart ? (
          <JumpToStartButton onJumpToStartOfMessage={onJumpToStartOfMessage} />
        ) : null}
        {showJumpToLatest ? (
          <JumpToLatestButton onJumpToLatest={onJumpToLatest} />
        ) : null}
      </div>
    </div>
  );
});
