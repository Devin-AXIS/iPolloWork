export interface TimelineEditCapabilities {
  canMove: boolean;
  canTrimStart: boolean;
  canTrimEnd: boolean;
  status:
    | "editable"
    | "materializes-timing"
    | "locked"
    | "nested-context"
    | "missing-target"
    | "invalid-duration";
}

function isDeterministicTimelineWindow(input: {
  tag: string;
  compositionSrc?: string;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): boolean {
  if (input.compositionSrc || input.playbackStartAttr != null) return true;
  if (
    input.sourceDuration != null &&
    Number.isFinite(input.sourceDuration) &&
    input.sourceDuration > 0
  ) {
    return true;
  }
  return ["video", "audio", "img"].includes(input.tag.toLowerCase());
}

export function hasPatchableTimelineTarget(input: { domId?: string; selector?: string }): boolean {
  return Boolean(input.domId || input.selector);
}

export function getTimelineEditCapabilities(input: {
  tag: string;
  duration: number;
  domId?: string;
  selector?: string;
  compositionSrc?: string;
  playbackStart?: number;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
  timingSource?: "authored" | "implicit";
  timelineLocked?: boolean;
  expandedParentStart?: number;
}): TimelineEditCapabilities {
  if (input.timelineLocked) {
    return {
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "locked",
    };
  }
  if (input.expandedParentStart != null) {
    return {
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "nested-context",
    };
  }

  const canPatch = hasPatchableTimelineTarget(input);
  const hasFiniteDuration = Number.isFinite(input.duration) && input.duration > 0;
  if (!canPatch) {
    return {
      canMove: false,
      canTrimStart: false,
      canTrimEnd: false,
      status: "missing-target",
    };
  }
  if (input.timingSource === "implicit" && hasFiniteDuration) {
    return {
      canMove: true,
      canTrimStart: true,
      canTrimEnd: true,
      status: "materializes-timing",
    };
  }

  const hasDeterministicWindow = isDeterministicTimelineWindow(input);
  return {
    canMove: hasDeterministicWindow || hasFiniteDuration,
    canTrimEnd: hasFiniteDuration,
    canTrimStart: hasFiniteDuration,
    status: hasFiniteDuration ? "editable" : "invalid-duration",
  };
}
