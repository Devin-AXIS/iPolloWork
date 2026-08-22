/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Check, FileAudio, Loader2, Play, RefreshCw, Sparkles, Upload } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { StudioInspectorHeader, StudioInspectorPanel } from "../panel/studio-inspector-panel";

import {
  BAILIAN_PRESET_VOICES,
  DEFAULT_COSYVOICE_MODEL,
  migrateVideoVoiceoverSettings,
  parseVideoVoiceoverSettings,
  serializeVideoVoiceoverSettings,
  synthesizedAudioUrl,
  validateVoiceSampleFile,
  videoVoiceoverSettingsPath,
  voiceSampleWorkspacePath,
  type VideoVoiceoverSettings,
} from "./video-voice";

type VideoVoicePanelProps = {
  sessionId: string;
  workspaceRoot: string;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  previewRequest: number;
  onClose: () => void;
  embedded?: boolean;
  embeddedWidth?: number;
};

type CustomVoice = {
  id: string;
  name: string;
  model: string;
  status: string;
};

type LoadedSettings = {
  settings: VideoVoiceoverSettings | null;
  updatedAt: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key].trim() : "";
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function mediaOutput(value: unknown): Record<string, unknown> {
  return readRecord(value, "output");
}

function mediaConfigured(value: unknown): boolean {
  return mediaOutput(value).configured === true;
}

function storageConfigured(value: unknown): boolean {
  const providers = mediaOutput(value).providers;
  return Array.isArray(providers) && providers.some((provider) => isRecord(provider) && provider.configured === true);
}

function customVoicesFrom(value: unknown): CustomVoice[] {
  const items = mediaOutput(value).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const id = readString(item, "id");
    if (!id) return [];
    const name = readString(item, "name") || id;
    return [{ id, name, model: readString(item, "model") || DEFAULT_COSYVOICE_MODEL, status: readString(item, "status").toUpperCase() || "UNKNOWN" }];
  });
}

function readableError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/Could not reach Alibaba Model Studio/i.test(message)) return t("video.voice.error.unreachable");
  if (/Alibaba Model Studio did not respond before the request timed out/i.test(message)) return t("video.voice.error.timeout");
  if (/Could not upload the audio to Alibaba Model Studio temporary storage/i.test(message)) return t("video.voice.error.upload");
  return message || t("video.voice.error.generic");
}

function canSynthesizeCustomVoice(voice: CustomVoice | undefined) {
  return voice?.status === "OK";
}

function presetVoiceLabel(voiceId: string) {
  return BAILIAN_PRESET_VOICES.some((voice) => voice.id === voiceId)
    ? t(`video.voice.preset_name.${voiceId}`)
    : voiceId;
}

function customVoiceAvailabilityMessage(voice: CustomVoice | undefined) {
  if (!voice) return t("video.voice.error.cloned_not_found");
  if (voice.status === "DEPLOYING") return t("video.voice.error.cloned_deploying");
  if (voice.status === "UNDEPLOYED") return t("video.voice.error.cloned_undeployed");
  return t("video.voice.error.cloned_unavailable");
}

function voiceSettings(voiceId: string, source: VideoVoiceoverSettings["source"], model = DEFAULT_COSYVOICE_MODEL): VideoVoiceoverSettings {
  return { provider: "aliyun-bailian", model, voiceId, source, updatedAt: new Date().toISOString() };
}

