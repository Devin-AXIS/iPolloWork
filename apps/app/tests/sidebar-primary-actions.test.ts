import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(
  new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const navigationIconSource = readFileSync(
  new URL("../src/components/navigation-icons.tsx", import.meta.url),
  "utf8",
);
const folderIconSource = readFileSync(
  new URL("../public/sidebar-icon/figma-folder-closed.svg", import.meta.url),
  "utf8",
);

describe("sidebar primary actions", () => {
  test("optically balances Lucide artwork inside aligned 16px slots", () => {
    expect(sidebarSource).toContain('SidebarMenu className="gap-1"');
    expect(sidebarSource).toContain('const primarySidebarActionClassName = "h-8 gap-2 rounded-[8px] px-2 py-0 text-sm font-normal leading-4');
    expect(sidebarSource).toContain('<SquarePen className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />');
    expect(sidebarSource).toContain('<LayoutTemplate className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />');
    expect(sidebarSource).toContain('<CalendarDays className="!size-[15px]" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />');
    expect(sidebarSource).toContain('<ToyBrick className="!size-[17px]" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />');
    expect(sidebarSource).toContain('<ToolCase className="size-4" strokeWidth={SIDEBAR_ICON_STROKE_WIDTH} />');
    expect(sidebarSource.match(/className=\{primarySidebarActionClass\}/g)).toHaveLength(5);
  });

  test("shares one navigation stroke token", () => {
    expect(navigationIconSource).toContain("NAVIGATION_ICON_STROKE_WIDTH = 1.5;");
    expect(sidebarSource).toContain("const SIDEBAR_ICON_STROKE_WIDTH = NAVIGATION_ICON_STROKE_WIDTH;");
  });

  test("keeps the previous collapsed project icon at one physical pixel", () => {
    expect(folderIconSource).toContain('stroke-width="1" vector-effect="non-scaling-stroke"');
    expect(navigationIconSource).toContain('publicAssetUrl("sidebar-icon/figma-folder-closed.svg")');
    expect(navigationIconSource).toContain('className={cn("block h-3 w-3.5 shrink-0 bg-current"');
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
