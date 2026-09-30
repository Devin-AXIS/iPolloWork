import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  clearHostVideoDelivery,
  currentHostVideoDelivery,
  publishHostVideoDelivery,
  readHostVideoDeliveryError,
  subscribeHostVideoDeliverySettled,
} from "../src/react-app/domains/session/video/video-delivery-coordination";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

describe("host video delivery coordination", () => {
  test("survives a conversation-surface replacement until the exact operation completes", () => {
    const signal = {
      workspaceId: "ws-1",
      sessionId: "session-1",
      sourcePath: "video/session-1-artifact-video/index.html",
      baselineFingerprint: "before",
      operationKey: "delivery-1",
      intent: "publish-douyin" as const,
      promptText: "发布到抖音",
    };
    publishHostVideoDelivery(signal);
    expect(currentHostVideoDelivery("ws-1", "session-1")).toEqual(signal);

    clearHostVideoDelivery("ws-1", "session-1", "another-delivery");
    expect(currentHostVideoDelivery("ws-1", "session-1")).toEqual(signal);

    clearHostVideoDelivery("ws-1", "session-1", "delivery-1");
    expect(currentHostVideoDelivery("ws-1", "session-1")).toBeNull();
  });

  test("carries WeChat Channels delivery across every engine-neutral surface", () => {
    const signal = {
      workspaceId: "ws-2",
      sessionId: "session-2",
      sourcePath: "video/session-2/index.html",
      baselineFingerprint: null,
      operationKey: "delivery-2",
      intent: "publish-wechat-channels" as const,
      promptText: "生成视频并发布到视频号",
      publicationCopy: { title: "标题", description: "正文", topics: "#话题" },
    };
    publishHostVideoDelivery(signal);
    expect(currentHostVideoDelivery("ws-2", "session-2")).toEqual(signal);
    clearHostVideoDelivery("ws-2", "session-2", "delivery-2");
  });

  test("settling one delivery preserves another module's queued delivery", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => { values.set(key, value); },
        },
        dispatchEvent: () => true,
      },
    });
    try {
      const first = {
        workspaceId: "ws-merge", sessionId: "first", sourcePath: "video/first/index.html",
        baselineFingerprint: null, operationKey: "first-op", intent: "publish-douyin" as const,
        promptText: "发布到抖音",
      };
      const second = { ...first, sessionId: "second", operationKey: "second-op" };
      publishHostVideoDelivery(first);
      values.set("ipollowork:host-video-deliveries:v1", JSON.stringify([
        { ...first, storedAt: Date.now() }, { ...second, storedAt: Date.now() },
      ]));
      clearHostVideoDelivery(first.workspaceId, first.sessionId, first.operationKey);
      expect(currentHostVideoDelivery(second.workspaceId, second.sessionId)).toEqual(second);
      expect(JSON.parse(values.get("ipollowork:host-video-deliveries:v1") || "[]")).toHaveLength(1);
      clearHostVideoDelivery(second.workspaceId, second.sessionId, second.operationKey);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("a failed host publication remains visible after the conversation surface remounts", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => { values.set(key, value); },
        },
        dispatchEvent: () => true,
      },
    });
    try {
      const signal = {
        workspaceId: "ws-error", sessionId: "session-error", sourcePath: "video/error/index.html",
        baselineFingerprint: null, operationKey: "error-op", intent: "publish-wechat-channels" as const,
        promptText: "发布到视频号",
      };
      publishHostVideoDelivery(signal);
      clearHostVideoDelivery(signal.workspaceId, signal.sessionId, signal.operationKey, "发布结果待核对");
      expect(readHostVideoDeliveryError(signal.workspaceId, signal.sessionId)).toBe("发布结果待核对");
      publishHostVideoDelivery(signal);
      expect(readHostVideoDeliveryError(signal.workspaceId, signal.sessionId)).toBeNull();
      clearHostVideoDelivery(signal.workspaceId, signal.sessionId, signal.operationKey);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("keeps the sidebar processing through engine idle and settles an objective publish failure", () => {
    const signal = {
      workspaceId: "ws-status",
      sessionId: "session-status",
      sourcePath: "video/session-status/index.html",
      baselineFingerprint: null,
      operationKey: "delivery-status",
      intent: "publish-douyin" as const,
      promptText: "发布到抖音",
    };
    publishHostVideoDelivery(signal);
    const activity = useSessionActivityStore.getState();
    activity.setRunStatus(signal.workspaceId, signal.sessionId, { type: "idle" });
    activity.finishRun(signal.workspaceId, signal.sessionId, "completed");
    expect(activity.getStatus(signal.workspaceId, signal.sessionId)).toBe("thinking");
    clearHostVideoDelivery(signal.workspaceId, signal.sessionId, signal.operationKey, "平台拒绝发布");
    expect(activity.getStatus(signal.workspaceId, signal.sessionId)).toBe("error");
    expect(activity.getRunOutcome(signal.workspaceId, signal.sessionId)).toBe("failed");
  });

  test("settles a stale sidebar activity when a background window removes the delivery", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const values = new Map<string, string>();
    const listeners = new Map<string, (event: { key: string }) => void>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => { values.set(key, value); },
        },
        addEventListener: (name: string, listener: (event: { key: string }) => void) => { listeners.set(name, listener); },
        removeEventListener: (name: string) => { listeners.delete(name); },
        dispatchEvent: () => true,
      },
    });
    try {
      const signal = {
        workspaceId: "ws-background", sessionId: "session-background",
        sourcePath: "video/session-background/index.html", baselineFingerprint: null,
        operationKey: "background-delivery", intent: "publish-wechat-channels" as const,
        promptText: "发布到视频号",
      };
      publishHostVideoDelivery(signal);
      const activity = useSessionActivityStore.getState();
      activity.setRunStatus(signal.workspaceId, signal.sessionId, { type: "idle" });
      expect(activity.getStatus(signal.workspaceId, signal.sessionId)).toBe("thinking");
      const settled: string[] = [];
      const unsubscribe = subscribeHostVideoDeliverySettled((result) => settled.push(result.sessionId));
      values.set("ipollowork:host-video-deliveries:v1", "[]");
      listeners.get("storage")?.({ key: "ipollowork:host-video-deliveries:v1" });
      expect(activity.getStatus(signal.workspaceId, signal.sessionId)).toBe("idle");
      expect(activity.getRunOutcome(signal.workspaceId, signal.sessionId)).toBe("completed");
      expect(settled).toContain(signal.sessionId);
      unsubscribe();
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("keeps a ready host delivery moving after the engine chat turn becomes idle", () => {
    const surfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );
    const openCodeEngineSource = readFileSync(
      new URL("../src/react-app/domains/session/engine/opencode-conversation-engine.ts", import.meta.url),
      "utf8",
    );

    expect(surfaceSource).toContain(
      "hostVideoDeliverySignalKeyRef.current === signalKey && activeOperationKey === signal.operationKey",
    );
    expect(surfaceSource).toContain(
      "const hostDeliveryReady = pendingVideoDeliveryRef.current?.hostExport?.ready === true",
    );
    expect(surfaceSource).toContain("(!sending && !hostDeliveryReady)");
    expect(surfaceSource).not.toContain("hostVideoDeliveryStallAbortInFlightRef");
    expect(surfaceSource).not.toContain("hostVideoDeliveryStallReleaseRef");
    expect(surfaceSource).toContain("if (hostDeliveryReady && !hostSourceTurnSettled) return;");
    expect(surfaceSource).toContain("const VIDEO_DELIVERY_ACTIVITY_TIMEOUT_MS = 3 * 60 * 60_000");
    expect(surfaceSource).toContain("Date.now() + VIDEO_DELIVERY_ACTIVITY_TIMEOUT_MS");
    expect(surfaceSource).toContain("Video export did not finish within 3 hours");
    expect(surfaceSource).toContain("publicationUserInterventionRequired(latestAssistantText)");
    expect(surfaceSource).toContain("publicationInterventionAbortInFlightRef.current = true");
    expect(surfaceSource).toContain("const publicationInterventionUserMessageId = activeClientUserMessageIdRef.current");
    expect(surfaceSource).toContain(
      "settleInterruptedSessionRun(\n        props.workspaceId,\n        props.sessionId,\n        publicationInterventionUserMessageId",
    );
    expect(surfaceSource).toContain("promptDispatchAbortRef.current?.abort()");
    expect(surfaceSource).toContain(
      "if (!hostDeliveryReady && !runActivityObservedRef.current && !assistantOutputAfterAwaitStart) return;",
    );
    expect(surfaceSource).toContain(
      "if (pendingVideoDeliveryRef.current?.hostExport?.ready !== true)",
    );
    expect(surfaceSource).toContain(
      "const hostPostProcessing = pendingVideoDeliveryRef.current?.hostExport?.ready === true",
    );
    expect(surfaceSource).toContain("if (!chatStreaming || hostPostProcessing) return;");
    expect(surfaceSource).toContain("Reuse the returned tabId for every subsequent browser action.");
    expect(surfaceSource).toContain("never invoke a native file picker");
    expect(surfaceSource).toContain("settleMs between 800 and 2000");
    expect(surfaceSource).toContain("const MAX_VIDEO_DELIVERY_RECOVERY_ATTEMPTS = 3");
    expect(surfaceSource).toContain(
      "if (pending.recoveryAttempts < MAX_VIDEO_DELIVERY_RECOVERY_ATTEMPTS)",
    );
    expect(surfaceSource).toContain('capability: { id: "video-delivery-recovery", instruction: recoveryInstruction }');
    expect(surfaceSource).toContain('parts: [{ type: "text", text: recoveryInstruction }]');
    expect(surfaceSource).not.toContain('parts: [{ type: "text", text: recoveryInstruction, synthetic: true }]');
    expect(surfaceSource).toContain('action: "video_component_install"');
    expect(surfaceSource).toContain('componentIds: ["spatial-camera-suite"]');
    expect(surfaceSource).toContain("The iPolloWork app already installed the component for this repair.");
    expect(surfaceSource).toContain("const needsStoryboardMusicRepair = issues.some");
    expect(surfaceSource).toContain('issue.code === "music_asset_mismatch"');
    expect(surfaceSource).toContain("Save the corrected artifact files and stop.");
    expect(surfaceSource).toContain("Synchronize STORYBOARD.md frontmatter music_prompt and music_asset");
    expect(surfaceSource).toContain("The saved STORYBOARD.md is already approved production input");
    expect(surfaceSource).toContain("createInternalContinuationMessageId()");
    expect(surfaceSource).toContain("Make the first action of this turn a file edit or required media tool call.");
    expect(surfaceSource).toContain('"componentCheck" in output');
    expect(surfaceSource).toContain("Follow this host-generated repair plan as authoritative");
    expect(surfaceSource).toContain("continue, topic-change, time-change, location-change, compare, reveal, or closure");
    expect(surfaceSource).toContain("A hold: beat or a zero-length motion window does not count.");
    expect(surfaceSource).not.toContain(
      '{ type: "text", text: "Continue the unfinished video delivery." },',
    );
    expect(surfaceSource).not.toContain("Apply every application instruction before completing this turn");
    expect(surfaceSource).not.toContain(
      'pending.requirements.voiceover ? "video-voice-reference" : "video-delivery-recovery"',
    );
    expect(openCodeEngineSource).toContain(
      "if (promptParts.length === 0 && syntheticInstructions.length > 0)",
    );
    expect(openCodeEngineSource).toContain("SYNTHETIC_ONLY_EXECUTION_PROMPT");
  });
});
