import { useStudioI18n } from "../i18n";

export function StudioSplash({ waiting }: { waiting?: boolean }) {
  const { t } = useStudioI18n();

  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950">
      {waiting ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center" role="status">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-500 motion-reduce:animate-none" />
          <p className="text-xs text-neutral-600">{t("app.waitingForServer")}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 text-center" role="status">
          <div className="h-4 w-4 animate-pulse rounded-full bg-studio-accent motion-reduce:animate-none" />
          <p className="text-xs text-neutral-600">{t("app.loadingProject")}</p>
        </div>
      )}
    </div>
  );
}
