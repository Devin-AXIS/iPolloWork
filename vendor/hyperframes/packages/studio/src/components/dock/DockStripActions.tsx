import { useCallback, useSyncExternalStore } from "react";
import { CornersIn, CornersOut, DotsThree, X } from "@phosphor-icons/react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
} from "../ui";
import { useStudioI18n } from "../../i18n";
import { useDockLayoutStore } from "./dockLayoutStore";
import { PANEL_DEFINITIONS, isPanelId, panelsInZone } from "./panelRegistry";

/** Panel menu, maximise and close group, drawn on the active group's strip only. */
export function DockStripActions({
  api,
  containerApi,
  panels,
  isGroupActive,
}: IDockviewHeaderActionsProps) {
  const { tx } = useStudioI18n();
  const availablePanels = useDockLayoutStore((state) => state.panels);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = containerApi.onDidMaximizedGroupChange(onChange);
      return () => subscription.dispose();
    },
    [containerApi],
  );
  const maximized = useSyncExternalStore(subscribe, () => api.isMaximized());
  const openPanels = useDockLayoutStore((state) => state.openPanels);
  const togglePanel = useDockLayoutStore((state) => state.togglePanel);
  const resetLayout = useDockLayoutStore((state) => state.resetLayout);
  if (!isGroupActive) return null;

  const first = panels.find((panel) => isPanelId(panel.id))?.id;
  const menuPanels = isPanelId(first)
    ? panelsInZone(PANEL_DEFINITIONS[first].zone).filter((id) => availablePanels.includes(id))
    : [];
  return (
    <div className="hf-dock-strip-actions">
      <Menu
        align="end"
        aria-label={tx("Panel menu")}
        trigger={
          <IconButton
            size="sm"
            aria-label={tx("Panel menu")}
            icon={<DotsThree size={16} />}
          />
        }
      >
        {menuPanels.map((id) => (
          <MenuCheckboxItem
            key={id}
            checked={openPanels.has(id)}
            onCheckedChange={() => togglePanel(id)}
          >
            {tx(PANEL_DEFINITIONS[id].title)}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={resetLayout}>{tx("Reset layout")}</MenuItem>
      </Menu>
      <IconButton
        size="sm"
        aria-label={tx(maximized ? "Restore panel" : "Maximize panel")}
        icon={maximized ? <CornersIn size={16} /> : <CornersOut size={16} />}
        onClick={() => (maximized ? api.exitMaximized() : api.maximize())}
      />
      <IconButton
        size="sm"
        aria-label={tx("Close group")}
        icon={<X size={16} />}
        onClick={() => api.close()}
      />
    </div>
  );
}
