import type React from "react";

export const inputCls =
  "w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-2xs text-neutral-200 font-mono outline-none focus:border-neutral-600";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mt-2 mb-1.5">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-neutral-600 w-14 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
