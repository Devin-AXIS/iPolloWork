import { Tooltip } from "./ui";
import { Button } from "@ipollowork/ui/controls";

/** Tab-bar button for the right inspector panel header. */
export function PanelTabButton({
  label,
  tooltip,
  active,
  onClick,
}: {
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={tooltip} side="bottom">
      <Button
        type="button"
        size="sm"
        variant={active ? "default" : "ghost"}
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className="relative z-10 min-w-0"
      >
        <span className="relative z-10 whitespace-nowrap text-current">{label}</span>
      </Button>
    </Tooltip>
  );
}
