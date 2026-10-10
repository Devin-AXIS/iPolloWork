import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { usePanelLayout } from "../hooks/usePanelLayout";
type PanelLayoutValue = ReturnType<typeof usePanelLayout>;
const PanelLayoutContext = createContext<PanelLayoutValue | null>(null);
export function usePanelLayoutContext(): PanelLayoutValue {
  const ctx = useContext(PanelLayoutContext);
  if (!ctx) throw new Error("usePanelLayoutContext must be used within PanelLayoutProvider");
  return ctx;
}
export function PanelLayoutProvider({ value, children }: { value: PanelLayoutValue; children: ReactNode }) {
  const { rightWidth, setRightWidth, rightCollapsed, setRightCollapsed, rightPanelTab, setRightPanelTab } = value;
  const stable = useMemo(() => ({ rightWidth, setRightWidth, rightCollapsed, setRightCollapsed, rightPanelTab, setRightPanelTab }),
    [rightWidth, setRightWidth, rightCollapsed, setRightCollapsed, rightPanelTab, setRightPanelTab]);
  return <PanelLayoutContext value={stable}>{children}</PanelLayoutContext>;
}
