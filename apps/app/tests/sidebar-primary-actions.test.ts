import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const sidebarSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const toyBrickIconSource = readFileSync(
  new URL("../public/sidebar-icon/toy-brick.svg", import.meta.url),
  "utf8",
);
const squarePenIconSource = readFileSync(
  new URL("../public/sidebar-icon/figma-square-pen.svg", import.meta.url),
  "utf8",
);
const layoutIconSource = readFileSync(
  new URL("../public/sidebar-icon/figma-layout-panel-top.svg", import.meta.url),
  "utf8",
);
const folderIconSource = readFileSync(
  new URL("../public/sidebar-icon/figma-folder-closed.svg", import.meta.url),
  "utf8",
);

describe("sidebar primary actions", () => {
  test("uses the exported Figma assets in aligned 16px slots with 14px artwork", () => {
    expect(sidebarSource).toContain('SidebarMenu className="gap-1"');
    expect(sidebarSource).toContain('sidebar-icon/figma-square-pen.svg');
    expect(sidebarSource).toContain('sidebar-icon/figma-layout-panel-top.svg');
    expect(sidebarSource).toContain('sidebar-icon/toy-brick.svg');
    expect(sidebarSource).toContain('const primarySidebarActionClassName = "h-8 gap-2 rounded-[8px] px-2 py-0 text-sm font-normal leading-4');
    expect(sidebarSource).toContain('figma-square-pen.svg")} alt="" className="size-3.5 dark:invert"');
    expect(sidebarSource).toContain('figma-layout-panel-top.svg")} alt="" className="size-3.5 dark:invert"');
    expect(sidebarSource).toContain('toy-brick.svg")} alt="" className="size-3.5 dark:invert"');
    expect(sidebarSource).toContain('<CalendarDays className="!size-3.5" strokeWidth={1.7} />');
    expect(sidebarSource.match(/className=\{primarySidebarActionClass\}/g)).toHaveLength(5);
  });

  test("keeps one-pixel strokes from scaling across sidebar icon viewboxes", () => {
    expect(toyBrickIconSource).toContain('viewBox="1.15 1.15 11.7 11.7"');
    expect(toyBrickIconSource).toContain('stroke-width="1" vector-effect="non-scaling-stroke"');
    expect(squarePenIconSource).toContain('stroke-width="1" vector-effect="non-scaling-stroke"');
    expect(layoutIconSource.match(/stroke-width="1" vector-effect="non-scaling-stroke"/g)).toHaveLength(3);
    expect(folderIconSource).toContain('stroke-width="1" vector-effect="non-scaling-stroke"');
    expect(existsSync(new URL("../public/sidebar-icon/cable.svg", import.meta.url))).toBe(false);
  });

  test("retains hover, press, active, focus, and disabled behavior", () => {
    expect(sidebarSource).toContain("hover:bg-sidebar-accent");
    expect(sidebarSource).toContain("hover:text-sidebar-accent-foreground");
    expect(sidebarSource).toContain("active:bg-sidebar-accent");
    expect(sidebarSource).toContain("data-active:bg-sidebar-accent");
    expect(sidebarSource).toContain("data-active:text-sidebar-accent-foreground");
    expect(sidebarSource).toContain("focus-visible:ring-1");
    expect(sidebarSource).toContain('disabled={props.newTaskDisabled || !props.selectedWorkspaceId}');
  });
});
