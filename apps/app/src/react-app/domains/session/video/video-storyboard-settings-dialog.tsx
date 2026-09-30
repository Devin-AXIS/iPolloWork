import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import type { StoryboardSettingsAsset, StoryboardSettingsFields, StoryboardSettingsRequest } from "@ipollowork/types/hyperframes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";

/** One client-owned shell; the Studio remains the canonical Markdown editor. */
export function VideoStoryboardSettingsDialog({
  frameIndex, title, kind, request, voiceContent, disabled, onClose, onApply, onImport,
}: {
  frameIndex: number; title: string; kind: "picture" | "sound" | "voice";
  request?: StoryboardSettingsRequest;
  voiceContent?: React.ReactNode;
  disabled: boolean; onClose: () => void;
  onApply: (fields: StoryboardSettingsFields | undefined) => Promise<boolean>;
  onImport: (file: File) => Promise<StoryboardSettingsAsset[]>;
}) {
  const [fields, setFields] = React.useState(request?.fields);
  const [assets, setAssets] = React.useState(request?.assets ?? []);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);
  function update(key: keyof StoryboardSettingsFields, value: string) {
    setFields(current => current ? { ...current, [key]: value } : current);
  }
  const source = fields?.asset_source === "search" ? "auto" : fields?.asset_source || "generate";
  const referenceKey = kind === "sound" ? "sound_effect_reference" : "asset_reference";
  const selected = fields?.[referenceKey] ?? "";
  const selectedAsset = assets.find(asset => asset.path === selected);
  const candidates = assets.filter(asset => (kind === "sound" ? asset.kind === "audio"
    : asset.kind !== "audio" && (!fields?.asset_kind || fields.asset_kind === asset.kind))
    && asset.path.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  async function importFile(file: File) {
    setBusy(true); setError("");
    try {
      const imported = await onImport(file);
      const compatible = imported.filter(asset => kind === "sound" ? asset.kind === "audio" : asset.kind !== "audio" && (!fields?.asset_kind || fields.asset_kind === asset.kind));
      if (!compatible[0]) throw new Error(t("video.script.import_failed"));
      setAssets(current => [...current.filter(asset => !imported.some(item => item.path === asset.path)), ...imported]);
      update(referenceKey, compatible[0].path);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("video.script.import_failed")); }
    finally { setBusy(false); }
  }
  function assetPicker() {
    return <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-ui-control font-medium">{t("video.script.project_assets")}</h3>
        <Button variant="outline" size="sm" disabled={busy || disabled} onClick={() => input.current?.click()}><Upload className="size-3.5" />{t("video.script.import")}</Button>
        <input ref={input} type="file" hidden accept={kind === "sound" ? "audio/*" : "image/*,video/*"} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file);
        }} />
      </div>
      <Input aria-label={t("video.script.search_assets")} placeholder={t("video.script.search_assets")} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        {candidates.map(asset => <Button key={asset.path} variant={selected === asset.path ? "secondary" : "outline"} className="h-auto min-h-10 justify-start overflow-hidden px-3 py-2 text-left text-xs" aria-pressed={selected === asset.path} onClick={() => update(referenceKey, asset.path)}>
          <span className="truncate">{asset.path.split("/").at(-1)}</span>
        </Button>)}
      </div>
      {candidates.length === 0 && <p className="text-xs text-muted-foreground">{t("video.script.no_assets")}</p>}
      {selected && <div className="space-y-2 rounded-lg bg-muted/40 p-3">
        <div className="flex items-center justify-between gap-3"><p className="truncate text-xs" title={selected}>{selected}</p>
          <Button variant="ghost" size="sm" onClick={() => update(referenceKey, "")}>{t("video.script.clear")}</Button></div>
        {selectedAsset?.kind === "image" && <img src={selectedAsset?.url} alt="" className="max-h-40 w-full rounded-lg object-contain" />}
        {selectedAsset?.kind === "audio" && <audio controls preload="none" src={selectedAsset?.url} className="h-9 w-full" />}
        {selectedAsset?.kind === "video" && <video controls preload="metadata" src={selectedAsset?.url} className="max-h-40 w-full rounded-lg" />}
      </div>}
    </section>;
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent data-testid="storyboard-settings-dialog" data-kind={kind}
      className="flex h-[640px] max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[640px] flex-col gap-0 p-0 [&_button]:rounded-[8px]"
      showCloseButton={!busy}>
      <header className="shrink-0 border-b border-border px-6 py-5 pr-16">
        <DialogDescription className="text-ui-caption">{t("video.script.shot", { frame: String(frameIndex).padStart(2, "0") })} · {title}</DialogDescription>
        <DialogTitle className="mt-1">{t(`video.script.${kind}_title`)}</DialogTitle>
      </header>
      {kind === "voice" ? voiceContent : <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <fieldset disabled={disabled || busy} className="min-w-0 space-y-5">
          {kind === "picture" && fields && <>
            <section className="space-y-2">
              <h3 className="text-ui-control font-medium">{t("video.script.source")}</h3>
              <Select value={source} onValueChange={value => { if (value) update("asset_source", value); }}>
                <SelectTrigger className="w-full" aria-label={t("video.script.source")}><SelectValue>{t(`video.script.source_${source}`)}</SelectValue></SelectTrigger>
                <SelectContent>{["auto", "existing", "generate", "code"].map(value => <SelectItem key={value} value={value}>{t(`video.script.source_${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </section>
            {(source === "auto" || source === "generate") && <>
              <section className="space-y-2"><h3 className="text-ui-control font-medium">{t("video.script.media_type")}</h3>
                <Select value={fields.asset_kind || "auto"} onValueChange={value => { if (value) update("asset_kind", value === "auto" ? "" : value); }}>
                  <SelectTrigger className="w-full" aria-label={t("video.script.media_type")}><SelectValue>{t(`video.script.media_${fields.asset_kind || "auto"}`)}</SelectValue></SelectTrigger><SelectContent>{["auto", "image", "video"].map(value => <SelectItem key={value} value={value}>{t(`video.script.media_${value}`)}</SelectItem>)}</SelectContent>
                </Select>
              </section>
              <section className="space-y-2"><label htmlFor="shot-material-brief" className="text-ui-control font-medium">{t("video.script.brief")}</label>
                <Textarea id="shot-material-brief" rows={4} value={fields.asset_brief} onChange={event => update("asset_brief", event.target.value)} /></section>
            </>}
            {source !== "code" && <section className="space-y-2"><label htmlFor="shot-source-origin" className="text-ui-control font-medium">{t("video.script.origin")}</label>
              <Textarea id="shot-source-origin" rows={2} value={fields.asset_origin} onChange={event => update("asset_origin", event.target.value)} /></section>}
            {source === "existing" && assetPicker()}
            <details className="border-t border-border pt-4"><summary className="cursor-pointer text-ui-control font-medium">{t("video.script.more")}</summary>
              <div className="mt-4 space-y-4">
                <section className="space-y-2"><h3 className="text-ui-control font-medium">{t("video.script.camera")}</h3>
                  <Select value={request?.cameras.some(camera => camera.value === fields.camera) ? fields.camera : "custom"}
                    onValueChange={value => { if (value !== null && value !== "custom") update("camera", value); }}>
                    <SelectTrigger className="w-full" aria-label={t("video.script.camera")}><SelectValue>{request?.cameras.find(camera => camera.value === fields.camera)?.label ?? t("video.script.custom_camera")}</SelectValue></SelectTrigger><SelectContent>
                      <SelectItem value="custom">{t("video.script.custom_camera")}</SelectItem>
                      {request?.cameras.map(camera => <SelectItem key={camera.value} value={camera.value}>{camera.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input aria-label={t("video.script.camera_direction")} value={fields.camera} onChange={event => update("camera", event.target.value)} />
                </section>
                <section className="space-y-2"><label htmlFor="shot-transition" className="text-ui-control font-medium">{t("video.script.transition")}</label>
                  <Input id="shot-transition" value={fields.transition_in} onChange={event => update("transition_in", event.target.value)} /></section>
              </div>
            </details>
          </>}
          {kind === "sound" && fields && <><section className="space-y-2"><label htmlFor="shot-sound-effects" className="text-ui-control font-medium">{t("video.script.sound_cue")}</label>
            <Textarea id="shot-sound-effects" rows={4} value={fields.sound_effects} placeholder={t("video.script.sound_placeholder")} onChange={event => update("sound_effects", event.target.value)} /></section>{assetPicker()}</>}
        </fieldset>
      </div>}
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-6 py-4">
        <p role={error ? "alert" : undefined} className={error ? "text-ui-caption text-destructive" : "text-ui-caption text-muted-foreground"}>{error || t("video.voice.apply_help")}</p>
        <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" disabled={disabled || busy} onClick={async () => {
            setBusy(true); setError("");
            try { if (await onApply(fields)) onClose(); else setError(t("video.script.stale")); }
            catch (cause) { setError(cause instanceof Error ? cause.message : t("video.script.stale")); }
            finally { setBusy(false); }
          }}>{busy && <Loader2 className="size-3.5 animate-spin" />}{t("video.voice.apply_script")}</Button></div>
      </footer>
    </DialogContent>
  </Dialog>;
}
