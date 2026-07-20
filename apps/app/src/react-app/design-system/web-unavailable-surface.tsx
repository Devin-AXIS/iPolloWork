/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { t } from "@/i18n";

export type WebUnavailableSurfaceProps = {
  unavailable: boolean;
  children: ReactNode;
  compact?: boolean;
  className?: string;
  contentClassName?: string;
};

export function WebUnavailableSurface(props: WebUnavailableSurfaceProps) {
  const innerProps = props.unavailable
    ? {
        inert: true,
        "aria-disabled": true as const,
        className: "opacity-55",
      }
    : {
        className: "",
      };

  return (
    <div className={props.className}>
      {props.unavailable ? (
        <div
          className={
            props.compact
              ? "mb-3 rounded-xl border border-amber-7/30 bg-amber-2/45 px-3 py-2 text-[11px] text-amber-12"
              : "mb-4 rounded-2xl border border-amber-7/30 bg-amber-2/45 px-4 py-3 text-[13px] text-amber-12"
          }
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t("web_unavailable.message")}</span>
            <a
              href="https://ipolloworklabs.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
            >
              <span>{t("web_unavailable.download_desktop")}</span>
              <ArrowUpRight size={props.compact ? 12 : 14} />
            </a>
          </div>
        </div>
      ) : null}

      <div className={`relative ${props.contentClassName ?? ""}`}>
        <div {...innerProps}>{props.children}</div>
        {props.unavailable ? (
          <div
            className="absolute inset-0 z-10 cursor-not-allowed"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
