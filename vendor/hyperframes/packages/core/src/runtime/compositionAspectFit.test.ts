// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAspectFitCompositionHost,
  installAspectFitCompositionHosts,
} from "./compositionAspectFit";

function buildHost(options: {
  id: string;
  hostWidth: number;
  hostHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  explicitFit?: boolean;
}) {
  const host = document.createElement("div");
  host.setAttribute("data-composition-id", options.id);
  host.setAttribute("data-width", String(options.hostWidth));
  host.setAttribute("data-height", String(options.hostHeight));
  host.style.width = `${options.hostWidth}px`;
  host.style.height = `${options.hostHeight}px`;
  if (options.explicitFit) host.setAttribute("data-hf-content-fit", "contain");

  const inner = document.createElement("main");
  inner.setAttribute("data-hf-inner-root", "true");
  inner.setAttribute("data-width", String(options.sourceWidth));
  inner.setAttribute("data-height", String(options.sourceHeight));
  host.append(inner);
  document.body.append(host);
  return { host, inner };
}

describe("composition aspect fitting", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("contains an explicitly fitted landscape composition inside a portrait host", () => {
    const { host, inner } = buildHost({
      id: "fitted-composition",
      hostWidth: 1080,
      hostHeight: 1920,
      sourceWidth: 1920,
      sourceHeight: 1080,
      explicitFit: true,
    });

    expect(applyAspectFitCompositionHost(host)).toBe(true);
    expect(inner.style.width).toBe("1920px");
    expect(inner.style.height).toBe("1080px");
    expect(inner.style.left).toBe("0px");
    expect(inner.style.top).toBe("656.25px");
    expect(inner.style.scale).toBe("0.5625");
    expect(host.style.overflow).toBe("hidden");

    host.style.width = "800px";
    host.style.height = "450px";
    expect(applyAspectFitCompositionHost(host)).toBe(true);
    expect(inner.style.scale).toBe("0.416667");
    expect(inner.style.left).toBe("0px");
    expect(inner.style.top).toBe("0px");
  });

  it("does not alter ordinary sub-compositions without an explicit fit mode", () => {
    const { host, inner } = buildHost({
      id: "ordinary-scene",
      hostWidth: 1080,
      hostHeight: 1920,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });

    expect(applyAspectFitCompositionHost(host)).toBe(false);
    expect(inner.getAttribute("style")).toBeNull();
  });

  it("supports explicit contain fitting for future registry compositions", () => {
    const { host, inner } = buildHost({
      id: "custom-outro",
      hostWidth: 960,
      hostHeight: 540,
      sourceWidth: 1920,
      sourceHeight: 1080,
      explicitFit: true,
    });

    expect(applyAspectFitCompositionHost(host)).toBe(true);
    expect(inner.style.scale).toBe("0.5");
    expect(inner.style.left).toBe("0px");
    expect(inner.style.top).toBe("0px");
  });

  it("exposes a synchronous refit hook for Studio resize frames", () => {
    const { host, inner } = buildHost({
      id: "fitted-composition-refit",
      hostWidth: 960,
      hostHeight: 540,
      sourceWidth: 1920,
      sourceHeight: 1080,
      explicitFit: true,
    });
    const cleanup = installAspectFitCompositionHosts(document);
    const fitHost = host as HTMLElement & { __hfAspectFit?: () => boolean };

    expect(fitHost.__hfAspectFit).toBeTypeOf("function");
    host.style.width = "480px";
    host.style.height = "270px";
    fitHost.__hfAspectFit?.();
    expect(inner.style.scale).toBe("0.25");

    cleanup();
    expect(fitHost.__hfAspectFit).toBeUndefined();
  });
});
