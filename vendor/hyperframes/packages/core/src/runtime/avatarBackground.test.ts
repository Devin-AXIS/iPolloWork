import { afterEach, expect, it, vi } from "vitest";
import { syncAvatarBackgrounds } from "./avatarBackground";

afterEach(() => {
  document.body.innerHTML = "";
  syncAvatarBackgrounds();
  vi.restoreAllMocks();
});

function fixture() {
  document.body.innerHTML = `<main>
    <video id="source" data-avatar-cutout="fg" style="z-index:1"></video>
    <section style="z-index:5"><div class="scene-fill"></div><h1>Title</h1></section>
    <div class="background" style="z-index:0"></div>
    <video id="fg" data-avatar-source="source" style="z-index:6"></video>
  </main>`;
  const source = document.querySelector<HTMLVideoElement>("#source")!;
  const fill = document.querySelector<HTMLElement>(".scene-fill")!;
  vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 20, 20, 60));
  vi.spyOn(fill, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
  return { source, fill };
}

it("reveals only the avatar rectangle through a nested scene background and restores it outside the clip", () => {
  const { source, fill } = fixture();
  syncAvatarBackgrounds();
  expect(decodeURIComponent(fill.style.maskImage)).toContain('x="4000" y="2000" width="2000" height="6000"');
  expect(document.querySelector<HTMLElement>("h1")!.style.maskImage).toBe("");
  expect(document.querySelector<HTMLElement>(".background")!.style.maskImage).toBe("");
  source.style.visibility = "hidden";
  syncAvatarBackgrounds();
  expect(fill.style.maskImage).toBe("");
  source.style.visibility = "visible";
  syncAvatarBackgrounds();
  expect(fill.style.maskImage).not.toBe("");
  source.removeAttribute("data-avatar-cutout");
  syncAvatarBackgrounds();
  expect(fill.style.maskImage).toBe("");
});

it("does not erase content-bearing backgrounds or replace authored masks", () => {
  const { fill } = fixture();
  fill.innerHTML = "<span>Caption</span>";
  syncAvatarBackgrounds();
  expect(fill.style.maskImage).toBe("");
  fill.innerHTML = "";
  fill.style.maskImage = "linear-gradient(black, transparent)";
  syncAvatarBackgrounds();
  expect(fill.style.maskImage).toBe("linear-gradient(black, transparent)");
});

it("moves a scene background into a masked proxy while keeping its content above the avatar", () => {
  const { source } = fixture();
  const main = document.querySelector("main")!;
  const scene = document.createElement("section");
  scene.className = "scene clip";
  scene.style.cssText = "z-index:5;background:rgb(250, 240, 230)";
  scene.innerHTML = "<h2>Business plan</h2>";
  main.insertBefore(scene, document.querySelector("#fg"));
  vi.spyOn(scene, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));

  syncAvatarBackgrounds();
  const proxy = scene.querySelector<HTMLElement>("[data-avatar-background-proxy]")!;
  expect(proxy).toBeTruthy();
  expect(decodeURIComponent(proxy.style.maskImage)).toContain('x="4000" y="2000" width="2000" height="6000"');
  expect(scene.style.getPropertyValue("background-image")).toBe("none");
  expect(scene.querySelector("h2")!.textContent).toBe("Business plan");

  source.style.display = "none";
  syncAvatarBackgrounds();
  expect(scene.querySelector("[data-avatar-background-proxy]")).toBeNull();
  expect(scene.style.getPropertyValue("background-color")).toBe("rgb(250, 240, 230)");
});
