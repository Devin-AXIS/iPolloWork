// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { PropertyKeyframeRows } from "./AnimationCardParts";
import { KeyframeNavigation } from "./KeyframeNavigation";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("../../contexts/StudioContext", () => ({ useStudioShellContext: () => ({previewIframeRef:{current:null}}) }));
vi.mock("../../hooks/gsapRuntimeReaders", () => ({readGsapProperty: () => 0.7}));

describe("property keyframe controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  const animation = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#title",{duration:2,keyframes:{"0%":{x:0,opacity:0},"50%":{x:100,opacity:0.5},"100%":{x:200,opacity:1}}},1);').animations[0];
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    usePlayerStore.setState({currentTime:1.5,selectedElementId:"title",selectedPropertyKeyframe:null});
  });
  afterEach(() => { flushSync(() => root.unmount()); container.remove(); });
  it("presents independent rows and deletes only the selected property", () => {
    const onEdit = vi.fn();
    flushSync(() => root.render(<PropertyKeyframeRows animation={animation} onEdit={onEdit} />));
    expect(container.querySelectorAll('[data-property-keyframe="x"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-property-keyframe="opacity"]')).toHaveLength(3);
    const button = container.querySelector('[aria-label="Delete Keyframe · Opacity"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Property delete missing");
    button.click();
    expect(onEdit).toHaveBeenCalledWith(animation.id,"opacity",0,{action:"remove"});
  });
  it("records the runtime value for just the requested property", () => {
    const onEdit = vi.fn();
    flushSync(() => root.render(<PropertyKeyframeRows animation={animation} onEdit={onEdit} />));
    const row = Array.from(container.querySelectorAll("details")).find((item) => item.querySelector("summary")?.textContent === "Opacity");
    const button = row?.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Property add missing");
    button.click();
    expect(onEdit).toHaveBeenCalledWith(animation.id,"opacity",25,{action:"add",value:0.7});
  });
  it("disables adding an existing property keyframe and active diamonds never delete", () => {
    const onEdit = vi.fn();
    usePlayerStore.setState({currentTime:2});
    flushSync(() => root.render(<PropertyKeyframeRows animation={animation} onEdit={onEdit} />));
    expect(Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Keyframe at playhead").every((button) => button.disabled)).toBe(true);
    const remove = vi.fn();
    const add = vi.fn();
    flushSync(() => root.render(<KeyframeNavigation property="opacity" keyframes={animation.keyframes?.keyframes ?? null} currentPercentage={50} onSeek={vi.fn()} onAddKeyframe={add} onRemoveKeyframe={remove} onConvertToKeyframes={vi.fn()} />));
    const diamond = container.querySelector('[title="Keyframe at playhead"]');
    if (!(diamond instanceof HTMLButtonElement)) throw new Error("Diamond missing");
    diamond.click();
    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
  it("distinguishes live values from selected key values without editing another channel", () => {
    const onEdit = vi.fn();
    const render = () => flushSync(() => root.render(<PropertyKeyframeRows compact ownerKey="title" animation={animation} onEdit={onEdit} />));
    render();
    const live = container.querySelector('[data-layer-effect-property="opacity"]');
    expect(live?.getAttribute("data-value-context")).toBe("playhead");
    expect(live?.querySelector('[data-property-value-context]')?.textContent).toBe("Current value");
    expect(live?.querySelector<HTMLInputElement>('input')?.value).toBe("70");
    expect(live?.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    flushSync(() => usePlayerStore.getState().setSelectedPropertyKeyframe({ownerKey:"title",animationId:animation.id,property:"opacity",time:2}));
    render();
    expect(live?.getAttribute("data-value-context")).toBe("keyframe");
    expect(live?.querySelector("[data-property-value-time]")?.textContent).toContain("2.000 s");
    expect(live?.querySelector('[data-property-value-context]')?.textContent).toBe("Keyframe value");
    expect(live?.querySelector<HTMLInputElement>('input')?.value).toBe("50");
    expect(live?.querySelector<HTMLInputElement>('input')?.disabled).toBe(false);
    flushSync(() => usePlayerStore.setState({currentTime:2.7}));
    expect(live?.querySelector<HTMLInputElement>('input')?.value).toBe("50");
    expect(container.querySelector('[data-layer-effect-property="x"]')?.getAttribute("data-value-context")).toBe("playhead");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shared read-only keys can still be located without enabling value writes", () => {
    const onEdit=vi.fn();
    flushSync(()=>root.render(<PropertyKeyframeRows compact readOnly ownerKey="title" animation={animation} onEdit={onEdit}/>));
    const row=container.querySelector('[data-layer-effect-property="opacity"]');
    row?.querySelector('button')?.click();
    expect(usePlayerStore.getState().selectedTimelineEffect).toMatchObject({ownerKey:"title",property:"opacity",time:1});
    expect(row?.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Select a keyframe to edit its value.");
  });

  it("groups X and Y while resolving each property's selected segment independently", () => {
    const parsed = parseGsapScriptAcorn('const tl=gsap.timeline();tl.to("#title",{duration:1,keyframes:{"0%":{x:0,y:10,opacity:0},"100%":{x:20,y:30,opacity:1}}},1);tl.to("#title",{duration:1,keyframes:{"0%":{x:20,opacity:1},"100%":{x:80,opacity:0}}},5);').animations;
    const onEdit=vi.fn();
    const source=JSON.stringify(parsed);
    const render=()=>flushSync(()=>root.render(<PropertyKeyframeRows compact ownerKey="title" animation={parsed[0]} relatedAnimations={parsed.map((animation,index)=>({animation,readOnly:index===0}))} onEdit={onEdit}/>));
    usePlayerStore.setState({currentTime:5.5});render();
    expect(container.querySelectorAll('[data-animation-property-group="Position"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-layer-effect-property="x"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-layer-effect-property="opacity"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-property-animation-segments="x"] [data-slot="select-trigger"]')).toHaveLength(1);
    flushSync(()=>usePlayerStore.getState().setSelectedPropertyKeyframe({ownerKey:"title",animationId:parsed[1].id,property:"x",time:6}));render();
    const x=container.querySelector('[data-layer-effect-property="x"] input');
    if (!(x instanceof HTMLInputElement)) throw new Error("X input missing");
    expect(x.value).toBe("80");expect(x.disabled).toBe(false);
    container.querySelector<HTMLButtonElement>('[data-layer-effect-property="x"] button')?.click();
    expect(usePlayerStore.getState().selectedPropertyKeyframe).toMatchObject({animationId:parsed[1].id,property:"x",time:5});
    expect(onEdit).not.toHaveBeenCalled();
    flushSync(()=>usePlayerStore.getState().setSelectedPropertyKeyframe({ownerKey:"title",animationId:parsed[0].id,property:"x",time:2}));render();
    expect(container.querySelector<HTMLInputElement>('[data-layer-effect-property="x"] input')?.value).toBe("20");
    expect(container.querySelector<HTMLInputElement>('[data-layer-effect-property="x"] input')?.disabled).toBe(true);
    expect(JSON.stringify(parsed)).toBe(source);
  });

});
