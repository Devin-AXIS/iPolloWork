/** @jsxImportSource react */
import { publicAssetUrl } from "@/app/lib/public-asset";

type WorkspaceLoadingStateProps = {
  message: string;
  detail?: string | null;
};

export function WorkspaceLoadingState({ message, detail }: WorkspaceLoadingStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="ipollowork-loading-logo-shell" aria-hidden="true">
        <img
          src={publicAssetUrl("ipollowork-thinking-logo-v2.gif")}
          alt=""
          className="ipollowork-loading-logo"
        />
      </div>
      <div className="ipollowork-loading-label text-[12px] leading-5 text-dls-secondary">
        <span>{message}</span>
        <span className="ipollowork-loading-dots" aria-hidden="true" />
      </div>
      {detail ? <p className="max-w-[320px] text-xs leading-5 text-dls-secondary">{detail}</p> : null}
    </div>
  );
}
