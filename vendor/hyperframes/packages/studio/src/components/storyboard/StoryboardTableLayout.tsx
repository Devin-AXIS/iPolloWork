import { useId, useRef, useState, type ReactNode } from "react";
import { useStudioI18n } from "../../i18n";

const COLUMNS = [
  { label: "#", width: 56, min: 48, max: 96 },
  { label: "Picture & scene", width: 300, min: 180, max: 900 },
  { label: "Narration", width: 260, min: 180, max: 900 },
  { label: "Camera & animation", width: 220, min: 160, max: 720 },
  { label: "Materials", width: 260, min: 200, max: 720 },
  { label: "Sound effects", width: 220, min: 160, max: 720 },
  { label: "Duration", width: 112, min: 96, max: 240 },
  { label: "Actions", width: 48, min: 48, max: 48 },
];

/** Layout preferences stay separate from the saved script and the video timeline. */
export function StoryboardTableLayout({
  children,
  footer,
  disabled,
}: {
  children: ReactNode;
  footer: ReactNode;
  disabled: boolean;
}) {
  const { tx } = useStudioI18n();
  const id = useId();
  const table = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    widths: number[];
  } | null>(null);
  const measuredWidths = () =>
    Array.from(
      table.current?.tHead?.rows[0].cells ?? [],
      (cell) => cell.getBoundingClientRect().width,
    );
  function resize(index: number, width: number, previous = measuredWidths()) {
    const column = COLUMNS[index];
    setWidths(
      previous.map((value, position) =>
        position === index
          ? Math.max(column.min, Math.min(column.max, width))
          : value,
      ),
    );
  }

  return (
    <div
      className="hf-script-table-scroll min-h-0 min-w-0 flex-1 overflow-auto outline-none"
      role="region"
      aria-label={tx("Scroll script table")}
      tabIndex={0}
    >
      <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
        <table
          ref={table}
          id={id}
          className="hf-script-table table-fixed border-collapse text-left text-xs"
          style={{
            width: widths
              ? widths.reduce((sum, width) => sum + width, 0)
              : "100%",
            minWidth: widths
              ? undefined
              : COLUMNS.reduce((sum, column) => sum + column.width, 0),
          }}
          aria-label={tx("Editable shots")}
        >
          <colgroup>
            {COLUMNS.map((column, index) => (
              <col
                key={column.label}
                style={{ width: widths?.[index] ?? column.width }}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[var(--hf-workspace-surface)] text-[var(--hf-panel-text-3)]">
            <tr className="border-y border-[var(--hf-workspace-border)]">
              {COLUMNS.map((column, index) => (
                <th
                  key={column.label}
                  scope="col"
                  className="relative px-3 py-2.5 font-medium"
                >
                  <span className={column.label === "Actions" ? "sr-only" : ""}>
                    {tx(column.label)}
                  </span>
                  {index < COLUMNS.length - 1 && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`${tx("Resize column")}: ${tx(column.label)}`}
                      aria-controls={id}
                      aria-valuemin={column.min}
                      aria-valuemax={column.max}
                      aria-valuenow={Math.round(
                        widths?.[index] ?? column.width,
                      )}
                      aria-disabled={disabled}
                      tabIndex={disabled ? -1 : 0}
                      title={tx(
                        "Drag to resize. Double-click to reset. Arrow keys adjust width.",
                      )}
                      className="hf-script-column-resize absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none select-none outline-none"
                      onPointerDown={(event) => {
                        if (disabled || event.button !== 0) return;
                        event.preventDefault();
                        drag.current = {
                          pointerId: event.pointerId,
                          x: event.clientX,
                          widths: measuredWidths(),
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const origin = drag.current;
                        if (
                          !origin ||
                          origin.pointerId !== event.pointerId ||
                          disabled
                        )
                          return;
                        resize(
                          index,
                          origin.widths[index] + event.clientX - origin.x,
                          origin.widths,
                        );
                      }}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                      onLostPointerCapture={() => {
                        drag.current = null;
                      }}
                      onDoubleClick={() => {
                        if (!disabled) resize(index, column.width);
                      }}
                      onKeyDown={(event) => {
                        if (
                          disabled ||
                          !["ArrowLeft", "ArrowRight", "Home"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const current = measuredWidths();
                        const delta =
                          (event.key === "ArrowLeft" ? -1 : 1) *
                          (event.shiftKey ? 40 : 16);
                        resize(
                          index,
                          event.key === "Home"
                            ? column.width
                            : current[index] + delta,
                          current,
                        );
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </table>
        <div className="sticky left-0 w-full">{footer}</div>
      </fieldset>
    </div>
  );
}
