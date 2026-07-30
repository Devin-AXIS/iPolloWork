import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
  "utf8",
);

describe("sidebar primary actions", () => {
  test("uses the exported Figma assets and compact node spacing", () => {
    expect(sidebarSource).toContain('SidebarMenu className="gap-1 px-2"');
    expect(sidebarSource).toContain('sidebar-icon/figma-square-pen.svg');
    expect(sidebarSource).toContain('sidebar-icon/figma-layout-panel-top.svg');
    expect(sidebarSource).toContain('sidebar-icon/figma-plug.svg');
    expect(sidebarSource).toContain('const primarySidebarActionClassName = "h-8 gap-1 rounded-[8px] px-1 py-0 text-sm font-normal leading-4');
    expect(sidebarSource.match(/className=\{primarySidebarActionClassName\}/g)).toHaveLength(3);
  });

  test("retains hover, press, active, focus, and disabled behavior", () => {
    expect(sidebarSource).toContain("hover:bg-black/5");
    expect(sidebarSource).toContain("active:bg-black/10");
    expect(sidebarSource).toContain("data-active:bg-black/5");
    expect(sidebarSource).toContain("focus-visible:ring-1");
    expect(sidebarSource).toContain('disabled={props.newTaskDisabled || !props.selectedWorkspaceId}');
  });
});
