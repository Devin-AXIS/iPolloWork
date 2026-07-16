/** @jsxImportSource react */
import * as React from "react";
import { AudioLines, Check, FileAudio, Loader2, Play, RefreshCw, Upload, X } from "lucide-react";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return error instanceof Error ? error.message : "操作没有完成，请稍后重试。";
}

function canSynthesizeCustomVoice(voice: CustomVoice | undefined) {
  return voice?.status === "OK";
}

function customVoiceAvailabilityMessage(voice: CustomVoice | undefined) {
  if (!voice) return "没有在当前百炼账号中找到这个复刻音色。请刷新后重新选择。";
  if (voice.status === "DEPLOYING") return "该复刻音色正在百炼审核中，状态变为 OK 后才能试听和使用。";
  if (voice.status === "UNDEPLOYED") return "该复刻音色未通过百炼审核，无法试听或使用。";
  return "该复刻音色暂未就绪。请刷新状态后重试。";
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
      audio.onerror = () => reject(new Error("无法读取音频时长。"));
      audio.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function VideoVoicePanel({ sessionId, workspaceRoot, client, workspaceId, previewRequest, onClose }: VideoVoicePanelProps) {
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const handledPreviewRequestRef = React.useRef(0);
  const [settings, setSettings] = React.useState<LoadedSettings>({ settings: null, updatedAt: null });
  const [presetVoiceId, setPresetVoiceId] = React.useState("");
  const [customVoices, setCustomVoices] = React.useState<CustomVoice[]>([]);
  const [mediaReady, setMediaReady] = React.useState(false);
  const [storageReady, setStorageReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [refreshingVoices, setRefreshingVoices] = React.useState(false);
  const [cloning, setCloning] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const activeVoice = settings.settings;
  const context = React.useMemo(() => ({ directory: workspaceRoot }), [workspaceRoot]);

  const loadCustomVoices = React.useCallback(async () => {
    if (!client || !mediaReady) return [];
    const result = await client.callMedia("voice_list", {}, context);
    if (!result.ok) throw new Error(result.message);
    const voices = customVoicesFrom(result.result);
    setCustomVoices(voices);
    return voices;
  }, [client, context, mediaReady]);

  const refreshCustomVoices = React.useCallback(async () => {
    setRefreshingVoices(true);
    try {
      await loadCustomVoices();
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setRefreshingVoices(false);
    }
  }, [loadCustomVoices]);

  const saveSettings = React.useCallback(async (next: VideoVoiceoverSettings) => {
    if (!client || !workspaceId) throw new Error("当前工作区尚未准备好。");
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
      setMessage("先选择一个百炼音色，再试听。");
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
        text: "你好，这是当前视频的配音效果试听。",
        voice: activeVoice.voiceId,
        model,
        format: "mp3",
      }, context);
      if (!result.ok) throw new Error(result.message);
      const url = synthesizedAudioUrl(mediaOutput(result.result));
      if (!url) throw new Error("百炼已完成合成，但没有返回可播放的试听地址。");
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
    const invalid = validateVoiceSampleFile(file);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    if (!client || !workspaceId || !mediaReady || !storageReady) return;
    setCloning(true);
    setMessage("");
    let samplePath: string | null = null;
    try {
      const duration = await readAudioDuration(file);
      if (!Number.isFinite(duration) || duration < 10 || duration > 60) {
        throw new Error("样本时长需为 10–60 秒；推荐 10–20 秒的清晰人声。");
      }
      samplePath = voiceSampleWorkspacePath(sessionId, file.name);
      await client.writeWorkspaceBinaryFile(workspaceId, { path: samplePath, data: await file.arrayBuffer() });
      const result = await client.callMedia("voice_clone_workspace_file", { sourcePath: samplePath }, context);
      if (!result.ok) throw new Error(result.message);
      const output = mediaOutput(result.result);
      const voiceId = readString(output, "voiceId");
      const model = readString(output, "model") || DEFAULT_COSYVOICE_MODEL;
      if (!voiceId) throw new Error("百炼没有返回可用的声音 ID。");
      const clonedVoice = (await loadCustomVoices()).find((voice) => voice.id === voiceId);
      if (!canSynthesizeCustomVoice(clonedVoice)) {
        setMessage(`${customVoiceAvailabilityMessage(clonedVoice)} 刷新后即可选择。`);
        return;
      }
      await saveSettings(voiceSettings(voiceId, "cloned", model));
      setMessage("声音已复刻并设为当前视频的配音。");
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      if (samplePath) await client.deleteWorkspaceFiles(workspaceId, [{ path: samplePath }]).catch(() => undefined);
      setCloning(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [client, context, loadCustomVoices, mediaReady, saveSettings, sessionId, storageReady, workspaceId]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void (async () => {
      if (!client || !workspaceId) {
        if (!cancelled) {
          setMediaReady(false);
          setStorageReady(false);
          setLoading(false);
        }
        return;
      }
      try {
        const [media, storage, saved] = await Promise.all([
          client.callMedia("status", {}, context),
          client.callStorage("status", {}, context),
          client.readWorkspaceFile(workspaceId, videoVoiceoverSettingsPath(sessionId)).catch(() => null),
        ]);
        if (cancelled) return;
        const configured = media.ok && mediaConfigured(media.result);
        setMediaReady(configured);
        setStorageReady(storage.ok && storageConfigured(storage.result));
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
              setMessage("已将旧版百炼音色升级为兼容 CosyVoice v3 的音色。");
            } catch (error) {
              setSettings({ settings: restored, updatedAt: saved.updatedAt });
              setMessage(`已在本次打开中使用兼容音色；保存升级失败：${readableError(error)}`);
            }
          } else {
            setSettings({ settings: restored, updatedAt: saved.updatedAt });
          }
          if (restored?.source === "preset") setPresetVoiceId(restored.voiceId);
        }
        if (configured) {
          const voices = await client.callMedia("voice_list", {}, context);
          if (!cancelled && voices.ok) setCustomVoices(customVoicesFrom(voices.result));
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
    if (loading || previewRequest <= handledPreviewRequestRef.current) return;
    handledPreviewRequestRef.current = previewRequest;
    void previewVoice();
  }, [loading, previewRequest, previewVoice]);

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[22rem] max-w-[calc(100%-2rem)] flex-col border-l border-border bg-popover/95 shadow-2xl backdrop-blur-xl" aria-label="视频配音设置" data-testid="video-voice-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <AudioLines className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">配音</p>
          <p className="truncate text-[10px] text-muted-foreground">阿里百炼 · 仅保存当前视频的音色</p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => void previewVoice()} disabled={!activeVoice || previewing} aria-label="试听当前音色">
          {previewing ? <Loader2 className="animate-spin" /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="关闭配音设置"><X /></Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ScrollAreaViewport className="px-3 py-3">
          {loading ? <div className="grid min-h-40 place-items-center text-xs text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />正在读取百炼配置…</div> : null}
          {!loading && !mediaReady ? <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-5 text-muted-foreground"><p className="font-medium text-foreground">请先配置阿里百炼</p><p className="mt-1">在授权中心保存百炼 API Key 后，即可选择和试听音色。</p></div> : null}
          {!loading && mediaReady ? <Tabs defaultValue="preset" className="gap-3">
            <TabsList className="w-full bg-muted/60">
              <TabsTrigger value="preset"><AudioLines />百炼音色</TabsTrigger>
              <TabsTrigger value="mine"><FileAudio />我的声音</TabsTrigger>
            </TabsList>
            <TabsContent value="preset" className="space-y-3">
              <div>
                <p className="text-xs font-medium">官方预置音色</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">选择后立即保存在此视频项目中，不会写入时间线。</p>
              </div>
              <Select value={presetVoiceId} onValueChange={(value) => { if (value) void choosePreset(value); }}>
                <SelectTrigger className="w-full" aria-label="百炼官方音色"><SelectValue placeholder="选择一个官方音色" /></SelectTrigger>
                <SelectContent alignItemWithTrigger><SelectGroup><SelectLabel>CosyVoice</SelectLabel>{BAILIAN_PRESET_VOICES.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.label} · {voice.description}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              {activeVoice?.source === "preset" ? <SelectedVoice voiceId={activeVoice.voiceId} label={BAILIAN_PRESET_VOICES.find((voice) => voice.id === activeVoice.voiceId)?.label ?? activeVoice.voiceId} /> : null}
            </TabsContent>
            <TabsContent value="mine" className="space-y-3">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">我复刻的声音</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">复刻样本会通过私有临时链接交给百炼，完成后自动清理。</p></div><Button variant="ghost" size="icon-xs" onClick={() => void refreshCustomVoices()} disabled={refreshingVoices} aria-label="刷新我的声音">{refreshingVoices ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></div>
              <Select value={activeVoice?.source === "cloned" ? activeVoice.voiceId : ""} onValueChange={(value) => { if (value) void chooseCustomVoice(value); }}>
                <SelectTrigger className="w-full" aria-label="我的百炼声音"><SelectValue placeholder={customVoices.length ? "选择已复刻的声音" : "还没有复刻的声音"} /></SelectTrigger>
                <SelectContent alignItemWithTrigger><SelectGroup>{customVoices.map((voice) => <SelectItem key={voice.id} value={voice.id} disabled={!canSynthesizeCustomVoice(voice)}>{voice.name}{voice.status === "OK" ? "" : ` · ${voice.status}`}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <input ref={uploadInputRef} type="file" accept="audio/wav,audio/mpeg,audio/mp4,.wav,.mp3,.m4a" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void cloneVoice(file); }} />
              <div className="rounded-xl border border-dashed border-border bg-muted/25 p-3">
                <p className="text-xs font-medium">复刻自己的声音</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">WAV、MP3、M4A；10–60 秒、最大 10 MB。推荐 10–20 秒清晰人声。</p>
                {!storageReady ? <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">复刻需要先在授权中心配置 OSS 或 Wasabi。</p> : null}
                <Button className="mt-3 w-full" variant="outline" size="sm" disabled={!storageReady || cloning} onClick={() => uploadInputRef.current?.click()}>{cloning ? <Loader2 className="animate-spin" /> : <Upload />}复刻声音</Button>
              </div>
              {activeVoice?.source === "cloned" ? <SelectedVoice voiceId={activeVoice.voiceId} label={customVoices.find((voice) => voice.id === activeVoice.voiceId)?.name ?? "当前复刻声音"} /> : null}
            </TabsContent>
          </Tabs> : null}
          {message ? <p className="mt-3 rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-4 text-muted-foreground" role="status">{message}</p> : null}
        </ScrollAreaViewport>
      </ScrollArea>
    </aside>
  );
}

function SelectedVoice({ voiceId, label }: { voiceId: string; label: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs"><Check className="size-3.5 text-primary" /><div className="min-w-0"><p className="truncate font-medium">{label}</p><p className="truncate text-[10px] text-muted-foreground">{voiceId}</p></div></div>;
}
