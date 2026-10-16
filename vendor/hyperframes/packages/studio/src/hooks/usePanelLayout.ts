import { useState, useCallback, useEffect, useRef } from "react";
import type { RightPanelTab } from "../utils/studioHelpers";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useDockLayoutStore } from "../components/dock/dockLayoutStore";

export interface InitialPanelLayoutState {
  rightPanelTab?: RightPanelTab | null;
}

export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  // Measured dock width for host narration/theme overlays, never a second resizer.
  const [rightWidth, setRightWidth] = useState(400);
  const [scriptExpanded, setScriptExpanded] = useState(false);
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
  const currentTabRef = useRef(rightPanelTab);
  currentTabRef.current = rightPanelTab;
  const exportReturnTabRef = useRef<RightPanelTab>("design");
  useEffect(() => {
    if (initialTab === "assets" || initialTab === "code") useDockLayoutStore.getState().activatePanel("design");
  }, [initialTab]);
  const trackedSetRightPanelTab = useCallback((tab: RightPanelTab) => {
    if (tab === "assets" || tab === "code") useDockLayoutStore.getState().activatePanel("design");
    // Preserve old Code deep links without reviving the removed sidebar page.
    const nextTab = tab === "layers" || tab === "code" ? "design" : tab;
    if (nextTab === "renders" && currentTabRef.current !== "renders") {
      exportReturnTabRef.current = currentTabRef.current;
    }
    currentTabRef.current = nextTab;
    setRightPanelTab(nextTab);
    trackStudioEvent("tab_switch", { panel: "right_panel", tab });
  }, []);
  const returnFromExport = useCallback(() => trackedSetRightPanelTab(exportReturnTabRef.current), [trackedSetRightPanelTab]);
  return { rightWidth, setRightWidth, rightCollapsed, setRightCollapsed,
    scriptExpanded, setScriptExpanded,
    rightPanelTab, setRightPanelTab: trackedSetRightPanelTab, returnFromExport };
}
