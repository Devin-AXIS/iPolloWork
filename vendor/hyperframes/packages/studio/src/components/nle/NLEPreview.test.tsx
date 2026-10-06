// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NLEPreview } from "./NLEPreview";

const previewPlayers = vi.hoisted(() => new Map<number, {
  iframe: HTMLIFrameElement;
  handoff: () => void;
  reveal: () => void;
  fail: () => void;
}>());

vi.mock("../../player", async () => {
  const { createElement, forwardRef, useEffect, useRef } = await import("react");
  return {
    Player: forwardRef<HTMLIFrameElement, {
      refreshToken?: number;
      deferReveal?: boolean;
      onLoad: () => void;
      onReadyToReveal?: () => void;
      onError?: () => void;
    }>((props, forwardedRef) => {
      const iframeRef = useRef<HTMLIFrameElement>(null);
      useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) throw Error("Preview test iframe did not mount");
        const assign = () => {
          if (typeof forwardedRef === "function") forwardedRef(iframe);
          else if (forwardedRef) forwardedRef.current = iframe;
        };
        const key = props.refreshToken ?? 0;
        previewPlayers.set(key, {
          iframe,
          handoff: () => { assign(); props.onLoad(); },
          reveal: () => props.onReadyToReveal?.(),
          fail: () => props.onError?.(),
        });
        if (!props.deferReveal) assign();
        // Match Player: a retiring callback ref is not blindly cleared because
        // it can already point to a replacement iframe.
        return () => { previewPlayers.delete(key); };
      }, []);
      return createElement("iframe", { ref: iframeRef });
    }),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mountedPreviews: Array<() => void> = [];
afterEach(() => {
  mountedPreviews.splice(0).forEach(unmount => unmount());
  previewPlayers.clear();
});

async function mountStagedPreview() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const iframeRef: { current: HTMLIFrameElement | null } = { current: null };
  const onLoad = vi.fn(() => iframeRef.current);
  const render = async (refreshToken: number) => {
    await act(async () => root.render(createElement(NLEPreview, {
      projectId: "preview-ref-proof", refreshToken, iframeRef, onIframeLoad: onLoad,
    })));
  };
  await render(0);
  mountedPreviews.push(() => { flushSync(() => root.unmount()); container.remove(); });
  const slot = (key: number) => {
    const player = previewPlayers.get(key);
    if (!player) throw Error("Missing preview player " + key);
    return player;
  };
  return { render, slot, iframeRef, onLoad };
}

describe("staged preview ownership", () => {
  it("restores the visible iframe when an incoming handoff fails", async () => {
    const preview = await mountStagedPreview();
    const visible = preview.slot(0).iframe;
    await preview.render(1);
    flushSync(() => preview.slot(1).handoff());
    expect(preview.iframeRef.current).toBe(preview.slot(1).iframe);

    flushSync(() => preview.slot(1).fail());

    expect(preview.iframeRef.current).toBe(visible);
    expect(preview.iframeRef.current?.isConnected).toBe(true);
    expect(preview.onLoad).toHaveLastReturnedWith(visible);
  });

  it("restores the visible iframe when another edit cancels the incoming handoff", async () => {
    const preview = await mountStagedPreview();
    const visible = preview.slot(0).iframe;
    await preview.render(1);
    flushSync(() => preview.slot(1).handoff());

    await preview.render(2);

    expect(preview.iframeRef.current).toBe(visible);
    expect(preview.iframeRef.current?.isConnected).toBe(true);
  });

  it("restores the latest successful preview after a later handoff fails", async () => {
    const preview = await mountStagedPreview();
    await preview.render(1);
    flushSync(() => preview.slot(1).handoff());
    const visible = preview.slot(1).iframe;
    flushSync(() => preview.slot(1).reveal());
    await preview.render(2);
    flushSync(() => preview.slot(2).handoff());

    flushSync(() => preview.slot(2).fail());

    expect(preview.iframeRef.current).toBe(visible);
    expect(preview.iframeRef.current?.isConnected).toBe(true);
  });
});
