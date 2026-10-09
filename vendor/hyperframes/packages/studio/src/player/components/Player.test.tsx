// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Player } from "./Player";

vi.mock("@hyperframes/player", () => {
  class TestPlayer extends HTMLElement {
    ready = false;
    readonly iframeElement: HTMLIFrameElement;
    constructor() {
      super();
      this.iframeElement = document.createElement("iframe");
      this.attachShadow({ mode: "open" }).append(this.iframeElement);
    }
  }
  if (!customElements.get("hyperframes-player")) {
    customElements.define("hyperframes-player", TestPlayer);
  }
  return {};
});

let root: Root;
let container: HTMLDivElement;
let player: HTMLElement & { ready: boolean; iframeElement: HTMLIFrameElement };

beforeEach(async () => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Player ref={createRef()} projectId="proof" onLoad={vi.fn()} suppressLoadingOverlay />);
  });
  player = container.querySelector("hyperframes-player")! as typeof player;
  expect(player).toBeTruthy();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function advanceOverlay() {
  await act(async () => vi.advanceTimersByTime(250));
}

describe("official player readiness and iframe load ordering", () => {
  it("keeps a ready preview usable after a late iframe load", async () => {
    await act(async () => {
      player.ready = true;
      player.dispatchEvent(new Event("ready"));
      player.iframeElement.dispatchEvent(new Event("load"));
    });
    await advanceOverlay();
    expect(container.querySelector('[data-testid="composition-refresh-loading-overlay"]')).toBeNull();
  });

  it("shows loading before readiness and removes it on the native ready event", async () => {
    await act(async () => player.iframeElement.dispatchEvent(new Event("load")));
    await advanceOverlay();
    expect(container.querySelector('[data-testid="composition-refresh-loading-overlay"]')).not.toBeNull();
    await act(async () => {
      player.ready = true;
      player.dispatchEvent(new Event("ready"));
    });
    expect(container.querySelector('[data-testid="composition-refresh-loading-overlay"]')).toBeNull();
  });

  it("tracks readiness again when the official player navigates to another document", async () => {
    await act(async () => {
      player.ready = true;
      player.dispatchEvent(new Event("ready"));
      player.ready = false;
      player.iframeElement.dispatchEvent(new Event("load"));
    });
    await advanceOverlay();
    expect(container.querySelector('[data-testid="composition-refresh-loading-overlay"]')).not.toBeNull();
    await act(async () => {
      player.ready = true;
      player.dispatchEvent(new Event("ready"));
    });
    expect(container.querySelector('[data-testid="composition-refresh-loading-overlay"]')).toBeNull();
  });
});
