/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Check, ChevronDown, Loader2, Play, RefreshCw, Search, SlidersHorizontal, Sparkles, Mic, KeyRound, Plus } from "lucide-react";

import { Link } from "react-router-dom";
import { workspaceSettingsRoute, globalSettingsRoute } from "@/react-app/shell/workspace-routes";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { StudioInspectorHeader, StudioInspectorPanel } from "../panel/studio-inspector-panel";

import { VideoVoiceSample } from "./video-voice-sample";
import { videoProjectEntryPath } from "./video-project";
import {
  appliedVideoVoices,
  videoVoiceNeedsUpdate,
  requestVideoVoiceover,
  type AppliedVideoVoice,
  BAILIAN_PRESET_VOICES,
  BAILIAN_VOICE_AGES,
  BAILIAN_VOICE_GENDERS,
  BAILIAN_VOICE_LANGUAGES,
  BAILIAN_VOICE_STYLES,
  DEFAULT_COSYVOICE_MODEL,
  DEFAULT_COSYVOICE_VOICE,
  defaultVideoVoiceoverSettings,
  migrateVideoVoiceoverSettings,
  parseVideoVoiceoverSettings,
  serializeVideoVoiceoverSettings,
  synthesizedAudioUrl,
  validateVoiceSampleFile,
  videoVoiceoverSettingsPath,
  videoVoiceoverAvailability,
  videoVoiceInstruction,
  videoVoiceStyle,
  voiceSampleWorkspacePath,
  type VideoVoiceoverSettings,
} from "./video-voice";