async function readAudioDuration(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error(t("video.voice.error.duration_unreadable")));
      audio.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function VideoVoicePanel({ sessionId, workspaceRoot, client, workspaceId, previewRequest, onClose, embedded = false, embeddedWidth = 400 }: VideoVoicePanelProps) {
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const handledPreviewRequestRef = React.useRef(0);
  const [settings, setSettings] = React.useState<LoadedSettings>({ settings: null, updatedAt: null });
  const [presetVoiceId, setPresetVoiceId] = React.useState("");
  const [customVoices, setCustomVoices] = React.useState<CustomVoice[]>([]);
  const [mediaReady, setMediaReady] = React.useState(false);
  const [storageReady, setStorageReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<"preset" | "mine">("preset");
  const [mineDataLoaded, setMineDataLoaded] = React.useState(false);
  const [loadingMineData, setLoadingMineData] = React.useState(false);
  const [cloning, setCloning] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const activeVoice = settings.settings;
  const context = React.useMemo(() => ({ directory: workspaceRoot }), [workspaceRoot]);

  const sendVoiceToAi = React.useCallback(() => {
    if (!activeVoice) {
      setMessage(t("video.voice.select_first"));
      return;
    }
    const label = activeVoice.source === "preset"
      ? presetVoiceLabel(activeVoice.voiceId)
      : customVoices.find((voice) => voice.id === activeVoice.voiceId)?.name ?? t("video.voice.current_cloned");
    window.dispatchEvent(new CustomEvent("ipollowork:add-voice-reference", {
      detail: {
        sessionId,
        reference: { voiceId: activeVoice.voiceId, model: activeVoice.model, label: t("video.voice.reference_label", { label }) },
      },
    }));
  }, [activeVoice, customVoices, sessionId]);

  const loadCustomVoices = React.useCallback(async () => {
    if (!client || !mediaReady) return [];
    const result = await client.callMedia("voice_list", {}, context);
    if (!result.ok) throw new Error(result.message);
    const voices = customVoicesFrom(result.result);
    setCustomVoices(voices);
    return voices;
  }, [client, context, mediaReady]);

  const loadMineData = React.useCallback(async () => {
    if (!client || !mediaReady) return;
    setLoadingMineData(true);
    setMessage("");
    try {
      const [voicesResult, storageResult] = await Promise.allSettled([
        loadCustomVoices(),
        client.callStorage("status", {}, context),
      ]);
      const errors: string[] = [];
      if (voicesResult.status === "rejected") {
        errors.push(readableError(voicesResult.reason));
      }
      if (storageResult.status === "fulfilled") {
        const storage = storageResult.value;
        setStorageReady(storage.ok && storageConfigured(storage.result));
        if (!storage.ok) errors.push(storage.message);
      } else {
        setStorageReady(false);
        errors.push(readableError(storageResult.reason));
      }
      setMineDataLoaded(true);
      if (errors.length) setMessage(errors.join(" "));
    } finally {
      setLoadingMineData(false);
    }
  }, [client, context, loadCustomVoices, mediaReady]);

  const saveSettings = React.useCallback(async (next: VideoVoiceoverSettings) => {
    if (!client || !workspaceId) throw new Error(t("video.voice.error.workspace_unavailable"));
    const written = await client.writeWorkspaceFile(workspaceId, {
      path: videoVoiceoverSettingsPath(sessionId),
      content: serializeVideoVoiceoverSettings(next),
      baseUpdatedAt: settings.updatedAt,
    });
    setSettings({ settings: next, updatedAt: written.updatedAt });
  }, [client, sessionId, settings.updatedAt, workspaceId]);

  const choosePreset = React.useCallback(async (voiceId: string) => {
    setPresetVoiceId(voiceId);
    setMessage("");
    try {
      await saveSettings(voiceSettings(voiceId, "preset"));
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [saveSettings]);

  const chooseCustomVoice = React.useCallback(async (voiceId: string) => {
    const voice = customVoices.find((item) => item.id === voiceId);
    if (!voice) return;
    setMessage("");
    if (!canSynthesizeCustomVoice(voice)) {
      setMessage(customVoiceAvailabilityMessage(voice));
      return;
    }
    try {
      await saveSettings(voiceSettings(voice.id, "cloned", voice.model));
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [customVoices, saveSettings]);

  const previewVoice = React.useCallback(async () => {
    if (!client || !activeVoice) {
      setMessage(t("video.voice.preview_select_first"));
      return;
    }
    setPreviewing(true);
    setMessage("");
    try {
      let model = activeVoice.model;
      if (activeVoice.source === "cloned") {
        const latestVoice = (await loadCustomVoices()).find((voice) => voice.id === activeVoice.voiceId);
        if (!latestVoice || !canSynthesizeCustomVoice(latestVoice)) throw new Error(customVoiceAvailabilityMessage(latestVoice));
        model = latestVoice.model;
        if (model !== activeVoice.model) await saveSettings(voiceSettings(activeVoice.voiceId, "cloned", model));
      }
      const result = await client.callMedia("speech_synthesize", {
        text: t("video.voice.preview_sample"),
        voice: activeVoice.voiceId,
        model,
        format: "mp3",
      }, context);
      if (!result.ok) throw new Error(result.message);
      const url = synthesizedAudioUrl(mediaOutput(result.result));
      if (!url) throw new Error(t("video.voice.error.preview_url_missing"));
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setPreviewing(false);
    }
  }, [activeVoice, client, context]);

  const cloneVoice = React.useCallback(async (file: File) => {
    const invalid = validateVoiceSampleFile(file, {
      invalidType: t("video.voice.error.sample_type"),
      empty: t("video.voice.error.sample_empty"),
      tooLarge: t("video.voice.error.sample_too_large"),
    });
    if (invalid) {
      setMessage(invalid);
      return;
    }
    if (!client || !workspaceId || !mediaReady) return;
    setCloning(true);
    setMessage("");
    let samplePath: string | null = null;
    try {
      const duration = await readAudioDuration(file);
      if (!Number.isFinite(duration) || duration < 10 || duration > 60) {
        throw new Error(t("video.voice.error.sample_duration"));
      }
      samplePath = voiceSampleWorkspacePath(sessionId, file.name);
      await client.writeWorkspaceBinaryFile(workspaceId, { path: samplePath, data: await file.arrayBuffer() });
      const result = await client.callMedia("voice_clone_workspace_file", { sourcePath: samplePath }, context);
      if (!result.ok) throw new Error(result.message);
      const output = mediaOutput(result.result);
      const voiceId = readString(output, "voiceId");
      const model = readString(output, "model") || DEFAULT_COSYVOICE_MODEL;
      if (!voiceId) throw new Error(t("video.voice.error.clone_id_missing"));
      const clonedVoice = (await loadCustomVoices()).find((voice) => voice.id === voiceId);
      if (!canSynthesizeCustomVoice(clonedVoice)) {
        setMessage(`${customVoiceAvailabilityMessage(clonedVoice)} ${t("video.voice.refresh_to_select")}`);
        return;
      }
      await saveSettings(voiceSettings(voiceId, "cloned", model));
      setMessage(t("video.voice.clone_success"));
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      if (samplePath) await client.deleteWorkspaceFiles(workspaceId, [{ path: samplePath }]).catch(() => undefined);
      setCloning(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [client, context, loadCustomVoices, mediaReady, saveSettings, sessionId, workspaceId]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    setCustomVoices([]);
    setStorageReady(false);
    setMineDataLoaded(false);
    void (async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setMediaReady(false);
          setLoading(false);
        }
        return;
      }
      try {
        const [media, saved] = await Promise.all([
          client.callMedia("status", {}, context),
          client.readWorkspaceFile(workspaceId, videoVoiceoverSettingsPath(sessionId)).catch(() => null),
        ]);
        if (cancelled) return;
        const configured = media.ok && mediaConfigured(media.result);
        setMediaReady(configured);
        if (saved) {
          const parsed = parseVideoVoiceoverSettings(saved.content);
          const restored = parsed ? migrateVideoVoiceoverSettings(parsed) : null;
          if (restored && parsed && restored.voiceId !== parsed.voiceId) {
            const migrated = { ...restored, updatedAt: new Date().toISOString() };
            try {
              const written = await client.writeWorkspaceFile(workspaceId, {
                path: videoVoiceoverSettingsPath(sessionId),
                content: serializeVideoVoiceoverSettings(migrated),
                baseUpdatedAt: saved.updatedAt,
              });
              setSettings({ settings: migrated, updatedAt: written.updatedAt });
              setMessage(t("video.voice.migration_success"));
            } catch (error) {
              setSettings({ settings: restored, updatedAt: saved.updatedAt });
              setMessage(t("video.voice.migration_save_failed", { error: readableError(error) }));
            }
          } else {
            setSettings({ settings: restored, updatedAt: saved.updatedAt });
          }
          if (restored?.source === "preset") setPresetVoiceId(restored.voiceId);
        }
      } catch (error) {
        if (!cancelled) setMessage(readableError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [client, context, sessionId, workspaceId]);

  React.useEffect(() => {
    if (activeTab !== "mine" || mineDataLoaded || loadingMineData || !mediaReady) return;
    void loadMineData();
  }, [activeTab, loadMineData, loadingMineData, mediaReady, mineDataLoaded]);

  React.useEffect(() => {
    if (loading || previewRequest <= handledPreviewRequestRef.current) return;
    handledPreviewRequestRef.current = previewRequest;
    void previewVoice();
  }, [loading, previewRequest, previewVoice]);

  return (
    <StudioInspectorPanel
      ariaLabel={t("video.voice.panel_label")}
      className={embedded
        ? "absolute bottom-0 right-0 top-[90px] z-20 h-auto min-w-0 max-w-full bg-popover"
        : "absolute inset-y-0 right-0 z-20 h-auto w-[22rem] max-w-[calc(100%-2rem)] bg-popover/95 shadow-2xl backdrop-blur-xl"}
      width={embedded ? embeddedWidth : undefined}
      embedded={embedded}
      testId="video-voice-panel"
      bodyClassName="px-3 py-3"
      header={!embedded ? <StudioInspectorHeader
        title={t("video.voice.title")}
        description={t("video.voice.subtitle")}
        icon={<AudioLines />}
        actions={<Button variant="ghost" size="icon-xs" onClick={() => void previewVoice()} disabled={!activeVoice || previewing} aria-label={t("video.voice.preview_current")}>
          {previewing ? <Loader2 className="animate-spin" /> : <Play />}
        </Button>}
        closeLabel={t("video.voice.close_settings")}
        onClose={onClose}
      /> : undefined}
    >
          {loading ? <div className="grid min-h-40 place-items-center text-xs text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />{t("video.voice.loading_config")}</div> : null}
          {!loading && !mediaReady ? <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-5 text-muted-foreground"><p className="font-medium text-foreground">{t("video.voice.configure_title")}</p><p className="mt-1">{t("video.voice.configure_description")}</p></div> : null}
          {!loading && mediaReady ? <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value === "mine" ? "mine" : "preset")} className="gap-3">
            <TabsList className="w-full bg-muted/60">
              <TabsTrigger value="preset"><AudioLines />{t("video.voice.preset_tab")}</TabsTrigger>
              <TabsTrigger value="mine"><FileAudio />{t("video.voice.my_voices_tab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="preset" className="space-y-3">
              <div>
                <p className="text-xs font-medium">{t("video.voice.official_presets")}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("video.voice.preset_help")}</p>
              </div>
              <Select value={presetVoiceId} onValueChange={(value) => { if (value) void choosePreset(value); }}>
                <SelectTrigger className="w-full" aria-label={t("video.voice.official_aria")}><SelectValue placeholder={t("video.voice.choose_official")} /></SelectTrigger>
                <SelectContent align="start"><SelectGroup><SelectLabel>CosyVoice</SelectLabel>{BAILIAN_PRESET_VOICES.map((voice) => <SelectItem key={voice.id} value={voice.id}>{presetVoiceLabel(voice.id)} · {t(`video.voice.preset_description.${voice.id}`)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              {activeVoice?.source === "preset" ? <SelectedVoice voiceId={activeVoice.voiceId} label={presetVoiceLabel(activeVoice.voiceId)} /> : null}
              <VoiceAiButton disabled={!activeVoice || activeVoice.source !== "preset"} onClick={sendVoiceToAi} />
            </TabsContent>
            <TabsContent value="mine" className="space-y-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">{t("video.voice.cloned_heading")}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("video.voice.cloned_help")}</p></div><Button variant="ghost" size="icon-xs" onClick={() => void loadMineData()} disabled={loadingMineData} aria-label={t("video.voice.refresh_my_voices")}>{loadingMineData ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></div>
              {loadingMineData ? <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" />{t("video.voice.loading_my_voices")}</p> : null}
              <Select value={activeVoice?.source === "cloned" ? activeVoice.voiceId : ""} onValueChange={(value) => { if (value) void chooseCustomVoice(value); }}>
                <SelectTrigger className="w-full" disabled={loadingMineData} aria-label={t("video.voice.my_voice_aria")}><SelectValue placeholder={loadingMineData ? t("video.voice.loading") : customVoices.length ? t("video.voice.choose_cloned") : t("video.voice.no_cloned")} /></SelectTrigger>
                <SelectContent align="start"><SelectGroup>{customVoices.map((voice) => <SelectItem key={voice.id} value={voice.id} disabled={!canSynthesizeCustomVoice(voice)}>{voice.name}{voice.status === "OK" ? "" : ` · ${voice.status}`}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <input ref={uploadInputRef} type="file" accept="audio/wav,audio/mpeg,audio/mp4,.wav,.mp3,.m4a" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void cloneVoice(file); }} />
              <div className="rounded-xl border border-dashed border-border bg-muted/25 p-3">
                <p className="text-xs font-medium">{t("video.voice.clone_heading")}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("video.voice.clone_file_help")}</p>
                {!storageReady ? <p className="mt-2 text-[11px] text-muted-foreground">{t("video.voice.temp_storage_help")}</p> : null}
                <Button className="mt-3 w-full" variant="outline" size="sm" disabled={cloning} onClick={() => uploadInputRef.current?.click()}>{cloning ? <Loader2 className="animate-spin" /> : <Upload />}{t("video.voice.clone_action")}</Button>
              </div>
              {activeVoice?.source === "cloned" ? <SelectedVoice voiceId={activeVoice.voiceId} label={customVoices.find((voice) => voice.id === activeVoice.voiceId)?.name ?? t("video.voice.current_cloned")} /> : null}
              <VoiceAiButton disabled={!activeVoice || activeVoice.source !== "cloned"} onClick={sendVoiceToAi} />
            </TabsContent>
          </Tabs> : null}
          {message ? <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-4 text-muted-foreground" role="status">{message}</p> : null}
    </StudioInspectorPanel>
  );
}

function SelectedVoice({ voiceId, label }: { voiceId: string; label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs"><Check className="size-3.5 text-primary" /><div className="min-w-0"><p className="truncate font-medium">{label}</p><p className="truncate text-[10px] text-muted-foreground">{voiceId}</p></div></div>;
}

function VoiceAiButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return <Button type="button" className="w-full" variant="outline" size="sm" disabled={disabled} onClick={onClick}><Sparkles />{t("video.voice.ai_action")}</Button>;
}
