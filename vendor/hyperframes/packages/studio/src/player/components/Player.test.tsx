// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Player } from "./Player";

vi.mock("@hyperframes/player", () => ({}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

class TestPlayer extends HTMLElement {
  private readonly frame = document.createElement("iframe");

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(this.frame);
  }

  get iframeElement(): HTMLIFrameElement {
    return this.frame;
  }
}

if (!customElements.get("hyperframes-player")) {
  customElements.define("hyperframes-player", TestPlayer);
}

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

describe("composition preview loading", () => {
  it("shows loading immediately and offers a retry after player failure", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanup.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    const onError = vi.fn();

    await act(async () => {
      root.render(<Player projectId="preview-proof" onLoad={vi.fn()} onError={onError} />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="composition-loading-overlay"]')).not.toBeNull();
    const player = container.querySelector<TestPlayer>("hyperframes-player");
    expect(player).not.toBeNull();

    await act(async () => player?.dispatchEvent(new Event("error")));
    expect(onError).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="composition-error-overlay"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(player?.getAttribute("src")).toContain("_hfRetry=");
    expect(container.querySelector('[data-testid="composition-loading-overlay"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="composition-error-overlay"]')).toBeNull();
  });
});
