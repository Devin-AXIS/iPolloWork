// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { TimelineLayerHeader } from "./TimelineLayerHeader";
import { defaultTimelineTheme } from "./timelineTheme";

const element: TimelineElement = {
  id: "opening-title",
  key: "opening-title",
  domId: "opening-title",
  tag: "div",
  label: "Opening title",
  start: 0,
  duration: 2,
  track: 0,
};

const visualStyle = {
  accent: "#1FBAC0",
  clip: "#f5f6f9",
  label: "#20262d",
};

describe("TimelineLayerHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects the layer name and expands authored properties without auxiliary buttons", async () => {
    const onSelect = vi.fn();
    const onToggleExpanded = vi.fn();
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected={false}
          expanded={false}
          expandable
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          gutterWidth={255}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={onSelect}
          onToggleExpanded={onToggleExpanded}
        />,
      );
    });

    const select = container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    await act(async () => select?.click());

    expect(onSelect).toHaveBeenCalledWith(element);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 275)));
    expect(onToggleExpanded).toHaveBeenCalledOnce();
    expect(onToggleExpanded).toHaveBeenCalledWith(element);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(container.querySelector(".hf-timeline-layer-header__caret")).toBeNull();
    expect(container.querySelector('[aria-label="Add property"]')).toBeNull();
    expect(container.querySelector(".hf-timeline-layer-header__rename-input")).toBeNull();
    expect(container.querySelector(".hf-timeline-layer-header__label")?.textContent).toBe(
      "Opening title",
    );
  });

  it("double-clicking a group name enters its scope without expanding attributes", async () => {
    const group: TimelineElement = { ...element, inlineScopeKind: "group" };
    const toggle = vi.fn(); const drillDown = vi.fn();
    await act(async () => root.render(
      <TimelineLayerHeader track={0} elements={[group]} hidden={false} locked={false}
        selected expanded={false} expandable theme={defaultTimelineTheme} visualStyle={visualStyle}
        gutterWidth={255} onToggleHidden={vi.fn()} onToggleLocked={vi.fn()} onSelect={vi.fn()}
        onToggleExpanded={toggle} onDrillDown={drillDown} />
    ));
    const name = container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    await act(async () => {
      name?.dispatchEvent(new MouseEvent("click", {bubbles:true,detail:1}));
      name?.dispatchEvent(new MouseEvent("click", {bubbles:true,detail:2}));
      name?.dispatchEvent(new MouseEvent("dblclick", {bubbles:true,detail:2}));
      await new Promise((resolve) => setTimeout(resolve, 275));
    });
    expect(drillDown).toHaveBeenCalledExactlyOnceWith(group);
    expect(toggle).not.toHaveBeenCalled();
  });

  it.each([false,true])("keeps a name expansion intent across selection remount (auto-open=%s)", async (autoOpen) => {
    const events:string[]=[];
    function Harness(){
      const [version,setVersion]=useState(0);
      const [expanded,setExpanded]=useState(false);
      return <TimelineLayerHeader key={version} track={0} elements={[element]}
        hidden={false} locked={false} selected={version>0} expanded={expanded} expandable
        theme={defaultTimelineTheme} visualStyle={visualStyle} gutterWidth={255}
        onToggleHidden={vi.fn()} onToggleLocked={vi.fn()} onToggleExpanded={()=>setExpanded(!expanded)}
        onScheduleExpanded={()=>{events.push("schedule");const desired=!expanded;setTimeout(()=>setExpanded(desired),250);}}
        onSelect={()=>{events.push("select");setVersion(previous=>previous+1);if(autoOpen)setExpanded(true);}} />;
    }
    await act(async()=>root.render(<Harness/>));
    const first=container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    await act(async()=>first?.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1})));
    expect(events).toEqual(["schedule","select"]);
    expect(container.querySelector(".hf-timeline-layer-header__select")).not.toBe(first);
    await act(async()=>new Promise(resolve=>setTimeout(resolve,275)));
    expect(container.querySelector(".hf-timeline-layer-header__select")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("records first-click expansion before authored property discovery completes", async () => {
    const schedule=vi.fn();
    function Harness(){
      const [known,setKnown]=useState(false);const [expanded,setExpanded]=useState(false);
      return <TimelineLayerHeader track={0} elements={[element]} hidden={false} locked={false}
        selected={known} expanded={expanded} expandable={known} theme={defaultTimelineTheme}
        visualStyle={visualStyle} gutterWidth={255} onToggleHidden={vi.fn()} onToggleLocked={vi.fn()}
        onToggleExpanded={()=>setExpanded(!expanded)}
        onScheduleExpanded={target=>{schedule(target);setTimeout(()=>setExpanded(true),250);}}
        onSelect={()=>setTimeout(()=>setKnown(true),300)} />;
    }
    await act(async()=>root.render(<Harness/>));
    const name=container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    expect(name?.hasAttribute("aria-expanded")).toBe(false);
    await act(async()=>name?.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1})));
    expect(schedule).toHaveBeenCalledExactlyOnceWith(element);
    await act(async()=>new Promise(resolve=>setTimeout(resolve,350)));
    expect(container.querySelector(".hf-timeline-layer-header__select")?.getAttribute("aria-expanded")).toBe("true");
  });

  it.each(["Control","Meta"])("enters an inline group with %s+Enter and cancels pending expansion", async modifier => {
    const group:TimelineElement={...element,inlineScopeKind:"group"};
    const toggle=vi.fn();const cancel=vi.fn();const drill=vi.fn();const select=vi.fn();
    await act(async()=>root.render(<TimelineLayerHeader track={0} elements={[group]} hidden={false}
      locked={false} selected={false} expanded={false} expandable theme={defaultTimelineTheme}
      visualStyle={visualStyle} gutterWidth={255} onToggleHidden={vi.fn()} onToggleLocked={vi.fn()}
      onToggleExpanded={toggle} onCancelScheduledExpansion={cancel} onDrillDown={drill} onSelect={select}/>));
    const name=container.querySelector<HTMLElement>(".hf-timeline-layer-header__select");
    expect(name?.getAttribute("aria-keyshortcuts")).toContain(`${modifier}+Enter`);
    expect(name?.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(name?.title).toBe("");
    await act(async()=>name?.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:modifier==="Control",metaKey:modifier==="Meta",bubbles:true})));
    expect(cancel).toHaveBeenCalledOnce();expect(drill).toHaveBeenCalledExactlyOnceWith(group);
    expect(select).toHaveBeenCalledExactlyOnceWith(group);expect(toggle).not.toHaveBeenCalled();
    await act(async()=>name?.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(group);expect(drill).toHaveBeenCalledOnce();
  });

  it("uses the eye action to request hiding the layer", async () => {
    const onToggleHidden = vi.fn();
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected
          expanded={false}
          expandable={false}
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          gutterWidth={255}
          onToggleHidden={onToggleHidden}
          onToggleLocked={vi.fn()}
          onSelect={vi.fn()}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const eye = container.querySelector<HTMLButtonElement>(".hf-timeline-layer-header__visibility");
    expect(eye?.getAttribute("aria-label")).toBe("Hide Opening title");
    await act(async () => eye?.click());
    expect(onToggleHidden).toHaveBeenCalledWith(true);
  });

  it("uses the full layer row as a selection target", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <TimelineLayerHeader
          track={0}
          elements={[element]}
          hidden={false}
          locked={false}
          selected={false}
          expanded={false}
          expandable={false}
          theme={defaultTimelineTheme}
          visualStyle={visualStyle}
          gutterWidth={320}
          onToggleHidden={vi.fn()}
          onToggleLocked={vi.fn()}
          onSelect={onSelect}
          onToggleExpanded={vi.fn()}
        />,
      );
    });

    const row = container.querySelector<HTMLElement>(".hf-timeline-layer-header");
    expect(row?.style.width).toBe("320px");
    await act(async () => row?.click());
    expect(onSelect).toHaveBeenCalledWith(element);
  });
  it("flat scene groups expand properties without another navigation level", async () => {
    const group: TimelineElement = { ...element, inlineScopeKind: "group",
      sceneLayer: { role: "group", parentLabel: "Info Card" } };
    const drill = vi.fn(), toggle = vi.fn();
    await act(async () => root.render(<TimelineLayerHeader track={0} elements={[group]}
      hidden={false} locked={false} selected expanded={false} expandable
      theme={defaultTimelineTheme} visualStyle={visualStyle} gutterWidth={360}
      onToggleHidden={vi.fn()} onToggleLocked={vi.fn()} onSelect={vi.fn()}
      onToggleExpanded={toggle} onDrillDown={drill} />));
    const name = container.querySelector(".hf-timeline-layer-header__select");
    expect(name?.getAttribute("aria-keyshortcuts")).toBe("Enter Space");
    expect(name?.textContent).toContain("Info Card");
    await act(async () => name?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 })));
    expect(drill).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledExactlyOnceWith(group);
  });

  it.each([
    { tag: "img", timelineKind: "logo", icon: "image" },
    { tag: "video", icon: "film" },
    { tag: "audio", icon: "audio-lines" },
    { tag: "p", icon: "type" },
    { tag: "div", icon: "shapes" },
    { tag: "div", inlineScopeKind: "group", icon: "layers" },
  ] satisfies Array<Partial<TimelineElement> & { icon: string }>)("uses the actual $tag type icon ($icon)", async ({ icon, ...overrides }) => {
    await act(async () => root.render(<TimelineLayerHeader track={0} elements={[{ ...element, ...overrides }]}
      hidden={false} locked={false} selected={false} expanded={false} expandable={false}
      theme={defaultTimelineTheme} visualStyle={visualStyle} gutterWidth={300}
      onToggleHidden={vi.fn()} onToggleLocked={vi.fn()} onSelect={vi.fn()} onToggleExpanded={vi.fn()} />));
    expect(container.querySelector(`.hf-timeline-layer-header__kind .lucide-${icon}`)).not.toBeNull();
  });

});
