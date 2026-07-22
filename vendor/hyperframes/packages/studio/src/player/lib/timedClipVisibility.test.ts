// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { syncTimedClipVisibility, wrapAdapterWithTimedClipVisibility } from "./timedClipVisibility";

function sceneState(id: string) {
  const element = document.getElementById(id) as HTMLElement;
  return {
    display: element.style.display,
    visibility: element.style.visibility,
  };
}

describe("syncTimedClipVisibility", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="root" data-composition-id="main" data-start="0" data-duration="15">
        <section id="hook" data-start="0" data-duration="3.2" style="position:absolute"></section>
        <section id="ui" data-start="3.2" data-duration="3.8" style="position:absolute"></section>
        <section id="proof" data-start="7" data-duration="3.8" style="position:absolute"></section>
        <section id="cta" data-start="10.8" data-duration="4.2" style="position:absolute"></section>
      </main>`;
  });

  it("shows only the active scene after a reload seek", () => {
    syncTimedClipVisibility(document, 10);

    expect(sceneState("hook").visibility).toBe("hidden");
    expect(sceneState("ui").visibility).toBe("hidden");
    expect(sceneState("proof").visibility).toBe("visible");
    expect(sceneState("cta").visibility).toBe("hidden");
  });

  it("switches adjacent scenes exactly at the authored boundary", () => {
    syncTimedClipVisibility(document, 3.2);

    expect(sceneState("hook").visibility).toBe("hidden");
    expect(sceneState("ui").visibility).toBe("visible");
  });

  it("shows only the newest overlapping scene even when scenes use different tracks", () => {
    const root = document.getElementById("root")!;
    root.innerHTML = `
      <section id="old-frame" class="scene clip" data-start="0" data-duration="10" data-track-index="2" style="position:absolute"></section>
      <section id="new-frame" class="scene clip" data-start="4" data-duration="6" data-track-index="3" style="position:absolute"></section>
      <div id="overlay" class="clip" data-start="4" data-duration="6" data-track-index="1" style="position:absolute"></div>`;

    syncTimedClipVisibility(document, 5);

    expect(sceneState("old-frame").visibility).toBe("hidden");
    expect(sceneState("new-frame").visibility).toBe("visible");
    expect(sceneState("overlay").visibility).toBe("visible");
  });

  it("does not suppress timed children inside the winning scene", () => {
    const root = document.getElementById("root")!;
    root.innerHTML = `
      <section id="old-frame" class="scene clip" data-start="0" data-duration="10" data-track-index="2" style="position:absolute"></section>
      <section id="new-frame" class="scene clip" data-start="4" data-duration="6" data-track-index="3" style="position:absolute">
        <h1 id="title" data-start="0" data-duration="6" style="position:absolute">Title</h1>
        <img id="image" data-start="0" data-duration="6" style="position:absolute" />
      </section>`;

    syncTimedClipVisibility(document, 5);

    expect(sceneState("new-frame").visibility).toBe("visible");
    expect(sceneState("title").visibility).toBe("visible");
    expect(sceneState("image").visibility).toBe("visible");
  });

  it("does not let a child escape an inactive parent window", () => {
    document.getElementById("ui")!.innerHTML = `
      <div id="nested" data-start="0" data-duration="15" style="position:absolute"></div>`;

    syncTimedClipVisibility(document, 1);

    expect(sceneState("ui").visibility).toBe("hidden");
    expect(sceneState("nested").visibility).toBe("hidden");
  });

  it("keeps data-hidden clips hidden and restores authored display", () => {
    document.getElementById("proof")!.setAttribute("data-hidden", "");
    const flow = document.createElement("div");
    flow.id = "flow";
    flow.setAttribute("data-start", "3.2");
    flow.setAttribute("data-duration", "3.8");
    flow.style.position = "relative";
    flow.style.display = "flex";
    document.getElementById("root")!.appendChild(flow);

    syncTimedClipVisibility(document, 1);
    expect(sceneState("flow").display).toBe("none");
    syncTimedClipVisibility(document, 4);

    expect(sceneState("flow").display).toBe("flex");
    expect(sceneState("proof").display).toBe("none");
  });

  it("resolves end-relative start expressions", () => {
    const relative = document.createElement("section");
    relative.id = "relative";
    relative.setAttribute("data-start", "ui + 0.2");
    relative.setAttribute("data-duration", "1");
    relative.style.position = "absolute";
    document.getElementById("root")!.appendChild(relative);

    syncTimedClipVisibility(document, 7.1);
    expect(sceneState("relative").visibility).toBe("hidden");
    syncTimedClipVisibility(document, 7.2);
    expect(sceneState("relative").visibility).toBe("visible");
  });

  it("syncs clip windows on seek and playback time reads", () => {
    let time = 0;
    const source = {
      play: () => {},
      pause: () => {},
      seek: (next: number) => { time = next; },
      getTime: () => time,
      getDuration: () => 15,
      isPlaying: () => true,
    };
    const adapter = wrapAdapterWithTimedClipVisibility(source, () => document);

    adapter.seek(10);
    expect(sceneState("proof").visibility).toBe("visible");
    expect(sceneState("cta").visibility).toBe("hidden");
    time = 12;
    adapter.getTime();
    expect(sceneState("proof").visibility).toBe("hidden");
    expect(sceneState("cta").visibility).toBe("visible");
    expect(wrapAdapterWithTimedClipVisibility(source, () => document)).toBe(adapter);
  });
});
