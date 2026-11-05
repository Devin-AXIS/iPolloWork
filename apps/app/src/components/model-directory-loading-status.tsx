"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  CODEX_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_ENGINE_ID,
} from "@ipollowork/types/workspace";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type ModelDirectoryLoadingStage =
  | "connecting"
  | "cold-starting"
  | "reading-catalog"
  | "syncing-configuration"
  | "checking-compatibility"
  | "refreshing";

export function resolveModelDirectoryLoadingStage(input: {
  elapsedMs: number;
  engineId?: string | null;
  hasModels: boolean;
}): ModelDirectoryLoadingStage {
  if (input.hasModels) {
    return input.elapsedMs < 5_000 ? "refreshing" : "checking-compatibility";
  }
  if (input.elapsedMs < 1_200) return "connecting";
  if (
    input.engineId === DEEPSEEK_HARNESS_ENGINE_ID
    && input.elapsedMs < 6_000
  ) {
    return "cold-starting";
  }
  if (input.elapsedMs < 6_000) return "reading-catalog";
  if (input.elapsedMs < 10_000) return "syncing-configuration";
  return "checking-compatibility";
}

function engineName(engineId?: string | null): string {
  if (engineId === DEEPSEEK_HARNESS_ENGINE_ID) return t("projects.engine_dsh");
  if (engineId === CODEX_HARNESS_ENGINE_ID) return t("projects.engine_codex");
  return t("projects.engine_opencode");
}

function stageLabel(stage: ModelDirectoryLoadingStage, engineId?: string | null): string {
  switch (stage) {
    case "connecting":
      return t("model_picker.loading.connecting");
    case "cold-starting":
      return t("model_picker.loading.cold_start", { engine: engineName(engineId) });
    case "reading-catalog":
      return t("model_picker.loading.reading_catalog");
    case "syncing-configuration":
      return t("model_picker.loading.syncing_configuration");
    case "checking-compatibility":
      return t("model_picker.loading.checking_compatibility");
    case "refreshing":
      return t("model_picker.loading.refreshing");
  }
}

export function ModelDirectoryLoadingStatus(props: {
  className?: string;
  engineId?: string | null;
  hasModels: boolean;
}) {
  const startedAtRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const updateElapsed = () => setElapsedMs(Date.now() - startedAtRef.current);
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [props.engineId, props.hasModels]);

  const stage = resolveModelDirectoryLoadingStage({
    elapsedMs,
    engineId: props.engineId,
    hasModels: props.hasModels,
  });
  const label = useMemo(() => stageLabel(stage, props.engineId), [props.engineId, stage]);
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1_000));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn("flex min-w-0 items-center gap-2 text-muted-foreground", props.className)}
    >
      <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {elapsedMs >= 1_000 ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/70" aria-hidden>
          {t("model_picker.loading.elapsed", { seconds: elapsedSeconds })}
        </span>
      ) : null}
    </div>
  );
}