type VideoVoicePanelProps = {
  sessionId: string;
  conversationId?: string;
  generating?: boolean;
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

function customVoicesFrom(value: unknown): CustomVoice[] {
  const items = mediaOutput(value).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const id = readString(item, "id");
    if (!id) return [];
    const name = readString(item, "name") || t("video.voice.unnamed_cloned", { id: id.slice(-6) });
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

function voiceSettings(
  current: VideoVoiceoverSettings | null,
  voiceId: string,
  source: VideoVoiceoverSettings["source"],
  model = DEFAULT_COSYVOICE_MODEL,
): VideoVoiceoverSettings {
  return {
    ...(current ?? defaultVideoVoiceoverSettings()),
    model,
    voiceId,
    source,
    selectionMode: "manual",
    updatedAt: new Date().toISOString(),
  };
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

export function VideoVoicePanel({ sessionId, conversationId = sessionId, generating = false, workspaceRoot, client, workspaceId, previewRequest, onClose, embedded = false, embeddedWidth = 400 }: VideoVoicePanelProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const voicePickerAnchorRef = React.useRef<HTMLDivElement>(null);
  const previewGenerationRef = React.useRef(0);
  const handledPreviewRequestRef = React.useRef(0);
  const [settings, setSettings] = React.useState<LoadedSettings>({ settings: null, updatedAt: null });
  const [customVoices, setCustomVoices] = React.useState<CustomVoice[]>([]);
  const [mediaReady, setMediaReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [activeTab, setActiveTab] = React.useState<"preset" | "mine">("preset");
  const [mineDataLoaded, setMineDataLoaded] = React.useState(false);
  const [loadingMineData, setLoadingMineData] = React.useState(false);
  const [cloning, setCloning] = React.useState(false);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [cloneName, setCloneName] = React.useState("");
  const [cloneFile, setCloneFile] = React.useState<File | null>(null);
  const [sampleBusy, setSampleBusy] = React.useState(false);
  const [cloneStage, setCloneStage] = React.useState<"preparing" | "uploading" | "creating">("preparing");
  const [cloneError, setCloneError] = React.useState("");
  const cloneNameId = React.useId();
  const [previewingVoiceId, setPreviewingVoiceId] = React.useState<string | null>(null);
  const previewing = previewingVoiceId !== null;
  const [message, setMessage] = React.useState("");
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);
  const [voiceQuery, setVoiceQuery] = React.useState("");
  const [languageFilter, setLanguageFilter] = React.useState<(typeof BAILIAN_VOICE_LANGUAGES)[number]>("all");
  const [genderFilter, setGenderFilter] = React.useState<(typeof BAILIAN_VOICE_GENDERS)[number]>("all");
  const [ageFilter, setAgeFilter] = React.useState<(typeof BAILIAN_VOICE_AGES)[number]>("all");

  const [appliedVoices, setAppliedVoices] = React.useState<AppliedVideoVoice[]>([]);
  const [readingApplied, setReadingApplied] = React.useState(true);
  const [appliedReadFailed, setAppliedReadFailed] = React.useState(false);
  const [requesting, setRequesting] = React.useState(false);
  const busy = requesting || generating;
  const activeVoice = settings.settings;
  const needsUpdate = activeVoice ? videoVoiceNeedsUpdate(activeVoice, appliedVoices) : false;
  const appliedIds = [...new Set(appliedVoices.flatMap((voice) => voice.voiceId ? [voice.voiceId] : []))];
  const appliedLabel = appliedIds.length > 1 ? t("video.voice.multiple_applied")
    : appliedIds[0] ? customVoices.find((voice) => voice.id === appliedIds[0])?.name ?? presetVoiceLabel(appliedIds[0])
    : t("video.voice.applied_unknown");
  const hasApplied = appliedVoices.length > 0;
  const appliedMetadataKnown = appliedVoices.every((voice) => voice.voiceId && Object.values(voice).every((value) => value !== null));
  const actionLabel = t(busy
    ? hasApplied ? "video.voice.updating" : "video.voice.generating"
    : hasApplied ? "video.voice.update_action" : "video.voice.generate_action");
  const activeVoiceLabel = activeVoice?.source === "cloned"
    ? customVoices.find(voice => voice.id === activeVoice.voiceId)?.name ?? t("video.voice.current_cloned")
    : presetVoiceLabel(activeVoice?.voiceId ?? DEFAULT_COSYVOICE_VOICE);
  const selectedVoiceReady = activeVoice?.source === "preset"
    || (activeVoice?.source === "cloned" && canSynthesizeCustomVoice(customVoices.find(voice => voice.id === activeVoice.voiceId)));
  const filterCount = [languageFilter, genderFilter, ageFilter].filter(value => value !== "all").length;
  const context = React.useMemo(() => ({ directory: workspaceRoot }), [workspaceRoot]);
  const filteredPresetVoices = React.useMemo(() => BAILIAN_PRESET_VOICES.filter((voice) => {
    const query = voiceQuery.trim().toLocaleLowerCase();
    const matchesQuery = !query
      || presetVoiceLabel(voice.id).toLocaleLowerCase().includes(query)
      || t(`video.voice.preset_description.${voice.id}`).toLocaleLowerCase().includes(query);
    const matchesLanguage = languageFilter === "all" || voice.languages.some((language) => language === languageFilter);
    const matchesGender = genderFilter === "all" || voice.gender === genderFilter;
    const matchesAge = ageFilter === "all" || voice.age === ageFilter;
    return matchesQuery && matchesLanguage && matchesGender && matchesAge;
  }), [ageFilter, genderFilter, languageFilter, voiceQuery]);

  const generateVoiceover = React.useCallback(async () => {
    if (!activeVoice || busy) return;
    setRequesting(true);
    setMessage("");
    try {
      const dispatched = await requestVideoVoiceover({
        conversationId,
        videoSessionId: sessionId,
        settings: activeVoice,
        updating: hasApplied,
      });
      if (!dispatched) setMessage(t("video.voice.request_not_sent"));
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setRequesting(false);
    }
  }, [activeVoice, busy, conversationId, hasApplied, sessionId]);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!client || !workspaceId || generating) return;
      setReadingApplied(true);
      try {
        const source = await client.readWorkspaceFile(workspaceId, videoProjectEntryPath(sessionId));
        if (!cancelled) {
          setAppliedVoices(appliedVideoVoices(source.content));
          setAppliedReadFailed(false);
        }
      } catch (error) {
        if (!cancelled) {
          setAppliedReadFailed(true);
          setMessage(readableError(error));
        }
      } finally {
        if (!cancelled) setReadingApplied(false);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); };
  }, [client, generating, sessionId, workspaceId]);

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
      await loadCustomVoices();
      setMineDataLoaded(true);
    } catch (error) {
      setMineDataLoaded(true);
      setMessage(readableError(error));
    } finally {
      setLoadingMineData(false);
    }
  }, [client, loadCustomVoices, mediaReady]);

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
    setMessage("");
    try {
      await saveSettings(voiceSettings(activeVoice, voiceId, "preset"));
      setVoicePickerOpen(false);
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [activeVoice, saveSettings]);

  const chooseAuto = React.useCallback(async () => {
    if (activeVoice?.source === "preset" && activeVoice.selectionMode === "auto") {
      setVoicePickerOpen(false);
      return;
    }
    const current = activeVoice ?? defaultVideoVoiceoverSettings();
    setMessage("");
    try {
      await saveSettings({
        ...current,
        model: DEFAULT_COSYVOICE_MODEL,
        voiceId: current.source === "preset" ? current.voiceId : DEFAULT_COSYVOICE_VOICE,
        source: "preset",
        selectionMode: "auto",
        updatedAt: new Date().toISOString(),
      });
      setVoicePickerOpen(false);
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [activeVoice, saveSettings]);

  const updateSettings = React.useCallback(async (changes: Partial<VideoVoiceoverSettings>) => {
    const current = activeVoice ?? defaultVideoVoiceoverSettings();
    setMessage("");
    try {
      await saveSettings({ ...current, ...changes, updatedAt: new Date().toISOString() });
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [activeVoice, saveSettings]);

  const chooseCustomVoice = React.useCallback(async (voiceId: string) => {
    const voice = customVoices.find((item) => item.id === voiceId);
    if (!voice) return;
    setMessage("");
    if (!canSynthesizeCustomVoice(voice)) {
      setMessage(customVoiceAvailabilityMessage(voice));
      return;
    }
    try {
      await saveSettings(voiceSettings(activeVoice, voice.id, "cloned", voice.model));
      setVoicePickerOpen(false);
    } catch (error) {
      setMessage(readableError(error));
    }
  }, [activeVoice, customVoices, saveSettings]);

  const previewVoice = React.useCallback(async (target?: Pick<VideoVoiceoverSettings, "voiceId" | "source" | "model">) => {
    const voice = target ? voiceSettings(activeVoice, target.voiceId, target.source, target.model) : activeVoice;
    if (!client || !mediaReady || !voice || voice.selectionMode === "auto") {
      setMessage(t("video.voice.preview_select_first"));
      return;
    }
    const generation = ++previewGenerationRef.current;
    audioRef.current?.pause();
    setPreviewingVoiceId(voice.voiceId);
    setMessage("");
    try {
      let model = voice.model;
      if (voice.source === "cloned") {
        const latestVoice = (await loadCustomVoices()).find((item) => item.id === voice.voiceId);
        if (!latestVoice || !canSynthesizeCustomVoice(latestVoice)) throw new Error(customVoiceAvailabilityMessage(latestVoice));
        model = latestVoice.model;
        if (model !== voice.model) await saveSettings(voiceSettings(voice, voice.voiceId, "cloned", model));
      }
      const result = await client.callMedia("speech_synthesize", {
        text: t("video.voice.preview_sample"),
        voice: voice.voiceId,
        model,
        format: "mp3",
        rate: voice.rate,
        pitch: voice.pitch,
        volume: voice.volume,
        ...(voice.instruction ? { instruction: voice.instruction } : {}),
      }, context);
      if (generation !== previewGenerationRef.current) return;
      if (!result.ok) throw new Error(result.message);
      const url = synthesizedAudioUrl(mediaOutput(result.result));
      if (!url) throw new Error(t("video.voice.error.preview_url_missing"));
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch (error) {
      if (generation === previewGenerationRef.current) setMessage(readableError(error));
    } finally {
      if (generation === previewGenerationRef.current) setPreviewingVoiceId(null);
    }
  }, [activeVoice, client, context, loadCustomVoices, mediaReady, saveSettings]);

  const cloneVoice = React.useCallback(async (file: File, name: string) => {
    if (cloning || !name.trim()) return;
    const invalid = validateVoiceSampleFile(file, {
      invalidType: t("video.voice.error.sample_type"),
      empty: t("video.voice.error.sample_empty"),
      tooLarge: t("video.voice.error.sample_too_large"),
    });
    if (invalid) {
      setCloneError(invalid);
      return;
    }
    if (!client || !workspaceId || !mediaReady) {
      setCloneError(t("video.voice.error.workspace_unavailable"));
      return;
    }
    setCloning(true);
    setCloneStage("preparing");
    setCloneError("");
    let samplePath: string | null = null;
    let created = false;
    try {
      const duration = await readAudioDuration(file);
      if (!Number.isFinite(duration) || duration < 10 || duration > 60) {
        throw new Error(t("video.voice.error.sample_duration"));
      }
      setCloneStage("uploading");
      samplePath = voiceSampleWorkspacePath(sessionId, file.name);
      await client.writeWorkspaceBinaryFile(workspaceId, { path: samplePath, data: await file.arrayBuffer() });
      setCloneStage("creating");
      const result = await client.callMedia("voice_clone_workspace_file", { sourcePath: samplePath, name: name.trim() }, context);
      if (!result.ok) throw new Error(result.message);
      const output = mediaOutput(result.result);
      const voiceId = readString(output, "voiceId");
      const model = readString(output, "model") || DEFAULT_COSYVOICE_MODEL;
      if (!voiceId) throw new Error(t("video.voice.error.clone_id_missing"));
      created = true;
      setCloneOpen(false);
      setCloneFile(null);
      setCloneName("");
      const clonedVoice = (await loadCustomVoices()).find((voice) => voice.id === voiceId);
      if (!canSynthesizeCustomVoice(clonedVoice)) {
        setMessage(`${customVoiceAvailabilityMessage(clonedVoice)} ${t("video.voice.refresh_to_select")}`);
        return;
      }
      await saveSettings(voiceSettings(activeVoice, voiceId, "cloned", model));
      setMessage(t("video.voice.clone_success"));
    } catch (error) {
      if (created) setMessage(readableError(error));
      else setCloneError(readableError(error));
    } finally {
      if (samplePath) await client.deleteWorkspaceFiles(workspaceId, [{ path: samplePath }]).catch(() => undefined);
      setCloning(false);
    }
  }, [activeVoice, client, cloning, context, loadCustomVoices, mediaReady, saveSettings, sessionId, workspaceId]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreviewingVoiceId(null);
    setMessage("");
    setCustomVoices([]);
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
        const configured = videoVoiceoverAvailability(media, saved?.content ?? null).configured;
        setMediaReady(configured);
        const parsed = saved ? parseVideoVoiceoverSettings(saved.content) : null;
        const restored = parsed ? migrateVideoVoiceoverSettings(parsed) : { ...defaultVideoVoiceoverSettings(), enabled: configured };
        setSettings({ settings: restored, updatedAt: saved?.updatedAt ?? null });
        // An unavailable provider must not create a saved preference that overrides
        // the authorized default later. Existing user choices remain intact.
        if (!configured) return;
        if (!parsed || restored.voiceId !== parsed.voiceId) {
          const next = { ...restored, updatedAt: new Date().toISOString() };
          const written = await client.writeWorkspaceFile(workspaceId, {
            path: videoVoiceoverSettingsPath(sessionId),
            content: serializeVideoVoiceoverSettings(next),
            baseUpdatedAt: saved?.updatedAt ?? null,
          });
          if (!cancelled) {
            setSettings({ settings: next, updatedAt: written.updatedAt });
            if (parsed) setMessage(t("video.voice.migration_success"));
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(readableError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      previewGenerationRef.current += 1;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [client, context, sessionId, workspaceId]);

  const openClone = () => { setVoicePickerOpen(false); setCloneError(""); setSampleBusy(false); setCloneOpen(true); };

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
        ? "absolute bottom-0 right-0 top-[148px] z-20 h-auto min-w-0 max-w-full bg-popover"
        : "absolute inset-y-0 right-0 z-20 h-auto w-[22rem] max-w-[calc(100%-2rem)] bg-popover/95 shadow-2xl backdrop-blur-xl"}
      width={embedded ? embeddedWidth : undefined}
      embedded={embedded}
      testId="video-voice-panel"
      bodyClassName="video-settings-typography p-4 text-xs font-normal text-foreground"
      header={!embedded ? <StudioInspectorHeader
        title={t("video.voice.title")}
        description={t("video.voice.subtitle")}
        icon={<AudioLines />}
        actions={<Button variant="ghost" size="icon-xs" onClick={() => void previewVoice()} disabled={!mediaReady || !activeVoice?.enabled || activeVoice.selectionMode === "auto" || previewing} aria-label={t("video.voice.preview_current")}>
          {previewing ? <Loader2 className="animate-spin" /> : <Play />}
        </Button>}
        closeLabel={t("video.voice.close_settings")}
        onClose={onClose}
      /> : undefined}
    >
          {loading ? <div className="grid min-h-40 place-items-center text-xs text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />{t("video.voice.loading_config")}</div> : null}
          {!loading && activeVoice ? <div className="mb-6 flex min-h-8 items-center justify-between gap-3">
            <p className="min-w-0 text-[13px] font-medium text-foreground">{t("video.voice.enabled_title")}</p>
            <Switch checked={mediaReady && activeVoice.enabled} disabled={!mediaReady || busy} onCheckedChange={(checked) => void updateSettings({ enabled: checked })} aria-label={t("video.voice.enabled_title")} />
          </div> : null}
          {!loading && !mediaReady ? <div data-testid="voice-authorization-empty" className="flex flex-col items-center gap-3 rounded-lg bg-muted/45 px-4 py-8 text-center">
            <KeyRound aria-hidden="true" className="size-6 text-muted-foreground" />
            <div className="space-y-1"><p className="text-xs font-medium">{t("video.voice.configure_title")}</p><p className="text-[11px] leading-5 text-muted-foreground">{t("video.voice.configure_description")}</p></div>
            <Button className="h-[34px] rounded-lg text-xs" render={<Link to={workspaceId ? workspaceSettingsRoute(workspaceId, "authorizations") : globalSettingsRoute("authorizations")} />}>{t("video.voice.open_authorizations")}</Button>
          </div> : null}
          {!loading && mediaReady && activeVoice && (activeVoice.enabled || hasApplied) ? <fieldset disabled={busy || cloning} className="min-w-0 space-y-6">
            <div className="space-y-2">
              <h3 data-testid="voice-label" className="text-ui-control font-semibold">{t("video.voice.voice_label")}</h3>
              <div ref={voicePickerAnchorRef} className="relative">
              {activeVoice.selectionMode === "manual" && selectedVoiceReady ? <div data-testid="voice-selected-preview" className="absolute left-1 top-1/2 z-10 -translate-y-1/2">
                <VoicePreviewButton label={activeVoiceLabel} previewing={previewingVoiceId === activeVoice.voiceId} disabled={previewing} onPreview={() => void previewVoice()} />
              </div> : null}
              <Popover open={voicePickerOpen} onOpenChange={(open) => {
                setVoicePickerOpen(open);
                if (open) setActiveTab(activeVoice.source === "cloned" ? "mine" : "preset");
              }}>
                <PopoverTrigger render={<button type="button" data-testid="voice-selection-trigger" aria-label={`${t("video.voice.preset_tab")} / ${t("video.voice.my_voices_tab")}`} className={voiceFieldClassName + ` flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeVoice.selectionMode === "manual" && selectedVoiceReady ? "pl-9" : ""}`} />}>
                  <span className="min-w-0 truncate">{activeVoice.source === "cloned" ? activeVoiceLabel : activeVoice.selectionMode === "auto" ? hasApplied && appliedIds.length && !needsUpdate ? appliedLabel : t("video.voice.auto_title") : activeVoiceLabel}</span>
                  <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </PopoverTrigger>
                <PopoverContent data-testid="voice-picker" anchor={voicePickerAnchorRef} align="start" className={voiceMenuClassName + " w-(--anchor-width) gap-2 overflow-hidden"}>
                  <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value === "mine" ? "mine" : "preset")} className="min-h-0 gap-2">
                    <TabsList data-testid="voice-subtabs" className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 group-data-horizontal/tabs:h-[34px]">
                      <TabsTrigger value="preset" className="h-full rounded-md border-0 px-2 py-0 text-ui-control font-medium shadow-none data-active:shadow-none">{t("video.voice.preset_tab")}</TabsTrigger>
                      <TabsTrigger value="mine" className="h-full rounded-md border-0 px-2 py-0 text-ui-control font-medium shadow-none data-active:shadow-none">{t("video.voice.my_voices_tab")}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preset" className="min-h-0 space-y-2">
                      <PopoverTitle className="sr-only">{t("video.voice.official_presets")}</PopoverTitle>
                      <button type="button" data-testid="voice-auto-match" aria-pressed={activeVoice.source === "preset" && activeVoice.selectionMode === "auto"} onClick={() => void chooseAuto()} className={`flex h-12 w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-foreground/10 ${activeVoice.source === "preset" && activeVoice.selectionMode === "auto" ? "bg-foreground/10" : ""}`}>
                        <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{t("video.voice.auto_title")}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{t("video.voice.auto_help")}</span></span>
                        {activeVoice.source === "preset" && activeVoice.selectionMode === "auto" ? <Check aria-hidden="true" className="size-3.5 text-primary" /> : null}
                      </button>
                      <div className="flex shrink-0 items-center gap-2" data-testid="voice-search-toolbar">
                        <div className="relative min-w-0 flex-1">
                          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input value={voiceQuery} onChange={(event) => setVoiceQuery(event.currentTarget.value)} aria-label={t("video.voice.search_placeholder")} placeholder={t("video.voice.search_placeholder")} className="h-[34px] border-0 bg-muted/60 pl-8 text-xs shadow-none" />
                        </div>
                        <Popover>
                          <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t("video.voice.filters")} className={`relative size-[34px] shrink-0 rounded-lg bg-muted/60 ${filterCount ? "text-primary" : "text-muted-foreground"}`} />}>
                            <SlidersHorizontal aria-hidden="true" className="size-4" />
                            {filterCount ? <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-primary text-[9px] text-primary-foreground">{filterCount}</span> : null}
                          </PopoverTrigger>
                          <PopoverContent align="end" className={voiceMenuClassName + " w-64 gap-3"}>
                            <div className="flex items-center justify-between"><PopoverTitle className="text-xs font-medium">{t("video.voice.filters")}</PopoverTitle><Button variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-[11px]" disabled={!filterCount} onClick={() => { setLanguageFilter("all"); setGenderFilter("all"); setAgeFilter("all"); }}>{t("common.reset")}</Button></div>
                            <VoiceFilter value={languageFilter} options={BAILIAN_VOICE_LANGUAGES} label="language" onChange={(value) => setLanguageFilter(BAILIAN_VOICE_LANGUAGES.find((option) => option === value) ?? "all")} />
                            <VoiceFilter value={genderFilter} options={BAILIAN_VOICE_GENDERS} label="gender" onChange={(value) => setGenderFilter(BAILIAN_VOICE_GENDERS.find((option) => option === value) ?? "all")} />
                            <VoiceFilter value={ageFilter} options={BAILIAN_VOICE_AGES} label="age" onChange={(value) => setAgeFilter(BAILIAN_VOICE_AGES.find((option) => option === value) ?? "all")} />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div aria-label={t("video.voice.official_presets")} className="min-h-0 max-h-60 space-y-0.5 overflow-y-auto">
                        {filteredPresetVoices.map((voice) => {
                          const selected = activeVoice?.selectionMode === "manual" && activeVoice.source === "preset" && activeVoice.voiceId === voice.id;
                          return <div key={voice.id} className={`flex h-12 items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-foreground/10 ${selected ? "bg-foreground/10" : ""}`}>
                            <button data-testid="preset-voice-card" data-voice-id={voice.id} type="button" aria-pressed={selected} className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void choosePreset(voice.id)}>
                              <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{presetVoiceLabel(voice.id).slice(0, 1)}</span>
                              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{presetVoiceLabel(voice.id)}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t(`video.voice.preset_description.${voice.id}`)}</span></span>
                              {selected ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
                            </button>
                            <VoicePreviewButton label={presetVoiceLabel(voice.id)} previewing={previewingVoiceId === voice.id} disabled={previewing} onPreview={() => void previewVoice({ voiceId: voice.id, source: "preset", model: DEFAULT_COSYVOICE_MODEL })} />
                          </div>;
                        })}
                        {filteredPresetVoices.length === 0 ? <p className="rounded-xl bg-muted/40 px-3 py-5 text-center text-[11px] text-muted-foreground">{t("video.voice.no_matches")}</p> : null}
                      </div>
                    </TabsContent>
                    <TabsContent value="mine" data-testid="my-voice-picker" className="min-h-0 space-y-2">
                      {loadingMineData ? <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" />{t("video.voice.loading_my_voices")}</p> : null}
                      {customVoices.length ? <>
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <PopoverTitle className="text-ui-control font-medium">{t("video.voice.my_voices_tab")}<span className="ml-1.5 text-ui-caption font-normal text-muted-foreground">{customVoices.length}</span></PopoverTitle>
                    <Button variant="ghost" size="icon-xs" onClick={() => void loadMineData()} disabled={loadingMineData} aria-label={t("video.voice.refresh_my_voices")}>{loadingMineData ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button>
                  </div>
                  <div className="min-h-0 max-h-60 space-y-0.5 overflow-y-auto">{customVoices.map((voice) => {
                    const selected = activeVoice.source === "cloned" && activeVoice.voiceId === voice.id;
                    return <div key={voice.id} className={`flex min-h-[34px] items-center gap-1 rounded-lg pr-1 hover:bg-foreground/10 ${selected ? "bg-foreground/10" : ""}`}>
                      <button type="button" data-testid="custom-voice-option" disabled={!canSynthesizeCustomVoice(voice)} aria-pressed={selected} onClick={() => void chooseCustomVoice(voice.id)} className="flex min-h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                        <span className="min-w-0 flex-1 truncate">{voice.name}{voice.status === "OK" ? "" : ` · ${t(voice.status === "DEPLOYING" ? "video.voice.preparing" : "video.voice.unavailable")}`}</span>{selected ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
                      </button>
                      <VoicePreviewButton label={voice.name} previewing={previewingVoiceId === voice.id} disabled={previewing || !canSynthesizeCustomVoice(voice)} onPreview={() => void previewVoice({ voiceId: voice.id, source: "cloned", model: voice.model })} />
                    </div>;
                  })}</div>
                  <button type="button" data-testid="voice-clone-entry" onClick={openClone} className="mt-1 flex h-[34px] shrink-0 items-center gap-2 rounded-lg px-2 text-left text-ui-control hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus aria-hidden="true" className="size-3.5" />{t("video.voice.clone_new")}</button>
                      </> : !loadingMineData ? <div data-testid="voice-library-empty" className="space-y-3 rounded-lg bg-muted/45 px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">{t("video.voice.no_cloned")}</p>
                <Button variant="outline" data-testid="voice-clone-entry" className="h-[34px] rounded-lg text-xs" onClick={openClone}><Plus className="size-3.5" />{t("video.voice.clone_new")}</Button>
                <button type="button" className="mx-auto block text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void loadMineData()}>{t("video.voice.refresh_my_voices")}</button>
                      </div> : null}
                    </TabsContent>
                  </Tabs>
                </PopoverContent>
              </Popover>
              </div>
              {hasApplied ? <p data-testid="voice-applied" role="status" className={`text-xs leading-5 ${appliedIds.length ? "font-medium text-[#087C82] dark:text-[#6CDBE0]" : "text-warning"}`}>{appliedIds.length ? t("video.voice.applied_label", { label: appliedLabel }) : t("video.voice.applied_unknown")}</p> : null}
            </div>
            {selectedVoiceReady ? <VoiceControls settings={activeVoice} onChange={(changes) => void updateSettings(changes)} /> : null}
            {selectedVoiceReady ? <div className="space-y-2">
              {hasApplied && appliedMetadataKnown && needsUpdate && !busy ? <p data-testid="voice-pending-changes" className="text-[11px] text-muted-foreground">{t("video.voice.pending_changes")}</p> : null}
              <VoiceAiButton disabled={busy || cloning || readingApplied || appliedReadFailed || !needsUpdate} busy={busy} label={actionLabel} onClick={() => void generateVoiceover()} />
            </div> : null}
          </fieldset> : null}
          <Dialog open={cloneOpen} onOpenChange={(open) => { if (!cloning) setCloneOpen(open); }}>
            <DialogContent data-testid="voice-clone-dialog" className="video-settings-typography max-w-md gap-0 rounded-xl p-5 text-ui-control" showCloseButton={!cloning}>
              <DialogHeader className="gap-1 pr-8">
                <DialogTitle className="text-ui-title-sm font-semibold">{t("video.voice.clone_new")}</DialogTitle>
                <DialogDescription className="text-ui-control leading-5">{t("video.voice.clone_description")}</DialogDescription>
              </DialogHeader>
              <form className="mt-5 space-y-4" onSubmit={event => {
                event.preventDefault();
                if (sampleBusy) { setCloneError(t("video.voice.clone_finish_recording")); return; }
                if (!cloneName.trim()) { setCloneError(t("video.voice.clone_name_required")); return; }
                if (!cloneFile) { setCloneError(t("video.voice.clone_sample_required")); return; }
                void cloneVoice(cloneFile, cloneName);
              }}>
                <div className="flex flex-col gap-1.5"><label htmlFor={cloneNameId} className="text-ui-control font-medium leading-5">{t("video.voice.clone_name")}</label><Input id={cloneNameId} autoFocus aria-required="true" maxLength={80} disabled={cloning} value={cloneName} onChange={event => { setCloneName(event.target.value); setCloneError(""); }} placeholder={t("video.voice.clone_name_placeholder")} className="h-[34px] border-0 bg-muted/60 text-ui-control shadow-none" /></div>
                {cloneOpen ? <VideoVoiceSample file={cloneFile} disabled={cloning} onFile={file => { setCloneFile(file); if (file) setCloneError(""); }} onError={setCloneError} onBusy={setSampleBusy} /> : null}
                {cloning ? <p data-testid="voice-clone-progress" role="status" className="flex items-center gap-2 text-ui-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t(`video.voice.clone_stage_${cloneStage}`)}</p> : null}
                {cloneError ? <p role="alert" className="text-ui-caption text-destructive">{cloneError}</p> : null}
                <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" disabled={cloning} className="h-[34px] rounded-lg text-ui-control" onClick={() => setCloneOpen(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={cloning} className="h-[34px] rounded-lg text-[length:var(--text-ui-control)] disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground">{cloning ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}{t(cloning ? "video.voice.cloning" : "video.voice.clone_action")}</Button></div>
              </form>
            </DialogContent>
          </Dialog>
          {message ? <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-4 text-muted-foreground" role="status">{message}</p> : null}
    </StudioInspectorPanel>
  );
}

function VoiceAiButton({ disabled, busy, label, onClick }: { disabled: boolean; busy: boolean; label: string; onClick: () => void }) {
  return <Button data-testid="voice-generate" type="button" className="h-[34px] w-full rounded-lg border-0 text-xs shadow-none before:shadow-none" size="sm" disabled={disabled} onClick={onClick}>
    {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <AudioLines aria-hidden="true" className="size-4" />}{label}
  </Button>;
}

function VoiceFilter({ value, options, label, onChange }: { value: string; options: readonly string[]; label: string; onChange: (value: string) => void }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{t(`video.voice.filter.${label}`)}</span><Select value={value} onValueChange={(next) => { if (next) onChange(next); }}><SelectTrigger className="h-[34px] data-[size=default]:h-[34px] w-32 border-0 bg-muted/60 px-2 text-xs" aria-label={t(`video.voice.filter.${label}`)}><SelectValue>{t(`video.voice.filter_value.${value}`)}</SelectValue></SelectTrigger><SelectContent align="start" className={voiceMenuClassName}>{options.map((option) => <SelectItem key={option} value={option}>{t(`video.voice.filter_value.${option}`)}</SelectItem>)}</SelectContent></Select></div>;
}

function VoicePreviewButton({ label, previewing, disabled, onPreview }: { label: string; previewing: boolean; disabled: boolean; onPreview: () => void }) {
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 rounded-md text-muted-foreground" aria-label={t("video.voice.preview_named", { label })} disabled={disabled} onClick={onPreview} />}>
      {previewing ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
    </TooltipTrigger>
    <TooltipContent>{t("video.voice.preview")}</TooltipContent>
  </Tooltip>;
}

const voiceMenuClassName = "video-settings-typography max-h-(--available-height) max-w-(--available-width) rounded-lg bg-popover p-1.5 text-xs [&_[role=option]]:min-h-[34px] [&_[role=option]]:px-2 [&_[role=option]]:py-1.5 [&_[role=option]]:text-xs [&_[role=option]]:font-normal [&_[role=option][data-selected]]:bg-foreground/10 [&_[data-slot=select-item]>span:last-child]:text-primary";
const voiceFieldClassName = "h-[34px] data-[size=default]:h-[34px] w-full min-w-0 rounded-lg border-0 bg-muted/45 px-3 text-xs font-normal text-foreground shadow-none [&_svg]:size-3.5";
const voiceParameterRowClassName = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] items-center gap-3";

function VoiceControls({ settings, onChange }: { settings: VideoVoiceoverSettings; onChange: (changes: Partial<VideoVoiceoverSettings>) => void }) {
  const style = videoVoiceStyle(settings.instruction);
  const styleId = React.useId();
  return <section data-testid="voice-delivery-controls" aria-label={t("video.voice.delivery_title")} className="space-y-3">
    <h3 className="text-ui-control font-semibold">{t("video.voice.delivery_title")}</h3>
    <div className="space-y-2">
      <div className={voiceParameterRowClassName}>
        <label htmlFor={styleId} className="text-xs font-normal text-foreground">{t("video.voice.style")}</label>
        <Select value={style} onValueChange={(value) => { const next = BAILIAN_VOICE_STYLES.find((option) => option === value); if (next) onChange({ instruction: videoVoiceInstruction(next) }); }}>
          <SelectTrigger id={styleId} aria-label={t("video.voice.style")} className={voiceFieldClassName}><SelectValue>{t(`video.voice.style_value.${style}`)}</SelectValue></SelectTrigger>
          <SelectContent align="start" className={voiceMenuClassName}>{BAILIAN_VOICE_STYLES.map((option) => <SelectItem key={option} value={option}>{t(`video.voice.style_value.${option}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <VoiceParameterControl label={t("video.voice.rate")} value={settings.rate} min={0.5} max={2} step={0.05} options={[{ value: 0.75, label: t("video.voice.speed.slow") }, { value: 1, label: t("video.voice.standard") }, { value: 1.25, label: t("video.voice.speed.faster") }, { value: 1.5, label: t("video.voice.speed.fast") }]} format={(value) => `${Number.isInteger(value) ? value.toFixed(2) : value}×`} onCommit={(rate) => onChange({ rate })} />
      <VoiceParameterControl label={t("video.voice.pitch")} value={settings.pitch} min={0.5} max={2} step={0.05} options={[{ value: 0.9, label: t("video.voice.pitch_low") }, { value: 1, label: t("video.voice.standard") }, { value: 1.1, label: t("video.voice.pitch_high") }]} format={(value) => `${Number.isInteger(value) ? value.toFixed(2) : value}×`} onCommit={(pitch) => onChange({ pitch })} />
      <VoiceParameterControl label={t("video.voice.volume")} value={settings.volume} min={0} max={100} step={1} options={[25, 50, 75, 100].map((value) => ({ value, label: "" }))} format={(value) => `${value}%`} onCommit={(volume) => onChange({ volume })} />
    </div>
  </section>;
}

function VoiceParameterControl({ label, value, min, max, step, options, format, onCommit }: { label: string; value: number; min: number; max: number; step: number; options: { value: number; label: string }[]; format: (value: number) => string; onCommit: (value: number) => void }) {
  const id = React.useId();
  const customInputRef = React.useRef<HTMLInputElement>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);
  const selected = options.find(option => option.value === value);
  const optionLabel = (option: { value: number; label: string }) => `${option.label ? `${option.label} ` : ""}${format(option.value)}`;
  const commit = (input: HTMLInputElement) => {
    const next = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(next) || next < min || next > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    if (next !== value) onCommit(next);
  };
  return <div className={voiceParameterRowClassName}>
    <label htmlFor={id} className="text-xs font-normal text-foreground">{label}</label>
    <div className="relative min-w-0">
      {editing ? <Input ref={customInputRef} id={id} autoFocus type="number" min={min} max={max} step={step} value={draft} aria-label={t("video.voice.custom_label", { label })} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} className={`${voiceFieldClassName} pr-10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }} onBlur={(event) => { if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) return; commit(event.currentTarget); }} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); event.currentTarget.value = String(value); event.currentTarget.blur(); setEditing(false); setInvalid(false); }
      }} /> : null}
      <Select value={editing ? "custom" : String(value)} onValueChange={(next) => {
        if (next === "custom") { setDraft(String(value)); setInvalid(false); setEditing(true); return; }
        if (next === String(value)) { setEditing(false); setInvalid(false); return; }
        const option = options.find(option => String(option.value) === next);
        if (option) { setEditing(false); setInvalid(false); if (option.value !== value) onCommit(option.value); }
      }}>
        <SelectTrigger id={editing ? undefined : id} aria-label={label} className={editing ? `${voiceFieldClassName} absolute right-0 top-0 w-8 justify-center bg-transparent px-0` : voiceFieldClassName}>
          {editing ? <span className="sr-only">{label}</span> : <SelectValue>{selected ? optionLabel(selected) : format(value)}</SelectValue>}
        </SelectTrigger>
        <SelectContent align="start" className={voiceMenuClassName} finalFocus={() => customInputRef.current ?? true}>
          {!selected ? <SelectItem value={String(value)}>{format(value)}</SelectItem> : null}
          {options.map(option => <SelectItem key={option.value} value={String(option.value)}>{optionLabel(option)}</SelectItem>)}
          <SelectItem value="custom">{t("video.voice.custom")}</SelectItem>
        </SelectContent>
      </Select>
      {invalid ? <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] text-destructive">{t("video.voice.valid_range", { min, max })}</p> : null}
    </div>
  </div>;
}
