import { useState, useCallback, useEffect } from "react";
import type { RightPanelTab } from "../utils/studioHelpers";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useDockLayoutStore } from "../components/dock/dockLayoutStore";

export interface InitialPanelLayoutState {
  rightPanelTab?: RightPanelTab | null;
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  // Measured dock width for host narration/theme overlays, never a second resizer.
  const [rightWidth, setRightWidth] = useState(400);
  const rightCollapsed = useDockLayoutStore(state => !state.visiblePanels.has("design"));
  const setRightCollapsed = useCallback((collapsed: boolean) => {
    const dock = useDockLayoutStore.getState();
    if (collapsed) dock.closePanel("design");
    else dock.activatePanel("design");
  }, []);
  const initialTab = initialState?.rightPanelTab;
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>(
    initialTab === "layers" || initialTab === "code" ? "design" : initialTab ?? "renders",
  );
  useEffect(() => {
    if (initialTab === "assets" || initialTab === "code") useDockLayoutStore.getState().activatePanel("design");
  }, [initialTab]);
  const trackedSetRightPanelTab = useCallback((tab: RightPanelTab) => {
    if (tab === "assets" || tab === "code") useDockLayoutStore.getState().activatePanel("design");
    // Preserve old Code deep links without reviving the removed sidebar page.
    setRightPanelTab(tab === "layers" || tab === "code" ? "design" : tab);
    trackStudioEvent("tab_switch", { panel: "right_panel", tab });
  }, []);
  return { rightWidth, setRightWidth, rightCollapsed, setRightCollapsed,
    rightPanelTab, setRightPanelTab: trackedSetRightPanelTab };
}
